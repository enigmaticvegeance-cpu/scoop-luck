/**
 * Tier logic.
 *
 * One source of truth for "given an amount in INR (or USD), what tier is
 * this superchat and how many characters can the donor write?".
 *
 * The assignment is done SERVER-SIDE in the webhook handler. The
 * frontend can show a preview using `previewForAmount()` but the final
 * value in `Superchat.tier` is whatever we compute here at payment
 * verification time.
 *
 * Why a separate module:
 *   - Used by Razorpay, Stripe, PayPal webhook handlers — same code.
 *   - Used by the /superchat form preview.
 *   - Tested in isolation with Vitest.
 */

/**
 * Tier table from the spec. Index = tier number (1..6).
 * `charLimit` is the message length cap for that tier.
 */
export interface TierConfig {
  tier: 1 | 2 | 3 | 4 | 5 | 6;
  /** Inclusive lower bound, in INR. */
  inrMin: number;
  /** Inclusive upper bound, in INR. Infinity for the top tier. */
  inrMax: number;
  charLimit: number;
  /** Hex accent color used on the card border/glow. */
  accentColor: string;
  /** CSS class for the box-shadow glow. */
  glowClass: string;
  /** Display name for the UI tier badge. */
  label: string;
}

export const TIERS: readonly TierConfig[] = [
  {
    tier: 1,
    inrMin: 20,
    inrMax: 49,
    charLimit: 50,
    accentColor: "#00FFFF",
    glowClass: "tier-glow-cyan",
    label: "Cheer",
  },
  {
    tier: 2,
    inrMin: 50,
    inrMax: 99,
    charLimit: 100,
    accentColor: "#7C3AED",
    glowClass: "tier-glow-purple",
    label: "Boost",
  },
  {
    tier: 3,
    inrMin: 100,
    inrMax: 199,
    charLimit: 150,
    accentColor: "#F59E0B",
    glowClass: "tier-glow-amber",
    label: "Shoutout",
  },
  {
    tier: 4,
    inrMin: 200,
    inrMax: 499,
    charLimit: 200,
    accentColor: "#10B981",
    glowClass: "tier-glow-green",
    label: "Spotlight",
  },
  {
    tier: 5,
    inrMin: 500,
    inrMax: 999,
    charLimit: 250,
    accentColor: "#EF4444",
    glowClass: "tier-glow-red",
    label: "Featured",
  },
  {
    tier: 6,
    inrMin: 1000,
    inrMax: Number.POSITIVE_INFINITY,
    charLimit: 500,
    accentColor: "#FFD700",
    glowClass: "tier-glow-gold",
    label: "Top Fan",
  },
] as const;

/**
 * Pick the tier for an amount expressed in INR.
 *
 * NOTE: for non-INR payments, the caller must convert to INR-equivalent
 * first using `usdToInrPaise()` and pass that. We never compute tiers
 * from a USD amount directly because tiers are defined on INR thresholds.
 *
 * Defensive: negative or NaN inputs throw (programmer error). Infinity
 * falls through to the top tier (handles pathological webhook inputs
 * where amount/100 overflows).
 */
export function tierForInr(inrAmount: number): TierConfig {
  if (Number.isNaN(inrAmount) || inrAmount < 0) {
    throw new Error(`Invalid INR amount: ${inrAmount}`);
  }
  for (const t of TIERS) {
    if (inrAmount >= t.inrMin && inrAmount <= t.inrMax) return t;
  }
  // Above the top tier (or Infinity) — keep it at top tier.
  return TIERS[TIERS.length - 1]!;
}

/** Convert USD cents to INR paise using the admin-configured rate. */
export function usdToInrPaise(usdCents: number, inrPerUsd: number): number {
  if (!Number.isFinite(usdCents) || usdCents < 0) {
    throw new Error(`Invalid USD cents: ${usdCents}`);
  }
  if (!Number.isFinite(inrPerUsd) || inrPerUsd <= 0) {
    throw new Error(`Invalid INR-per-USD rate: ${inrPerUsd}`);
  }
  // 1 USD = inrPerUsd INR, so usdCents (cents) = usdCents/100 USD.
  // INR = usdCents/100 * inrPerUsd, paise = round(INR * 100)
  const inr = (usdCents / 100) * inrPerUsd;
  return Math.round(inr * 100);
}

/**
 * Server-side guard: throws if the amount falls outside the admin
 * configured min/max. Called from each gateway's order-create handler.
 */
export function assertAmountWithinLimits(
  amountPaise: number,
  limits: { minDonationPaise: number; maxDonationPaise: number },
): void {
  if (amountPaise < limits.minDonationPaise) {
    throw new Error(`Amount ${amountPaise}p below minimum ${limits.minDonationPaise}p`);
  }
  if (amountPaise > limits.maxDonationPaise) {
    throw new Error(`Amount ${amountPaise}p above maximum ${limits.maxDonationPaise}p`);
  }
}

/**
 * UI-side preview used by the superchat form. Pure function, no I/O,
 * no DB — the form re-renders as the donor types the amount.
 */
export function previewForAmount(
  amountPaise: number,
  inrPerUsd = 83,
  isUsd = false,
): TierConfig {
  const inrPaise = isUsd ? usdToInrPaise(amountPaise, inrPerUsd) : amountPaise;
  return tierForInr(inrPaise / 100);
}
