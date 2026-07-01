/**
 * E2E test auth helper.
 *
 * The admin dashboard is gated behind Supabase Auth + `ADMIN_EMAILS`
 * + `adminOtpVerified` (real flow). For E2E axe scans we don't want
 * the cost of provisioning a real Supabase local stack + Resend
 * mailbox capture, so the production code path has a small
 * NODE_ENV-guarded bypass (`lib/auth.ts:isE2EAuthBypass`).
 *
 * In bypass mode the webserver accepts a single `e2e-admin-session`
 * cookie in place of the full auth chain. This helper sets that
 * cookie on the Playwright context. Production behavior is
 * unchanged because the bypass requires both NODE_ENV=test AND
 * E2E_AUTH_BYPASS=true.
 */
import type { Page } from "@playwright/test";

const E2E_COOKIE_NAME = "e2e-admin-session";
// Opaque value — anything non-empty satisfies the proxy + layout
// substring check. Length kept > 16 so it can't be confused with
// a real Supabase access token by accident.
const E2E_COOKIE_VALUE = "e2e-test-session-token-do-not-use-in-prod";

export async function signInAsAdmin(page: Page, baseUrl: string): Promise<void> {
  // Strip any query string from baseUrl because Playwright's
  // browserContext.addCookies rejects url values that contain "?".
  const cookieOrigin = baseUrl.split("?", 1)[0] ?? baseUrl;
  await page.context().addCookies([
    {
      name: E2E_COOKIE_NAME,
      value: E2E_COOKIE_VALUE,
      domain: "127.0.0.1",
      path: "/",
      sameSite: "Lax",
      httpOnly: false,
      secure: false,
    },
  ]);
  // Sanity: Playwright's API is forgiving about which of {url,
  // domain+path} is provided. We pre-set domain+path here and rely
  // on the origin of the next navigation matching it. If a future
  // Playwright upgrade tightens this, swap to `url: cookieOrigin`.
  void cookieOrigin;
}

/**
 * Admin dashboard routes covered by the axe sweep after `signInAsAdmin`.
 * Kept in sync with `app/admin/(dashboard)/`.
 */
export const ADMIN_ROUTES = [
  { path: "/admin", name: "admin live feed", readySelector: "section[aria-label='Admin live feed']" },
  { path: "/admin/superchats", name: "admin superchats", readySelector: "table" },
  { path: "/admin/analytics", name: "admin analytics", readySelector: "[role='img']" },
  { path: "/admin/settings", name: "admin settings", readySelector: "form" },
] as const;
