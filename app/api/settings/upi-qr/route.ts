/**
 * GET /api/settings/upi-qr
 *
 * Public read of the admin-uploaded UPI QR code. Returns a 1-hour
 * signed URL (or `{ url: null }` if no QR has been uploaded yet).
 *
 * No auth required — donors hit this from the public superchat form.
 * The signed URL is the only way to read the bucket; the URL expires
 * so a leaked URL stops working within the hour.
 *
 * Response shape:
 *   - 200 { url: "https://...?token=..." } when a QR is set.
 *   - 200 { url: null } when no QR is set (NOT 404 — donors on the
 *     superchat form need to render the "no QR available" state
 *     without a special-case error handler).
 *   - 500 { error: "..." } on storage failure.
 *
 * No caching layer yet — donor pages hit this at most once per
 * checkout, and the storage API is cheap. If Sentry ever shows this
 * as a hot path we can add a 5-minute Redis cache in front.
 */
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { getUpiQrSignedUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface UpiQrReadResponse {
  url: string | null;
}

export async function GET(): Promise<NextResponse> {
  let path: string | null = null;
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: 1 },
      select: { upiQrPath: true },
    });
    path = settings?.upiQrPath ?? null;
  } catch {
    // DB unreachable — return null rather than 5xx. The donor form
    // degrades to "no QR" silently, same as if none were uploaded.
    return NextResponse.json({ url: null } satisfies UpiQrReadResponse, { status: 200 });
  }

  if (!path) {
    return NextResponse.json({ url: null } satisfies UpiQrReadResponse, { status: 200 });
  }

  const url = await getUpiQrSignedUrl(path);
  const body: UpiQrReadResponse = { url };
  return NextResponse.json(body, { status: 200 });
}