import { describe, it, expect } from "vitest";

import { buildSuperchatWhere } from "@/lib/superchat-where";
import { superchatFilterSchema } from "@/lib/schemas/admin";

describe("buildSuperchatWhere", () => {
  it("returns an empty where clause for an empty filter", () => {
    const w = buildSuperchatWhere(superchatFilterSchema.parse({}));
    expect(w).toEqual({});
  });

  it("adds a tier equality", () => {
    const w = buildSuperchatWhere(superchatFilterSchema.parse({ tier: "4" }));
    expect(w.tier).toBe(4);
  });

  it("adds a gateway equality", () => {
    const w = buildSuperchatWhere(superchatFilterSchema.parse({ gateway: "STRIPE" }));
    expect(w.gateway).toBe("STRIPE");
  });

  it("adds a date range with inclusive end-of-day for `to`", () => {
    const w = buildSuperchatWhere(superchatFilterSchema.parse({ from: "2025-01-01", to: "2025-01-31" }));
    expect(w.paidAt).toBeDefined();
    const range = w.paidAt as { gte?: Date; lte?: Date };
    expect(range.gte?.toISOString()).toBe("2025-01-01T00:00:00.000Z");
    expect(range.lte?.toISOString()).toBe("2025-01-31T23:59:59.999Z");
  });

  it("only sets gte when `from` is provided and `to` is missing", () => {
    const w = buildSuperchatWhere(superchatFilterSchema.parse({ from: "2025-01-01" }));
    const range = w.paidAt as { gte?: Date; lte?: Date };
    expect(range.gte).toBeDefined();
    expect(range.lte).toBeUndefined();
  });

  it("builds a case-insensitive OR for the search query", () => {
    const w = buildSuperchatWhere(superchatFilterSchema.parse({ q: "anna" }));
    expect(Array.isArray(w.OR)).toBe(true);
    const clauses = w.OR as Array<{ displayName?: { contains: string; mode: string }; message?: { contains: string; mode: string } }>;
    expect(clauses).toHaveLength(2);
    expect(clauses[0]?.displayName?.mode).toBe("insensitive");
    expect(clauses[1]?.message?.mode).toBe("insensitive");
  });

  it("ignores malformed date strings silently (no range added)", () => {
    // We don't expose raw strings; the schema would reject them. But
    // if a malformed date slipped through (e.g. from a manual call),
    // the helper should not crash — it just skips the range.
    const w = buildSuperchatWhere({ from: "not-a-date", page: 1 } as unknown as ReturnType<typeof superchatFilterSchema.parse>);
    expect(w.paidAt).toBeUndefined();
  });
});