/**
 * POST /api/payments/paypal/create-order
 *
 * Creates a PayPal order for a USD superchat.
 *
 * Flow:
 *   1. Auth: requireUser (Supabase session must be valid)
 *   2. Zod-validate input
 *   3. Idempotency: dedupe by UUID idempotencyKey
 *   4. Rate-limit (per-IP + per-user)
 *   5. Read Settings, enforce min/max donation
 *   6. Profanity filter + sanitize message
 *   7. Compute INR-equivalent amount (for tier preview)
 *   8. Create PayPal order (intent=CAPTURE)
 *   9. Insert PENDING Superchat row keyed on the PayPal order id
 *  10. Return { paypalOrderId, approveUrl, amountUsd, superchatId }
 *
 * PayPal differences vs Razorpay/Stripe:
 *   - amountPaise here is actually USD cents (smallest unit). We convert
 *     to a string "10.00" for the PayPal API.
 *   - approveUrl is what the client redirects the buyer to. After the
 *     buyer approves, PayPal JS SDK calls back to /api/payments/paypal/capture
 *     which performs the server-side capture.
 *   - We do NOT confirm capture here — that happens in a separate route.
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
import { createPayPalOrder } from "@/lib/paypal";

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
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    if (env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "PayPal is not configured on the server." },
        { status: 503 },
      );
    }
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
    gateway: "PAYPAL",
  });
  if (!prep.ok) return prep.response;

  const parsed = baseOrderSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const idempotencyKey = parsed.data.idempotencyKey;

  // Idempotency — same shape as Razorpay / Stripe.
  const existing = await checkIdempotency(idempotencyKey);
  if (existing) {
    const row = await prisma.superchat.findUnique({
      where: { id: existing.existingSuperchatId },
    });
    if (row) {
      log.info("payments.paypal.idempotent_replay", {
        actorId: await fingerprint(ctx.email),
        superchatId: row.id,
      });
      // PayPal approve URL is one-shot and expires — for a replay we
      // return the existing gateway order id but signal that the client
      // should re-call to get a fresh approveUrl.
      return NextResponse.json(
        {
          paypalOrderId: row.gatewayOrderId,
          approveUrl: null,
          amountUsd: row.amountPaise / 100,
          superchatId: row.id,
          replay: true,
        },
        { status: 200 },
      );
    }
  }

  // USD cents -> USD dollar string with 2dp. PayPal rejects amounts
  // with more precision than that, and rejects strings without exactly
  // 2 decimal places.
  const usdCents = parsed.data.amountPaise;
  const usdString = (usdCents / 100).toFixed(2);

  // Tier preview uses the INR equivalent.
  const inrPerUsd = Number(prep.settings.inrPerUsd);
  const inrEquivalentPaise = usdToInrPaise(usdCents, inrPerUsd);

  let ppOrder;
  try {
    ppOrder = await createPayPalOrder({
      amountUsd: usdString,
      receipt: idempotencyKey,
      description: "Scoop Luck superchat",
    });
  } catch (e) {
    log.error("payments.paypal.create_failed", {
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
      gateway: "PAYPAL",
      gatewayOrderId: ppOrder.id,
      amountPaise: usdCents,
      currency: "USD",
      inrEquivalentPaise,
      userId: ctx.user.id,
      displayName: ctx.user.displayName ?? parsed.data.displayName ?? "Anonymous",
      message: prep.cleanMessage,
      idempotencyKey,
      avatarUrl: ctx.user.avatarUrl,
    });
  } catch (e) {
    log.warn("payments.paypal.pending_insert_race", {
      actorId: await fingerprint(ctx.email),
      note: e instanceof Error ? e.message : "unknown",
    });
    const dup = await prisma.superchat
      .findUnique({ where: { gatewayOrderId: ppOrder.id } })
      .catch(() => null);
    if (dup) {
      return NextResponse.json(
        {
          paypalOrderId: dup.gatewayOrderId,
          approveUrl: ppOrder.approveUrl,
          amountUsd: dup.amountPaise / 100,
          superchatId: dup.id,
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

  log.info("payments.paypal.order_created", {
    actorId: await fingerprint(ctx.email),
    superchatId: row.id,
    amountUsd: usdString,
    inrEquivalentPaise,
  });

  return NextResponse.json(
    {
      paypalOrderId: ppOrder.id,
      approveUrl: ppOrder.approveUrl,
      amountUsd: usdString,
      superchatId: row.id,
    },
    { status: 201 },
  );
}