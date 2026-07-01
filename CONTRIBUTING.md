# CONTRIBUTING.md — Developer onboarding for Scoop Luck

This document covers how to set up Scoop Luck locally, run the tests,
and ship a PR. Production deploy is in [DEPLOY.md](./DEPLOY.md). The
security model is in [README.security.md](./README.security.md).

## 1. Local setup

```bash
# 1. Install deps. The postinstall hook runs `prisma generate` so the
#    Prisma client is ready immediately.
pnpm install

# 2. Copy the env template. Fill in the keys marked required below.
cp .env.example .env

# 3. Start the dev server. Vercel Turbopack + Next 16.
pnpm dev
```

`pnpm install` is the only mandatory step — the postinstall hook auto-generates the Prisma client. You don't need to run `prisma:generate` manually.

## 2. Required env vars for local dev

You do NOT need every var from DEPLOY.md §3 to boot locally. A reasonable dev subset:

| Var | What to put | Why |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project's URL | Auth, RLS, storage |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon JWT | Auth |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role JWT | Webhook ingestion, admin ops |
| `DATABASE_URL` | A `postgres://` URL pointing at a dev DB | Prisma |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `1x00000000000000000000AA` (Cloudflare's published **always-passes** test key) | CAPTCHA widget |
| `TURNSTILE_SECRET_KEY` | `1x0000000000000000000000000000000AA` (Cloudflare's published **always-passes** test secret) | CAPTCHA server check |
| `RESEND_API_KEY` | A Resend test key OR leave blank (lib/email.ts degrades to `console.log` in dev) | Email |
| `RESEND_FROM_EMAIL` | `Scoop Luck Dev <onboarding@resend.dev>` (Resend's default test sender) | Email |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Razorpay **test mode** keys (start with `rzp_test_`) | If you're testing the Indian payment path |
| `STRIPE_SECRET_KEY` / `STRIPE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe **test mode** keys (start with `sk_test_` / `pk_test_`) | If you're testing the international card path |
| `STRIPE_WEBHOOK_SECRET` | From `stripe listen --forward-to localhost:3000/api/webhooks/stripe` | Webhook testing |
| `RAZORPAY_WEBHOOK_SECRET` | Any string in dev (HMAC check uses your value) | Webhook testing |
| `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` / `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | PayPal **sandbox** credentials | If you're testing the PayPal path |
| `PAYPAL_WEBHOOK_ID` | Any string in dev | Webhook testing |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | An Upstash Redis instance (free tier is enough) | Rate-limits + webhook dedupe |
| `INVOICE_SECRET` | `openssl rand -hex 32` (any 16+ char string works in dev) | Invoice HMAC |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Email links + OG tags |
| `ADMIN_EMAILS` | Your email (the one you'll log in with) | Admin gate |
| `SENTRY_DSN` | Leave blank in dev (lib/log.ts degrades to console) | Observability |

**`NODE_ENV`**: leave as `development` (the `.env.example` default). The production fail-fast check in `lib/env.ts` only fires when `NODE_ENV=production`.

## 3. Tests

Three commands, in this order:

```bash
# 1. TypeScript — must be clean.
pnpm typecheck

# 2. Unit tests (Vitest). Pure unit — no DB needed.
pnpm test

# 3. Accessibility sweep (Playwright + axe-core).
#    Requires Postgres on 51214. Boot it first:
pnpm exec prisma dev &        # foreground once to confirm the DB is up
pnpm exec prisma db push      # apply schema (one-time per DB reset)
pnpm axe                      # 9 routes, ~30s on a laptop
```

The `pnpm axe` command boots its own dev server with the E2E auth bypass env vars (see [README.security.md](./README.security.md) § Test seam). You do NOT need to log in to scan admin pages.

If `prisma dev` is already running on 51213/51214 (typical for local dev), `pnpm axe` reuses it.

## 4. Adding a new env var

When you introduce a new configuration knob, you must update three places — otherwise CI will fail or production will crash at boot:

1. **`.env.example`** — add the var with a placeholder value and a comment explaining where to source it.
2. **`lib/env.ts` `ServerEnvSchema`** — add the var with the right zod rule. Use `.url()` for URLs, `.email()` for emails, `.min(N)` for length constraints, etc. If it's optional in dev, mark it `.optional()`.
3. **`lib/env.ts` `REQUIRED_IN_PRODUCTION`** — if it's needed at runtime in production, add it here too. CI's `env-prod-failfast.test.ts` will fail if a new var is added to `.env.example` but forgotten here.

Also: add a row to the env var table in [DEPLOY.md §3](./DEPLOY.md#3-required-env-vars).

## 5. PR checklist

Before opening a PR:

- [ ] `pnpm typecheck` exits clean.
- [ ] `pnpm test` passes (all unit tests).
- [ ] `pnpm axe` passes (0 serious / 0 critical accessibility violations across 9 routes).
- [ ] If you added a new third-party origin (script, image, iframe, fetch), update the CSP in `next.config.mjs`. Keep the allowlist tight.
- [ ] If you changed anything security-sensitive (auth, rate-limit, CSP, payment integrity, input validation, secrets handling), update `SECURITY_LOG.md` with a dated entry. Format: existing Phase 1–9 entries.
- [ ] If you changed the schema, run `pnpm prisma:push` locally and verify the AuthEvent audit row still records role transitions correctly.
- [ ] If you added a new file under `tests/`, follow the existing pattern (file header comment, `vi.mock` for Prisma + Supabase, dynamic `await import(...)` to allow hoisting).

## 6. Repo conventions

- **File header comments** — every source file starts with a 1-paragraph docstring describing what it does and why. Follow the existing style (see `lib/auth.ts`, `components/admin/AuditTable.tsx`).
- **No PII in logs** — `lib/log.ts` accepts a `LogContext` object that you should populate with hashed fingerprints (`fingerprint(email)`), never raw emails or user IDs.
- **Server-only / client-only** — `lib/*` files that touch Prisma or Supabase service-role must include `import "server-only"` at the top.
- **No `any`** — `tsconfig.json` has `strict: true`. Use `unknown` and narrow with type guards.

## 7. Getting help

- **Bug / question** — open a GitHub issue. Include the failing command + full error output.
- **Security issue** — see [README.security.md](./README.security.md) § Reporting. Do NOT open a public issue.
- **Stuck on local setup** — copy-paste your `pnpm dev` output (with secrets redacted) into an issue.