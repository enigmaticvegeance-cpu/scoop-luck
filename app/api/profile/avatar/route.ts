/**
 * POST /api/profile/avatar
 *
 * Multipart upload of a profile photo. The flow:
 *   1. Per-user rate limit (10 / hour) on the dedicated `avatar:upload`
 *      bucket so a single user can't starve the superchat bucket.
 *   2. Auth + parse multipart
 *   3. Reject if Content-Type isn't image/jpeg | image/png | image/webp
 *      AND magic bytes don't agree (defeats polyglot / spoofed files)
 *   4. sharp re-encode to exactly 400×400 JPEG, q=0.9, mozjpeg.
 *      This is the canonical sanitizer — the re-encoded buffer is the
 *      only thing stored. Even if a polyglot slips past the magic-byte
 *      check, sharp strips the payload.
 *   5. Upload to Supabase Storage, mint a 7-day signed URL.
 *   6. Best-effort delete the old avatar object.
 *   7. Persist the new URL on User.avatarUrl.
 *
 * Returns `{ avatarUrl }` on success.
 */
import { NextResponse } from "next/server";
import { headers } from "next/headers";

import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";

import { prisma } from "@/lib/prisma";
import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { getClientIp, limitByKey } from "@/lib/rate-limit";
import { uploadAvatar, deleteAvatar } from "@/lib/storage";
import type { AvatarUploadResponse } from "@/lib/schemas/profile";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 2 * 1024 * 1024; // 2 MB
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const TARGET_SIZE = 400;
const JPEG_QUALITY = 90;

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await getCurrentUser();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Per-user rate limit (10 per hour) on the dedicated `avatar:upload`
  // bucket. Keyed by userId so a single user can't burn the global
  // superchats:create quota. Per-IP lives in proxy.
  const rl = await limitByKey("avatar:upload", `avatar:user:${ctx.user.id}`);
  if (!rl.success) {
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

  // The browser sends a Content-Type; we treat it as a hint and
  // verify against magic bytes.
  const claimedType = file.type;
  if (!ALLOWED_MIME.has(claimedType)) {
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

  // Read into a buffer. file-type inspects the first 4100 bytes.
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  // Magic-byte check. file-type sniffs the file's actual content,
  // not its name or Content-Type header. If the claim and the bytes
  // disagree, we refuse the upload. This catches:
  //   - .jpg files containing HTML or scripts (polyglots)
  //   - file-extension forgery
  const detected = await fileTypeFromBuffer(buffer);
  if (!detected || !ALLOWED_MIME.has(detected.mime)) {
    return NextResponse.json(
      { error: "invalid_magic_bytes", detail: "File is not a valid image." },
      { status: 415 },
    );
  }
  // Cross-check that the claimed type matches the sniffed type. JPG, PNG,
  // and WebP have one canonical MIME each so this should always line up;
  // a mismatch is a strong signal of a polyglot attempt.
  if (detected.mime !== claimedType) {
    return NextResponse.json(
      { error: "mime_mismatch", detail: `Claimed ${claimedType} but file is ${detected.mime}.` },
      { status: 415 },
    );
  }

  // Re-encode. sharp normalizes EXIF orientation, strips any embedded
  // payload, and produces the canonical 400×400 JPEG. The output buffer
  // is what gets uploaded — nothing from the original file reaches
  // storage.
  let encoded: Buffer;
  try {
    encoded = await sharp(buffer, { failOn: "truncated" })
      .rotate()
      .resize(TARGET_SIZE, TARGET_SIZE, { fit: "cover", position: "attention" })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer();
  } catch (e) {
    log.error("avatar.sharp_failed", e instanceof Error ? e : new Error(String(e)), {
      actorId: await fingerprint(ctx.email),
    });
    return NextResponse.json(
      { error: "encode_failed", detail: "We could not process that image." },
      { status: 422 },
    );
  }

  // Upload. The service-role key handles the bucket's RLS bypass.
  let avatarUrl: string;
  try {
    avatarUrl = await uploadAvatar(ctx.user.id, encoded);
  } catch (e) {
    log.error("avatar.upload_failed", e instanceof Error ? e : new Error(String(e)), {
      actorId: await fingerprint(ctx.email),
    });
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  // Persist + best-effort delete the previous avatar.
  const previous = ctx.user.avatarUrl;
  const ip = getClientIp(await headers());
  await prisma.user.update({
    where: { id: ctx.user.id },
    data: { avatarUrl },
  });
  // Don't await the delete — failing to clean up an old object is
  // a soft issue, not a hard one. Fire and forget.
  void deleteAvatar(previous).catch(() => {});

  log.info("avatar.uploaded", {
    actorId: await fingerprint(ctx.email),
    route: "profile.avatar.post",
    ip,
  });

  const body: AvatarUploadResponse = { avatarUrl };
  return NextResponse.json(body, { status: 200 });
}