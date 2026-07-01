/**
 * POST /api/webhooks/razorpay
 *
 * Razorpay webhook receiver.
 *
 * Flow:
 *   1. Reject non-POST and wrong content-type
 *   2. Read raw body (verbatim — JSON.parse normalizes whitespace and
 *      breaks the HMAC)
 *   3. Verify X-Razorpay-Signature using RAZORPAY_WEBHOOK_SECRET
 *   4. Idempotency: at-least-once delivery is the norm. We process
 *      `payment.captured` / `payment.failed` / `refund.processed` and
 *      the Superchat row's `webhookVerified` flag prevents double-apply
 *   5. Update Superchat: status, tier recompute, gatewayPaymentId, paidAt
 *   6. Always return 200 quickly so Razorpay doesn't retry
 *
 * Security notes:
 *   - The secret is bound to this endpoint in the Razorpay dashboard;
 *     if the signature fails, we return 400 and DO NOT process.
 *   - We never log the signature header or raw body — they may contain
 *     PII (notes we put in the order).
 *   - Webhooks bypass the proxy-level rate limiter (excluded in
 *     proxy.ts matcher); the HMAC is our only gate.
 */
import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { tierForInr } from "@/lib/tier";
import { issueInvoice } from "@/lib/invoice-issuer";
import {
  parseRazorpayWebhook,
  verifyRazorpayWebhookSignature,
  type RazorpayWebhookEvent,
} from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reject non-POST + wrong content-type. Razorpay sends `application/json`
 * but its signatures are over the raw body, so we read `request.text()`.
 */
function rejectIfInvalidShape(request: Request): NextResponse | null {
  if (request.method !== "POST") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const ct = request.headers.get("content-type") ?? "";
  // Razorpay sometimes sends charset. Accept any application/json.
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "unsupported_media_type" },
      { status: 415 },
    );
  }
  return null;
}

/**
 * Apply a successful payment to the Superchat row.
 *
 * Razorpay sends the amount in paise. We recompute the tier server-side
 * from the verified amount — never trust the client-side preview.
 *
 * The Superchat row's `webhookVerified` flag is set true so a duplicate
 * delivery is a no-op.
 */
async function applyCapturedPayment(
  ev: RazorpayWebhookEvent,
): Promise<{ ok: true; superchatId: string } | { ok: false; reason: string }> {
  const payment = ev.payload.payment?.entity;
  if (!payment) return { ok: false, reason: "missing_payment_entity" };

  const rzpOrderId = payment.order_id;
  const superchat = await prisma.superchat.findUnique({
    where: { gatewayOrderId: rzpOrderId },
  });
  if (!superchat) {
    // Unknown order id — Razorpay is talking about something we never
    // created. Drop it; do not crash.
    return { ok: false, reason: "unknown_order" };
  }
  if (superchat.webhookVerified && superchat.status === "PAID") {
    // Idempotent replay — already applied.
    return { ok: true, superchatId: superchat.id };
  }

  // Verify the verified amount matches the preview. If the gateway
  // somehow captured more (or less) than we asked for, we still trust
  // the verified amount for tier assignment — but we never upgrade a
  // donor past what they confirmed.
  const verifiedAmountPaise = payment.amount;
  if (verifiedAmountPaise !== superchat.amountPaise) {
    log.warn("payments.razorpay.amount_mismatch", {
      superchatId: superchat.id,
      note: `preview=${superchat.amountPaise} verified=${verifiedAmountPaise}`,
    });
  }

  // For INR payments, inrEquivalentPaise == amountPaise.
  const tier = tierForInr(verifiedAmountPaise / 100);

  await prisma.superchat.update({
    where: { id: superchat.id },
    data: {
      status: "PAID",
      webhookVerified: true,
      gatewayPaymentId: payment.id,
      // Trust verified amount.
      amountPaise: verifiedAmountPaise,
      inrEquivalentPaise: verifiedAmountPaise,
      tier: tier.tier,
      paidAt: new Date(),
    },
  });

  return { ok: true, superchatId: superchat.id };
}

async function applyFailedPayment(
  ev: RazorpayWebhookEvent,
): Promise<{ ok: true; superchatId: string } | { ok: false; reason: string }> {
  const payment = ev.payload.payment?.entity;
  if (!payment) return { ok: false, reason: "missing_payment_entity" };
  const superchat = await prisma.superchat.findUnique({
    where: { gatewayOrderId: payment.order_id },
  });
  if (!superchat) return { ok: false, reason: "unknown_order" };
  if (superchat.status === "PAID") {
    // Race: webhook arrived after we already applied captured. Leave
    // the PAID row alone — refunds flow through `refund.processed`.
    return { ok: true, superchatId: superchat.id };
  }
  await prisma.superchat.update({
    where: { id: superchat.id },
    data: {
      status: "FAILED",
      webhookVerified: true,
    },
  });
  return { ok: true, superchatId: superchat.id };
}

async function applyRefund(
  ev: RazorpayWebhookEvent,
): Promise<{ ok: true; superchatId: string } | { ok: false; reason: string }> {
  const payment = ev.payload.payment?.entity;
  if (!payment) return { ok: false, reason: "missing_payment_entity" };
  const superchat = await prisma.superchat.findUnique({
    where: { gatewayOrderId: payment.order_id },
  });
  if (!superchat) return { ok: false, reason: "unknown_order" };
  if (superchat.status === "REFUNDED") {
    return { ok: true, superchatId: superchat.id };
  }
  await prisma.superchat.update({
    where: { id: superchat.id },
    data: {
      status: "REFUNDED",
      refundedAt: new Date(),
    },
  });
  return { ok: true, superchatId: superchat.id };
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Shape check.
  const shape = rejectIfInvalidShape(request);
  if (shape) return shape;

  // 2. Raw body.
  const rawBody = await request.text();

  // 3. Signature verification.
  const env = serverEnv();
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    log.error("payments.razorpay.webhook_secret_missing", new Error("RAZORPAY_WEBHOOK_SECRET unset"));
    // Fail closed: no secret configured = no processing.
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }
  const signature = request.headers.get("x-razorpay-signature");
  const ok = verifyRazorpayWebhookSignature({
    rawBody,
    signature,
    secret: env.RAZORPAY_WEBHOOK_SECRET,
  });
  if (!ok) {
    log.warn("payments.razorpay.webhook_signature_invalid");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  // 4. Parse + dispatch.
  let ev: RazorpayWebhookEvent;
  try {
    ev = parseRazorpayWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  let result: { ok: true; superchatId: string } | { ok: false; reason: string };
  switch (ev.event) {
    case "payment.captured":
    case "order.paid":
      result = await applyCapturedPayment(ev);
      break;
    case "payment.failed":
      result = await applyFailedPayment(ev);
      break;
    case "refund.processed":
      result = await applyRefund(ev);
      break;
    default:
      // Unhandled event types still get a 200 so Razorpay doesn't retry.
      log.info("payments.razorpay.unhandled_event", { event: ev.event });
      return NextResponse.json({ ok: true, ignored: true });
  }

  if (!result.ok) {
    // Unknown order / missing payment entity: log and return 200 to
    // stop retries. We don't want Razorpay hammering us for events we
    // never created (test traffic from their dashboard, etc).
    log.warn("payments.razorpay.webhook_unknown", { reason: result.reason });
    return NextResponse.json({ ok: true, ignored: true });
  }

  log.info("payments.razorpay.webhook_applied", {
    superchatId: result.superchatId,
    event: ev.event,
  });

  // For PAID events, fire-and-forget invoice issuance. The webhook
  // itself returns 200 immediately so Razorpay doesn't retry; the
  // invoice work happens in the background.
  if (ev.event === "payment.captured" || ev.event === "order.paid") {
    issueInvoice({ superchatId: result.superchatId }).catch((e) =>
      log.error("invoice.issue_failed", e instanceof Error ? e : new Error(String(e)), {
        superchatId: result.superchatId,
      }),
    );
  }

  return NextResponse.json({ ok: true });
}
