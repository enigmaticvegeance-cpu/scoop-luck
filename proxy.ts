/**
 * Next.js proxy (formerly middleware) — runs on EVERY request before any
 * route handler. Renamed from `middleware.ts` to `proxy.ts` per Next 16.
 *
 * Responsibilities, in order:
 *   1. Mint a fresh CSP nonce and inject it into a request header so
 *      server components and <Script> tags can read it.
 *   2. Set baseline security headers on the response (CSP, HSTS, …).
 *   3. Refresh the Supabase session cookie (must run early so RSC sees
 *      a valid user).
 *   4. Apply IP-level rate limits on the API surface.
 *   5. Server-side guard the /admin/(dashboard) routes.
 *
 * Anything requiring DB access or a Prisma client lives in the page
 * layouts themselves — proxy runs on Edge and must stay light.
 */
import { type NextRequest, NextResponse } from "next/server";

import { getClientIp, limitByIp, rateLimitHeaders } from "@/lib/rate-limit";
import { updateSession } from "@/lib/supabase/middleware";
import { getAdminEmails } from "@/lib/env";
import { isE2EAuthBypass, E2E_ADMIN_COOKIE } from "@/lib/auth";

const NONCE_HEADER = "x-nonce";

function buildCsp(nonce: string, isDev: boolean): string {
  // The directives here are the prompt's baseline. We add the nonce
  // for our own scripts. Third-party scripts (Razorpay, Stripe, PayPal,
  // Cloudflare Insights) are loaded via <Script strategy="afterInteractive"
  // src="…"> — those are whitelisted by host, not nonce.
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Scripts: nonce covers our app's own JS, plus the explicit hosts
    // for payment SDKs and Cloudflare Insights (loaded via Next <Script>).
    // Dev adds 'unsafe-eval' so Next's HMR works.
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      isDev ? "'unsafe-eval'" : "",
      "https://checkout.razorpay.com",
      "https://js.stripe.com",
      "https://www.paypal.com",
      "https://static.cloudflareinsights.com",
      "https://challenges.cloudflare.com",
    ].filter(Boolean),
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "img-src": ["'self'", "data:", "blob:", "https://*.supabase.co", "https://*.supabase.in"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "connect-src": [
      "'self'",
      "https://api.razorpay.com",
      "https://api.stripe.com",
      "https://*.paypal.com",
      "https://*.supabase.co",
      "https://*.supabase.in",
      "https://*.sentry.io",
      "https://*.upstash.io",
      "https://challenges.cloudflare.com",
    ],
    "frame-src": [
      "https://checkout.razorpay.com",
      "https://js.stripe.com",
      "https://hooks.stripe.com",
      "https://www.paypal.com",
      "https://challenges.cloudflare.com",
    ],
    "frame-ancestors": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'", "https://checkout.razorpay.com", "https://www.paypal.com"],
    "object-src": ["'none'"],
    "manifest-src": ["'self'"],
  };
  if (!isDev) directives["upgrade-insecure-requests"] = [];
  return Object.entries(directives)
    .map(([k, v]) => `${k} ${v.join(" ")}`)
    .join("; ");
}

function applySecurityHeaders(res: NextResponse, nonce: string, isDev: boolean): void {
  const csp = buildCsp(nonce, isDev);
  res.headers.set("Content-Security-Policy", csp);
  res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  );
  res.headers.set("Cross-Origin-Opener-Policy", "same-origin");
  res.headers.set("Cross-Origin-Resource-Policy", "same-site");
}

// Map a pathname to a rate-limit bucket. Anything not matched falls under
// the "public" bucket (100/min/IP).
function bucketFor(pathname: string): "payments:create" | "auth:login" | "auth:otp" | "superchats:create" | "admin" | "public" | null {
  if (pathname.startsWith("/api/payments/")) return "payments:create";
  if (pathname === "/api/auth/login" || pathname === "/api/auth/register") return "auth:login";
  if (pathname === "/api/auth/otp") return "auth:otp";
  if (pathname === "/api/superchats" && !pathname.startsWith("/api/superchats/admin")) {
    return "superchats:create";
  }
  if (pathname.startsWith("/api/admin/")) return "admin";
  if (pathname.startsWith("/api/")) return "public";
  // Webhooks are POST-only and must bypass rate-limit (they originate
  // from the gateway, not the user) — handled by separate per-gateway
  // HMAC verification.
  return null;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { nextUrl, headers } = request;
  const isDev = process.env.NODE_ENV === "development";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  // Forward the nonce to downstream handlers via a request header.
  // Downstream RSC reads it with `headers().get('x-nonce')`.
  // Also forward the pathname so layouts (e.g. app/admin/layout.tsx)
  // can branch on the route without re-parsing URL fragments.
  const reqHeaders = new Headers(headers);
  reqHeaders.set(NONCE_HEADER, nonce);
  reqHeaders.set("x-pathname", nextUrl.pathname);

  // Refresh Supabase auth cookies (must happen before any RSC reads the user).
  // In E2E bypass mode (NODE_ENV=test + E2E_AUTH_BYPASS=true) we skip
  // updateSession because the admin layout will stub the user from the
  // e2e-admin-session cookie and Supabase validation would otherwise
  // crash on empty env. Dead-code-eliminates in production.
  const supabaseResponse = isE2EAuthBypass()
    ? NextResponse.next({ request: { headers: reqHeaders } })
    : await updateSession(request, reqHeaders);

  // Apply static security headers on the response we're about to return.
  applySecurityHeaders(supabaseResponse, nonce, isDev);

  // Rate-limit API routes. Webhooks are excluded so payment providers
  // can deliver retries without us 429-ing them.
  const bucket = bucketFor(nextUrl.pathname);
  if (bucket && request.method !== "GET" && request.method !== "HEAD") {
    const ip = getClientIp(reqHeaders);
    const verdict = await limitByIp(bucket, ip);
    if (!verdict.success) {
      const headers = rateLimitHeaders(verdict);
      return new NextResponse(JSON.stringify({ error: "rate_limited" }), {
        status: 429,
        headers: { ...headers, "Content-Type": "application/json" },
      });
    }
    // Attach rate-limit info on success too — useful for clients to back off.
    Object.entries(rateLimitHeaders(verdict)).forEach(([k, v]) => supabaseResponse.headers.set(k, v));
  }

  // Admin route server-side guard. We can't hit the DB from Edge (Prisma
  // doesn't run on Edge yet), so the proxy enforces a *coarse* gate;
  // the layout (`app/admin/layout.tsx`) does the fine-grained check
  // against the DB. This layer:
  //   1. Bounces unauthenticated users to /admin/login
  //   2. For authenticated users on the *dashboard*, demands the
  //      `adminOtpVerified` cookie; if absent, sends them to
  //      /admin/login?error=otp&next=…
  if (nextUrl.pathname.startsWith("/admin/")) {
    const rawCookie = reqHeaders.get("cookie") ?? "";
    const cookieLower = rawCookie.toLowerCase();

    // E2E bypass: a single test cookie satisfies both the Supabase
    // session check AND the adminOtpVerified check. Only active when
    // isE2EAuthBypass() returns true (NODE_ENV=test AND E2E_AUTH_BYPASS=true).
    if (isE2EAuthBypass() && cookieLower.includes(E2E_ADMIN_COOKIE)) {
      return supabaseResponse;
    }

    const hasSession = cookieLower.includes("auth-token");
    const hasOtpVerified = cookieLower.includes("adminotpverified");
    const onLogin = nextUrl.pathname.startsWith("/admin/login");
    const onOtp = nextUrl.pathname.startsWith("/admin/otp");
    const onDashboard =
      nextUrl.pathname === "/admin" ||
      nextUrl.pathname.startsWith("/admin/");

    if (!hasSession && !onLogin && !onOtp) {
      const url = nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("next", nextUrl.pathname);
      return NextResponse.redirect(url);
    }
    if (hasSession && onDashboard && !hasOtpVerified && !onLogin && !onOtp) {
      const url = nextUrl.clone();
      url.pathname = "/admin/login";
      url.searchParams.set("error", "otp");
      url.searchParams.set("next", nextUrl.pathname);
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}

// Skip proxy on static assets, image optimizer, and webhook endpoints
// (webhooks must be hit raw so signature headers aren't stripped).
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|apple-touch-icon.png|api/webhooks/).*)",
  ],
};