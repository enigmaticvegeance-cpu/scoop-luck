/**
 * POST /api/payments/razorpay/create-order
 *
 * Creates a Razorpay order for an INR superchat.
 *
 * Flow:
 *   1. Auth: requireUser (Supabase session must be valid)
 *   2. Zod-validate input
 *   3. Idempotency: dedupe by UUID idempotencyKey
 *   4. Rate-limit (per-IP + per-user)
 *   5. Read Settings, enforce min/max donation
 *   6. Profanity filter + sanitize message
 *   7. Create Razorpay order (gateway-side id)
 *   8. Insert PENDING Superchat row keyed on gatewayOrderId
 *   9. Return { orderId, keyId, amount, currency, superchatId }
 *
 * Security notes:
 *   - The client NEVER sees the Razorpay key_secret.
 *   - Tier assigned here is a PREVIEW — the webhook re-computes from
 *     the verified amount. (See /api/webhooks/razorpay.)
 *   - Idempotency: the same key returns the same superchat id, so a
 *     network retry can't double-charge.
 *   - The amount is server-trusted; we never trust the client's amount.
 */
import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { serverEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import {
  baseOrderSchema,
  checkIdempotency,
  createPendingSuperchat,
  prepareOrder,
  rememberIdempotency,
} from "@/lib/payments";
import { prisma } from "@/lib/prisma";
import { createRazorpayOrder, getRazorpay } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Reject non-POST immediately. Matches the spec: webhooks reject wrong
 * verbs, and so do order endpoints — they only ever accept POST.
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}

export async function POST(request: Request): Promise<NextResponse> {
  // 1. Auth — must be a logged-in Supabase user.
  const ctx = await getCurrentUser();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Cheap configuration check before any DB work: if the gateway is
  // not configured, fail fast with 503 so the UI can show a real message.
  const env = serverEnv();
  if (!getRazorpay() && env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "Razorpay is not configured on the server." },
      { status: 503 },
    );
  }

  // 2. Parse JSON. We re-parse the body here (instead of passing the
  //    parsed object) so the same handler shape works for all gateways.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // 3-6. Common validation (Zod + rate-limit + min/max + profanity).
  const prep = await prepareOrder({
    request,
    input: raw,
    userId: ctx.user.id,
    userEmail: ctx.email,
    userDisplayName: ctx.user.displayName,
    userAvatarUrl: ctx.user.avatarUrl,
    gateway: "RAZORPAY",
  });
  if (!prep.ok) return prep.response;

  // We re-parse to keep idempotencyKey available for the dedup step.
  // `baseOrderSchema` was already applied inside prepareOrder.
  const parsed = baseOrderSchema.safeParse(raw);
  if (!parsed.success) {
    // Defensive — prepareOrder would have rejected this already.
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const idempotencyKey = parsed.data.idempotencyKey;

  // 7. Idempotency check (Redis first, then DB).
  //    On a hit, we look up the Superchat by its primary id (not by
  //    gatewayOrderId — we may not have one yet if a previous attempt
  //    crashed between gateway order create and DB insert).
  const existing = await checkIdempotency(idempotencyKey);
  if (existing) {
    const row = await prisma.superchat.findUnique({
      where: { id: existing.existingSuperchatId },
    });
    if (row) {
      log.info("payments.razorpay.idempotent_replay", {
        actorId: await fingerprint(ctx.email),
        superchatId: row.id,
      });
      return NextResponse.json(
        {
          orderId: row.gatewayOrderId,
          keyId: env.RAZORPAY_KEY_ID ?? "",
          amount: row.amountPaise,
          currency: row.currency,
          superchatId: row.id,
        },
        { status: 200 },
      );
    }
  }

  // 8. Create the Razorpay order. `receipt` is our internal Superchat id
  //    reference — we use the idempotency key (UUID) for traceability.
  let rzpOrder;
  try {
    rzpOrder = await createRazorpayOrder(parsed.data.amountPaise, idempotencyKey, {
      userId: ctx.user.id,
      purpose: "superchat",
    });
  } catch (e) {
    log.error("payments.razorpay.create_failed", {
      actorId: await fingerprint(ctx.email),
      note: e instanceof Error ? e.message : "unknown",
    });
    return NextResponse.json(
      { error: "Payment provider is unavailable. Please try again." },
      { status: 502 },
    );
  }

  // 9. Insert the PENDING Superchat row. `inrEquivalentPaise` for INR
  //    is the same as `amountPaise`; we pass 1:1 to keep the column
  //    meaningful for tier lookups later.
  let row;
  try {
    row = await createPendingSuperchat({
      gateway: "RAZORPAY",
      gatewayOrderId: rzpOrder.id,
      amountPaise: parsed.data.amountPaise,
      currency: "INR",
      inrEquivalentPaise: parsed.data.amountPaise,
      userId: ctx.user.id,
      displayName: ctx.user.displayName ?? parsed.data.displayName ?? "Anonymous",
      message: prep.cleanMessage,
      idempotencyKey,
      avatarUrl: ctx.user.avatarUrl,
    });
  } catch (e) {
    // Race: another concurrent request with the same idempotency key
    // won. The unique constraint is on `idempotencyKey`, NOT on
    // `gatewayOrderId`, so this branch handles the rare double-tap
    // case where two clients sent the same UUID at the same instant.
    log.warn("payments.razorpay.pending_insert_race", {
      actorId: await fingerprint(ctx.email),
      note: e instanceof Error ? e.message : "unknown",
    });
    const dup = await prisma.superchat.findUnique({ where: { gatewayOrderId: rzpOrder.id } }).catch(() => null);
    if (dup) {
      return NextResponse.json(
        {
          orderId: dup.gatewayOrderId,
          keyId: env.RAZORPAY_KEY_ID ?? "",
          amount: dup.amountPaise,
          currency: dup.currency,
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

  // 10. Cache the new superchat id under the idempotency key (24h).
  await rememberIdempotency(idempotencyKey, row.id);

  log.info("payments.razorpay.order_created", {
    actorId: await fingerprint(ctx.email),
    superchatId: row.id,
    amountPaise: row.amountPaise,
  });

  return NextResponse.json(
    {
      orderId: rzpOrder.id,
      keyId: env.RAZORPAY_KEY_ID ?? "",
      amount: rzpOrder.amount,
      currency: rzpOrder.currency,
      superchatId: row.id,
    },
    { status: 201 },
  );
}