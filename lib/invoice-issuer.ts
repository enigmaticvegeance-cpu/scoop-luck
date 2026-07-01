/**
 * Post-payment side effects.
 *
 * After a Superchat row is marked PAID, we:
 *   1. Mint an invoice number (if not already set)
 *   2. Render the PDF
 *   3. Send the invoice email (best-effort; failure does not roll back)
 *   4. Update the row with the invoice number
 *
 * Called by the three webhook handlers (Razorpay / Stripe / PayPal).
 *
 * Why best-effort email: the donor already paid and the row is already
 * marked PAID. A transient Resend outage shouldn't fail the webhook —
 * the donor can re-download from /api/invoices/[id].
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { sendInvoiceEmail } from "@/lib/email";
import { mintInvoiceNumber, renderInvoicePdf } from "@/lib/invoice";

interface IssueInvoiceArgs {
  superchatId: string;
}

/**
 * Render + email + persist invoice number. Idempotent — if the row
 * already has an invoiceNumber, we don't re-mint, just re-send the
 * email (handy when admin re-issues from the dashboard).
 */
export async function issueInvoice(args: IssueInvoiceArgs): Promise<{
  ok: boolean;
  invoiceNumber: string | null;
  reason?: string;
}> {
  const superchat = await prisma.superchat.findUnique({
    where: { id: args.superchatId },
    include: { user: true },
  });
  if (!superchat) return { ok: false, invoiceNumber: null, reason: "not_found" };
  if (superchat.status !== "PAID") {
    return { ok: false, invoiceNumber: null, reason: "not_paid" };
  }
  if (!superchat.user?.email) {
    // Anonymous superchat — nothing to email. The PDF is still
    // downloadable if the row gets a userId later.
    return { ok: true, invoiceNumber: superchat.invoiceNumber };
  }

  let invoiceNumber = superchat.invoiceNumber;
  if (!invoiceNumber) {
    invoiceNumber = mintInvoiceNumber(superchat.id, superchat.paidAt ?? new Date());
    // Persist eagerly so concurrent calls don't mint duplicates. The
    // unique index on invoiceNumber is the safety net.
    try {
      await prisma.superchat.update({
        where: { id: superchat.id },
        data: { invoiceNumber },
      });
    } catch {
      // Race: another webhook already minted. Re-read.
      const re = await prisma.superchat.findUnique({ where: { id: superchat.id } });
      invoiceNumber = re?.invoiceNumber ?? invoiceNumber;
    }
  }

  // Render the PDF. Even if email fails, the user can re-download
  // via /api/invoices/[id] because the invoiceNumber is now persisted.
  let pdf: Buffer;
  try {
    const settings = await prisma.settings.findUnique({ where: { id: 1 } });
    if (!settings) {
      return { ok: false, invoiceNumber, reason: "settings_missing" };
    }
    pdf = await renderInvoicePdf({ superchat, settings, invoiceNumber });
  } catch (e) {
    log.error("invoice.render_failed", e instanceof Error ? e : new Error(String(e)), {
      superchatId: superchat.id,
    });
    return { ok: false, invoiceNumber, reason: "render_failed" };
  }

  // Build display values for the email.
  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: superchat.currency,
    minimumFractionDigits: 2,
  });
  const amountFormatted = fmt.format(superchat.amountPaise / 100);

  await sendInvoiceEmail({
    to: superchat.user.email,
    pdfBuffer: new Uint8Array(pdf),
    pdfFilename: `invoice-${invoiceNumber}.pdf`,
    messagePreview: superchat.message,
    displayName: superchat.displayName,
    amountFormatted,
    invoiceNumber,
    paidAt: superchat.paidAt ?? new Date(),
  });

  log.info("invoice.issued", {
    actorId: await fingerprint(superchat.user.email),
    superchatId: superchat.id,
    invoiceNumber,
  });
  return { ok: true, invoiceNumber };
}