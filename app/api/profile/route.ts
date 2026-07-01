/**
 * GET /api/profile   — return the current user's profile
 * PATCH /api/profile — update the display name
 *
 * Display name is server-validated against the same rules used in
 * registration AND re-filtered through the profanity word list before
 * being persisted. We never trust a client-supplied display name.
 *
 * Rate-limited under the `superchats:create` bucket (3/min/IP) so
 * spammers can't churn display names.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp, limitByIp } from "@/lib/rate-limit";
import { profanityFilter } from "@/lib/security";
import { updateProfileSchema, type ProfileResponse } from "@/lib/schemas/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET — return the authenticated user's profile. */
export async function GET(): Promise<NextResponse> {
  const ctx = await getCurrentUser();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body: ProfileResponse = {
    id: ctx.user.id,
    email: ctx.email,
    displayName: ctx.user.displayName,
    avatarUrl: ctx.user.avatarUrl,
    emailVerified: ctx.emailVerified,
  };
  return NextResponse.json(body, { status: 200 });
}

/** PATCH — update display name. */
export async function PATCH(request: Request): Promise<NextResponse> {
  const ctx = await getCurrentUser();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Per-IP rate-limit so a single attacker can't churn display names.
  const ip = getClientIp(await headers());
  const verdict = await limitByIp("superchats:create", ip, "profile");
  if (!verdict.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  // Parse + validate the body.
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = updateProfileSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { error: first?.message ?? "invalid_input", field: first?.path?.[0]?.toString() },
      { status: 400 },
    );
  }

  // Server-side profanity filter. The client can't bypass this —
  // we run it regardless of what the client did.
  const cleaned = await profanityFilter(parsed.data.displayName);
  if (cleaned.trim().length < 3) {
    return NextResponse.json(
      { error: "Display name is not allowed.", field: "displayName" },
      { status: 400 },
    );
  }

  const updated = await prisma.user.update({
    where: { id: ctx.user.id },
    data: { displayName: cleaned },
    select: { id: true, email: true, displayName: true, avatarUrl: true },
  });

  log.info("profile.updated", {
    actorId: await fingerprint(ctx.email),
    route: "profile.patch",
    field: "displayName",
  });

  return NextResponse.json(
    {
      id: updated.id,
      email: updated.email,
      displayName: updated.displayName,
      avatarUrl: updated.avatarUrl,
      emailVerified: ctx.emailVerified,
    } satisfies ProfileResponse,
    { status: 200 },
  );
}