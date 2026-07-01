# Scoop Luck

A production-grade podcast superchat platform — India + international payments, server-side verified, with admin moderation.

See **README.security.md** for the security model and runbook.

## Stack

- **Frontend**: Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v3 · Framer Motion
- **Auth**: Supabase Auth (email + password + email verification)
- **DB**: PostgreSQL via Prisma 7 (`@/generated/prisma`)
- **Payments**: Razorpay (UPI / Indian cards), Stripe (international cards), PayPal
- **Cache & rate-limit**: Upstash Redis
- **CAPTCHA**: Cloudflare Turnstile
- **Email**: Resend
- **Observability**: Sentry
- **Tests**: Vitest · Playwright

## Local setup

```bash
pnpm install
cp .env.example .env        # fill in the keys
pnpm prisma:generate
pnpm dev
```

For Prisma migrations during development:

```bash
pnpm prisma:migrate --name init
```

For production builds:

```bash
pnpm prisma:generate
pnpm build
pnpm start
```

## Deployment

Scoop Luck deploys to **Vercel** (project ID pinned in `.vercel/project.json`).
Every PR auto-builds via GitHub Actions (`.github/workflows/ci.yml`) and
gets a preview URL on merge; pushes to `main` go to production.

The full operator runbook — Vercel setup, env var table, database
migration, post-deploy smoke tests, rollback procedure — is in
[DEPLOY.md](./DEPLOY.md).

For local development and tests, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Repo layout

```
app/                 – App Router routes (public + admin)
components/          – UI primitives + feature components
lib/                 – Server helpers (auth, prisma, redis, rate-limit, …)
prisma/              – Prisma schema + migrations
supabase/            – Supabase CLI config & migrations
middleware.ts        – CSP nonce, security headers, rate-limit, auth gate
next.config.mjs      – Build + security headers
tailwind.config.ts   – Design tokens (cyberpunk / neon)
```

## Security review

Read `README.security.md` and the in-line `*Flags*` comments before opening a PR.
