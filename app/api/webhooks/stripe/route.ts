/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook receiver.
 *
 * Flow:
 *   1. Reject non-POST and wrong content-type
 *   2. Read raw body (verbatim — constructEvent uses HMAC over bytes)
 *   3. Verify with stripe.webhooks.constructEvent
 *   4. Dispatch on event type:
 *        - payment_intent.succeeded     -> mark Superchat PAID
 *        - payment_intent.payment_failed -> mark FAILED
 *        - charge.refunded               -> mark REFUNDED
 *   5. Always 200 quickly; the Superchat.webhookVerified flag and
 *      status check make at-least-once delivery safe
 *
 * The Superchat row is found by `gatewayOrderId == event.data.object.id`
 * (the PaymentIntent id we stored at create time).
 */
import { NextResponse } from "next/server";
import type Stripe from "stripe";

import { log } from "@/lib/log";
import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { tierForInr, usdToInrPaise } from "@/lib/tier";
import { issueInvoice } from "@/lib/invoice-issuer";
import { verifyStripeWebhookEvent } from "@/lib/stripe";

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

type ApplyResult =
  | { ok: true; superchatId: string }
  | { ok: false; reason: string };

async function applyPaymentIntent(
  intent: Stripe.PaymentIntent,
  nextStatus: "PAID" | "FAILED",
): Promise<ApplyResult> {
  const superchat = await prisma.superchat.findUnique({
    where: { gatewayOrderId: intent.id },
  });
  if (!superchat) return { ok: false, reason: "unknown_intent" };

  if (superchat.webhookVerified && superchat.status === "PAID") {
    return { ok: true, superchatId: superchat.id };
  }
  if (nextStatus === "FAILED" && superchat.status === "PAID") {
    // Late failure: leave the PAID row.
    return { ok: true, superchatId: superchat.id };
  }

  if (nextStatus === "PAID") {
    // Read the configured INR rate. We re-fetch the Settings row here
    // (not from the Superchat snapshot) because the rate is global.
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    const inrPerUsd = settings ? Number(settings.inrPerUsd) : 83;
    const verifiedAmountCents = intent.amount_received ?? intent.amount;
    const inrEquivalentPaise = usdToInrPaise(verifiedAmountCents, inrPerUsd);
    const tier = tierForInr(inrEquivalentPaise / 100);

    if (verifiedAmountCents !== superchat.amountPaise) {
      log.warn("payments.stripe.amount_mismatch", {
        superchatId: superchat.id,
        note: `preview=${superchat.amountPaise} verified=${verifiedAmountCents}`,
      });
    }

    await prisma.superchat.update({
      where: { id: superchat.id },
      data: {
        status: "PAID",
        webhookVerified: true,
        // Trust verified amount.
        amountPaise: verifiedAmountCents,
        inrEquivalentPaise,
        tier: tier.tier,
        paidAt: new Date(),
      },
    });
  } else {
    await prisma.superchat.update({
      where: { id: superchat.id },
      data: { status: "FAILED", webhookVerified: true },
    });
  }
  return { ok: true, superchatId: superchat.id };
}

async function applyRefund(charge: Stripe.Charge): Promise<ApplyResult> {
  // Stripe sends refunds as charge.refunded; the original PaymentIntent
  // id is on charge.payment_intent. We look up the Superchat by intent.
  const intentId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (!intentId) return { ok: false, reason: "no_intent_on_charge" };
  const superchat = await prisma.superchat.findUnique({
    where: { gatewayOrderId: intentId },
  });
  if (!superchat) return { ok: false, reason: "unknown_intent" };
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
  if (!env.STRIPE_WEBHOOK_SECRET) {
    log.error("payments.stripe.webhook_secret_missing", new Error("STRIPE_WEBHOOK_SECRET unset"));
    return NextResponse.json({ error: "webhook not configured" }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("stripe-signature");

  let event: Stripe.Event;
  try {
    event = verifyStripeWebhookEvent({ rawBody, signature });
  } catch (e) {
    log.warn("payments.stripe.webhook_signature_invalid", {
      note: e instanceof Error ? e.message : "unknown",
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  let result: ApplyResult;
  switch (event.type) {
    case "payment_intent.succeeded":
      result = await applyPaymentIntent(event.data.object, "PAID");
      break;
    case "payment_intent.payment_failed":
    case "payment_intent.canceled":
      result = await applyPaymentIntent(event.data.object, "FAILED");
      break;
    case "charge.refunded":
      result = await applyRefund(event.data.object);
      break;
    default:
      log.info("payments.stripe.unhandled_event", { type: event.type });
      return NextResponse.json({ ok: true, ignored: true });
  }

  if (!result.ok) {
    log.warn("payments.stripe.webhook_unknown", { reason: result.reason });
    return NextResponse.json({ ok: true, ignored: true });
  }

  log.info("payments.stripe.webhook_applied", {
    superchatId: result.superchatId,
    type: event.type,
  });

  if (event.type === "payment_intent.succeeded") {
    issueInvoice({ superchatId: result.superchatId }).catch((e) =>
      log.error("invoice.issue_failed", e instanceof Error ? e : new Error(String(e)), {
        superchatId: result.superchatId,
      }),
    );
  }

  return NextResponse.json({ ok: true });
}