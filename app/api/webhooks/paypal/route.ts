/**
 * POST /api/webhooks/paypal
 *
 * PayPal webhook receiver.
 *
 * Flow:
 *   1. Reject non-POST and wrong content-type
 *   2. Read raw body (verbatim — PayPal's verify endpoint takes the
 *      raw JSON in its `webhook_event` field)
 *   3. Verify via PayPal's /v1/notifications/verify-webhook-signature
 *      (we pass the 6 transmission headers + raw body + our webhook id)
 *   4. Dispatch on event_type:
 *        - CHECKOUT.ORDER.COMPLETED       -> mark Superchat PAID
 *        - PAYMENT.CAPTURE.COMPLETED      -> mark Superchat PAID
 *        - PAYMENT.CAPTURE.REFUNDED       -> mark REFUNDED
 *   5. Always 200 quickly; Superchat.webhookVerified + status check
 *      make at-least-once delivery safe
 *
 * The Superchat row is found by `gatewayOrderId == <paypal order id>`.
 * For capture events, the order id lives under
 * `resource.supplementary_data.related_ids.order_id`.
 */
import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { tierForInr, usdToInrPaise } from "@/lib/tier";
import { issueInvoice } from "@/lib/invoice-issuer";
import {
  parsePayPalWebhook,
  verifyPayPalWebhook,
  type PayPalWebhookEvent,
  type PayPalWebhookHeaders,
} from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function rejectIfInvalidShape(request: Request): NextResponse | null {
  if (request.method !== "POST") {
    return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
  }
  const ct = request.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { error: "unsupported_media_type" },
      { status: 415 },
    );
  }
  return null;
}

/**
 * Extract the PayPal order id from a webhook event resource.
 * Different event types put it in different fields.
 */
function paypalOrderIdFromEvent(ev: PayPalWebhookEvent): string | null {
  // CHECKOUT.ORDER.* — resource IS the order (id is the order id).
  if (ev.event_type.startsWith("CHECKOUT.ORDER.")) {
    return ev.resource.id;
  }
  // PAYMENT.CAPTURE.* — resource.id is the capture id; order id is
  // buried in supplementary_data.related_ids.order_id.
  const orderId = ev.resource.supplementary_data?.related_ids?.order_id;
  return orderId ?? null;
}

type ApplyResult =
  | { ok: true; superchatId: string }
  | { ok: false; reason: string };

async function applyCaptured(
  ev: PayPalWebhookEvent,
): Promise<ApplyResult> {
  const orderId = paypalOrderIdFromEvent(ev);
  if (!orderId) return { ok: false, reason: "no_order_id" };

  const superchat = await prisma.superchat.findUnique({
    where: { gatewayOrderId: orderId },
  });
  if (!superchat) return { ok: false, reason: "unknown_order" };
  if (superchat.webhookVerified && superchat.status === "PAID") {
    return { ok: true, superchatId: superchat.id };
  }

  // The capture resource carries the verified amount in `amount.value`
  // (USD dollars string) plus `amount.currency_code`. We trust that
  // over the preview.
  const verifiedUsdString = ev.resource.amount?.value;
  if (!verifiedUsdString) {
    return { ok: false, reason: "no_amount_on_event" };
  }
  const verifiedUsdCents = Math.round(parseFloat(verifiedUsdString) * 100);
  if (!Number.isFinite(verifiedUsdCents) || verifiedUsdCents <= 0) {
    return { ok: false, reason: "invalid_amount" };
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const inrPerUsd = settings ? Number(settings.inrPerUsd) : 83;
  const inrEquivalentPaise = usdToInrPaise(verifiedUsdCents, inrPerUsd);
  const tier = tierForInr(inrEquivalentPaise / 100);

  if (verifiedUsdCents !== superchat.amountPaise) {
    log.warn("payments.paypal.amount_mismatch", {
      superchatId: superchat.id,
      note: `preview=${superchat.amountPaise} verified=${verifiedUsdCents}`,
    });
  }

  await prisma.superchat.update({
    where: { id: superchat.id },
    data: {
      status: "PAID",
      webhookVerified: true,
      amountPaise: verifiedUsdCents,
      inrEquivalentPaise,
      tier: tier.tier,
      paidAt: new Date(),
    },
  });
  return { ok: true, superchatId: superchat.id };
}

async function applyRefund(ev: PayPalWebhookEvent): Promise<ApplyResult> {
  const orderId = paypalOrderIdFromEvent(ev);
  if (!orderId) return { ok: false, reason: "no_order_id" };
  const superchat = await prisma.superchat.findUnique({
    where: { gatewayOrderId: orderId },
  });
  if (!superchat) return { ok: false, reason: "unknown_order" };
  if (superchat.status === "REFUNDED") {
    return { ok: true, superchatId: superchat.id };
  }
  await prisma.superchat.update({
    where: { id: superchat.id },
    data: { status: "REFUNDED", refundedAt: new Date() },
  });
  return { ok: true, superchatId: superchat.id };
}

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const shape = rejectIfInvalidShape(request);
  if (shape) return shape;

  const env = serverEnv();
  if (!env.PAYPAL_WEBHOOK_ID) {
    log.error("payments.paypal.webhook_id_missing", new Error("PAYPAL_WEBHOOK_ID unset"));
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const headers: PayPalWebhookHeaders = {
    authAlgo: request.headers.get("paypal-auth-algo") ?? "",
    certUrl: request.headers.get("paypal-cert-url") ?? "",
    certId: request.headers.get("paypal-cert-id") ?? "",
    transmissionId: request.headers.get("paypal-transmission-id") ?? "",
    transmissionSig: request.headers.get("paypal-transmission-sig") ?? "",
    transmissionTime: request.headers.get("paypal-transmission-time") ?? "",
  };

  // Fail closed if any header is missing.
  if (
    !headers.authAlgo ||
    !headers.certUrl ||
    !headers.certId ||
    !headers.transmissionId ||
    !headers.transmissionSig ||
    !headers.transmissionTime
  ) {
    return NextResponse.json({ error: "missing headers" }, { status: 400 });
  }

  const valid = await verifyPayPalWebhook({ headers, rawBody });
  if (!valid) {
    log.warn("payments.paypal.webhook_signature_invalid");
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let ev: PayPalWebhookEvent;
  try {
    ev = parsePayPalWebhook(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  let result: ApplyResult;
  switch (ev.event_type) {
    case "CHECKOUT.ORDER.COMPLETED":
    case "PAYMENT.CAPTURE.COMPLETED":
      result = await applyCaptured(ev);
      break;
    case "PAYMENT.CAPTURE.REFUNDED":
      result = await applyRefund(ev);
      break;
    default:
      log.info("payments.paypal.unhandled_event", { type: ev.event_type });
      return NextResponse.json({ ok: true, ignored: true });
  }

  if (!result.ok) {
    log.warn("payments.paypal.webhook_unknown", { reason: result.reason });
    return NextResponse.json({ ok: true, ignored: true });
  }

  log.info("payments.paypal.webhook_applied", {
    superchatId: result.superchatId,
    type: ev.event_type,
  });

  if (
    ev.event_type === "CHECKOUT.ORDER.COMPLETED" ||
    ev.event_type === "PAYMENT.CAPTURE.COMPLETED"
  ) {
    issueInvoice({ superchatId: result.superchatId }).catch((e) =>
      log.error("invoice.issue_failed", e instanceof Error ? e : new Error(String(e)), {
        superchatId: result.superchatId,
      }),
    );
  }

  return NextResponse.json({ ok: true });
}