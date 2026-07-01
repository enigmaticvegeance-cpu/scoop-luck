/**
 * Browser-side Supabase client.
 *
 * Use ONLY inside client components. The cookies adapter reads/writes
 * document.cookie so the SSR boundary stays intact on subsequent
 * navigations.
 */
"use client";

import { createBrowserClient } from "@supabase/ssr";

import { publicEnv } from "@/lib/env";

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserClient() {
  if (_client) return _client;
  _client = createBrowserClient(publicEnv.SUPABASE_URL, publicEnv.SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => {
        if (typeof document === "undefined") return [];
        return document.cookie.split("; ").filter(Boolean).map((kv) => {
          const [name, ...rest] = kv.split("=");
          return { name: name!, value: decodeURIComponent(rest.join("=")) };
        });
      },
      setAll: (toSet) => {
        if (typeof document === "undefined") return;
        toSet.forEach(({ name, value, options }) => {
          const maxAge = options?.maxAge ? `; Max-Age=${options.maxAge}` : "";
          const path = options?.path ? `; Path=${options.path}` : "; Path=/";
          const sameSite = options?.sameSite ? `; SameSite=${options.sameSite}` : "; SameSite=Lax";
          const secure = options?.secure ? "; Secure" : "";
          document.cookie = `${name}=${encodeURIComponent(value)}${path}${maxAge}${sameSite}${secure}`;
        });
      },
    },
  });
  return _client;
}