/**
 * Public-facing projection of a Superchat row.
 *
 * The Superchat table carries fields the public feed must NEVER see
 * (userId, gatewayOrderId, idempotencyKey, hiddenByAdminEmail,
 * hideReason, webhookVerified, …). Server code MUST project rows
 * through `toLiveSuperchat()` before returning them to a client.
 *
 * Used by:
 *   - app/api/superchats/route.ts (SSR initial fetch)
 *   - the browser-side Realtime handler that mirrors inserts into the
 *     `SuperchatFeed` state (it re-fetches via the same endpoint to
 *     avoid trusting client-supplied payloads).
 *
 * The interface intentionally matches what `SuperchatCard` consumes so
 * the card doesn't need to know about Prisma.
 */
import { z } from "zod";

/** Tier label comes from the server-verified value on the row, 1..6. */
export const LiveSuperchatSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
  avatarUrl: z.string().url().nullable(),
  message: z.string(),
  /** Smallest unit in the donor's chosen currency — paise for INR, cents for USD. */
  amount: z.number().int().nonnegative(),
  currency: z.enum(["INR", "USD"]),
  /** INR-equivalent in paise — always present. */
  inrEquivalentPaise: z.number().int().nonnegative(),
  /** 1..6, server-assigned at webhook time. */
  tier: z.number().int().min(1).max(6),
  /** ms since epoch — sorted descending in the feed. */
  paidAt: z.number().int(),
});
export type LiveSuperchat = z.infer<typeof LiveSuperchatSchema>;

/**
 * Project a Prisma Superchat row to the public shape.
 *
 * Used both for SSR (`page.tsx`) and for the Realtime patch handler
 * (re-fetch by id). The input may be `null` if the row was deleted
 * between Realtime event and re-fetch — caller decides how to handle.
 */
export function toLiveSuperchat(row: {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  message: string;
  amountPaise: number;
  currency: string;
  inrEquivalentPaise: number;
  tier: number;
  paidAt: Date | null;
  createdAt: Date;
}): LiveSuperchat | null {
  const paidAt = (row.paidAt ?? row.createdAt).getTime();
  const currency = row.currency === "USD" ? "USD" : "INR";
  // Validate tier bounds — anything outside is a corrupted row, refuse
  // to surface it. Better to drop a card than render a malformed glow.
  if (row.tier < 1 || row.tier > 6) return null;
  return {
    id: row.id,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    message: row.message,
    amount: row.amountPaise,
    currency,
    inrEquivalentPaise: row.inrEquivalentPaise,
    tier: row.tier,
    paidAt,
  };
}

/**
 * Build the display label for an amount — always shows native currency,
 * and (for USD) the approximate INR equivalent so a global audience
 * understands the value.
 *
 * No math is done client-side; the server pre-computes INR-equivalent
 * at webhook time using the admin-configured rate. We just format.
 */
export function formatAmountLabel(s: Pick<LiveSuperchat, "amount" | "currency" | "inrEquivalentPaise">): string {
  const major = s.amount / 100;
  if (s.currency === "INR") {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(major);
  }
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(major);
  const inrMajor = s.inrEquivalentPaise / 100;
  const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(inrMajor);
  return `${usd} (≈ ${inr})`;
}