/**
 * GET /api/invoices/[superchatId]/download
 *
 * Authenticated donor (or admin) can re-download the PDF for a
 * Superchat they own. Anonymous superchats have no email to send to,
 * so they're inaccessible here — that's intentional.
 *
 * Returns application/pdf with a Content-Disposition that names the
 * file `invoice-<invoiceNumber>.pdf`.
 */
import { NextResponse } from "next/server";

import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { mintInvoiceNumber, renderInvoicePdf } from "@/lib/invoice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  ctxParam: { params: Promise<{ superchatId: string }> },
): Promise<NextResponse> {
  const { superchatId } = await ctxParam.params;

  const ctx = await getCurrentUser();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const superchat = await prisma.superchat.findUnique({
    where: { id: superchatId },
  });
  if (!superchat) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Authorize: the donor who paid, OR an admin.
  const isOwner = superchat.userId === ctx.user.id;
  const isAdmin = ctx.user.role === "ADMIN";
  if (!isOwner && !isAdmin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (superchat.status !== "PAID" && superchat.status !== "REFUNDED") {
    return NextResponse.json({ error: "not_paid" }, { status: 409 });
  }

  // Lazy-mint an invoice number if the webhook hasn't issued one yet
  // (e.g. webhook still in-flight, manual admin re-issue).
  let invoiceNumber = superchat.invoiceNumber;
  if (!invoiceNumber) {
    invoiceNumber = mintInvoiceNumber(superchat.id, superchat.paidAt ?? new Date());
    try {
      await prisma.superchat.update({
        where: { id: superchat.id },
        data: { invoiceNumber },
      });
    } catch {
      const re = await prisma.superchat.findUnique({ where: { id: superchat.id } });
      invoiceNumber = re?.invoiceNumber ?? invoiceNumber;
    }
  }

  const settings = await prisma.settings.findUnique({ where: { id: 1 } });
  if (!settings) {
    return NextResponse.json({ error: "settings_missing" }, { status: 500 });
  }

  let pdf: Buffer;
  try {
    pdf = await renderInvoicePdf({ superchat, settings, invoiceNumber });
  } catch (e) {
    log.error("invoice.render_failed", e instanceof Error ? e : new Error(String(e)), {
      superchatId: superchat.id,
      actorId: await fingerprint(ctx.email),
    });
    return NextResponse.json({ error: "render_failed" }, { status: 500 });
  }

  // Convert Buffer -> Uint8Array for the BodyInit type (Web Response).
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="invoice-${invoiceNumber}.pdf"`,
      // Don't let the browser or proxies cache the PDF — invoice
      // numbers can change if we re-mint.
      "Cache-Control": "private, no-store",
    },
  });
}