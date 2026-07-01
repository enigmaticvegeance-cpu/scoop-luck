/**
 * Server-side Supabase client.
 *
 * Use this in Server Components, Server Actions, and Route Handlers.
 * A fresh client is constructed per request because the underlying
 * cookies API is request-scoped.
 */
import { cookies } from "next/headers";

import { createServerClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(publicEnv.SUPABASE_URL, publicEnv.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (toSet) => {
        try {
          toSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // setAll called from a Server Component — cookies can only be
          // written from Server Actions or Route Handlers. Middleware
          // refreshes them anyway, so this is safe to swallow.
        }
      },
    },
  });
}

/**
 * Service-role client — bypasses RLS. Use ONLY on the server for
 * trusted operations: webhook ingestion, admin-only mutations,
 * scheduled jobs. Never expose to the browser.
 */
export async function createServiceClient() {
  const { serverEnv } = await import("@/lib/env");
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for service-role operations");
  }
  const cookieStore = await cookies();
  return createServerClient(publicEnv.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: () => {
        // No-op — service-role requests should not write user cookies.
      },
    },
  });
}