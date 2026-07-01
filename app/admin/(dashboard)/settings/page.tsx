/**
 * /admin/settings — runtime configuration + profanity word list.
 *
 * Loads:
 *   - the single-row Settings table
 *   - every row in ProfanityWord
 *   - the ADMIN_EMAILS env (read-only display)
 *   - masked gateway key ids (read-only)
 *
 * The page is a server component. Mutations happen through three
 * server actions (updateSettings, addProfanityWord,
 * removeProfanityWord) which all live in app/(public)/admin-actions.ts.
 */
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAdminEmails, serverEnv } from "@/lib/env";
import { SettingsForm } from "@/components/admin/SettingsForm";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const ctx = await getCurrentUser();
  if (!ctx || ctx.user.role !== "ADMIN") {
    redirect("/admin/login");
  }

  // The Settings table is a single row keyed at id=1; create it on
  // first read so a fresh deploy doesn't 404.
  const settings = await prisma.settings.upsert({
    where: { id: 1 },
    create: { id: 1 },
    update: {},
  });

  const profanityWords = await prisma.profanityWord.findMany({
    orderBy: [{ category: "asc" }, { word: "asc" }],
    select: { id: true, word: true, category: true, createdAt: true },
  });

  const env = serverEnv();
  const adminEmails = Array.from(getAdminEmails());

  // Masked key display. Never log or echo the secret.
  const mask = (s: string | undefined, last = 4) => {
    if (!s) return null;
    if (s.length <= last) return "•".repeat(s.length);
    return `…${s.slice(-last)}`;
  };

  const gatewayConfig = {
    razorpay: {
      keyId: mask(env.RAZORPAY_KEY_ID),
      hasSecret: Boolean(env.RAZORPAY_KEY_SECRET),
      hasWebhook: Boolean(env.RAZORPAY_WEBHOOK_SECRET),
    },
    stripe: {
      keyId: mask(env.STRIPE_PUBLISHABLE_KEY),
      hasSecret: Boolean(env.STRIPE_SECRET_KEY),
      hasWebhook: Boolean(env.STRIPE_WEBHOOK_SECRET),
    },
    paypal: {
      keyId: mask(env.NEXT_PUBLIC_PAYPAL_CLIENT_ID),
      hasSecret: Boolean(env.PAYPAL_CLIENT_SECRET),
      hasWebhook: Boolean(env.PAYPAL_WEBHOOK_ID),
    },
  };

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Runtime configuration for the donation form, profanity filter, and platform
          metadata that appears on invoices. Gateway keys live in environment variables —
          they cannot be rotated from here.
        </p>
      </header>
      <SettingsForm
        settings={settings}
        profanityWords={profanityWords}
        adminEmails={adminEmails}
        gatewayConfig={gatewayConfig}
      />
    </section>
  );
}