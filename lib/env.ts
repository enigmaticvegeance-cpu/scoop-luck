/**
 * Environment-variable reader.
 *
 * Two-layer check:
 *   1. Import-time (here): every var is validated by zod for shape; in
 *      `NODE_ENV=production`, the REQUIRED_IN_PRODUCTION list is enforced
 *      and we throw with a single readable message listing every missing
 *      var. This catches misconfigured deploys at first request instead
 *      of letting the app boot with half its services wired up.
 *   2. Lazy (per-service): lib/razorpay.ts, lib/stripe.ts, lib/paypal,
 *      lib/email.ts, lib/rate-limit.ts, lib/turnstile.ts each assert
 *      their keys are present on first use. This is defense-in-depth —
 *      if a service is somehow called in test mode without env, the lazy
 *      throw is still helpful. (In production the import-time check
 *      fires first and these branches become unreachable.)
 *
 * For builds that intentionally run without certain integrations (CI,
 * lint, typecheck), set SCOOP_LUCK_SKIP_ENV=1 and only the absolutely
 * required vars are validated.
 */
import { z } from "zod";

const skipEnv = process.env.SCOOP_LUCK_SKIP_ENV === "1";

const ServerEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  // Supabase (server)
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),

  // Database
  DATABASE_URL: z.string().min(1).optional(),

  // Razorpay
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),

  // Stripe
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: z.string().optional(),

  // PayPal
  PAYPAL_CLIENT_ID: z.string().optional(),
  PAYPAL_CLIENT_SECRET: z.string().optional(),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: z.string().optional(),

  // Cloudflare Turnstile
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),

  // Upstash Redis
  UPSTASH_REDIS_REST_URL: z.string().url().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),

  // Resend
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),

  // App
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  ADMIN_EMAILS: z.string().optional(),
  INVOICE_SECRET: z.string().min(16).optional(),

  // Sentry (optional in dev)
  SENTRY_DSN: z.string().url().optional(),
});

export type ServerEnv = z.infer<typeof ServerEnvSchema>;

/**
 * Single source of truth for which env vars MUST be set in production.
 *
 * The runtime check fires inside `serverEnv()` when NODE_ENV=production,
 * so an operator who forgets a key will see a clear "Missing required
 * env vars" message at boot — not at first payment or first admin login.
 *
 * When adding a new var to `.env.example`:
 *   1. Add it to `ServerEnvSchema` above with the right zod rule.
 *   2. If it's required at runtime in production, add it here.
 *   3. Document the source + format in DEPLOY.md (operator runbook).
 */
const REQUIRED_IN_PRODUCTION = [
  // Supabase
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",

  // Database
  "DATABASE_URL",

  // Razorpay (gateway)
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",

  // Stripe (gateway)
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",

  // PayPal (gateway)
  "PAYPAL_CLIENT_ID",
  "PAYPAL_CLIENT_SECRET",
  "PAYPAL_WEBHOOK_ID",
  "NEXT_PUBLIC_PAYPAL_CLIENT_ID",

  // Rate-limit
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",

  // Email
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",

  // CAPTCHA
  "TURNSTILE_SECRET_KEY",
  "NEXT_PUBLIC_TURNSTILE_SITE_KEY",

  // Invoice HMAC
  "INVOICE_SECRET",

  // App
  "NEXT_PUBLIC_APP_URL",
  "ADMIN_EMAILS",

  // Observability — we treat this as hard-required because lib/log.ts
  // becomes a no-op without it and incidents disappear silently.
  "SENTRY_DSN",
] as const satisfies readonly (keyof ServerEnv)[];

let cached: ServerEnv | null = null;

export function serverEnv(): ServerEnv {
  if (cached) return cached;
  if (skipEnv) {
    // Provide safe defaults for build-time tasks (lint, typecheck, prisma generate)
    cached = ServerEnvSchema.parse({
      NODE_ENV: process.env.NODE_ENV ?? "development",
    });
    return cached;
  }
  const parsed = ServerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error(
      "❌ Invalid environment variables:",
      z.flattenError(parsed.error).fieldErrors,
    );
    throw new Error("Invalid environment variables. See logs above.");
  }
  if (parsed.data.NODE_ENV === "production") {
    const missing = REQUIRED_IN_PRODUCTION.filter((k) => !parsed.data[k]);
    if (missing.length > 0) {
      console.error(
        "❌ Missing required env vars in production:\n  " + missing.join("\n  "),
      );
      throw new Error("Missing required env vars in production. See logs above.");
    }
  }
  cached = parsed.data;
  return cached;
}

/**
 * Public (browser-exposed) env — only the vars prefixed with NEXT_PUBLIC_
 * are guaranteed to be inlined by Next. Everything else is undefined here.
 */
export const publicEnv = {
  APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  STRIPE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "",
  PAYPAL_CLIENT_ID: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "",
  TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
};

/**
 * Resolve the list of admin emails (comma-separated in env) into a Set.
 * The `requireAdmin` helper compares the logged-in user's email to this set.
 */
export function getAdminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}