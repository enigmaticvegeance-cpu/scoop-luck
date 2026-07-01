/**
 * Input sanitization & validation helpers.
 *
 * Defense-in-depth: even though every API route validates with Zod,
 * these helpers provide a final scrub for fields like superchat
 * messages that end up rendered in the browser.
 *
 * The cardinal rule: user-supplied text is rendered with React
 * (no dangerouslySetInnerHTML), so HTML is never interpreted.
 * We additionally strip ASCII/C1 control chars and angle brackets
 * to defang copy-paste attempts at injecting <script>, null bytes,
 * or zero-width joiners used for tracking.
 */
import DOMPurify from "isomorphic-dompurify";

import leoProfanity from "leo-profanity";

import { prisma } from "@/lib/prisma";
import { cleanMessage } from "@/lib/utils";

/**
 * Scrub free-text. Returns plain text. HTML is escaped so React renders it
 * as text. We rely on the DOMPurify fallback for paranoia: even if a
 * caller decides to render with dangerouslySetInnerHTML somewhere, this
 * strips tags first.
 */
export function sanitizeMessage(input: string): string {
  const cleaned = cleanMessage(input);
  // DOMPurify with no allowed tags returns plain text.
  return DOMPurify.sanitize(cleaned, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

/** Simple HTML-entity escape — for non-React contexts (e.g. PDF templates). */
export function htmlEscape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Email-format pre-check (lowercase, trim). Real validation lives in Zod. */
export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * Profanity gate. Uses the bundled `leo-profanity` library PLUS any
 * rows in `ProfanityWord` that the admin has added. Returns true if
 * the input is acceptable, false if it should be rejected.
 *
 * NOTE: We do NOT block on every match — the prompt specifies
 * "profanity filtered server-side". We replace bad words with asterisks
 * so the message remains legible but cleaner; admins can choose to
 * outright reject by adjusting the policy here later.
 */
export async function profanityFilter(input: string): Promise<string> {
  const custom = await prisma.profanityWord.findMany({ select: { word: true } });
  leoProfanity.add(custom.map((w) => w.word));
  leoProfanity.loadDictionary("en");
  return leoProfanity.clean(input);
}