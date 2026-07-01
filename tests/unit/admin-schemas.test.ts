import { describe, it, expect } from "vitest";

import {
  superchatFilterSchema,
  hideSuperchatSchema,
  unhideSuperchatSchema,
  updateSettingsSchema,
  addProfanityWordSchema,
  removeProfanityWordSchema,
  profanityCategoryEnum,
} from "@/lib/schemas/admin";

const UUID = "00000000-0000-4000-8000-000000000000";

describe("superchatFilterSchema", () => {
  it("parses an empty filter (all fields optional)", () => {
    const r = superchatFilterSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.page).toBe(1);
  });

  it("parses a full filter", () => {
    const r = superchatFilterSchema.safeParse({
      q: "  hello  ",
      tier: "3",
      gateway: "RAZORPAY",
      from: "2025-01-01",
      to: "2025-12-31",
      page: "5",
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.q).toBe("hello");
      expect(r.data.tier).toBe(3);
      expect(r.data.gateway).toBe("RAZORPAY");
      expect(r.data.from).toBe("2025-01-01");
      expect(r.data.to).toBe("2025-12-31");
      expect(r.data.page).toBe(5);
    }
  });

  it("rejects an out-of-range tier", () => {
    const r = superchatFilterSchema.safeParse({ tier: "7" });
    expect(r.success).toBe(false);
  });

  it("rejects a malformed date", () => {
    const r = superchatFilterSchema.safeParse({ from: "1/1/2025" });
    expect(r.success).toBe(false);
  });

  it("rejects a search query longer than 120 chars", () => {
    const r = superchatFilterSchema.safeParse({ q: "x".repeat(121) });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown gateway", () => {
    const r = superchatFilterSchema.safeParse({ gateway: "BITCOIN" });
    expect(r.success).toBe(false);
  });
});

describe("hideSuperchatSchema", () => {
  it("accepts a uuid without a reason", () => {
    const r = hideSuperchatSchema.safeParse({ id: UUID });
    expect(r.success).toBe(true);
  });

  it("accepts a uuid + trimmed reason", () => {
    const r = hideSuperchatSchema.safeParse({ id: UUID, reason: "  spam  " });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.reason).toBe("spam");
  });

  it("rejects a non-uuid id", () => {
    const r = hideSuperchatSchema.safeParse({ id: "not-a-uuid" });
    expect(r.success).toBe(false);
  });

  it("rejects an oversized reason", () => {
    const r = hideSuperchatSchema.safeParse({ id: UUID, reason: "x".repeat(501) });
    expect(r.success).toBe(false);
  });
});

describe("unhideSuperchatSchema", () => {
  it("accepts a uuid", () => {
    const r = unhideSuperchatSchema.safeParse({ id: UUID });
    expect(r.success).toBe(true);
  });

  it("rejects a non-uuid id", () => {
    const r = unhideSuperchatSchema.safeParse({ id: "abc" });
    expect(r.success).toBe(false);
  });
});

describe("updateSettingsSchema", () => {
  const base = {
    minDonationPaise: 2000,
    maxDonationPaise: 100000,
    inrPerUsd: 83,
    pinHighTierSeconds: 60,
    pinTopTierSeconds: 120,
    platformLegalName: "Scoop Luck",
    platformAddress: null,
    platformGstin: null,
  };

  it("accepts a valid full payload", () => {
    const r = updateSettingsSchema.safeParse({
      ...base,
      platformAddress: "123 Main St",
      platformGstin: "27AAAAA0000A1Z5",
    });
    expect(r.success).toBe(true);
  });

  it("rejects when min ≥ max", () => {
    const r = updateSettingsSchema.safeParse({ ...base, minDonationPaise: 100000, maxDonationPaise: 50000 });
    expect(r.success).toBe(false);
    if (!r.success) {
      const msg = r.error.issues.find((i) => i.path.includes("maxDonationPaise"));
      expect(msg?.message).toMatch(/greater than min/);
    }
  });

  it("rejects when top pin < high pin", () => {
    const r = updateSettingsSchema.safeParse({ ...base, pinHighTierSeconds: 120, pinTopTierSeconds: 60 });
    expect(r.success).toBe(false);
  });

  it("rejects out-of-range paise values", () => {
    const lowMin = updateSettingsSchema.safeParse({ ...base, minDonationPaise: 50 });
    expect(lowMin.success).toBe(false);
    const highMax = updateSettingsSchema.safeParse({ ...base, maxDonationPaise: 50_000_000 });
    expect(highMax.success).toBe(false);
  });

  it("rejects a malformed GSTIN (not 15 alphanumeric)", () => {
    const r = updateSettingsSchema.safeParse({ ...base, platformGstin: "abc-123" });
    expect(r.success).toBe(false);
  });

  it("accepts an empty GSTIN (clears the field)", () => {
    const r = updateSettingsSchema.safeParse({ ...base, platformGstin: "" });
    expect(r.success).toBe(true);
  });

  it("rejects an empty legal name", () => {
    const r = updateSettingsSchema.safeParse({ ...base, platformLegalName: "" });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-range INR/USD rate", () => {
    const tooLow = updateSettingsSchema.safeParse({ ...base, inrPerUsd: 0.5 });
    expect(tooLow.success).toBe(false);
    const tooHigh = updateSettingsSchema.safeParse({ ...base, inrPerUsd: 500 });
    expect(tooHigh.success).toBe(false);
  });
});

describe("addProfanityWordSchema", () => {
  it("accepts a valid word + category", () => {
    const r = addProfanityWordSchema.safeParse({ word: "badword", category: "PROFANITY" });
    expect(r.success).toBe(true);
  });

  it("trims whitespace from the word", () => {
    const r = addProfanityWordSchema.safeParse({ word: "  badword  ", category: "SLUR" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.word).toBe("badword");
  });

  it("rejects an empty word", () => {
    const r = addProfanityWordSchema.safeParse({ word: "", category: "PROFANITY" });
    expect(r.success).toBe(false);
  });

  it("rejects a word longer than 50 chars", () => {
    const r = addProfanityWordSchema.safeParse({ word: "x".repeat(51), category: "PROFANITY" });
    expect(r.success).toBe(false);
  });

  it("rejects an unknown category", () => {
    const r = addProfanityWordSchema.safeParse({ word: "foo", category: "FOO" });
    expect(r.success).toBe(false);
  });
});

describe("removeProfanityWordSchema", () => {
  it("accepts a uuid", () => {
    const r = removeProfanityWordSchema.safeParse({ id: UUID });
    expect(r.success).toBe(true);
  });

  it("rejects a non-uuid", () => {
    const r = removeProfanityWordSchema.safeParse({ id: "abc" });
    expect(r.success).toBe(false);
  });
});

describe("profanityCategoryEnum", () => {
  it("exposes the four Prisma enum values", () => {
    expect(new Set(profanityCategoryEnum.options)).toEqual(new Set(["SLUR", "PROFANITY", "HATE", "SPAM"]));
  });
});