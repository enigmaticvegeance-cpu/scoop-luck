/**
 * /superchat — the superchat submission page.
 *
 * Server component: reads Settings (min/max donation) and the current
 * user's display name, then hands them to the client form. The form
 * itself is client-side because it owns the payment-method modal state.
 */
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { SuperchatForm } from "@/components/superchat/SuperchatForm";

export const dynamic = "force-dynamic";

export default async function SuperchatPage() {
  const ctx = await getCurrentUser();
  if (!ctx) {
    // Gate: must be logged in to send a superchat.
    redirect("/login?next=/superchat");
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  const minPaise = settings?.minDonationPaise ?? 2000;
  const maxPaise = settings?.maxDonationPaise ?? 1_000_000;
  const inrPerUsd = settings ? Number(settings.inrPerUsd) : 83;

  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <header className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          Send a superchat
        </h1>
        <p className="mt-2 text-ink-muted">
          Pick a tier, write a message, choose how to pay. Your message lands on screen
          the moment payment clears.
        </p>
      </header>
      <SuperchatForm
        isAuthenticated
        defaultDisplayName={ctx.user.displayName ?? undefined}
        minPaise={minPaise}
        maxPaise={maxPaise}
        inrPerUsd={inrPerUsd}
      />
    </main>
  );
}