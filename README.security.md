# Scoop Luck — Security Model

A runbook for engineers and reviewers. Every section maps to a concrete
control in code. If a control changes, update this file in the same PR.

## Threat model

| Adversary | Goal | Primary control |
|---|---|---|
| Anonymous attacker | Spam superchats, denial-of-service | Upstash rate-limit + Cloudflare Turnstile + WAF |
| Authenticated user | View another user's data, escalate role | Supabase RLS + server-side role check |
| Authenticated user | Bypass payment, get free tier | Webhook signature verify + server-side tier assignment |
| Admin | Log another admin out, leak PII | HttpOnly cookies + hashed logging |
| Payment gateway impersonator | Submit fake "paid" events | HMAC signature verify on every webhook |
| Cloudflare-bypasser | Tamper with CSP / inject scripts | Per-request CSP nonce + strict script-src |

## Input validation

* Every API route validates input with **Zod** in `lib/schemas/*`. The
  client-side schema is a duplicate of the server's for UX only.
* Allow-list over block-list. Profanity is filtered for display
  (`lib/security.ts`), not for blocking — admins can hide messages.
* All free-text is rendered with React (no `dangerouslySetInnerHTML`)
  and pre-cleaned to strip control characters and `<>`.
* Avatars: MIME validated by `file-type` magic-byte check; rejected
  SVG; re-encoded server-side with `sharp` to defang image bombs.

## Injection

* **Prisma** is the only DB access layer. No raw SQL. Parameterized
  queries by construction.
* No `eval`, no `new Function`, no string-built template engines.

## Auth & sessions

* **Supabase Auth** owns authentication (bcrypt hashes, JWT tokens).
* Sessions live in cookies managed by `@supabase/ssr`; middleware
  refreshes them on every request.
* Admin MFA: email OTP required on every admin login. We do **not**
  rely on the Supabase Auth session alone — the admin layout refuses
  to render until the in-app OTP challenge is consumed
  (`AdminOtpChallenge`).
* CSRF defense: `SameSite=Strict` cookies (set by Supabase), Turnstile
  on every form that mutates state, and per-route rate-limit.
* Session fixation: new session cookie is minted on every
  `signInWithPassword` and on every OAuth callback.

## Rate limiting (Upstash Redis sliding window)

| Endpoint family | Budget |
|---|---|
| `POST /api/payments/*` | 5 req/min/IP |
| `POST /api/superchats` | 3 req/min/IP |
| `POST /api/auth/login` | 10 req/15min/IP and 10 req/15min/email |
| `POST /api/auth/otp` | 3 req/10min/email |
| `GET  /api/admin/*` | 60 req/min/IP |
| Other API | 100 req/min/IP |

Violations return **429** with `Retry-After`. The bucket name (never
the IP/email) is sent to Sentry.

## Payment integrity

* Tier is assigned **only** in the verified webhook handler. The
  client-suggested amount is never trusted.
* Razorpay: HMAC-SHA256 of `razorpay_order_id|razorpay_payment_id` with
  `RAZORPAY_WEBHOOK_SECRET`. Implemented in
  `app/api/webhooks/razorpay/route.ts` (Phase 2).
* Stripe: `stripe.webhooks.constructEvent` with `STRIPE_WEBHOOK_SECRET`.
* PayPal: SDK `verifyWebhookSignature` with `PAYPAL_WEBHOOK_ID`.
* Webhook endpoints reject non-POST and any content-type other than
  application/json. They run before any DB write — partial state is
  impossible.
* Idempotency: every order creation carries a UUIDv4 key, deduped both
  in Redis (24h TTL) and on the Superchat row (unique index).
* We never store card number, CVV, UPI PIN — only gateway order id,
  gateway payment id, amount in minor units, currency, and tier.

## Security headers (`next.config.mjs` + `middleware.ts`)

| Header | Value |
|---|---|
| `Content-Security-Policy` | Per-request nonce; explicit allow-list for payment SDKs |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `X-Frame-Options` | `DENY` (anti-clickjacking) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), interest-cohort=()` |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| API routes | `Cache-Control: no-store, no-cache, must-revalidate, private` |

A per-request nonce is generated in `middleware.ts` and stamped on the
`<head>` of every server-rendered page (`x-nonce` header). Every
`<Script>` in our own bundle carries the nonce so the browser refuses
inline scripts injected at runtime.

## Cloudflare (dashboard config)

* WAF: OWASP CRS ruleset; block bad bots and known scanners.
* Bot Fight Mode: ON.
* Security Level: Medium (High during live streams).
* Turnstile widget on: registration, login, payment selection.
* Cache: static assets only. API routes (`/api/*`) bypass cache by
  setting `Cache-Control: no-store`.
* Zero Trust: lock `/api/admin/*` to specific IP ranges (optional).

## Database security

* Row-Level Security enabled on every table.
* `users`: a viewer may select their own row; admins may select any.
  No client-side role mutation — admin role is set from
  `ADMIN_EMAILS` env at login.
* `superchats`: anonymous SELECT allowed only on rows where
  `status = 'PAID' AND hidden = false`. Mutations only via service role
  on the server.
* `admin_*` mutations require service-role client, only reachable from
  API routes that themselves are gated by `requireAdmin()`.
* Primary keys are UUIDs everywhere.

## Secrets management

* All secrets live in Vercel env vars. Never in git, never in the
  browser bundle.
* Rotation plan (quarterly, owner: SRE):
  * `RAZORPAY_WEBHOOK_SECRET` — rotate from dashboard; deploy; old
    secret honoured for 24h via a brief dual-accept window.
  * `STRIPE_WEBHOOK_SECRET` — same, via Stripe CLI `stripe listen`
    replay.
  * `PAYPAL_WEBHOOK_ID` — rotate in PayPal dashboard; redeploy.
  * `SUPABASE_SERVICE_ROLE_KEY` — rotate in Supabase, redeploy all
    environments in lockstep (no dual-accept — single source of truth).
  * `INVOICE_SECRET` — only needed for invoice numbering HMAC. Rotate
    with a DB backfill of the new secret across the format string.
* `.env.example` is committed. `.env*` is in `.gitignore`.

## Logging

Logged: route, request id, hashed email (`fingerprint()`), success/fail,
timestamp. **Never logged**: passwords, OTPs, card data, UPI PINs,
Supabase access tokens, raw JWTs.

The `log()` wrapper in `lib/log.ts` is the single log path; nothing
imports `console.log` directly in production code.

## Error handling

* Public APIs return `{ error: "Something went wrong" }` (or
  rate-limit / validation specifics) on failure. The full cause
  (with stack trace) goes only to Sentry.
* Auth failures: `requireUser()` / `requireAdmin()` throw a
  `NextResponse.redirect` — they never crash the request handler.
* **Fail closed**: if any auth check errors, the user is denied
  (no graceful fallback that could leak data).

## Secret rotation runbook

1. Open PR titled `chore(security): rotate <secret>`. Don't merge
   until all envs are updated.
2. Update the secret in each environment via Vercel CLI:
   `vercel env rm <NAME> production && vercel env add <NAME> production`.
3. For webhooks, configure the new value in the gateway dashboard
   **after** the redeploy so the old secret isn't still in flight.
4. Document the rotation in `SECURITY_LOG.md` (date, secret, env,
   operator).

## Penetration test plan

Before each major release:

* OWASP ZAP scan against staging URL with the auth flow exercised.
* Manual replay of every webhook payload (with and without valid HMAC).
* Upload fuzz test against `/api/profile/avatar` (SVG, polyglot, 50MB
  PNG with embedded zip).
* Tier escalation attempts: submit ₹10 → tamper amount to ₹10000 in
  the create-order request, verify the webhook recomputes tier.
* Brute-force the admin login form with 50 attempts to confirm
  lockout triggers correctly.

## Reporting security issues

Email security@scoop-luck.example (or open a private GitHub advisory).
Do not file public issues for vulnerabilities.
