import { describe, it, expect } from "vitest";

import {
  updateProfileSchema,
  profileResponseSchema,
  avatarUploadResponseSchema,
} from "@/lib/schemas/profile";

describe("updateProfileSchema", () => {
  it("accepts a 3-char display name", () => {
    const parsed = updateProfileSchema.safeParse({ displayName: "abc" });
    expect(parsed.success).toBe(true);
  });

  it("accepts a 30-char display name", () => {
    const parsed = updateProfileSchema.safeParse({
      displayName: "A".repeat(30),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a 2-char display name", () => {
    const parsed = updateProfileSchema.safeParse({ displayName: "ab" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/3/);
    }
  });

  it("rejects a 31-char display name", () => {
    const parsed = updateProfileSchema.safeParse({
      displayName: "A".repeat(31),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toMatch(/30/);
    }
  });

  it("rejects names with disallowed characters", () => {
    const r1 = updateProfileSchema.safeParse({ displayName: "foo<bar>" });
    expect(r1.success).toBe(false);
    const r2 = updateProfileSchema.safeParse({ displayName: "foo@example" });
    expect(r2.success).toBe(false);
    const r3 = updateProfileSchema.safeParse({ displayName: "foo.bar" });
    expect(r3.success).toBe(false);
  });

  it("trims whitespace before validating", () => {
    // schema trims; "  abc  " becomes "abc" → accepted.
    const parsed = updateProfileSchema.safeParse({ displayName: "  abc  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.displayName).toBe("abc");
    }
  });

  it("accepts letters, numbers, spaces, underscores", () => {
    expect(updateProfileSchema.safeParse({ displayName: "Anna_99" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ displayName: "Anna 99" }).success).toBe(true);
    expect(updateProfileSchema.safeParse({ displayName: "Anna-99" }).success).toBe(false);
  });
});

describe("profileResponseSchema", () => {
  it("parses a complete response", () => {
    const r = profileResponseSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000000",
      email: "a@b.co",
      displayName: "Anna",
      avatarUrl: "https://x.supabase.co/storage/v1/object/sign/avatars/abc.jpg?token=…",
      emailVerified: true,
    });
    expect(r.success).toBe(true);
  });

  it("permits null displayName and null avatarUrl", () => {
    const r = profileResponseSchema.safeParse({
      id: "00000000-0000-4000-8000-000000000000",
      email: "a@b.co",
      displayName: null,
      avatarUrl: null,
      emailVerified: false,
    });
    expect(r.success).toBe(true);
  });
});

describe("avatarUploadResponseSchema", () => {
  it("requires a non-empty URL", () => {
    expect(
      avatarUploadResponseSchema.safeParse({
        avatarUrl: "https://x.supabase.co/foo.jpg",
      }).success,
    ).toBe(true);
    expect(avatarUploadResponseSchema.safeParse({ avatarUrl: "" }).success).toBe(false);
    expect(avatarUploadResponseSchema.safeParse({ avatarUrl: "not-a-url" }).success).toBe(false);
  });
});
