# DEPLOY.md — Operator runbook for Scoop Luck

This document covers the **production deploy** of Scoop Luck on Vercel.
Local development is in [README.md](./README.md) and [CONTRIBUTING.md](./CONTRIBUTING.md).

## 1. Prerequisites

You (or the org owner) need accounts on all of:

- **Vercel** — `team_JE7MRyLJj2PkUuCe0Fgkbs9k` (scoop-luck project: `prj_3D9N1V8ZOfwjOjI3ZKpRMtwMMZuu`)
- **Postgres** — any provider that gives you a `postgres://` URL (Vercel Postgres, Supabase, Neon, RDS).
- **Upstash Redis** — for rate-limits + webhook idempotency. Free tier is enough for hobby traffic.
- **Resend** — for invoice + admin OTP emails. Sender domain must be verified.
- **Cloudflare Turnstile** — for CAPTCHA on every mutating form. Free, unlimited.
- **Sentry** — for error monitoring. We treat this as hard-required.
- **Razorpay** (India: UPI + RuPay + Indian cards) — sandbox + live keys.
- **Stripe** (international cards) — sandbox + live keys.
- **PayPal** (international wallet) — sandbox + live app credentials.

## 2. One-time Vercel project setup

If you're spinning up a fresh Vercel project:

```bash
# Link your local checkout to the existing project.
vercel link --yes

# Or create a new project and link it.
vercel link
```

In the Vercel dashboard:

- **Settings → General → Region**: `bom1` (Mumbai — closest to the primary audience in India).
- **Settings → Build & Development → Framework Preset**: Next.js (auto-detected).
- **Settings → Build & Development → Build Command**: leave default (`next build`). The `prisma generate` postinstall hook runs on `pnpm install` before `next build`.
- **Settings → Functions → Node.js Version**: 22 (matches `.nvmrc`; auto-detected).

## 3. Required env vars

Every var below is enforced by `lib/env.ts:REQUIRED_IN_PRODUCTION`. If any
are missing when `NODE_ENV=production`, the app throws at boot with a
clear "Missing required env vars" message naming each one. You cannot
ship a half-configured deploy.

| Var | Source | Format | Sensitive |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Your Vercel deployment URL | `https://scoop-luck.example` | no |
| `NODE_ENV` | Always `production` on Vercel | `production` | no |
| `ADMIN_EMAILS` | Comma-separated list of admin logins | `admin@example.com,owner@example.com` | no |
| `INVOICE_SECRET` | `openssl rand -hex 32` | ≥16 chars | **yes** |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase dashboard → API | `https://xxx.supabase.co` | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase dashboard → API | ≥20 chars (anon JWT) | no (it's public) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase dashboard → API | ≥20 chars (service-role JWT) | **yes** |
| `DATABASE_URL` | Postgres provider | **must be `postgres://`** (NOT `prisma+postgres://`) | **yes** |
| `RAZORPAY_KEY_ID` | Razorpay dashboard → API Keys | `rzp_live_…` | no |
| `RAZORPAY_KEY_SECRET` | Razorpay dashboard → API Keys | string | **yes** |
| `RAZORPAY_WEBHOOK_SECRET` | Razorpay dashboard → Webhooks | string | **yes** |
| `STRIPE_SECRET_KEY` | Stripe dashboard → API keys | `sk_live_…` | **yes** |
| `STRIPE_PUBLISHABLE_KEY` | Stripe dashboard → API keys | `pk_live_…` | no |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Mirror of `STRIPE_PUBLISHABLE_KEY` | same as above | no |
| `STRIPE_WEBHOOK_SECRET` | Stripe dashboard → Webhooks | `whsec_…` | **yes** |
| `PAYPAL_CLIENT_ID` | PayPal developer dashboard | string | no |
| `PAYPAL_CLIENT_SECRET` | PayPal developer dashboard | string | **yes** |
| `PAYPAL_WEBHOOK_ID` | PayPal developer dashboard → Webhooks | string | **yes** |
| `NEXT_PUBLIC_PAYPAL_CLIENT_ID` | Mirror of `PAYPAL_CLIENT_ID` | same | no |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Cloudflare Turnstile widget | `0x4AAA…` | no |
| `TURNSTILE_SECRET_KEY` | Cloudflare Turnstile widget | string | **yes** |
| `UPSTASH_REDIS_REST_URL` | Upstash console | `https://xxx.upstash.io` | no |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash console | string | **yes** |
| `RESEND_API_KEY` | Resend dashboard → API Keys | `re_…` | **yes** |
| `RESEND_FROM_EMAIL` | Verified sender in Resend | `Scoop Luck <noreply@scoop-luck.example>` | no |
| `SENTRY_DSN` | Sentry project settings | `https://xxx@sentry.io/123` | no |

**Tip:** Sensitive vars must be set per-environment (Preview / Production) — don't paste a live key into a preview deployment.

**Why every payment gateway?** Razorpay, Stripe, AND PayPal are all wired into the live superchat flow. The /api/payments/* routes expect each gateway's keys to be present; if any are missing, the app fails fast at boot. This is intentional — a half-configured payment setup is worse than a non-functional one.

**`DATABASE_URL` gotcha:** Use a plain `postgres://` URL. **Do NOT** use a `prisma+postgres://` Accelerate-style URL — the `@prisma/adapter-pg` driver does not understand it. Supabase Pooler URLs (`postgres://postgres.xxx:[pwd]@aws-0-us-east-1.pooler.supabase.com:6543/postgres`) are fine. So are Vercel Postgres URLs (`postgres://default:xxx@xxx.postgres.vercel-storage.com:5432/verceldb`).

## 4. Branch-to-deployment mapping

Vercel auto-detects Next.js. By default:

| Branch | URL |
| --- | --- |
| `main` (production branch) | `https://scoop-luck.example` |
| any other branch | `https://scoop-luck-<branch>-<team>.vercel.app` (preview) |
| every PR | preview URL posted as a PR comment |

To change the production branch: Vercel dashboard → Settings → Git → Production Branch.

## 5. Database migration

This project ships **without** a `prisma/migrations/` directory. The
schema is the source of truth; production is updated via `db push`, not
migration files.

On first deploy:

```bash
# Pull production env into a local .env.production
vercel env pull .env.production

# Apply the current schema. Idempotent: a re-run against an
# up-to-date DB is a no-op.
pnpm prisma:push
```

For subsequent deploys that add new models/columns: run `pnpm prisma:push`
against production before pushing the new code, so the live app doesn't
crash on a missing column. (If the Vercel build is set up to run
`prisma migrate deploy` automatically, replace the above with the
equivalent command — the schema is still the source of truth.)

**Do not** run `prisma db push` against production from a CI runner —
operators only, never automated.

## 6. Post-deploy smoke test checklist

After every production deploy, run through this. Items 1–3 are critical; the rest can be deferred.

1. **Admin login** — `/admin/login`, enter an email in `ADMIN_EMAILS`. Confirm OTP email arrives (check Resend dashboard logs). Confirm `/admin` dashboard renders.
2. **Test superchat** — On the public landing page, send a 1 INR test tip through Razorpay (sandbox keys → live keys swap during smoke). Confirm tier badge renders correctly.
3. **Webhook delivery** — In Razorpay/Stripe/PayPal dashboards, confirm the webhook endpoint returned 200 (otherwise webhook retries pile up — investigate within 1 hour).
4. **Invoice email** — Confirm the invoice email lands in the donor's inbox (Resend logs).
5. **`/admin/audit`** — Confirm the role-change event from step 1 appears in the audit log.
6. **CSP / headers** — `curl -I https://scoop-luck.example/` and verify CSP, HSTS, X-Frame-Options headers are present (matches `next.config.mjs` baseline).
7. **Sentry** — Trigger a benign error (e.g. visit `/api/payments/razorpay/create-order` with a missing field). Confirm Sentry receives it within 30s.

## 7. Rollback runbook

Vercel deployments are immutable. To roll back:

**Via dashboard:** Deployments → click a previous successful deployment → "Promote to Production".

**Via CLI:**

```bash
vercel promote <previous-deployment-url>
```

Rollbacks take ~30s to propagate globally. DNS doesn't change.

If a deployment broke the database schema: roll back the **code first**, then decide whether to revert the schema change manually via `prisma db push` with an older `schema.prisma` checked out.

## 8. Incident response

For secret rotation, see [README.security.md](./README.security.md) § Secret rotation runbook. Summary:

- Rotate immediately on any suspected leak (Sentry alert, log scrape, employee offboarding).
- Rotate via the upstream dashboard (Razorpay/Stripe/PayPal/Supabase/Resend), then update Vercel env vars, then trigger a redeploy.
- The webhook signature keys (Razorpay/Stripe/PayPal `*_WEBHOOK_SECRET`) are the highest-priority rotation — a leaked webhook secret allows forged payment confirmations.

For Sentry: https://sentry.io/scoop-luck/ (project URL — replace with the real one before sharing).

For uptime monitoring: hook Vercel's "Deployment failed" webhook into a Slack/Discord channel via the Vercel integrations page.