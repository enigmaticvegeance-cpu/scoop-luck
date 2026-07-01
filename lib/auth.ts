/**
 * Auth helpers — server-side only.
 *
 *   - getCurrentUser(): returns the Supabase user + our User row, or null
 *   - requireUser():    same, but throws a redirect to /login
 *   - requireAdmin():   same, but throws a redirect to /admin/login
 *                       if the user isn't an admin (by ADMIN_EMAILS env)
 *
 * These run in Server Components, Route Handlers, and Server Actions.
 *
 * Side effect: getCurrentUser() writes a row to the AuthEvent table on
 *   - FIRST_LOGIN when the User row is created
 *   - ROLE_CHANGE  when the role differs from what the previous login
 *     left on the row
 * The insert is fire-and-forget — a Prisma failure here MUST NOT
 * block the login itself (which would be a self-DoS).
 */
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { getAdminEmails } from "@/lib/env";
import { log } from "@/lib/log";
import type { AuthEventKind, Role, User } from "@/generated/prisma/client";

export interface AuthContext {
  supabaseUserId: string;
  email: string;
  emailVerified: boolean;
  user: User; // our mirror row
}

// -------------------------------------------------------------------------
// E2E test bypass — gated by a single env var. `next dev` always runs
// as NODE_ENV=development regardless of what we pass, so the
// production-realistic "NODE_ENV=test" gate doesn't actually fire
// when the Playwright webserver boots. Using only E2E_AUTH_BYPASS=true
// is the standard test-mode pattern (NextAuth, Cypress, MSW all do
// this); the protection is that this flag is set ONLY by the
// Playwright config's webServer command and never appears in
// .env/.env.local. See SECURITY_LOG.md for the documented threat-model
// tradeoff.
// -------------------------------------------------------------------------
export const E2E_ADMIN_COOKIE = "e2e-admin-session";
export const E2E_ADMIN_EMAIL = "e2e-admin@test.local";
const E2E_USER_ID = "e2e-admin";

function buildE2EAuthContext(): AuthContext {
  const now = new Date();
  return {
    supabaseUserId: E2E_USER_ID,
    email: E2E_ADMIN_EMAIL,
    emailVerified: true,
    user: {
      id: E2E_USER_ID,
      supabaseId: E2E_USER_ID,
      email: E2E_ADMIN_EMAIL,
      displayName: "E2E Admin",
      avatarUrl: null,
      emailVerifiedAt: now,
      role: "ADMIN",
      createdAt: now,
      updatedAt: now,
    } as unknown as User,
  };
}

export function isE2EAuthBypass(): boolean {
  return process.env.E2E_AUTH_BYPASS === "true";
}

export async function getCurrentUser(): Promise<AuthContext | null> {
  // E2E bypass: every admin page calls getCurrentUser() as defense in
  // depth. Short-circuit at the source so the bypass applies uniformly
  // across layout + per-page re-checks. Production path unchanged
  // when the flag is unset.
  if (isE2EAuthBypass()) {
    return buildE2EAuthContext();
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Compute the target role from ADMIN_EMAILS env. Email-verified flag
  // mirrors Supabase's email_confirmed_at; we don't enforce it on
  // /login (Supabase Auth handles that), but we surface it in ctx.
  const email = (data.user.email ?? "").toLowerCase();
  const targetRole: Role = getAdminEmails().has(email) ? "ADMIN" : "VIEWER";
  const emailVerifiedAt = data.user.email_confirmed_at
    ? new Date(data.user.email_confirmed_at)
    : null;

  // Find-or-create the User row. We do NOT use prisma.upsert here
  // because we need to know the PREVIOUS role (and whether the row
  // existed) to write a meaningful AuthEvent. The read-then-write
  // pattern is fine here: this runs once per request, and the race
  // window is narrow (a concurrent login that creates the row will
  // just get a unique-constraint violation that we catch below).
  let user = await prisma.user.findUnique({ where: { supabaseId: data.user.id } });
  let auditKind: AuthEventKind | null = null;
  let fromRole: Role | null = user?.role ?? null;
  let toRole: Role = targetRole;

  if (!user) {
    // First login for this email.
    try {
      user = await prisma.user.create({
        data: {
          supabaseId: data.user.id,
          email,
          displayName: null,
          avatarUrl: null,
          emailVerifiedAt,
          role: targetRole,
        },
      });
      auditKind = "FIRST_LOGIN";
      fromRole = null;
      toRole = targetRole;
    } catch {
      // Race: a concurrent request just created the row. Re-read and
      // fall through to the update path.
      user = await prisma.user.findUnique({ where: { supabaseId: data.user.id } });
      if (!user) {
        // Genuinely lost the race — log + bail with null context. The
        // page will render as logged-out, which is the safe default.
        log.error("auth.user_create_lost_race", new Error("user row missing after re-read"), {
          supabaseUserId: data.user.id,
        });
        return null;
      }
      fromRole = user.role;
      toRole = targetRole;
      if (fromRole !== toRole) auditKind = "ROLE_CHANGE";
    }
  } else {
    // Existing user — compare role and emailVerifiedAt.
    if (user.role !== targetRole) {
      auditKind = "ROLE_CHANGE";
      fromRole = user.role;
      toRole = targetRole;
    }
    // Only write if something actually changed. We DO want to update
    // emailVerifiedAt when Supabase flips it, but we don't audit
    // that — it's a routine state-of-the-world change, not a role event.
    const needsUpdate =
      user.role !== targetRole ||
      user.email !== email ||
      (emailVerifiedAt?.getTime() ?? null) !== (user.emailVerifiedAt?.getTime() ?? null);
    if (needsUpdate) {
      try {
        user = await prisma.user.update({
          where: { id: user.id },
          data: {
            role: targetRole,
            email,
            emailVerifiedAt,
          },
        });
      } catch {
        // Concurrent admin-role flip on the same row. The audit row
        // already reflects the source-of-truth env, so a re-read is
        // sufficient.
        user = await prisma.user.findUnique({ where: { supabaseId: data.user.id } });
        if (!user) return null;
      }
    }
  }

  // Fire-and-forget audit write. We don't await — a Prisma hiccup on
  // the audit table must not block the user from logging in. Errors
  // are captured by log.error so Sentry still gets them.
  if (auditKind && user) {
    const actorEmail = email;
    const fromR = fromRole;
    const toR = toRole;
    const userId = user.id;
    void prisma.authEvent
      .create({
        data: {
          userId,
          actorEmail,
          kind: auditKind,
          fromRole: fromR,
          toRole: toR,
        },
      })
      .catch((e) =>
        log.error("auth.audit_write_failed", e instanceof Error ? e : new Error(String(e)), {
          actorEmail,
          kind: auditKind,
        }),
      );
  }

  return {
    supabaseUserId: data.user.id,
    email: user.email,
    emailVerified: !!data.user.email_confirmed_at,
    user,
  };
}

export async function requireUser(redirectTo = "/login"): Promise<AuthContext> {
  const ctx = await getCurrentUser();
  if (!ctx) redirect(redirectTo);
  return ctx;
}

export async function requireAdmin(redirectTo = "/admin/login"): Promise<AuthContext> {
  const ctx = await requireUser(redirectTo);
  if (ctx.user.role !== "ADMIN") redirect("/admin/login?error=not-admin");
  return ctx;
}