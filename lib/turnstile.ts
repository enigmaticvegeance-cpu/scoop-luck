/**
 * Cloudflare Turnstile server-side verification.
 *
 * Token comes from the client widget; we POST to Cloudflare's
 * `siteverify` endpoint to confirm the user passed the CAPTCHA.
 *
 * We never log the raw token — it's a one-time bearer.
 */
import { serverEnv } from "@/lib/env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileResult {
  ok: boolean;
  /** Why it failed, if ok=false. Generic — never propagate to UI. */
  reason?: string;
  /** Cloudflare's per-request hostname; useful for log correlation. */
  hostname?: string;
}

export async function verifyTurnstile(token: string | null | undefined, remoteIp?: string): Promise<TurnstileResult> {
  const env = serverEnv();
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // If Turnstile is not configured (e.g. dev), fail closed only in prod.
    if (env.NODE_ENV === "production") {
      return { ok: false, reason: "turnstile-not-configured" };
    }
    return { ok: true };
  }
  if (!token || token.length < 8) return { ok: false, reason: "missing-token" };

  const body = new URLSearchParams({ secret, response: token });
  if (remoteIp) body.set("remoteip", remoteIp);

  try {
    const res = await fetch(VERIFY_URL, { method: "POST", body });
    if (!res.ok) return { ok: false, reason: "upstream-error" };
    const json = (await res.json()) as { success: boolean; hostname?: string; "error-codes"?: string[] };
    return { ok: !!json.success, hostname: json.hostname };
  } catch {
    return { ok: false, reason: "network-error" };
  }
}