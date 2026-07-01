/**
 * Supabase session refresh — invoked from middleware.ts on every request
 * so tokens stay valid without page navigations.
 *
 * The pattern comes from the @supabase/ssr docs. We always return a
 * NextResponse so the caller can attach additional headers (CSP nonce,
 * rate-limit info, security headers) before sending it back.
 */
import { type NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

export async function updateSession(request: NextRequest, requestHeaders: Headers): Promise<NextResponse> {
  let response = NextResponse.next({
    request: { headers: requestHeaders },
  });

  const supabase = createServerClient(publicEnv.SUPABASE_URL, publicEnv.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value, options }) => {
          // Apply to BOTH the request (for any same-request reads) and
          // the response (so the browser stores the updated cookie).
          requestHeaders.set(name, value);
          response.cookies.set({ name, value, ...options });
        });
        // Re-create response so subsequent reads see the updated request
        // headers.
        response = NextResponse.next({ request: { headers: requestHeaders } });
      },
    },
  });

  // Trigger the refresh + validate the user. This call is required
  // even when we don't read the user — it causes the cookie writer
  // above to fire if a token refresh happened.
  await supabase.auth.getUser();

  return response;
}