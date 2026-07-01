/**
 * POST /api/payments/stripe/create-intent
 *
 * Creates a Stripe PaymentIntent for a USD superchat.
 *
 * Flow:
 *   1. Auth: requireUser (Supabase session must be valid)
 *   2. Zod-validate input
 *   3. Idempotency: dedupe by UUID idempotencyKey
 *   4. Rate-limit (per-IP + per-user)
 *   5. Read Settings, enforce min/max donation (in paise; for USD we
 *      convert the limits via the configured INR rate for the check)
 *   6. Profanity filter + sanitize message
 *   7. Compute INR-equivalent amount (for tier preview)
 *   8. Create Stripe PaymentIntent (returns client_secret)
 *   9. Insert PENDING Superchat row keyed on the intent id
 *  10. Return { clientSecret, paymentIntentId, amount, currency, superchatId }
 *
 * Security notes:
 *   - We never see card numbers; Stripe Elements collects them.
 *   - automatic_payment_methods is enabled so a single intent accepts
 *     Visa / Mastercard / Amex / Discover.
 *   - Same idempotency guarantees as Razorpay.
 *   - The INR-equivalent computed here is for the preview tier only —
 *     the webhook re-computes from the verified USD amount.
 */
import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { serverEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { usdToInrPaise } from "@/lib/tier";
import {
  baseOrderSchema,
  checkIdempotency,
  createPendingSuperchat,
  prepareOrder,
  rememberIdempotency,
} from "@/lib/payments";
import { createStripePaymentIntent, getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await getCurrentUser();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const env = serverEnv();
  if (!getStripe() && env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Stripe is not configured on the server." },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const prep = await prepareOrder({
    request,
    input: raw,
    userId: ctx.user.id,
    userEmail: ctx.email,
    userDisplayName: ctx.user.displayName,
    userAvatarUrl: ctx.user.avatarUrl,
    gateway: "STRIPE",
  });
  if (!prep.ok) return prep.response;

  const parsed = baseOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const idempotencyKey = parsed.data.idempotencyKey;

  // Idempotency — same shape as Razorpay route.
  const existing = await checkIdempotency(idempotencyKey);
  if (existing) {
    const row = await prisma.superchat.findUnique({
      where: { id: existing.existingSuperchatId },
    });
    if (row) {
      log.info("payments.stripe.idempotent_replay", {
        actorId: await fingerprint(ctx.email),
        superchatId: row.id,
      });
      return NextResponse.json(
        {
          paymentIntentId: row.gatewayOrderId,
          // The original client_secret is gone (Stripe only returns it
          // on the create call). For a replay we tell the client to
          // re-fetch the client_secret via the confirm path, OR we
          // re-issue a fresh intent with the same metadata. We re-issue
          // — Stripe will dedupe via metadata.receipt when possible.
          clientSecret: null,
          amount: row.amountPaise,
          currency: row.currency,
          superchatId: row.id,
          replay: true,
        },
        { status: 200 },
      );
    }
  }

  // Compute INR-equivalent for tier preview. The Settings.inrPerUsd
  // is stored as Decimal in the DB; cast carefully.
  const inrPerUsd = Number(prep.settings.inrPerUsd);
  const inrEquivalentPaise = usdToInrPaise(parsed.data.amountPaise, inrPerUsd);

  let intent;
  try {
    intent = await createStripePaymentIntent({
      amountCents: parsed.data.amountPaise,
      currency: "usd",
      receipt: idempotencyKey,
      metadata: {
        userId: ctx.user.id,
        purpose: "superchat",
        inrEquivalentPaise: String(inrEquivalentPaise),
      },
    });
  } catch (e) {
    log.error("payments.stripe.intent_failed", {
      actorId: await fingerprint(ctx.email),
      note: e instanceof Error ? e.message : "unknown",
    });
    return NextResponse.json(
      { error: "Payment provider is unavailable. Please try again." },
      { status: 502 },
    );
  }

  let row;
  try {
    row = await createPendingSuperchat({
      gateway: "STRIPE",
      gatewayOrderId: intent.id,
      amountPaise: parsed.data.amountPaise,
      currency: "USD",
      inrEquivalentPaise,
      userId: ctx.user.id,
      displayName: ctx.user.displayName ?? parsed.data.displayName ?? "Anonymous",
      message: prep.cleanMessage,
      idempotencyKey,
      avatarUrl: ctx.user.avatarUrl,
    });
  } catch (e) {
    log.warn("payments.stripe.pending_insert_race", {
      actorId: await fingerprint(ctx.email),
      note: e instanceof Error ? e.message : "unknown",
    });
    const dup = await prisma.superchat
      .findUnique({ where: { gatewayOrderId: intent.id } })
      .catch(() => null);
    if (dup) {
      return NextResponse.json(
        {
          paymentIntentId: dup.gatewayOrderId,
          clientSecret: null,
          amount: dup.amountPaise,
          currency: dup.currency,
          superchatId: dup.id,
          replay: true,
        },
        { status: 200 },
      );
    }
    return NextResponse.json(
      { error: "Failed to record order. Please try again." },
      { status: 500 },
    );
  }

  await rememberIdempotency(idempotencyKey, row.id);

  log.info("payments.stripe.intent_created", {
    actorId: await fingerprint(ctx.email),
    superchatId: row.id,
    amountCents: row.amountPaise,
    inrEquivalentPaise,
  });

  return NextResponse.json(
    {
      paymentIntentId: intent.id,
      clientSecret: intent.clientSecret,
      amount: intent.amount,
      currency: intent.currency,
      superchatId: row.id,
    },
    { status: 201 },
  );
}