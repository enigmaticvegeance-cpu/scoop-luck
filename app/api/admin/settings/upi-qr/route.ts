/**
 * POST /api/admin/settings/upi-qr
 * DELETE /api/admin/settings/upi-qr
 *
 * Admin-only UPI QR code image upload. Mirrors the avatar upload
 * security model:
 *
 *   1. requireAdmin() — admin layout also gates /admin/*, but this
 *      defense-in-depth check refuses unauthenticated callers early
 *      and produces a uniform 401.
 *   2. Per-IP rate-limit on the `admin` bucket (60 / min, shared with
 *      other admin actions). Brute-forcing the upload is the obvious
 *      abuse vector.
 *   3. Multipart parse + magic-byte sniff. The browser's Content-Type
 *      is a HINT; file-type inspects the first 4100 bytes. If the two
 *      disagree, it's a polyglot — refuse. We accept PNG / JPEG / WebP
 *      and nothing else (no SVG, no GIF — both are valid attack surfaces
 *      for XSS via SVG and the QR is a single image so we don't need
 *      animated formats).
 *   4. MAX_BYTES 1 MB. A QR is a few KB at most; 1 MB is generous.
 *   5. Upload to Supabase Storage (platform-assets bucket) at a fixed
 *      path `upi-qr.<ext>`. Overwrite allowed. The storage layer
 *      returns the path, NOT a URL — the public read endpoint mints
 *      signed URLs on demand.
 *   6. Persist the storage path on `Settings.upiQrPath`. NULL = no QR.
 *
 * DELETE clears the field, attempts best-effort bucket cleanup, and
 * never fails the request — admin intent ("remove the QR") is honored
 * even if the bucket was already empty.
 *
 * All errors to the client are uniform ("Could not save UPI QR."). The
 * full reason is sent to Sentry via `log.error`.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { fileTypeFromBuffer } from "file-type";

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp, limitByIp } from "@/lib/rate-limit";
import { uploadUpiQr, deleteUpiQr, type UpiQrMime } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 1 * 1024 * 1024; // 1 MB
const ALLOWED_MIME: ReadonlySet<UpiQrMime> = new Set(["image/png", "image/jpeg", "image/webp"]);

interface UpiQrUploadResponse {
  /** Storage object path (e.g. "upi-qr.png"). */
  path: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await getCurrentUser();
  if (!ctx || ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(await headers());
  const ipLimit = await limitByIp("admin", ip, "upi-qr");
  if (!ipLimit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "invalid_multipart" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file_missing" }, { status: 400 });
  }

  const claimedType = file.type;
  if (!ALLOWED_MIME.has(claimedType as UpiQrMime)) {
    return NextResponse.json(
      { error: "unsupported_type", detail: `Unsupported type: ${claimedType || "unknown"}` },
      { status: 415 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "too_large", detail: `File must be ${MAX_BYTES / 1024 / 1024} MB or smaller.` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Magic-byte sniff. file-type inspects the actual bytes (not the
  // extension or Content-Type). Polyglots — a file that claims PNG
  // but carries HTML or JS — are caught here. A claim/sniff mismatch
  // is a strong signal of a polyglot attempt.
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime as UpiQrMime)) {
    return NextResponse.json(
      { error: "invalid_magic_bytes", detail: "File is not a valid PNG, JPEG, or WebP image." },
      { status: 415 },
    );
  }
  if (detected.mime !== claimedType) {
    return NextResponse.json(
      { error: "mime_mismatch", detail: `Claimed ${claimedType} but file is ${detected.mime}.` },
      { status: 415 },
    );
  }

  const actorFp = await fingerprint(ctx.email);
  const mime = detected.mime as UpiQrMime;

  let path: string;
  try {
    path = await uploadUpiQr(buffer, mime);
  } catch (e) {
    log.error("upi-qr.upload_failed", e instanceof Error ? e : new Error(String(e)), {
      actorId: actorFp,
      route: "admin.upiQr.post",
      ip,
    });
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  try {
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, upiQrPath: path },
      update: { upiQrPath: path },
    });
  } catch (e) {
    // Storage succeeded but DB didn't — log + best-effort cleanup so
    // a stale bucket object doesn't outlive the row.
    log.error("upi-qr.persist_failed", e instanceof Error ? e : new Error(String(e)), {
      actorId: actorFp,
      route: "admin.upiQr.post",
      ip,
      path,
    });
    void deleteUpiQr().catch(() => {});
    return NextResponse.json({ error: "persist_failed" }, { status: 500 });
  }

  log.info("upi-qr.uploaded", { actorId: actorFp, route: "admin.upiQr.post", ip, path });

  const body: UpiQrUploadResponse = { path };
  return NextResponse.json(body, { status: 200 });
}

export async function DELETE(): Promise<NextResponse> {
  const ctx = await getCurrentUser();
  if (!ctx || ctx.user.role !== "ADMIN") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(await headers());
  const ipLimit = await limitByIp("admin", ip, "upi-qr");
  if (!ipLimit.success) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const actorFp = await fingerprint(ctx.email);

  try {
    await prisma.settings.upsert({
      where: { id: 1 },
      create: { id: 1, upiQrPath: null },
      update: { upiQrPath: null },
    });
    void deleteUpiQr().catch(() => {});
  } catch (e) {
    log.error("upi-qr.delete_failed", e instanceof Error ? e : new Error(String(e)), {
      actorId: actorFp,
      route: "admin.upiQr.delete",
      ip,
    });
    return NextResponse.json({ error: "delete_failed" }, { status: 500 });
  }

  log.info("upi-qr.deleted", { actorId: actorFp, route: "admin.upiQr.delete", ip });
  return NextResponse.json({ ok: true }, { status: 200 });
}