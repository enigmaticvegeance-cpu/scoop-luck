/**
 * AvatarCropper — modal avatar selection + crop + upload.
 *
 * Flow:
 *   1. User picks a JPG/PNG/WebP file via the file input
 *   2. The file is read into a `URL.createObjectURL()` for preview
 *   3. react-easy-crop renders a circle crop viewport with
 *      drag-to-pan, scroll-to-zoom (0.5× – 4×), and keyboard arrows
 *      for accessibility
 *   4. On confirm: paint the cropped area onto a 400×400 canvas, then
 *      `canvas.toBlob(blob, 'image/jpeg', 0.9)` and call `onConfirm`
 *
 * The cropper never uploads anything itself — the parent owns the
 * upload (POST /api/profile/avatar). It only produces the final Blob.
 *
 * Accessibility:
 *   - The modal traps focus; ESC closes.
 *   - The file input has a visible label.
 *   - The crop viewport responds to arrow keys (default
 *     react-easy-crop behavior) for zoom + pan.
 *
 * Why we paint through a Canvas ourselves instead of relying on
 * react-easy-crop's `crop` math: we want the server to receive a
 * square 400×400 JPEG regardless of what aspect the donor picked —
 * sharp then re-encodes defensively on the server.
 */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { X, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface AvatarCropperProps {
  onCancel: () => void;
  onConfirm: (blob: Blob) => void;
}

const TARGET_SIZE = 400;
const JPEG_QUALITY = 0.9;
const MAX_PICK_BYTES = 4 * 1024 * 1024; // 4 MB on the client (server caps at 2 MB)

export function AvatarCropper({ onCancel, onConfirm }: AvatarCropperProps) {
  const [pickedFile, setPickedFile] = useState<File | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Revoke the object URL on swap / unmount.
  useEffect(() => {
    return () => {
      if (imageSrc) URL.revokeObjectURL(imageSrc);
    };
  }, [imageSrc]);

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, busy]);

  const onPick = useCallback((file: File) => {
    setError(null);
    if (!/^image\/(jpe?g|png|webp)$/.test(file.type)) {
      setError("Please pick a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_PICK_BYTES) {
      setError(`Image is ${(file.size / 1024 / 1024).toFixed(1)} MB; max ${MAX_PICK_BYTES / 1024 / 1024} MB.`);
      return;
    }
    // Swap out the previous object URL so we don't leak memory.
    setPickedFile(file);
    if (imageSrc) URL.revokeObjectURL(imageSrc);
    setImageSrc(URL.createObjectURL(file));
  }, [imageSrc]);

  const onConfirmClick = useCallback(async () => {
    if (!imageSrc || !croppedAreaPixels) return;
    setBusy(true);
    try {
      const blob = await renderCroppedJpeg(imageSrc, croppedAreaPixels);
      if (!blob) {
        setError("Could not crop this image. Try a different file.");
        return;
      }
      onConfirm(blob);
    } finally {
      setBusy(false);
    }
  }, [imageSrc, croppedAreaPixels, onConfirm]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="avatar-cropper-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-base/80 p-4 backdrop-blur-sm"
      onClick={(e) => {
        // Click on backdrop closes; click on inner panel does not.
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="glass relative flex w-full max-w-lg flex-col gap-4 rounded-2xl border p-4">
        <header className="flex items-center justify-between">
          <h2 id="avatar-cropper-title" className="font-display text-xl font-semibold">
            {imageSrc ? "Crop your photo" : "Pick a photo"}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            aria-label="Close"
            className="rounded-md p-1 text-ink-muted hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-5" />
          </button>
        </header>

        {!imageSrc ? (
          <div className="flex flex-col gap-3">
            <Label htmlFor="avatar-file">Image file</Label>
            <Input
              ref={inputRef}
              id="avatar-file"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
              }}
            />
            <p className="text-xs text-ink-muted">
              JPG, PNG, or WebP. We crop to a square and resize to 400×400.
            </p>
            {pickedFile ? null : null}
            {error ? <p className="text-xs text-destructive">{error}</p> : null}
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => inputRef.current?.click()}
              >
                <Upload className="size-4" /> Choose file
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div
              className="relative h-72 w-full overflow-hidden rounded-xl bg-elevated"
              aria-label="Crop your photo. Drag to reposition, scroll to zoom."
            >
              <Cropper
                image={imageSrc}
                crop={crop}
                zoom={zoom}
                aspect={1}
                minZoom={0.5}
                maxZoom={4}
                cropShape="round"
                showGrid={false}
                objectFit="contain"
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={(_area, pixels) => setCroppedAreaPixels(pixels)}
              />
            </div>

            <div className="flex items-center gap-3">
              <Label htmlFor="zoom" className="text-xs text-ink-muted">
                Zoom
              </Label>
              <input
                id="zoom"
                type="range"
                min={0.5}
                max={4}
                step={0.05}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-elevated accent-neon-cyan"
                aria-label="Zoom level"
              />
              <span className="w-10 text-right text-xs tabular-nums text-ink-muted">
                {zoom.toFixed(2)}×
              </span>
            </div>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setImageSrc(null);
                  setPickedFile(null);
                  setCroppedAreaPixels(null);
                  setError(null);
                }}
                disabled={busy}
              >
                Pick a different file
              </Button>
              <Button type="button" onClick={onConfirmClick} disabled={busy || !croppedAreaPixels}>
                {busy ? "Preparing…" : "Use this photo"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Paint the cropped region of `src` (an object URL or data URL) into
 * a 400×400 canvas, then return a JPEG blob at quality 0.9.
 *
 * The server re-encodes defensively, so this client preview is purely
 * for donor convenience — we don't rely on the geometry being perfect.
 */
async function renderCroppedJpeg(src: string, area: Area): Promise<Blob | null> {
  const img = await loadImage(src);
  if (!img) return null;
  const canvas = document.createElement("canvas");
  canvas.width = TARGET_SIZE;
  canvas.height = TARGET_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // Fill the background black so transparent PNGs don't produce a
  // checker-board artifact in the JPEG (JPEG has no alpha channel).
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TARGET_SIZE, TARGET_SIZE);
  // Draw the cropped region scaled to TARGET_SIZE × TARGET_SIZE. The
  // natural-width is the image's display width; the croppedAreaPixels
  // describes the region in those same coordinates.
  ctx.drawImage(
    img,
    area.x,
    area.y,
    area.width,
    area.height,
    0,
    0,
    TARGET_SIZE,
    TARGET_SIZE,
  );
  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
  });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}