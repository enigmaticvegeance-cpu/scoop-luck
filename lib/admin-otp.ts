/**
 * Admin OTP challenge helpers — extracted from the server action so
 * they can be unit-tested in isolation (no DB, no fetch, no side
 * effects). The actions in `app/(public)/admin-actions.ts` call
 * these functions; nothing else should.
 *
 * Rules:
 *   - `mintOtp` produces a 6-digit zero-padded string.
 *   - `hashOtp` is SHA-256 over the code; constant-time comparison
 *     avoids timing attacks that recover the code digit-by-digit.
 *   - `maskEmail` shows the first 2 characters of the local part
 *     followed by `***@domain`, so the OTP form can render a hint
 *     without exposing the full address (which would otherwise leak
 *     via browser history, referrers, and screenshots).
 */
import crypto from "node:crypto";

export const OTP_CODE_LENGTH = 6;
export const OTP_REGEX = /^\d{6}$/;

/** Mint a fresh 6-digit OTP. Always 6 characters, leading zeros kept. */
export function mintOtp(): string {
  const n = crypto.randomInt(0, 10 ** OTP_CODE_LENGTH);
  return n.toString().padStart(OTP_CODE_LENGTH, "0");
}

/** SHA-256 hash of the OTP code. Always returns 64 hex chars. */
export function hashOtp(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Constant-time string comparison. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Format a user-inputted code the same way the actions do before
 * hashing. Whitespace must be stripped so pasted `"123  456"` becomes
 * `"123456"` — same value as a typed `123456`.
 */
export function normalizeCode(input: string): string {
  return input.trim();
}

/** Mask an email for the OTP screen. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length === 1) return `${local}***@${domain}`;
  // 2+ chars: show the first 2 so the user can still recognize the
  // address. Anything shorter would be the entire local part anyway.
  return `${local.slice(0, 2)}***@${domain}`;
}
