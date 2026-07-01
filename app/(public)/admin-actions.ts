"use server";

/**
 * Admin login + email-OTP server actions.
 *
 * Flow:
 *   1. `requestAdminOtp({ email, password })` — verifies Supabase Auth
 *      credentials AND that the email is in ADMIN_EMAILS. On success,
 *      mints a 6-digit OTP, stores its SHA-256 hash in
 *      `AdminOtpChallenge` (10-minute TTL, 5-attempt lockout for
 *      15 minutes), and emails the code via Resend. Returns a masked
 *      email so the client can land on `/admin/otp?email=<masked>`.
 *
 *   2. `verifyAdminOtp({ email, code })` — fetches the latest non-
 *      consumed challenge for the email, hashes the supplied code,
 *      constant-time-compares. On success: mark consumed, set the
 *      `adminOtpVerified` cookie (HttpOnly, Secure, SameSite=Strict,
 *      8h expiry), sign the user into Supabase Auth (via the
 *      pre-existing Supabase session that `requestAdminOtp` opened).
 *
 * Why two stages: the password stage establishes *who* the user is
 * with their long-term secret; the OTP stage is a short-lived
 * single-use confirmation that the same browser controls the inbox.
 * The OTP layer means a stolen password alone is not enough to reach
 * `/admin`, and a stolen cookie alone is not enough either.
 *
 * Anti-enumeration: errors from `requestAdminOtp` are uniform —
 * "Invalid credentials." — regardless of whether the email or the
 * password was wrong, AND regardless of whether the email is in
 * ADMIN_EMAILS. The `ADMIN_EMAILS` check happens after sign-in.
 */

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { getAdminEmails } from "@/lib/env";
import { getClientIp, limitByIp, limitByKey } from "@/lib/rate-limit";
import { fingerprint, normalizeEmail } from "@/lib/utils";
import { verifyTurnstile } from "@/lib/turnstile";
import { sendOtpEmail } from "@/lib/email";
import { createClient } from "@/lib/supabase/server";
import { fail, ok, type ActionResult } from "@/lib/errors";
import {
  requestAdminOtpSchema,
  verifyAdminOtpSchema,
  hideSuperchatSchema,
  unhideSuperchatSchema,
  updateSettingsSchema,
  addProfanityWordSchema,
  removeProfanityWordSchema,
} from "@/lib/schemas/admin";
import { mintOtp, hashOtp, constantTimeEqual, maskEmail } from "@/lib/admin-otp";
import { requireAdmin } from "@/lib/auth";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_LOCK_MS = 15 * 60 * 1000; // 15 minutes
const OTP_MAX_ATTEMPTS = 5;
const ADMIN_COOKIE = "adminOtpVerified";
const ADMIN_COOKIE_TTL_S = 8 * 60 * 60; // 8 hours
const MAX_OPEN_CHALLENGES = 1; // only one outstanding OTP per email

/**
 * Step 1: password → issue OTP.
 */
export async function requestAdminOtp(rawInput: unknown): Promise<ActionResult<{ maskedEmail: string }>> {
  const parsed = requestAdminOtpSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;
  const email = normalizeEmail(input.email);
  const actorFp = await fingerprint(email);
  const ip = getClientIp(await headers());

  // Per-IP and per-email rate limiting on auth flow.
  const ipLimit = await limitByIp("auth:otp", ip);
  if (!ipLimit.success) return fail("Too many attempts. Please wait a few minutes.");
  const emailLimit = await limitByKey("auth:otp", `admin:email:${email}`);
  if (!emailLimit.success) return fail("Too many attempts for this email. Please wait a few minutes.");

  // Captcha (skipped in dev).
  const captcha = await verifyTurnstile(input.turnstileToken, ip);
  if (!captcha.ok) return fail("Captcha verification failed. Please try again.");

  // 1) Sign in through Supabase Auth. A failure here is reported with
  //    a uniform error to avoid leaking which side was wrong.
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: input.password });
  if (error || !data.user) {
    log.warn("admin.password_failed", { actorId: actorFp, route: "admin.requestOtp" });
    return fail("Invalid credentials.");
  }

  // 2) Verify the email is in ADMIN_EMAILS. We do this AFTER sign-in so
  //    a non-admin sign-in still hits the Supabase Auth rate limiter,
  //    and the response time matches the admin path (no user enumeration).
  if (!getAdminEmails().has(email)) {
    log.warn("admin.not_in_admin_emails", { actorId: actorFp, route: "admin.requestOtp" });
    return fail("Invalid credentials.");
  }

  // 3) Mint a fresh challenge. Reuse only if the existing challenge is
  //    unexpired and the user has fewer than MAX_OPEN_CHALLENGES open;
  //    otherwise mint a new one (rotating the OTP so a stolen old code
  //    is invalidated).
  const now = new Date();
  const existing = await prisma.adminOtpChallenge.findFirst({
    where: { adminEmail: email, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  let challengeId: string;
  let code: string;
  if (existing && !existing.lockedUntil) {
    challengeId = existing.id;
    code = mintOtp();
    const codeHash = hashOtp(code);
    await prisma.adminOtpChallenge.update({
      where: { id: challengeId },
      data: {
        otpHash: codeHash,
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attempts: 0,
        lockedUntil: null,
        ip,
        userAgent: (await headers()).get("user-agent") ?? null,
      },
    });
  } else {
    code = mintOtp();
    challengeId = crypto.randomUUID();
    await prisma.adminOtpChallenge.create({
      data: {
        id: challengeId,
        adminEmail: email,
        otpHash: hashOtp(code),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
        attempts: 0,
        ip,
        userAgent: (await headers()).get("user-agent") ?? null,
      },
    });
  }

  // 4) Email the code (best-effort). Failures here should NOT block
  //    the login — the admin can retry from the start, and the rate
  //    limit takes care of brute force attempts.
  await sendOtpEmail({ to: email, code, issuedAt: now, ip });

  log.info("admin.otp_issued", { actorId: actorFp, route: "admin.requestOtp", challengeId });

  return ok({ maskedEmail: maskEmail(email) });
}

/**
 * Step 2: OTP code → set admin-verified cookie.
 */
export async function verifyAdminOtp(rawInput: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = verifyAdminOtpSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;
  const email = normalizeEmail(input.email);
  const actorFp = await fingerprint(email);

  const now = new Date();

  // Per-IP rate-limit on the OTP verification endpoint (separate
  // bucket from the password one). This caps how many OTP guesses
  // any single IP can make.
  const ip = getClientIp(await headers());
  const ipLimit = await limitByIp("auth:otp", ip, "verify");
  if (!ipLimit.success) return fail("Too many attempts. Please wait a few minutes.");

  // Re-confirm admin status (defense-in-depth — the layer at the
  // admin layout will also check, but we want to refuse here).
  if (!getAdminEmails().has(email)) {
    log.warn("admin.otp_not_admin", { actorId: actorFp, route: "admin.verifyOtp" });
    return fail("Invalid credentials.");
  }

  // Find the latest unconsumed challenge.
  const challenge = await prisma.adminOtpChallenge.findFirst({
    where: { adminEmail: email, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!challenge) {
    return fail("Code expired or never issued. Please restart the login.");
  }
  if (challenge.expiresAt.getTime() <= now.getTime()) {
    return fail("Code expired. Please restart the login.");
  }
  if (challenge.lockedUntil && challenge.lockedUntil.getTime() > now.getTime()) {
    const remainingMin = Math.ceil((challenge.lockedUntil.getTime() - now.getTime()) / 60_000);
    return fail(`Too many wrong codes. Try again in ${remainingMin} minute${remainingMin === 1 ? "" : "s"}.`);
  }

  // Constant-time compare on hashes.
  const supplied = hashOtp(input.code);
  if (!constantTimeEqual(supplied, challenge.otpHash)) {
    const nextAttempts = challenge.attempts + 1;
    const locked = nextAttempts >= OTP_MAX_ATTEMPTS;
    await prisma.adminOtpChallenge.update({
      where: { id: challenge.id },
      data: {
        attempts: nextAttempts,
        lockedUntil: locked ? new Date(now.getTime() + OTP_LOCK_MS) : null,
      },
    });
    if (locked) {
      log.warn("admin.otp_locked", { actorId: actorFp, route: "admin.verifyOtp" });
      return fail(`Too many wrong codes. Locked for 15 minutes.`);
    }
    log.warn("admin.otp_wrong_code", { actorId: actorFp, route: "admin.verifyOtp" });
    return fail(`Wrong code. ${OTP_MAX_ATTEMPTS - nextAttempts} attempt${OTP_MAX_ATTEMPTS - nextAttempts === 1 ? "" : "s"} left.`);
  }

  // Success.
  await prisma.adminOtpChallenge.update({
    where: { id: challenge.id },
    data: { consumedAt: now },
  });

  // Set the admin-verified cookie. HttpOnly so JS on the page can't
  // read it; Secure in prod; SameSite=Strict so cross-site forged
  // requests don't carry it. 8-hour expiry matches the spec.
  const cookieStore = await cookies();
  cookieStore.set(ADMIN_COOKIE, challenge.id, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_COOKIE_TTL_S,
  });

  log.info("admin.otp_ok", { actorId: actorFp, route: "admin.verifyOtp" });

  return ok({ redirectTo: "/admin" });
}

/**
 * AdminLogout — admin-only sign-out. Clears the cookie and signs out
 * of Supabase Auth. Always succeeds.
 */
export async function adminLogoutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  const cookieStore = await cookies();
  cookieStore.delete(ADMIN_COOKIE);
  redirect("/admin/login");
}

/* -------------------------------------------------------------------------
 * Phase 4 — moderation + settings actions
 *
 * All actions below:
 *   1. Verify the caller is an admin (defense-in-depth on top of the
 *      /admin/(dashboard) layout gate and the proxy's cookie check).
 *   2. Apply the per-IP `admin` rate-limit bucket (60/min).
 *   3. Validate input via zod.
 *   4. Mutate the DB.
 *   5. Log the action with the admin's hashed email + the target id
 *      (never the message text or any PII).
 *
 * Errors to the client are uniform: "Admin access required." for any
 * gate failure, generic for storage / DB errors. The full reason is
 * always sent to Sentry via `log.error`.
 * ------------------------------------------------------------------------- */

const ADMIN_ACCESS_DENIED = "Admin access required.";

/**
 * Soft-delete a superchat. Sets `hidden = true`, records the admin
 * email + a reason + the timestamp. The row is NEVER hard-deleted —
 * financial records must persist.
 */
export async function hideSuperchat(rawInput: unknown): Promise<ActionResult<{ id: string; hidden: boolean }>> {
  const parsed = hideSuperchatSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;

  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    log.warn("admin.hide_unauthorized", { route: "admin.hideSuperchat", err: String(err) });
    return fail(ADMIN_ACCESS_DENIED);
  }

  const ip = getClientIp(await headers());
  const ipLimit = await limitByIp("admin", ip, "hide");
  if (!ipLimit.success) return fail("Too many admin actions. Please wait a moment.");

  const actorFp = await fingerprint(ctx.email);

  try {
    const updated = await prisma.superchat.update({
      where: { id: input.id },
      data: {
        hidden: true,
        hiddenByAdminEmail: ctx.email,
        hiddenAt: new Date(),
        hideReason: input.reason ?? null,
      },
      select: { id: true, hidden: true },
    });
    log.info("admin.superchat_hidden", {
      actorId: actorFp,
      route: "admin.hideSuperchat",
      superchatId: updated.id,
    });
    return ok({ id: updated.id, hidden: updated.hidden });
  } catch (err) {
    log.error("admin.hide_failed", err, { actorId: actorFp, route: "admin.hideSuperchat", superchatId: input.id });
    return fail("Could not hide superchat. Please try again.");
  }
}

/** Reverse a hide. The row's `hidden*` columns are cleared. */
export async function unhideSuperchat(rawInput: unknown): Promise<ActionResult<{ id: string; hidden: boolean }>> {
  const parsed = unhideSuperchatSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;

  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    log.warn("admin.unhide_unauthorized", { route: "admin.unhideSuperchat", err: String(err) });
    return fail(ADMIN_ACCESS_DENIED);
  }

  const ip = getClientIp(await headers());
  const ipLimit = await limitByIp("admin", ip, "unhide");
  if (!ipLimit.success) return fail("Too many admin actions. Please wait a moment.");

  const actorFp = await fingerprint(ctx.email);

  try {
    const updated = await prisma.superchat.update({
      where: { id: input.id },
      data: {
        hidden: false,
        hiddenByAdminEmail: null,
        hiddenAt: null,
        hideReason: null,
      },
      select: { id: true, hidden: true },
    });
    log.info("admin.superchat_unhidden", {
      actorId: actorFp,
      route: "admin.unhideSuperchat",
      superchatId: updated.id,
    });
    return ok({ id: updated.id, hidden: updated.hidden });
  } catch (err) {
    log.error("admin.unhide_failed", err, { actorId: actorFp, route: "admin.unhideSuperchat", superchatId: input.id });
    return fail("Could not restore superchat. Please try again.");
  }
}

/**
 * Update the single-row `Settings` table. The shape is fully
 * validated by zod (including cross-field checks).
 */
export async function updateSettings(rawInput: unknown): Promise<ActionResult<{ id: number }>> {
  const parsed = updateSettingsSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;

  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    log.warn("admin.update_settings_unauthorized", { route: "admin.updateSettings", err: String(err) });
    return fail(ADMIN_ACCESS_DENIED);
  }

  const ip = getClientIp(await headers());
  const ipLimit = await limitByIp("admin", ip, "settings");
  if (!ipLimit.success) return fail("Too many admin actions. Please wait a moment.");

  const actorFp = await fingerprint(ctx.email);

  try {
    // Settings is a single-row table keyed on `id = 1`. Upsert so a
    // fresh deploy with no row yet still works.
    const saved = await prisma.settings.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        minDonationPaise: input.minDonationPaise,
        maxDonationPaise: input.maxDonationPaise,
        inrPerUsd: input.inrPerUsd,
        pinHighTierSeconds: input.pinHighTierSeconds,
        pinTopTierSeconds: input.pinTopTierSeconds,
        platformLegalName: input.platformLegalName,
        platformAddress: input.platformAddress ?? null,
        platformGstin: input.platformGstin ?? null,
      },
      update: {
        minDonationPaise: input.minDonationPaise,
        maxDonationPaise: input.maxDonationPaise,
        inrPerUsd: input.inrPerUsd,
        pinHighTierSeconds: input.pinHighTierSeconds,
        pinTopTierSeconds: input.pinTopTierSeconds,
        platformLegalName: input.platformLegalName,
        platformAddress: input.platformAddress ?? null,
        platformGstin: input.platformGstin ?? null,
      },
    });
    log.info("admin.settings_updated", { actorId: actorFp, route: "admin.updateSettings" });
    return ok({ id: saved.id });
  } catch (err) {
    log.error("admin.update_settings_failed", err, { actorId: actorFp, route: "admin.updateSettings" });
    return fail("Could not save settings. Please try again.");
  }
}

/**
 * Add a word to the profanity list. Rejects duplicates (case-
 * insensitive) so the table never carries redundant entries.
 */
export async function addProfanityWord(rawInput: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = addProfanityWordSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;

  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    log.warn("admin.add_profanity_unauthorized", { route: "admin.addProfanityWord", err: String(err) });
    return fail(ADMIN_ACCESS_DENIED);
  }

  const ip = getClientIp(await headers());
  const ipLimit = await limitByIp("admin", ip, "profanity");
  if (!ipLimit.success) return fail("Too many admin actions. Please wait a moment.");

  const actorFp = await fingerprint(ctx.email);
  const wordLower = input.word.toLowerCase();

  try {
    // Check for an existing case-insensitive duplicate. We do this
    // explicitly because Postgres's default `citext` collation is not
    // enabled on this column.
    const existing = await prisma.profanityWord.findFirst({
      where: { word: { equals: wordLower, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing) return fail("That word is already in the list.", "word");

    const created = await prisma.profanityWord.create({
      data: {
        word: wordLower,
        category: input.category,
        addedBy: ctx.email,
      },
      select: { id: true },
    });
    log.info("admin.profanity_added", {
      actorId: actorFp,
      route: "admin.addProfanityWord",
      category: input.category,
    });
    return ok({ id: created.id });
  } catch (err) {
    log.error("admin.add_profanity_failed", err, { actorId: actorFp, route: "admin.addProfanityWord" });
    return fail("Could not add word. Please try again.");
  }
}

/** Remove a word from the profanity list by id. */
export async function removeProfanityWord(rawInput: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = removeProfanityWordSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;

  let ctx;
  try {
    ctx = await requireAdmin();
  } catch (err) {
    log.warn("admin.remove_profanity_unauthorized", { route: "admin.removeProfanityWord", err: String(err) });
    return fail(ADMIN_ACCESS_DENIED);
  }

  const ip = getClientIp(await headers());
  const ipLimit = await limitByIp("admin", ip, "profanity");
  if (!ipLimit.success) return fail("Too many admin actions. Please wait a moment.");

  const actorFp = await fingerprint(ctx.email);

  try {
    await prisma.profanityWord.delete({ where: { id: input.id } });
    log.info("admin.profanity_removed", { actorId: actorFp, route: "admin.removeProfanityWord", wordId: input.id });
    return ok({ id: input.id });
  } catch (err) {
    log.error("admin.remove_profanity_failed", err, { actorId: actorFp, route: "admin.removeProfanityWord" });
    return fail("Could not remove word. Please try again.");
  }
}
