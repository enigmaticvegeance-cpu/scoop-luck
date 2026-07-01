/**
 * Shared helpers for /api/payments/* order endpoints.
 *
 * Each gateway has its own /create-order (Razorpay, Stripe, PayPal).
 * All three do the same thing in slightly different shapes:
 *
 *   1. Zod-validate input
 *   2. Check idempotency key against Redis (24h TTL)
 *   3. Read Settings (min/max donation limits)
 *   4. Create a gateway-specific order with the gateway SDK
 *   5. Insert a PENDING Superchat row (so webhooks have a target)
 *   6. Return minimal client-facing data (no secrets)
 *
 * Helpers below factor steps 1-2-3-5-6 into reusable functions.
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { Redis } from "@upstash/redis";

import { prisma } from "@/lib/prisma";
import { serverEnv } from "@/lib/env";
import { getClientIp, limitByKey } from "@/lib/rate-limit";
import { fingerprint } from "@/lib/utils";
import { log } from "@/lib/log";
import { tierForInr, assertAmountWithinLimits } from "@/lib/tier";
import { profanityFilter, sanitizeMessage } from "@/lib/security";

/**
 * Shared input shape — every gateway's create-order has the same fields.
 * Gateway-specific extras (UPI intent, currency) are inferred server-side.
 */
export const baseOrderSchema = z.object({
  amountPaise: z.number().int().min(2000).max(10_000_000), // ₹20 to ₹100,000 sanity
  message: z.string().min(1).max(1000),
  idempotencyKey: z.string().uuid(),
  // Optional override — e.g. to log "Anonymous". UI may send a hint but
  // we always pull the canonical displayName from the User row.
  displayName: z.string().min(3).max(30).optional(),
});

export type BaseOrderInput = z.infer<typeof baseOrderSchema>;

let _redis: Redis | null = null;
function redis(): Redis | null {
  if (_redis) return _redis;
  const env = serverEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  _redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

/**
 * Idempotency: the same key must always return the same order.
 *
 * We check Redis first because it's cheap; the unique index on
 * Superchat.idempotencyKey is the source of truth (Redis can be wiped).
 *
 * Returns the existing order id if duplicated, else null.
 */
export async function checkIdempotency(
  key: string,
): Promise<{ existingSuperchatId: string } | null> {
  // Hot path: Redis lookup.
  const r = redis();
  if (r) {
    const cached = await r.get<string>(`sl:idem:${key}`);
    if (cached) return { existingSuperchatId: cached };
  }
  // Cold path: DB lookup by the unique index.
  const existing = await prisma.superchat.findUnique({
    where: { idempotencyKey: key },
    select: { id: true },
  });
  if (existing) {
    if (r) await r.set(`sl:idem:${key}`, existing.id, { ex: 86_400 });
    return { existingSuperchatId: existing.id };
  }
  return null;
}

/**
 * Record the new superchat id under the idempotency key.
 */
export async function rememberIdempotency(key: string, superchatId: string): Promise<void> {
  const r = redis();
  if (r) await r.set(`sl:idem:${key}`, superchatId, { ex: 86_400 });
}

export interface OrderRowSpec {
  gateway: "RAZORPAY" | "STRIPE" | "PAYPAL";
  gatewayOrderId: string;
  amountPaise: number;
  currency: "INR" | "USD";
  /** INR-equivalent in paise — required for tier assignment later. */
  inrEquivalentPaise: number;
  userId: string;
  displayName: string;
  message: string;
  idempotencyKey: string;
  avatarUrl: string | null;
}

/**
 * Insert the PENDING Superchat row, returning the id.
 *
 * The tier is filled in immediately as a preview — the webhook
 * re-computes and overwrites it if the verified amount differs.
 */
export async function createPendingSuperchat(spec: OrderRowSpec) {
  const inrPaiseForTier = spec.currency === "INR" ? spec.amountPaise : spec.inrEquivalentPaise;
  const tier = tierForInr(inrPaiseForTier / 100);

  const cleanMsg = sanitizeMessage(spec.message);

  return prisma.superchat.create({
    data: {
      userId: spec.userId,
      displayName: spec.displayName,
      avatarUrl: spec.avatarUrl,
      message: cleanMsg,
      amountPaise: spec.amountPaise,
      currency: spec.currency,
      inrEquivalentPaise: spec.inrEquivalentPaise,
      tier: tier.tier,
      gateway: spec.gateway,
      gatewayOrderId: spec.gatewayOrderId,
      status: "PENDING",
      idempotencyKey: spec.idempotencyKey,
    },
  });
}

/**
 * Per-IP rate-limit on payments. Different from the proxy-level rate
 * limit (which is also active) — this one lets us lower limits in dev
 * without touching middleware config.
 */
export async function enforcePaymentRateLimit(ip: string, userEmail: string) {
  const byIp = await limitByKey("payments:create", `payments:ip:${ip}`);
  if (!byIp.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  const byUser = await limitByKey(
    "payments:create",
    `payments:user:${await fingerprint(userEmail)}`,
  );
  if (!byUser.success) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }
  return null;
}

/**
 * Read settings; lazily seeded if absent.
 */
export async function getSettings() {
  let settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    settings = await prisma.settings.create({ data: { id: 1 } });
  }
  return settings;
}

/**
 * Common validate + rate-limit + insert-pending for every gateway.
 *
 * Each route handler calls this, then does its gateway-specific order
 * call after, then updates the Superchat row with the gateway order id.
 */
export async function prepareOrder(args: {
  request: Request;
  input: unknown;
  userId: string;
  userEmail: string;
  userDisplayName: string | null;
  userAvatarUrl: string | null;
  gateway: "RAZORPAY" | "STRIPE" | "PAYPAL";
}): Promise<
  | {
      ok: true;
      input: BaseOrderInput;
      cleanMessage: string;
      settings: Awaited<ReturnType<typeof getSettings>>;
    }
  | { ok: false; response: NextResponse }
> {
  const parsed = baseOrderSchema.safeParse(args.input);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      response: NextResponse.json(
        { error: first?.message ?? "Invalid input", field: first?.path?.[0]?.toString() },
        { status: 400 },
      ),
    };
  }

  // Apply profanity filter to free-text BEFORE persisting.
  const filtered = await profanityFilter(parsed.data.message);
  const cleanMessage = sanitizeMessage(filtered);

  const ip = getClientIp(args.request.headers);
  const limited = await enforcePaymentRateLimit(ip, args.userEmail);
  if (limited) return { ok: false, response: limited };

  const settings = await getSettings();
  try {
    assertAmountWithinLimits(parsed.data.amountPaise, {
      minDonationPaise: settings.minDonationPaise,
      maxDonationPaise: settings.maxDonationPaise,
    });
  } catch (e) {
    log.warn("payments.amount.out_of_range", {
      actorId: await fingerprint(args.userEmail),
      note: e instanceof Error ? e.message : "unknown",
    });
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Amount is outside the allowed range for this platform." },
        { status: 400 },
      ),
    };
  }

  return {
    ok: true,
    input: parsed.data,
    cleanMessage,
    settings,
  };
}

/**
 * Lookup the existing Superchat for a duplicate idempotency key.
 * Used to return the same gateway order id when the client retries.
 */
export async function findPendingByGatewayOrderId(gatewayOrderId: string) {
  return prisma.superchat.findUnique({
    where: { gatewayOrderId },
  });
}