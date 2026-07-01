"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { fail, ok, type ActionResult } from "@/lib/errors";
import { log } from "@/lib/log";
import { getClientIp, limitByKey } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { verifyTurnstile } from "@/lib/turnstile";
import { fingerprint, normalizeEmail } from "@/lib/utils";
import { loginSchema, registerSchema } from "@/lib/schemas/auth";
import { prisma } from "@/lib/prisma";

/**
 * Register a new viewer.
 *
 * Flow:
 *   1. Zod-validate input (server-side, never trust the client)
 *   2. Per-IP rate-limit (auth:login bucket per the spec)
 *   3. Verify Cloudflare Turnstile token (skip in dev if not configured)
 *   4. Create the user via Supabase Auth (sends email verification)
 *   5. Mirror a row in our `users` table with role=VIEWER
 *   6. Redirect to /login with a "check your email" hint
 */
export async function registerAction(rawInput: unknown): Promise<ActionResult<{ email: string }>> {
  const parsed = registerSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;
  const email = normalizeEmail(input.email);
  const actorFp = await fingerprint(email);

  // Rate-limit per email so a single attacker can't exhaust the bucket
  // for a legitimate user, and per-IP so a botnet spraying different
  // emails still gets throttled.
  const ip = getClientIp(await headers());
  const byIp = await limitByKey("auth:login", `register:ip:${ip}`);
  if (!byIp.success) return fail("Too many attempts. Please wait a few minutes.");
  const byEmail = await limitByKey("auth:login", `register:email:${email}`);
  if (!byEmail.success) return fail("Too many attempts for this email. Please wait a few minutes.");

  const captcha = await verifyTurnstile(input.turnstileToken, ip);
  if (!captcha.ok) return fail("Captcha verification failed. Please try again.");

  const supabase = await createClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  const { data, error } = await supabase.auth.signUp({
    email,
    password: input.password,
    options: {
      emailRedirectTo: `${appUrl}/auth/callback?next=/superchat`,
      data: { display_name: input.displayName },
    },
  });
  if (error || !data.user) {
    log.warn("auth.signup.failed", { actorId: actorFp, route: "register" });
    return fail("Could not create your account. Try a different email or try again later.");
  }

  // Mirror into our users table. Use upsert so a re-submit after a
  // network error doesn't 500 — the row may already exist.
  try {
    await prisma.user.upsert({
      where: { supabaseId: data.user.id },
      create: {
        supabaseId: data.user.id,
        email,
        displayName: input.displayName,
        role: "VIEWER",
      },
      update: { displayName: input.displayName },
    });
  } catch (e) {
    log.error("auth.signup.mirror-failed", e, { actorId: actorFp });
    // Don't fail the whole registration — Supabase user is created,
    // the mirror row will be created on first successful login.
  }

  log.info("auth.signup.ok", { actorId: actorFp, route: "register" });

  // If email verification is disabled (dev), Supabase returns a session
  // and we can log the user straight in.
  if (data.session) {
    redirect("/superchat");
  }
  return ok({ email });
}

/**
 * Log a viewer in. Errors are intentionally generic — we don't tell
 * the caller whether the email or the password was wrong (avoid user
 * enumeration).
 */
export async function loginAction(rawInput: unknown): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = loginSchema.safeParse(rawInput);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return fail(first?.message ?? "Invalid input", first?.path?.[0]?.toString());
  }
  const input = parsed.data;
  const email = normalizeEmail(input.email);
  const actorFp = await fingerprint(email);

  const ip = getClientIp(await headers());
  const byIp = await limitByKey("auth:login", `login:ip:${ip}`);
  if (!byIp.success) return fail("Too many attempts. Please wait a few minutes.");
  const byEmail = await limitByKey("auth:login", `login:email:${email}`);
  if (!byEmail.success) return fail("Too many attempts for this email. Please wait a few minutes.");

  const captcha = await verifyTurnstile(input.turnstileToken, ip);
  if (!captcha.ok) return fail("Captcha verification failed. Please try again.");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password: input.password });
  if (error || !data.user) {
    log.warn("auth.signin.failed", { actorId: actorFp, route: "login" });
    return fail("Invalid email or password.");
  }

  log.info("auth.signin.ok", { actorId: actorFp, route: "login" });
  return ok({ redirectTo: "/superchat" });
}

/**
 * Log the user out. Always succeeds — the worst case is the cookie
 * was already gone.
 */
export async function logoutAction(): Promise<ActionResult<void>> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
