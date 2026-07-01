/**
 * Admin layout — server-side guard.
 *
 * The proxy (proxy.ts) ensures the request has a Supabase auth
 * cookie. THIS layer does the heavier check:
 *   1. The user must be authenticated.
 *   2. The user's email must be in ADMIN_EMAILS AND their DB row's
 *      role must be ADMIN.
 *   3. The browser must present the `adminOtpVerified` cookie —
 *      set by verifyAdminOtp once a 6-digit code was confirmed.
 *
 * Any failure redirects to the appropriate sign-in screen. The
 * logic deliberately never reveals WHY (no enumeration).
 *
 * The /admin/login and /admin/otp routes are exempt — they ARE the
 * sign-in screens, and gating them would create a redirect loop.
 * The proxy.ts matcher already exempts them in the auth-token
 * check (proxy.ts:171-172).
 *
 * E2E bypass (E2E_AUTH_BYPASS=true, set by Playwright's webServer):
 *   - `lib/auth.ts:getCurrentUser()` returns a fake admin without
 *     touching Supabase or Prisma (so per-page defense-in-depth
 *     checks also pass).
 *   - The `adminOtpVerified` cookie check is skipped when the test
 *     cookie is present.
 * Production code is byte-identical when the bypass is inactive.
 */
import { redirect } from "next/navigation";
import { cookies, headers } from "next/headers";

import { getAdminEmails } from "@/lib/env";
import { getCurrentUser, isE2EAuthBypass, E2E_ADMIN_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Pages in /admin that don't require an authenticated session.
// Matches the carve-out in proxy.ts (lines 156-157).
function isSignInPath(pathname: string): boolean {
  return pathname.startsWith("/admin/login") || pathname.startsWith("/admin/otp");
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();
  const hdrs = await headers();
  const pathname = hdrs.get("x-pathname") ?? "";
  if (isSignInPath(pathname)) {
    // Login + OTP screens render without a session.
    return <div className="min-h-[calc(100vh-4rem)]">{children}</div>;
  }

  const bypassActive = isE2EAuthBypass();
  const e2eSession = bypassActive ? cookieStore.get(E2E_ADMIN_COOKIE) : null;

  // Bypass path requires the test cookie; without it we fall through
  // to the production auth check, which will redirect to /admin/login.
  // This keeps the public sign-in pages reachable without auth in
  // test mode (e.g., for axe scans of /admin/login itself).
  const ctx = bypassActive && !e2eSession?.value ? null : await getCurrentUser();
  const email = ctx?.email.toLowerCase() ?? "";

  // Not authenticated → bounce to admin login. The proxy already
  // would have bounced unauthenticated requests, but a stale session
  // (deleted User row) would slip past — handle it here too.
  if (!ctx) {
    redirect("/admin/login");
  }

  // Two-factor: must be ADMIN in DB AND in ADMIN_EMAILS env. We
  // check both so a stale role upgrade can't slip through, and so
  // an admin removed from env loses access without waiting for a
  // role update.
  if (ctx.user.role !== "ADMIN" || !getAdminEmails().has(email)) {
    redirect("/admin/login?error=not-admin");
  }

  // Two-step gate: must have a valid `adminOtpVerified` cookie set
  // by verifyAdminOtp in the last 8 hours. E2E bypass: the same
  // test cookie that the proxy honored also satisfies this check.
  if (!e2eSession?.value) {
    const otpVerified = cookieStore.get("adminOtpVerified");
    if (!otpVerified || !otpVerified.value) {
      const next = encodeURIComponent("/admin");
      redirect(`/admin/login?error=otp&next=${next}`);
    }
  }

  return <div className="min-h-[calc(100vh-4rem)]">{children}</div>;
}
