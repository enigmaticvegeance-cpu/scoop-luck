/**
 * Playwright configuration — used by `pnpm test:e2e` and `pnpm axe`.
 *
 * Scope: chromium-only (axe + Playwright runtime is heavy; we're not
 * running cross-browser on this project yet). Each spec under
 * tests/e2e/ must be idempotent and self-contained.
 *
 * Test infrastructure:
 *   - The dev server is started by `webServer` on port 3100.
 *     `reuseExistingServer: !process.env.CI` lets `pnpm axe` pick up
 *     a pre-existing dev server (useful on a developer laptop) but
 *     forces a fresh boot in CI.
 *   - The admin dashboard pages query Postgres, so a running DB is
 *     required for the admin axe sweep. `pnpm exec prisma dev` boots
 *     a local one on 51213/51214 (see prisma docs). When unavailable,
 *     the admin cases skip rather than fail (test.skip on 5xx).
 *
 * E2E auth bypass:
 *   - The webserver is launched with NODE_ENV=test, E2E_AUTH_BYPASS=true,
 *     ADMIN_EMAILS=<the fake-admin email>, plus stub Supabase env vars
 *     that satisfy zod parsing but are never actually contacted.
 *   - With both bypass flags set, `proxy.ts` skips Supabase session
 *     validation and `app/admin/layout.tsx` stubs the admin user
 *     from a single `e2e-admin-session` cookie. See
 *     `lib/auth.ts:isE2EAuthBypass` for the gate.
 *   - Without the gate (production), the production code path is
 *     byte-identical.
 *
 * Admin dashboard routes are gated behind Supabase Auth + an in-app
 * email OTP (see `app/admin/layout.tsx`). The axe sweep covers all 9
 * routes: 5 public/auth-free (Phase 5) + 4 admin dashboard (Phase 6).
 */
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.PORT ? Number(process.env.PORT) : 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

// Override DATABASE_URL for the test webServer. The `.env` shipped
// with this repo uses the Prisma Accelerate URL style
// (prisma+postgres://localhost:51213/...), but @prisma/adapter-pg
// only understands postgres:// URLs. `prisma dev` boots a local
// Postgres on 51214 whose URL is what adapter-pg needs.
//
// We re-write unconditionally to the same URL the dev machine gets
// from `pnpm exec prisma dev`'s stdout (see prisma.config.ts + the
// Prisma docs). Has no effect on the production build (the
// webServer command only runs under Playwright).
const TEST_DB_URL = "postgres://postgres:postgres@127.0.0.1:51214/template1?sslmode=disable";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "tests/e2e/.playwright-html" }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // NODE_ENV=test + E2E_AUTH_BYPASS=true activate the test-seam in
    // proxy.ts + app/admin/layout.tsx (see lib/auth.ts). cross-env
    // makes this work identically on Windows + POSIX shells. Stub
    // Supabase URL/key satisfy zod parsing in lib/env.ts but are
    // never contacted because the bypass short-circuits Supabase.
    // DATABASE_URL is overridden to the postgres:// form so
    // @prisma/adapter-pg can connect to `prisma dev` on 51214.
    command: `cross-env NODE_ENV=test E2E_AUTH_BYPASS=true ADMIN_EMAILS=e2e-admin@test.local NEXT_PUBLIC_SUPABASE_URL=http://stub NEXT_PUBLIC_SUPABASE_ANON_KEY=stub-anon-key-not-real DATABASE_URL="${TEST_DB_URL}" pnpm dev -p ${PORT}`,
    // Readiness probe: hit /admin/login which is reachable without
    // any DB / Supabase connection (it's a static client form). If
    // we'd used "/" we'd 500 on a DB-less env and Playwright would
    // give up on the webserver. /admin/login returns 200 either way.
    url: `${BASE_URL}/admin/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
