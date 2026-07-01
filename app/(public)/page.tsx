/**
 * Public landing page. Public visitors (GUEST role) can see the live
 * feed and the call to action to register — they cannot submit
 * superchats (the superchat page is gated server-side).
 *
 * The live feed is server-rendered from the latest 50 PAID superchats
 * via the same `LiveSuperchat` projection the API exposes. The
 * client-side `<SuperchatFeed />` then attaches to Supabase Realtime
 * and animates new cards in.
 */
import Link from "next/link";

import { LandingHero } from "@/components/landing/LandingHero";
import { SuperchatFeed } from "@/components/superchat/SuperchatFeed";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toLiveSuperchat, type LiveSuperchat } from "@/lib/schemas/superchat";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await getCurrentUser();
  const rows = await prisma.superchat.findMany({
    where: { status: "PAID", hidden: false },
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
  const initialFeed: LiveSuperchat[] = [];
  for (const r of rows) {
    const projected = toLiveSuperchat(r);
    if (projected) initialFeed.push(projected);
  }

  return (
    <main className="relative min-h-[calc(100vh-4rem)]">
      <LandingHero
        isAuthenticated={!!user}
        displayName={user?.user.displayName ?? user?.email}
      />
      <section className="container mx-auto max-w-3xl px-4 pb-24 pt-12">
        <h2 className="font-display text-3xl font-semibold tracking-tight text-balance">
          Live superchats
        </h2>
        <p className="mt-2 text-ink-muted">
          Tip the crew directly — no algorithm, no revenue cut. Newest messages at the top.
        </p>
        <SuperchatFeed initial={initialFeed} />
      </section>
      <footer className="border-t border-border/40 py-8 text-center text-xs text-ink-muted">
        <p>
          Scoop Luck · <Link href="/login" className="underline hover:text-ink">Sign in</Link>
          {" · "}
          <Link href="/register" className="underline hover:text-ink">Create an account</Link>
        </p>
      </footer>
    </main>
  );
}