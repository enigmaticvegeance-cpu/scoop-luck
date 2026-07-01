/**
 * Supabase Storage helpers — server-only.
 *
 * The avatars bucket is PRIVATE. The server reads/writes through the
 * SERVICE-ROLE key, which bypasses RLS. Clients never read from the
 * bucket directly; they see whatever URL the server persists on the
 * `User.avatarUrl` row.
 *
 * We use a *signed* URL with a 7-day expiry. That gives the browser
 * long enough to cache the image across sessions without exposing the
 * bucket to the world. The download route could mint a fresh signed
 * URL on every request, but a 7-day window is a good balance between
 * cache friendliness and the cost of a leaked URL.
 *
 * The browser receives the signed URL via the `/api/profile/avatar`
 * response, persists it on the `User` row, and uses it in the next
 * page load. By the time it expires the user has likely refreshed.
 *
 * The `platform-assets` bucket holds admin-managed files (currently
 * just the UPI QR code image). Same pattern: signed URL, but a
 * shorter TTL (1 hour) because donors reload the form mid-checkout
 * and the read path is public — a shorter expiry limits the blast
 * radius of a leaked URL.
 */
import { randomUUID } from "node:crypto";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";

const AVATAR_BUCKET = "avatars";
/** 7 days — long enough to keep avatars cached across sessions. */
const AVATAR_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

const PLATFORM_BUCKET = "platform-assets";
/** 1 hour — public read path; shorter TTL limits blast radius. */
const PLATFORM_SIGNED_URL_TTL_SECONDS = 60 * 60;

let _client: ReturnType<typeof createSupabaseClient> | null = null;

function getServiceClient() {
  if (_client) return _client;
  const env = serverEnv();
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for storage operations");
  }
  if (!publicSupabaseUrl()) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL is required for storage operations");
  }
  _client = createSupabaseClient(publicSupabaseUrl(), env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return _client;
}

function publicSupabaseUrl(): string {
  return process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
}

/**
 * Upload a re-encoded JPEG avatar to the private bucket and return a
 * 7-day signed URL for the browser.
 *
 * The path layout is `avatars/<userId>/<uuid>.jpg`. We never
 * overwrite — each upload gets a fresh UUID so the old URL can stay
 * valid until the row is updated, and a delete can race in without
 * breaking anything.
 */
export async function uploadAvatar(userId: string, jpegBuffer: Buffer): Promise<string> {
  const supabase = getServiceClient();
  const path = `${userId}/${randomUUID()}.jpg`;
  const { error: upErr } = await supabase.storage.from(AVATAR_BUCKET).upload(path, jpegBuffer, {
    contentType: "image/jpeg",
    cacheControl: "public, max-age=300",
    upsert: false,
  });
  if (upErr) {
    throw new Error(`avatar upload failed: ${upErr.message}`);
  }
  const { data: signed, error: signErr } = await supabase.storage
    .from(AVATAR_BUCKET)
    .createSignedUrl(path, AVATAR_SIGNED_URL_TTL_SECONDS);
  if (signErr || !signed) {
    throw new Error(`avatar signed-url failed: ${signErr?.message ?? "no data"}`);
  }
  return signed.signedUrl;
}

/**
 * Best-effort delete of a previous avatar. We never fail the new
 * upload if the old delete fails — the worst case is a few orphaned
 * objects in the bucket, which a maintenance job can clean up.
 *
 * Silently swallows "not found" because that's the common case.
 */
export async function deleteAvatar(avatarUrl: string | null): Promise<void> {
  if (!avatarUrl) return;
  const path = pathFromSignedUrl(avatarUrl, AVATAR_BUCKET);
  if (!path) return;
  try {
    const supabase = getServiceClient();
    const { error } = await supabase.storage.from(AVATAR_BUCKET).remove([path]);
    if (error && !/not\s*found/i.test(error.message)) {
      // Surface only unexpected errors; "not found" is benign.
      throw new Error(error.message);
    }
  } catch {
    // Swallow — the upload succeeded, the old URL is just orphaned.
  }
}

/**
 * Extract `avatars/<userId>/<uuid>.jpg` from a Supabase signed URL.
 * The path is the part of the URL that comes after `/object/sign/`.
 *
 * Examples (parsed):
 *   https://x.supabase.co/storage/v1/object/sign/avatars/uuid/abc.jpg?token=…
 *   → "uuid/abc.jpg"
 *
 * Returns null if the URL doesn't look like a Supabase Storage URL —
 * which means we shouldn't try to delete it (could be an external CDN
 * URL from before this code shipped).
 */
function pathFromSignedUrl(url: string, bucket: string): string | null {
  try {
    const u = new URL(url);
    const marker = `/object/sign/${bucket}/`;
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;
    return u.pathname.slice(idx + marker.length);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------
 * Platform assets bucket — admin-managed static files (currently just UPI QR).
 *
 * Unlike avatars, these are PUBLIC-READ via signed URLs. The signed URL is
 * minted on every request to /api/settings/upi-qr and cached briefly. The
 * bucket itself is private (no public RLS); the signed URL is the only
 * way to read.
 *
 * Path layout: a single fixed name `upi-qr.<ext>`. We OVERWRITE on each
 * upload (upsert: true) so the stored Settings.upiQrPath is always
 * `upi-qr.png` / `upi-qr.jpg` / `upi-qr.webp` regardless of how many
 * times the admin has replaced the file.
 * ------------------------------------------------------------------------- */

export type UpiQrMime = "image/png" | "image/jpeg" | "image/webp";

const UPI_QR_PATH_BY_MIME: Record<UpiQrMime, string> = {
  "image/png": "upi-qr.png",
  "image/jpeg": "upi-qr.jpg",
  "image/webp": "upi-qr.webp",
};

/**
 * Upload the UPI QR code image, overwriting any prior file. Returns the
 * storage object path (e.g. "upi-qr.png") which is what gets persisted on
 * Settings.upiQrPath — NOT a URL. The public read path mints a fresh
 * signed URL on demand.
 */
export async function uploadUpiQr(buffer: Buffer, mime: UpiQrMime): Promise<string> {
  const supabase = getServiceClient();
  const path = UPI_QR_PATH_BY_MIME[mime];
  const { error: upErr } = await supabase.storage.from(PLATFORM_BUCKET).upload(path, buffer, {
    contentType: mime,
    cacheControl: "public, max-age=300",
    upsert: true,
  });
  if (upErr) {
    throw new Error(`upi-qr upload failed: ${upErr.message}`);
  }
  return path;
}

/** Delete the stored UPI QR image (all three extensions). */
export async function deleteUpiQr(): Promise<void> {
  try {
    const supabase = getServiceClient();
    const paths = Object.values(UPI_QR_PATH_BY_MIME);
    const { error } = await supabase.storage.from(PLATFORM_BUCKET).remove(paths);
    // "not found" is benign — first delete, bucket never had a QR.
    if (error && !/not\s*found/i.test(error.message)) {
      throw new Error(error.message);
    }
  } catch {
    // Swallow — the delete is best-effort. The Settings.upiQrPath
    // column will be nulled server-side regardless.
  }
}

/**
 * Mint a 1-hour signed URL for the stored UPI QR. Returns null if the
 * path doesn't exist or signing fails. The read path calls this on
 * every donor page load (with a short Redis cache in front).
 */
export async function getUpiQrSignedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  try {
    const supabase = getServiceClient();
    const { data: signed, error: signErr } = await supabase.storage
      .from(PLATFORM_BUCKET)
      .createSignedUrl(path, PLATFORM_SIGNED_URL_TTL_SECONDS);
    if (signErr || !signed) return null;
    return signed.signedUrl;
  } catch {
    return null;
  }
}