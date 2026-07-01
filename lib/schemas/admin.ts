/**
 * Admin login + email-OTP schemas.
 *
 * The admin flow is two-stage:
 *   1. Email + password (Supabase Auth)
 *   2. 6-digit OTP emailed via Resend (this app's challenge table)
 *
 * The password stage rejects anyone whose email isn't in ADMIN_EMAILS
 * — without leaking whether the email exists (uniform error). The
 * OTP stage then re-confirms admin status via the DB.
 */
import { z } from "zod";

import { emailSchema } from "@/lib/schemas/auth";

export const requestAdminOtpSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required"),
  turnstileToken: z.string().optional(),
});
export type RequestAdminOtpInput = z.infer<typeof requestAdminOtpSchema>;

/** A 6-digit OTP. Leading zeros allowed — we store as a string. */
export const OTP_CODE = /^\d{6}$/;

export const verifyAdminOtpSchema = z.object({
  email: emailSchema,
  code: z
    .string()
    .trim()
    .regex(OTP_CODE, "Enter the 6-digit code from your email"),
});
export type VerifyAdminOtpInput = z.infer<typeof verifyAdminOtpSchema>;

/** Mask an email so the OTP screen can show what's being verified
 *  without revealing the full address in the URL bar. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!local || !domain) return email;
  if (local.length <= 2) return `${local[0]}***@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

/* -------------------------------------------------------------------------
 * Phase 4 — moderation + settings schemas
 * ------------------------------------------------------------------------- */

/**
 * Filter applied to the All-superchats admin table. All fields are
 * optional; an empty filter returns the most recent N paid rows.
 *
 * Values come from URL searchParams and are intentionally loose:
 *   - `q` matches display name OR message body (case-insensitive)
 *   - `tier` is 1..6 (server-verified tier)
 *   - `gateway` is one of the three gateways we accept
 *   - `from` / `to` are ISO date strings (inclusive day bounds)
 *   - `page` is 1-indexed
 */
export const superchatFilterSchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  tier: z.coerce.number().int().min(1).max(6).optional(),
  gateway: z.enum(["RAZORPAY", "STRIPE", "PAYPAL"]).optional(),
  from: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "from must be YYYY-MM-DD")
    .optional(),
  to: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "to must be YYYY-MM-DD")
    .optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
});
export type SuperchatFilterInput = z.infer<typeof superchatFilterSchema>;

/** Auth-event audit-log filter. Shared between the `/admin/audit` page
 *  and its `AuditTable` component so the URL contract is single-sourced. */
export const authEventFilterSchema = z.object({
  kind: z.enum(["ROLE_CHANGE", "FIRST_LOGIN"]).optional(),
  email: z.string().trim().min(1).max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).optional().default(1),
});
export type AuthEventFilterInput = z.infer<typeof authEventFilterSchema>;

/** Hide / unhide a single superchat. Reason optional, capped at 500
 *  chars so an admin can't accidentally paste a huge wall of text. */
export const hideSuperchatSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().max(500, "Reason is too long").optional(),
});
export type HideSuperchatInput = z.infer<typeof hideSuperchatSchema>;

/** Unhide takes just the id. Kept as a separate schema so the route
 *  surface is explicit (and a future audit log can attach a separate
 *  reason shape to unhides). */
export const unhideSuperchatSchema = z.object({
  id: z.string().uuid(),
});
export type UnhideSuperchatInput = z.infer<typeof unhideSuperchatSchema>;

/** GSTIN format check — 15 chars, alphanumeric. Not full validation
 *  (the algorithm is complex) but rejects obvious junk. */
const GSTIN_REGEX = /^[0-9A-Z]{15}$/;

export const updateSettingsSchema = z
  .object({
    minDonationPaise: z.number().int().min(100).max(1_000_000),
    maxDonationPaise: z.number().int().min(100).max(10_000_000),
    inrPerUsd: z.number().min(1).max(200),
    pinHighTierSeconds: z.number().int().min(0).max(600),
    pinTopTierSeconds: z.number().int().min(0).max(600),
    platformLegalName: z.string().trim().min(1).max(200),
    platformAddress: z.string().trim().max(500).optional().nullable(),
    platformGstin: z
      .string()
      .trim()
      .max(20)
      .refine((s) => !s || GSTIN_REGEX.test(s), "GSTIN must be 15 alphanumeric characters")
      .optional()
      .nullable(),
  })
  .refine((d) => d.minDonationPaise < d.maxDonationPaise, {
    path: ["maxDonationPaise"],
    message: "Max donation must be greater than min donation",
  })
  .refine((d) => d.pinTopTierSeconds >= d.pinHighTierSeconds, {
    path: ["pinTopTierSeconds"],
    message: "Top-tier pin duration must be at least the high-tier duration",
  });
export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/** Categories mirrored from the Prisma `ProfanityCategory` enum. */
export const profanityCategoryEnum = z.enum(["SLUR", "PROFANITY", "HATE", "SPAM"]);

export const addProfanityWordSchema = z.object({
  word: z
    .string()
    .trim()
    .min(1, "Word is required")
    .max(50, "Word is too long"),
  category: profanityCategoryEnum,
});
export type AddProfanityWordInput = z.infer<typeof addProfanityWordSchema>;

export const removeProfanityWordSchema = z.object({
  id: z.string().uuid(),
});
export type RemoveProfanityWordInput = z.infer<typeof removeProfanityWordSchema>;