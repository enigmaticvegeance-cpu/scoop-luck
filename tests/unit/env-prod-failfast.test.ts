/**
 * Tests for lib/env.ts — the production fail-fast check (Phase 9.1).
 *
 * The shape checks here lock down:
 *   1. With NODE_ENV=production and NO env vars set, serverEnv() throws
 *      and the error message names every missing required var.
 *   2. With NODE_ENV=production and EVERY required var set, serverEnv()
 *      returns the parsed env without throwing.
 *   3. With NODE_ENV=development and NO env vars set, serverEnv() returns
 *      a lenient parsed env (current behavior — dev convenience).
 *   4. With NODE_ENV=test and NO env vars set, serverEnv() is lenient.
 *
 * Test isolation: `serverEnv()` memoizes its result in module-level
 * `cached`. We force a fresh import between tests with `vi.resetModules()`
 * so each test gets a clean cache. Stubs via `vi.stubEnv` reset on
 * `vi.unstubAllEnvs()` (called in afterEach).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// A small representative subset of the REQUIRED_IN_PRODUCTION list. The
// production check filters by name against parsed.data — so any string
// matching a schema field works as a stub value. We use realistic-shape
// values for the URL/email fields so zod's url()/email() passes.
const STUB_PROD_ENV = {
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: "https://stub.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "stub-anon-key-stubs-have-no-real-secret",
  SUPABASE_SERVICE_ROLE_KEY: "stub-service-role-key-with-enough-length-1234",
  // Database
  DATABASE_URL: "postgres://user:pass@127.0.0.1:5432/db",
  // Razorpay
  RAZORPAY_KEY_ID: "rzp_test_xxxxxxxxxxxxxxxx",
  RAZORPAY_KEY_SECRET: "stub-razorpay-secret-with-enough-length",
  RAZORPAY_WEBHOOK_SECRET: "stub-webhook-secret-with-enough-length",
  // Stripe
  STRIPE_SECRET_KEY: "sk_test_stub_stripe_secret_key_with_enough_length",
  STRIPE_PUBLISHABLE_KEY: "pk_test_stub_stripe_publishable_key",
  STRIPE_WEBHOOK_SECRET: "whsec_stub_stripe_webhook_secret",
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_stub_stripe_publishable_key",
  // PayPal
  PAYPAL_CLIENT_ID: "stub-paypal-client-id-with-real-shape",
  PAYPAL_CLIENT_SECRET: "stub-paypal-secret-with-enough-length-1234",
  PAYPAL_WEBHOOK_ID: "stub-paypal-webhook-id",
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: "stub-paypal-client-id-with-real-shape",
  // Rate-limit
  UPSTASH_REDIS_REST_URL: "https://stub.upstash.io",
  UPSTASH_REDIS_REST_TOKEN: "stub-upstash-token-with-enough-length-12",
  // Email
  RESEND_API_KEY: "re_stub_resend_key_with_enough_length_to_pass",
  RESEND_FROM_EMAIL: "noreply@example.com",
  // CAPTCHA
  TURNSTILE_SECRET_KEY: "stub-turnstile-secret-with-enough-length",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "stub-turnstile-site-key",
  // Invoice HMAC (must be >= 16 chars per zod rule)
  INVOICE_SECRET: "stub-invoice-secret-1234",
  // App
  NEXT_PUBLIC_APP_URL: "https://example.com",
  ADMIN_EMAILS: "admin@example.com",
  // Observability
  SENTRY_DSN: "https://stub@sentry.io/123",
} as const;

/**
 * Import a fresh copy of lib/env.ts. vi.resetModules() drops the module
 * cache so the inner `cached` variable starts undefined again, and the
 * dynamic import returns a new instance.
 */
async function freshServerEnv() {
  vi.resetModules();
  const mod = await import("@/lib/env");
  return mod.serverEnv;
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("serverEnv — production fail-fast", () => {
  it("throws when NODE_ENV=production and required vars are missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    // Intentionally no other stubs.

    const serverEnv = await freshServerEnv();
    expect(() => serverEnv()).toThrowError(/Missing required env vars in production/);

    // The error must name specific missing vars. We don't enumerate
    // every one in the assertion (the list could grow); we assert at
    // least one representative name appears.
    let consoleOutput = "";
    const origError = console.error;
    console.error = (...args: unknown[]) => {
      consoleOutput += args.map((a) => String(a)).join(" ") + "\n";
    };
    try {
      expect(() => serverEnv()).toThrowError();
    } finally {
      console.error = origError;
    }
    expect(consoleOutput).toMatch(/SENTRY_DSN/);
    expect(consoleOutput).toMatch(/DATABASE_URL/);
  });

  it("throws when only a subset of required vars is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("DATABASE_URL", STUB_PROD_ENV.DATABASE_URL);
    vi.stubEnv("SENTRY_DSN", STUB_PROD_ENV.SENTRY_DSN);

    const serverEnv = await freshServerEnv();
    expect(() => serverEnv()).toThrowError(/Missing required env vars in production/);
  });

  it("returns parsed env when every required var is set", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const [k, v] of Object.entries(STUB_PROD_ENV)) {
      vi.stubEnv(k, v);
    }

    const serverEnv = await freshServerEnv();
    const env = serverEnv();
    expect(env.NODE_ENV).toBe("production");
    expect(env.DATABASE_URL).toBe(STUB_PROD_ENV.DATABASE_URL);
    expect(env.SENTRY_DSN).toBe(STUB_PROD_ENV.SENTRY_DSN);
    expect(env.ADMIN_EMAILS).toBe(STUB_PROD_ENV.ADMIN_EMAILS);
  });

  it("memoizes — second call returns same object (no re-validation)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const [k, v] of Object.entries(STUB_PROD_ENV)) {
      vi.stubEnv(k, v);
    }

    const serverEnv = await freshServerEnv();
    const first = serverEnv();
    // Remove a required var AFTER the first call. The cached result
    // should still be returned (no re-validation on every call).
    vi.stubEnv("SENTRY_DSN", undefined);
    const second = serverEnv();
    expect(second).toBe(first);
    expect(second.SENTRY_DSN).toBe(STUB_PROD_ENV.SENTRY_DSN);
  });
});

describe("serverEnv — non-production lenience", () => {
  it("does not throw in development mode without env", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const serverEnv = await freshServerEnv();
    const env = serverEnv();
    expect(env.NODE_ENV).toBe("development");
    // Optional vars are absent; the schema permits them.
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.SENTRY_DSN).toBeUndefined();
  });

  it("does not throw in test mode without env", async () => {
    vi.stubEnv("NODE_ENV", "test");

    const serverEnv = await freshServerEnv();
    const env = serverEnv();
    expect(env.NODE_ENV).toBe("test");
  });
});

describe("serverEnv — schema shape errors", () => {
  it("rejects a malformed URL (RESEND_FROM_EMAIL not an email)", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("RESEND_FROM_EMAIL", "not an email");

    const serverEnv = await freshServerEnv();
    expect(() => serverEnv()).toThrowError(/Invalid environment variables/);
  });

  it("rejects an INVOICE_SECRET shorter than 16 chars", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("INVOICE_SECRET", "short");

    const serverEnv = await freshServerEnv();
    expect(() => serverEnv()).toThrowError(/Invalid environment variables/);
  });
});