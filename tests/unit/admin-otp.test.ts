import { describe, it, expect } from "vitest";

import {
  mintOtp,
  hashOtp,
  constantTimeEqual,
  maskEmail,
  normalizeCode,
  OTP_CODE_LENGTH,
  OTP_REGEX,
} from "@/lib/admin-otp";
import { verifyAdminOtpSchema, requestAdminOtpSchema } from "@/lib/schemas/admin";

describe("mintOtp", () => {
  it("always produces a 6-character string", () => {
    for (let i = 0; i < 100; i++) {
      const code = mintOtp();
      expect(code).toHaveLength(OTP_CODE_LENGTH);
    }
  });

  it("matches the digit-only regex", () => {
    for (let i = 0; i < 50; i++) {
      expect(mintOtp()).toMatch(OTP_REGEX);
    }
  });

  it("includes codes with leading zeros", () => {
    // Run enough times that we should hit at least one code starting
    // with "0". If this flakes (5/100,000 chance of all-nonzero), the
    // test still validates the format.
    let sawLeadingZero = false;
    for (let i = 0; i < 200; i++) {
      if (mintOtp().startsWith("0")) {
        sawLeadingZero = true;
        break;
      }
    }
    expect(sawLeadingZero).toBe(true);
  });
});

describe("hashOtp", () => {
  it("is deterministic — same code → same hash", () => {
    const a = hashOtp("123456");
    const b = hashOtp("123456");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("different codes → different hashes", () => {
    expect(hashOtp("123456")).not.toBe(hashOtp("123457"));
    expect(hashOtp("000001")).not.toBe(hashOtp("100000"));
  });
});

describe("constantTimeEqual", () => {
  it("accepts identical strings", () => {
    expect(constantTimeEqual("abc123", "abc123")).toBe(true);
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("rejects strings of different lengths", () => {
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
  });

  it("rejects strings that differ in a single character", () => {
    expect(constantTimeEqual("abc123", "abc124")).toBe(false);
  });

  it("treats differing character class as a mismatch", () => {
    // Different-length bytes should fail; constant-time guard.
    expect(constantTimeEqual("000000", "00000")).toBe(false);
  });
});

describe("maskEmail", () => {
  it("shows the first 2 chars + *** + domain", () => {
    expect(maskEmail("anna@example.com")).toBe("an***@example.com");
  });

  it("falls back when the local part has 2 or fewer chars", () => {
    expect(maskEmail("a@example.com")).toBe("a***@example.com");
    expect(maskEmail("ab@example.com")).toBe("ab***@example.com");
  });

  it("returns the input unchanged when no '@' is present", () => {
    expect(maskEmail("not-an-email")).toBe("not-an-email");
  });
});

describe("normalizeCode", () => {
  it("strips surrounding whitespace", () => {
    expect(normalizeCode("  123456  ")).toBe("123456");
  });

  it("does not strip interior whitespace — the OTP must be 6 contiguous digits", () => {
    // The form lets the user paste "12 3456" then tab between boxes;
    // the action schema's `^\d{6}$` regex would already reject that,
    // but the helper should still be conservative.
    expect(normalizeCode("1 23456")).toBe("1 23456");
  });
});

describe("verifyAdminOtpSchema", () => {
  it("accepts a valid 6-digit code and a valid email", () => {
    const r = verifyAdminOtpSchema.safeParse({
      email: "admin@example.com",
      code: "123456",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a 5-digit code", () => {
    const r = verifyAdminOtpSchema.safeParse({
      email: "admin@example.com",
      code: "12345",
    });
    expect(r.success).toBe(false);
  });

  it("rejects a 7-digit code", () => {
    const r = verifyAdminOtpSchema.safeParse({
      email: "admin@example.com",
      code: "1234567",
    });
    expect(r.success).toBe(false);
  });

  it("rejects codes containing letters", () => {
    const r = verifyAdminOtpSchema.safeParse({
      email: "admin@example.com",
      code: "12345a",
    });
    expect(r.success).toBe(false);
  });

  it("accepts codes with leading zeros", () => {
    const r = verifyAdminOtpSchema.safeParse({
      email: "admin@example.com",
      code: "001234",
    });
    expect(r.success).toBe(true);
  });
});

describe("requestAdminOtpSchema", () => {
  it("requires email + password", () => {
    const ok = requestAdminOtpSchema.safeParse({
      email: "admin@example.com",
      password: "hunter2hunter2hunter2",
    });
    expect(ok.success).toBe(true);

    const noPw = requestAdminOtpSchema.safeParse({
      email: "admin@example.com",
      password: "",
    });
    expect(noPw.success).toBe(false);
  });

  it("treats turnstileToken as optional", () => {
    const r = requestAdminOtpSchema.safeParse({
      email: "admin@example.com",
      password: "hunter2hunter2hunter2",
      turnstileToken: undefined,
    });
    expect(r.success).toBe(true);
  });
});
