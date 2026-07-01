/**
 * /admin — admin live feed.
 *
 * The default landing tab. Shows the same Realtime feed the public
 * landing page does, but with per-card Hide controls and a Refresh
 * panel in the sub-nav.
 *
 * SSR delivers the initial 50 PAID superchats (including hidden
 * ones, so the admin can see and unhide what they hid). Realtime
 * reconciles new inserts, updates, and deletes via the admin live
 * feed component.
 */
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { AdminLiveFeed } from "@/components/admin/AdminLiveFeed";
import { toLiveSuperchat, type LiveSuperchat } from "@/lib/schemas/superchat";

export const dynamic = "force-dynamic";

export default async function AdminLiveFeedPage() {
  // Re-check admin role (defense in depth — the layout also checks).
  const ctx = await getCurrentUser();
  if (!ctx || ctx.user.role !== "ADMIN") {
    redirect("/admin/login");
  }

  // Fetch the most recent 50 PAID superchats. We INCLUDE hidden rows
  // here because the admin needs to see what they hid in order to
  // unhide it. The public API filters them out, so the public feed
  // is unaffected.
  const rows = await prisma.superchat.findMany({
    where: { status: "PAID" },
    orderBy: { paidAt: "desc" },
    take: 50,
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

  const initial: LiveSuperchat[] = [];
  for (const r of rows) {
    const projected = toLiveSuperchat(r);
    if (projected) initial.push(projected);
  }

  return (
    <section>
      <header className="mb-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Live feed</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Real-time superchats. Hide inappropriate messages — they vanish from the
          public feed immediately and are never hard-deleted.
        </p>
      </header>
      <AdminLiveFeed initial={initial} />
    </section>
  );
}