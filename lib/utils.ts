import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Tailwind-aware class merger. Resolves conflicting utilities
 * (e.g. `p-2 p-4` → `p-4`) and dedupes conditional class lists.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Sleep helper — used in rate-limit retry paths and tests. */
export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Hashed identifier for logging. We never log raw email addresses —
 * we log a short non-reversible fingerprint so logs can still be
 * correlated across requests without leaking PII.
 *
 * Uses SubtleCrypto SHA-256; truncates to 12 chars for readability.
 */
export async function fingerprint(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 12);
}

/**
 * Strip dangerous characters from a free-text user message before
 * persisting or rendering. We allow Unicode letters/numbers, punctuation,
 * and emoji — but kill control chars and angle brackets.
 *
 * NOTE: This is the FIRST pass. The server should still render via
 * <Text>{message}</Text> (no dangerouslySetInnerHTML) so HTML is never
 * interpreted by the browser.
 *
 * The cap of 1000 chars is a server-side backstop — per-tx char limits
 * are enforced by the superchat submission schema based on tier.
 */
// eslint-disable-next-line no-control-regex
const ASCII_CTRL = /[\x00-\x1F\x7F]/g;
// eslint-disable-next-line no-control-regex
const C1_CTRL = /[\x80-\x9F]/g;

export function cleanMessage(input: string): string {
  return input.replace(ASCII_CTRL, "").replace(C1_CTRL, "").replace(/[<>]/g, "").slice(0, 1000);
}

/** Constant-time string comparison. Use for secrets / OTP / HMAC compare. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Mask anything that looks like an API key — for the admin settings UI. */
export function maskKey(key: string | undefined, visibleChars = 4): string {
  if (!key) return "";
  if (key.length <= visibleChars * 2) return "•".repeat(key.length);
  return `${key.slice(0, visibleChars)}${"•".repeat(8)}${key.slice(-visibleChars)}`;
}

/** Email-format pre-check (lowercase, trim). Real validation lives in Zod. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}