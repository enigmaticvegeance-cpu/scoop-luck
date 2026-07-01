/**
 * ProfileForm — viewer profile settings.
 *
 * Two fields:
 *   - Display name (server-validated + profanity-filtered on save)
 *   - Avatar photo (open the AvatarCropper, upload the cropped image)
 *
 * Why two separate submit paths instead of one big "Save": display
 * name is a quick inline edit; avatar upload is multi-step (pick
 * file → crop → confirm → upload) with a different feedback pattern
 * (progress %, image preview). Forcing them into one form would
 * couple unrelated state.
 */
"use client";

import { useState, useTransition } from "react";
import { Loader2, User as UserIcon, Upload, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { AvatarCropper } from "@/components/profile/AvatarCropper";
import type { ProfileResponse } from "@/lib/schemas/profile";
import { cn } from "@/lib/utils";

interface ProfileFormProps {
  initial: ProfileResponse;
}

export function ProfileForm({ initial }: ProfileFormProps) {
  const [displayName, setDisplayName] = useState<string>(initial.displayName ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initial.avatarUrl);
  const [savedDisplayName, setSavedDisplayName] = useState<string>(initial.displayName ?? "");

  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSuccess, setNameSuccess] = useState<boolean>(false);
  const [namePending, startNameTransition] = useTransition();

  const [avatarError, setAvatarError] = useState<string | null>(null);
  const [avatarPending, startAvatarTransition] = useTransition();
  const [cropperOpen, setCropperOpen] = useState<boolean>(false);

  const dirty = displayName.trim() !== savedDisplayName;

  function onSaveName() {
    setNameError(null);
    setNameSuccess(false);
    startNameTransition(async () => {
      try {
        const res = await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ displayName: displayName.trim() }),
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setNameError(j.error ?? "Could not save your display name.");
          return;
        }
        const body = (await res.json()) as ProfileResponse;
        setSavedDisplayName(body.displayName ?? "");
        setDisplayName(body.displayName ?? "");
        setNameSuccess(true);
      } catch {
        setNameError("Network error. Please try again.");
      }
    });
  }

  function onAvatarConfirm(blob: Blob) {
    setAvatarError(null);
    startAvatarTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("file", blob, "avatar.jpg");
        const res = await fetch("/api/profile/avatar", { method: "POST", body: fd });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          setAvatarError(j.error ?? "Upload failed. Please try a different image.");
          return;
        }
        const body = (await res.json()) as { avatarUrl: string };
        setAvatarUrl(body.avatarUrl);
        setCropperOpen(false);
      } catch {
        setAvatarError("Network error. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Display name */}
      <Card>
        <CardHeader>
          <CardTitle>Display name</CardTitle>
          <CardDescription>
            This is the name that appears next to your superchats on the live feed.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label htmlFor="displayName" className="sr-only">
              Display name
            </Label>
            <Input
              id="displayName"
              maxLength={30}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value);
                setNameSuccess(false);
              }}
              placeholder="Anonymous"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-ink-muted">
              3 to 30 characters. Letters, numbers, spaces, and underscores.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              onClick={onSaveName}
              disabled={!dirty || namePending}
            >
              {namePending ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
            {nameSuccess ? (
              <span className="inline-flex items-center gap-1 text-xs text-neon-green">
                <Check className="size-3.5" /> Saved
              </span>
            ) : null}
          </div>
          {nameError ? (
            <Alert variant="destructive" role="alert">
              {nameError}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* Avatar */}
      <Card>
        <CardHeader>
          <CardTitle>Profile photo</CardTitle>
          <CardDescription>
            Pick an image. You can crop, zoom, and reposition before uploading. The
            image is re-encoded server-side to 400×400 JPEG.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div
              className={cn(
                "flex size-20 items-center justify-center overflow-hidden rounded-full border-2 border-border bg-elevated",
                !avatarUrl && "border-dashed",
              )}
              aria-hidden
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="size-full object-cover"
                  width={80}
                  height={80}
                />
              ) : (
                <UserIcon className="size-8 text-ink-muted" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setCropperOpen(true)}
                disabled={avatarPending}
              >
                {avatarPending ? (
                  <>
                    <Loader2 className="size-4 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <Upload className="size-4" /> {avatarUrl ? "Change photo" : "Upload photo"}
                  </>
                )}
              </Button>
              <p className="text-xs text-ink-muted">JPG, PNG, or WebP. Max 2 MB.</p>
            </div>
          </div>
          {avatarError ? (
            <Alert variant="destructive" role="alert">
              {avatarError}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {/* Cropper modal — rendered when active */}
      {cropperOpen ? (
        <AvatarCropper
          onCancel={() => setCropperOpen(false)}
          onConfirm={onAvatarConfirm}
        />
      ) : null}
    </div>
  );
}