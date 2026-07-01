/**
 * GET /api/superchats
 *
 * Public read endpoint that backs the live feed on the landing page.
 * Returns the most recent N PAID, non-hidden superchats as the
 * `LiveSuperchat` projection. Caches for 5s on the CDN/browser layer
 * so bursts of visitors don't pound Prisma, but a Realtime insert is
 * visible to the next visitor within the cache window.
 *
 * Anonymous-friendly. The Realtime channel on the client subscribes
 * with the same filter so this endpoint is the source of truth for
 * initial render AND for any reconnect after a transient Realtime
 * disconnect.
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { LiveSuperchatSchema, toLiveSuperchat, type LiveSuperchat } from "@/lib/schemas/superchat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LIMIT = 50;

/**
 * Sanity cap: the response should always stay under a few KB so the
 * CDN cache is cheap. 50 rows × ~400 bytes ≈ 20 KB. Plenty of headroom
 * for the body envelope.
 */
export async function GET(): Promise<NextResponse> {
  const rows = await prisma.superchat.findMany({
    where: { status: "PAID", hidden: false },
    orderBy: { paidAt: "desc" },
    take: LIMIT,
    select: {
      id: true,
      displayName: true,
      avatarUrl: true,
      message: true,
      amountPaise: true,
      currency: true,
      inrEquivalentPaise: true,
      tier: true,
      paidAt: true,
      createdAt: true,
    },
  });

  const items: LiveSuperchat[] = [];
  for (const r of rows) {
    const projected = toLiveSuperchat(r);
    if (!projected) continue;
    // Parse-validate the projection so we don't ship malformed JSON if
    // a future regression breaks the helper. Cheap on 50 items.
    const parsed = LiveSuperchatSchema.safeParse(projected);
    if (parsed.success) items.push(parsed.data);
  }

  return NextResponse.json(
    { items },
    {
      status: 200,
      headers: {
        // Public, edge-cached for 5s with stale-while-revalidate.
        // The Realtime subscription pushes fresh rows immediately to
        // already-connected clients; this cache is for cold loads and
        // for crawlers.
        "Cache-Control": "public, max-age=5, s-maxage=5, stale-while-revalidate=30",
      },
    },
  );
}