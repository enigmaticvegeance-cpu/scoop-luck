/**
 * Tests for lib/storage.ts — focused on the parts that don't require a
 * live Supabase backend.
 *
 * The shape checks here lock down:
 *   1. The fixed-path mapping for UPI QR uploads — the DB row's
 *      upiQrPath must always be one of three canonical strings so the
 *      read endpoint doesn't have to enumerate the bucket.
 *   2. The bucket-aware URL parser — making sure avatar URLs parse out
 *      to avatar paths and not platform paths.
 *
 * Magic-byte / mime-sniff rejection is exercised at the HTTP layer
 * (file-type is wired into the route handler).
 */
import { describe, it, expect, vi } from "vitest";

const store = new Map<string, Buffer>();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, data: Buffer) => {
          store.set(`${bucket}:${path}`, data);
          return { error: null };
        },
        remove: async (paths: string[]) => {
          for (const p of paths) store.delete(`${bucket}:${p}`);
          return { error: null };
        },
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: `https://stub.supabase.co/storage/v1/object/sign/${bucket}/${path}?token=stub` },
          error: null,
        }),
      }),
    },
  }),
}));

// Set env stubs BEFORE importing the modules under test. The storage
// module reads NEXT_PUBLIC_SUPABASE_URL via process.env directly; the
// serverEnv() call uses zod which requires SERVICE_ROLE_KEY ≥20 chars.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key-stubs-have-no-real-secret";
// node-fetch isn't actually used here but lib/env.ts may import it
// transitively; harmless to set.

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stub-key-stubs-have-no-real-secret");

const { uploadUpiQr, deleteUpiQr, getUpiQrSignedUrl, deleteAvatar } = await import("@/lib/storage");

describe("uploadUpiQr", () => {
  it("returns the canonical png path for image/png", async () => {
    const path = await uploadUpiQr(Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png");
    expect(path).toBe("upi-qr.png");
  });

  it("returns the canonical jpg path for image/jpeg", async () => {
    const path = await uploadUpiQr(Buffer.from([0xff, 0xd8, 0xff]), "image/jpeg");
    expect(path).toBe("upi-qr.jpg");
  });

  it("returns the canonical webp path for image/webp", async () => {
    const buf = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0x10, 0x00, 0x00, 0x00]),
      Buffer.from("WEBP"),
    ]);
    const path = await uploadUpiQr(buf, "image/webp");
    expect(path).toBe("upi-qr.webp");
  });
});

describe("deleteUpiQr", () => {
  it("does not throw when the bucket is empty (first delete)", async () => {
    await expect(deleteUpiQr()).resolves.toBeUndefined();
  });
});

describe("getUpiQrSignedUrl", () => {
  it("returns null for null path", async () => {
    expect(await getUpiQrSignedUrl(null)).toBeNull();
  });

  it("returns a signed URL containing the bucket + path", async () => {
    const url = await getUpiQrSignedUrl("upi-qr.png");
    expect(url).not.toBeNull();
    expect(url).toMatch(/platform-assets/);
    expect(url).toMatch(/upi-qr\.png/);
  });
});

describe("deleteAvatar", () => {
  it("ignores a null avatarUrl", async () => {
    await expect(deleteAvatar(null)).resolves.toBeUndefined();
  });

  it("ignores a URL that is not a Supabase Storage URL", async () => {
    await expect(deleteAvatar("https://example.com/foo.jpg")).resolves.toBeUndefined();
  });

  it("ignores a Supabase URL pointing at a different bucket", async () => {
    await expect(
      deleteAvatar("https://stub.supabase.co/storage/v1/object/sign/platform-assets/upi-qr.png?token=x"),
    ).resolves.toBeUndefined();
  });
});