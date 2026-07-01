import { describe, it, expect } from "vitest";

import {
  TIERS,
  tierForInr,
  usdToInrPaise,
  assertAmountWithinLimits,
  previewForAmount,
} from "@/lib/tier";

describe("tierForInr", () => {
  it("assigns tier 1 for ₹20-49", () => {
    expect(tierForInr(20).tier).toBe(1);
    expect(tierForInr(49).tier).toBe(1);
  });

  it("assigns tier 2 for ₹50-99", () => {
    expect(tierForInr(50).tier).toBe(2);
    expect(tierForInr(99).tier).toBe(2);
  });

  it("assigns tier 3 for ₹100-199", () => {
    expect(tierForInr(100).tier).toBe(3);
    expect(tierForInr(199).tier).toBe(3);
  });

  it("assigns tier 4 for ₹200-499", () => {
    expect(tierForInr(200).tier).toBe(4);
    expect(tierForInr(499).tier).toBe(4);
  });

  it("assigns tier 5 for ₹500-999", () => {
    expect(tierForInr(500).tier).toBe(5);
    expect(tierForInr(999).tier).toBe(5);
  });

  it("assigns tier 6 for ₹1000+", () => {
    expect(tierForInr(1000).tier).toBe(6);
    expect(tierForInr(50_000).tier).toBe(6);
  });

  it("clamps below-minimum to top tier (matches server webhook behavior)", () => {
    // ₹19 is below tier 1 — the spec says we accept it but show top
    // tier as preview. (In practice the order-create endpoint rejects
    // anything below `minDonationPaise` first.)
    expect(tierForInr(19).tier).toBe(6);
  });

    it("clamps Infinity to the top tier (defensive — should never happen)", () => {
    // Webhook calls tierForInr with `amountPaise / 100`. A pathological
    // amount could in theory become Infinity; we just hand back the
    // top tier rather than throwing.
    expect(tierForInr(Number.POSITIVE_INFINITY).tier).toBe(6);
  });

  it("throws on negative or NaN amounts", () => {
    expect(() => tierForInr(-1)).toThrow();
    expect(() => tierForInr(Number.NaN)).toThrow();
  });

  it("returns the highest tier for amounts above the top", () => {
    expect(tierForInr(1_000_000).tier).toBe(6);
  });
});

describe("tier table sanity", () => {
  it("every tier has a positive char limit", () => {
    for (const t of TIERS) {
      expect(t.charLimit).toBeGreaterThan(0);
      expect(t.accentColor).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(t.glowClass).toMatch(/^tier-glow-/);
    }
  });

  it("tier ranges are contiguous and non-overlapping", () => {
    for (let i = 0; i < TIERS.length - 1; i++) {
      const curr = TIERS[i]!;
      const next = TIERS[i + 1]!;
      // Next.inrMin must equal curr.inrMax + 1 (or curr.inrMax is
      // the upper-inclusive bound and next picks up from next.inrMin).
      // The tier function uses `>= min && <= max` so ranges can touch
      // — the rule is "lower bound is the next tier's lower bound".
      expect(next.inrMin).toBe(curr.inrMax + 1);
    }
  });
});

describe("usdToInrPaise", () => {
  it("converts $1 to ₹83 at the default rate", () => {
    // 100 cents -> $1 -> ₹83 -> 8300 paise
    expect(usdToInrPaise(100, 83)).toBe(8300);
  });

  it("handles fractional dollars", () => {
    // $0.05 = 5 cents -> 5/100 * 83 = 4.15 INR = 415 paise (rounded)
    expect(usdToInrPaise(5, 83)).toBe(415);
  });

  it("rounds to the nearest paise", () => {
    // $1.23 @ 83 = 1.23 * 83 = 102.09 INR -> 10209 paise
    expect(usdToInrPaise(123, 83)).toBe(10209);
  });

  it("rounds half-up on .5 boundaries", () => {
    // $1.00 @ 50.005 = 50.005 INR -> 5001 paise (Math.round is half-up)
    expect(usdToInrPaise(100, 50.005)).toBe(5001);
  });

  it("throws on invalid inputs", () => {
    expect(() => usdToInrPaise(-1, 83)).toThrow();
    expect(() => usdToInrPaise(100, 0)).toThrow();
    expect(() => usdToInrPaise(100, -1)).toThrow();
    expect(() => usdToInrPaise(Number.NaN, 83)).toThrow();
  });
});

describe("assertAmountWithinLimits", () => {
  it("passes when amount is within range", () => {
    expect(() =>
      assertAmountWithinLimits(5000, { minDonationPaise: 2000, maxDonationPaise: 1_000_000 }),
    ).not.toThrow();
  });

  it("throws when below min", () => {
    expect(() =>
      assertAmountWithinLimits(1999, { minDonationPaise: 2000, maxDonationPaise: 1_000_000 }),
    ).toThrow(/below minimum/);
  });

  it("throws when above max", () => {
    expect(() =>
      assertAmountWithinLimits(1_000_001, { minDonationPaise: 2000, maxDonationPaise: 1_000_000 }),
    ).toThrow(/above maximum/);
  });
});

describe("previewForAmount", () => {
  it("uses the amount as INR paise by default", () => {
    const t = previewForAmount(5000); // ₹50
    expect(t.tier).toBe(2);
  });

  it("converts USD to INR using the supplied rate when isUsd=true", () => {
    // $1 @ 83 INR/USD = ₹83 = tier 2 (₹50-99)
    const t = previewForAmount(100, 83, true);
    expect(t.tier).toBe(2);
  });

  it("places $20 USD at the top tier when rate is 83", () => {
    // $20 * 83 = ₹1660 = tier 6 (≥₹1000)
    const t = previewForAmount(2000, 83, true);
    expect(t.tier).toBe(6);
  });
});