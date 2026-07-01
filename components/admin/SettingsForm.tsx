/**
 * SettingsForm — the /admin/settings page's interactive surface.
 *
 * Sections:
 *   1. Donation limits — min/max paise
 *   2. Currency — INR per USD
 *   3. Platform legal — name, address, GSTIN
 *   4. Pin durations — featured / top-fan
 *   5. UPI QR code — upload/replace/remove (admin-managed image)
 *   6. Profanity word list — CRUD
 *   7. Gateway config — read-only badges
 *   8. Admin emails — read-only display
 *
 * All writes go through server actions in app/(public)/admin-actions.ts
 * except the UPI QR upload, which is a multipart POST to
 * /api/admin/settings/upi-qr (server actions can't accept raw File
 * payloads cleanly under Turbopack's chunk splitting).
 */
"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ImageIcon, Loader2, Plus, Trash2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { addProfanityWord, removeProfanityWord, updateSettings } from "@/app/(public)/admin-actions";
import { profanityCategoryEnum } from "@/lib/schemas/admin";
import { cn } from "@/lib/utils";

type ProfanityCategory = (typeof profanityCategoryEnum.options)[number];

interface SettingsLike {
  minDonationPaise: number;
  maxDonationPaise: number;
  inrPerUsd: number | { toString(): string };
  pinHighTierSeconds: number;
  pinTopTierSeconds: number;
  platformLegalName: string;
  platformAddress: string | null;
  platformGstin: string | null;
  /** Storage object path of the UPI QR image. NULL = no QR uploaded. */
  upiQrPath: string | null;
}

interface ProfanityWordRow {
  id: string;
  word: string;
  category: string;
  createdAt: Date;
}

interface GatewayStatus {
  keyId: string | null;
  hasSecret: boolean;
  hasWebhook: boolean;
}

interface GatewayConfig {
  razorpay: GatewayStatus;
  stripe: GatewayStatus;
  paypal: GatewayStatus;
}

interface Props {
  settings: SettingsLike;
  profanityWords: ProfanityWordRow[];
  adminEmails: string[];
  gatewayConfig: GatewayConfig;
}

const CATEGORY_BADGE: Record<ProfanityCategory, string> = {
  SLUR: "bg-destructive/20 text-destructive",
  PROFANITY: "bg-neon-amber/20 text-neon-amber",
  HATE: "bg-destructive/20 text-destructive",
  SPAM: "bg-ink-muted/20 text-ink-muted",
};

const inr = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);

export function SettingsForm({ settings, profanityWords, adminEmails, gatewayConfig }: Props) {
  return (
    <div className="space-y-6">
      <DonationSettingsCard settings={settings} />
      <PlatformSettingsCard settings={settings} />
      <PinDurationsCard settings={settings} />
      <UpiQrCard path={settings.upiQrPath} />
      <ProfanityWordsCard words={profanityWords} />
      <GatewayConfigCard config={gatewayConfig} />
      <AdminEmailsCard emails={adminEmails} />
    </div>
  );
}

/* -------------------------------------------------------------------------
 * 1. Donation limits + currency
 * ------------------------------------------------------------------------- */

function DonationSettingsCard({ settings }: { settings: SettingsLike }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [minPaise, setMinPaise] = useState<number>(settings.minDonationPaise);
  const [maxPaise, setMaxPaise] = useState<number>(settings.maxDonationPaise);
  const [inrPerUsd, setInrPerUsd] = useState<number>(
    typeof settings.inrPerUsd === "number" ? settings.inrPerUsd : Number(settings.inrPerUsd),
  );
  const [error, setError] = useState<string | null>(null);

  const dirty =
    minPaise !== settings.minDonationPaise ||
    maxPaise !== settings.maxDonationPaise ||
    Math.abs(inrPerUsd - (typeof settings.inrPerUsd === "number" ? settings.inrPerUsd : Number(settings.inrPerUsd))) > 1e-6;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await updateSettings({
        minDonationPaise: minPaise,
        maxDonationPaise: maxPaise,
        inrPerUsd,
        pinHighTierSeconds: settings.pinHighTierSeconds,
        pinTopTierSeconds: settings.pinTopTierSeconds,
        platformLegalName: settings.platformLegalName,
        platformAddress: settings.platformAddress,
        platformGstin: settings.platformGstin,
      });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success("Donation settings saved.");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Donation limits &amp; currency</CardTitle>
        <CardDescription>
          Bounds enforced on the superchat form. Amounts are stored in paise (₹1 = 100 paise).
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <label htmlFor="minPaise" className="text-sm font-medium">Minimum donation (paise)</label>
            <Input
              id="minPaise"
              type="number"
              min={100}
              max={1_000_000}
              value={minPaise}
              onChange={(e) => setMinPaise(Number(e.target.value))}
              className="mt-1 tabular-nums"
            />
            <p className="mt-1 text-xs text-ink-muted">{inr(minPaise)}</p>
          </div>
          <div>
            <label htmlFor="maxPaise" className="text-sm font-medium">Maximum donation (paise)</label>
            <Input
              id="maxPaise"
              type="number"
              min={100}
              max={10_000_000}
              value={maxPaise}
              onChange={(e) => setMaxPaise(Number(e.target.value))}
              className="mt-1 tabular-nums"
            />
            <p className="mt-1 text-xs text-ink-muted">{inr(maxPaise)}</p>
          </div>
          <div>
            <label htmlFor="inrPerUsd" className="text-sm font-medium">INR per 1 USD</label>
            <Input
              id="inrPerUsd"
              type="number"
              step="0.0001"
              min={1}
              max={200}
              value={inrPerUsd}
              onChange={(e) => setInrPerUsd(Number(e.target.value))}
              className="mt-1 tabular-nums"
            />
            <p className="mt-1 text-xs text-ink-muted">Used to convert USD tips to INR for invoices.</p>
          </div>
          {error ? (
            <div className="sm:col-span-3">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          <div className="sm:col-span-3">
            <Button type="submit" disabled={pending || !dirty}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save donation settings
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 2. Platform legal
 * ------------------------------------------------------------------------- */

function PlatformSettingsCard({ settings }: { settings: SettingsLike }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [legalName, setLegalName] = useState(settings.platformLegalName);
  const [address, setAddress] = useState(settings.platformAddress ?? "");
  const [gstin, setGstin] = useState(settings.platformGstin ?? "");
  const [error, setError] = useState<string | null>(null);

  const dirty =
    legalName !== settings.platformLegalName ||
    (address || null) !== (settings.platformAddress ?? null) ||
    (gstin || null) !== (settings.platformGstin ?? null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await updateSettings({
        minDonationPaise: settings.minDonationPaise,
        maxDonationPaise: settings.maxDonationPaise,
        inrPerUsd: typeof settings.inrPerUsd === "number" ? settings.inrPerUsd : Number(settings.inrPerUsd),
        pinHighTierSeconds: settings.pinHighTierSeconds,
        pinTopTierSeconds: settings.pinTopTierSeconds,
        platformLegalName: legalName,
        platformAddress: address.trim() || null,
        platformGstin: gstin.trim() || null,
      });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success("Platform info saved.");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Platform legal info</CardTitle>
        <CardDescription>
          Appears on every invoice PDF. Leave a field blank to omit it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="legalName" className="text-sm font-medium">Legal name</label>
            <Input
              id="legalName"
              type="text"
              maxLength={200}
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              className="mt-1"
              required
            />
          </div>
          <div>
            <label htmlFor="address" className="text-sm font-medium">Address</label>
            <Input
              id="address"
              type="text"
              maxLength={500}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <label htmlFor="gstin" className="text-sm font-medium">GSTIN</label>
            <Input
              id="gstin"
              type="text"
              maxLength={20}
              value={gstin}
              onChange={(e) => setGstin(e.target.value.toUpperCase())}
              className="mt-1 font-mono uppercase"
              placeholder="15 alphanumeric characters"
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" disabled={pending || !dirty}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save platform info
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 3. Pin durations
 * ------------------------------------------------------------------------- */

function PinDurationsCard({ settings }: { settings: SettingsLike }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [high, setHigh] = useState<number>(settings.pinHighTierSeconds);
  const [top, setTop] = useState<number>(settings.pinTopTierSeconds);
  const [error, setError] = useState<string | null>(null);

  const dirty = high !== settings.pinHighTierSeconds || top !== settings.pinTopTierSeconds;

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await updateSettings({
        minDonationPaise: settings.minDonationPaise,
        maxDonationPaise: settings.maxDonationPaise,
        inrPerUsd: typeof settings.inrPerUsd === "number" ? settings.inrPerUsd : Number(settings.inrPerUsd),
        pinHighTierSeconds: high,
        pinTopTierSeconds: top,
        platformLegalName: settings.platformLegalName,
        platformAddress: settings.platformAddress,
        platformGstin: settings.platformGstin,
      });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      toast.success("Pin durations saved.");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pin durations</CardTitle>
        <CardDescription>
          High-tier and top-fan superchats stick to the top of the live feed for these
          many seconds.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="pinHigh" className="text-sm font-medium">High tier (seconds)</label>
            <Input
              id="pinHigh"
              type="number"
              min={0}
              max={600}
              value={high}
              onChange={(e) => setHigh(Number(e.target.value))}
              className="mt-1 tabular-nums"
            />
          </div>
          <div>
            <label htmlFor="pinTop" className="text-sm font-medium">Top tier (seconds)</label>
            <Input
              id="pinTop"
              type="number"
              min={0}
              max={600}
              value={top}
              onChange={(e) => setTop(Number(e.target.value))}
              className="mt-1 tabular-nums"
            />
          </div>
          {error ? (
            <div className="sm:col-span-2">
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            </div>
          ) : null}
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending || !dirty}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Save pin durations
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 4. UPI QR code
 *
 * The admin uploads a static UPI QR image here. Donors see it on the
 * superchat form's UPI flow ("scan to pay"). The file is stored in
 * the Supabase `platform-assets` bucket; we only persist the storage
 * path on Settings.upiQrPath, and mint signed URLs on demand via the
 * public read endpoint.
 *
 * Client-side flow:
 *   1. Admin picks a PNG / JPEG / WebP, ≤ 1 MB (server caps at 1 MB).
 *   2. We POST it as multipart/form-data to /api/admin/settings/upi-qr.
 *   3. The server runs the security gauntlet (mime sniff, magic-byte
 *      cross-check, rate limit) and returns { path }. We revalidate
 *      the page so the new path flows down from the server component.
 *   4. "Remove" DELETEs the same route and nulls the DB field.
 *
 * Accessibility:
 *   - The file input is visually-hidden but reachable via a labeled
 *     button (clicking the button opens the native picker).
 *   - The preview image has `alt=""` because it's a non-text decorative
 *     element for sighted admins; the surrounding text labels carry
 *     the meaning. A screen reader doesn't need a description.
 * ------------------------------------------------------------------------- */

function UpiQrCard({ path }: { path: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Revoke the object URL on swap / unmount to avoid a memory leak.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onPick = (file: File) => {
    setError(null);
    if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
      setError("Please pick a PNG, JPEG, or WebP image.");
      return;
    }
    if (file.size > 1024 * 1024) {
      setError("Image must be 1 MB or smaller.");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return url;
    });
  };

  const onSubmit = async () => {
    setError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    start(async () => {
      const res = await fetch("/api/admin/settings/upi-qr", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { detail?: string } | null;
        setError(body?.detail ?? "Upload failed. Please try again.");
        toast.error(body?.detail ?? "Upload failed.");
        return;
      }
      toast.success("UPI QR uploaded.");
      // Clear the picker + local preview; the server-rendered preview
      // takes over after refresh.
      if (inputRef.current) inputRef.current.value = "";
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      router.refresh();
    });
  };

  const onRemove = () => {
    setError(null);
    start(async () => {
      const res = await fetch("/api/admin/settings/upi-qr", { method: "DELETE" });
      if (!res.ok) {
        toast.error("Could not remove UPI QR.");
        return;
      }
      toast.success("UPI QR removed.");
      router.refresh();
    });
  };

  // For the server-rendered preview we need a signed URL. Fetched
  // client-side on demand (same endpoint donors hit). The bucket is
  // private; signed URLs expire in 1 hour, which is plenty for an
  // admin to eyeball the upload.
  const [signedPreview, setSignedPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!path) {
      setSignedPreview(null);
      return;
    }
    let cancelled = false;
    fetch("/api/settings/upi-qr")
      .then((r) => r.json() as Promise<{ url: string | null }>)
      .then((j) => {
        if (!cancelled) setSignedPreview(j.url);
      })
      .catch(() => {
        if (!cancelled) setSignedPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>UPI QR code</CardTitle>
        <CardDescription>
          Static QR shown to donors on the UPI checkout flow. PNG, JPEG, or WebP — 1 MB
          max. Uploaded file is stored privately; donors receive a 1-hour signed URL.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          <div className="flex h-40 w-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-surface/40">
            {previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={previewUrl}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : signedPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={signedPreview}
                alt=""
                className="h-full w-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-1 text-ink-muted">
                <ImageIcon className="size-8" aria-hidden />
                <span className="text-xs">No QR uploaded</span>
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3">
            {/* The file input is visually hidden but MUST keep a real
                <label htmlFor="upi-qr-file"> so axe doesn't flag it as
                unlabeled (label-only or sr-only inputs fail WCAG 4.1.2).
                The "Choose file" button is a click-target proxy — it
                forwards to the picker via inputRef.current?.click(). */}
            <label htmlFor="upi-qr-file" className="sr-only">
              UPI QR code image file
            </label>
            <input
              ref={inputRef}
              id="upi-qr-file"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPick(f);
              }}
              className="sr-only"
              aria-describedby="upi-qr-help"
            />
            <p id="upi-qr-help" className="text-xs text-ink-muted">
              The preview shows your local pick (before upload) until you press
              &ldquo;Upload&rdquo;. After upload, the server-side image takes over.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => inputRef.current?.click()}
                disabled={pending}
              >
                <Upload className="size-3.5" aria-hidden /> Choose file
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={onSubmit}
                disabled={pending || !previewUrl}
              >
                {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
                Upload
              </Button>
              {path ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onRemove}
                  disabled={pending}
                  className="text-destructive hover:bg-destructive/15"
                >
                  <Trash2 className="size-3.5" aria-hidden /> Remove
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 6. Profanity word list
 * ------------------------------------------------------------------------- */

function ProfanityWordsCard({ words }: { words: ProfanityWordRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [newWord, setNewWord] = useState("");
  const [newCategory, setNewCategory] = useState<ProfanityCategory>("PROFANITY");
  const [error, setError] = useState<string | null>(null);

  const onAdd = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await addProfanityWord({ word: newWord, category: newCategory });
      if (!res.ok) {
        setError(res.error);
        toast.error(res.error);
        return;
      }
      setNewWord("");
      setNewCategory("PROFANITY");
      toast.success("Word added.");
      router.refresh();
    });
  };

  const onRemove = (id: string) => {
    start(async () => {
      const res = await removeProfanityWord({ id });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success("Word removed.");
      router.refresh();
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Profanity word list</CardTitle>
        <CardDescription>
          These are added to the bundled profanity library. New superchat messages are
          sanitized server-side using the combined list. Matches are replaced with
          asterisks, not rejected.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={onAdd} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label htmlFor="newWord" className="text-sm font-medium">New word</label>
            <Input
              id="newWord"
              type="text"
              maxLength={50}
              value={newWord}
              onChange={(e) => setNewWord(e.target.value)}
              className="mt-1"
              placeholder="word to filter"
              required
            />
          </div>
          <div>
            <label htmlFor="newCategory" className="text-sm font-medium">Category</label>
            <select
              id="newCategory"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as ProfanityCategory)}
              className="mt-1 block h-10 rounded-md border border-border bg-elevated px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {profanityCategoryEnum.options.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <Button type="submit" disabled={pending || newWord.trim().length === 0}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Plus className="size-4" aria-hidden />}
            Add word
          </Button>
        </form>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-elevated/50 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2">Word</th>
                <th className="px-3 py-2">Category</th>
                <th className="px-3 py-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {words.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-ink-muted">
                    No custom words yet — the bundled English dictionary is still active.
                  </td>
                </tr>
              ) : (
                words.map((w) => (
                  <tr key={w.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">{w.word}</td>
                    <td className="px-3 py-2">
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                          CATEGORY_BADGE[(w.category as ProfanityCategory) ?? "PROFANITY"] ?? CATEGORY_BADGE.PROFANITY,
                        )}
                      >
                        {w.category}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onRemove(w.id)}
                        disabled={pending}
                        aria-label={`Remove ${w.word}`}
                        className="text-destructive hover:bg-destructive/15"
                      >
                        <Trash2 className="size-3.5" aria-hidden /> Remove
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/* -------------------------------------------------------------------------
 * 7. Gateway config (read-only)
 * ------------------------------------------------------------------------- */

function GatewayConfigCard({ config }: { config: GatewayConfig }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Gateway configuration</CardTitle>
        <CardDescription>
          Read-only — set the corresponding <code>RAZORPAY_*</code>, <code>STRIPE_*</code>,
          and <code>PAYPAL_*</code> environment variables and restart the app to change
          any of these.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <GatewayColumn name="Razorpay" status={config.razorpay} />
          <GatewayColumn name="Stripe" status={config.stripe} />
          <GatewayColumn name="PayPal" status={config.paypal} />
        </div>
      </CardContent>
    </Card>
  );
}

function GatewayColumn({ name, status }: { name: string; status: GatewayStatus }) {
  return (
    <div className="rounded-lg border border-border bg-surface/40 p-3 text-sm">
      <p className="font-medium">{name}</p>
      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex items-center justify-between">
          <dt className="text-ink-muted">Key id</dt>
          <dd className="font-mono">{status.keyId ?? "—"}</dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-ink-muted">Secret</dt>
          <dd>
            <Badge configured={status.hasSecret} />
          </dd>
        </div>
        <div className="flex items-center justify-between">
          <dt className="text-ink-muted">Webhook</dt>
          <dd>
            <Badge configured={status.hasWebhook} />
          </dd>
        </div>
      </dl>
    </div>
  );
}

function Badge({ configured }: { configured: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        configured ? "bg-neon-green/20 text-neon-green" : "bg-ink-muted/20 text-ink-muted",
      )}
    >
      {configured ? "Configured" : "Not configured"}
    </span>
  );
}

/* -------------------------------------------------------------------------
 * 8. Admin emails (read-only)
 * ------------------------------------------------------------------------- */

function AdminEmailsCard({ emails }: { emails: string[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin emails</CardTitle>
        <CardDescription>
          Comma-separated list in the <code>ADMIN_EMAILS</code> env var. The matching
          <code>User</code> rows are auto-promoted to <code>ADMIN</code> on next sign-in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {emails.length === 0 ? (
          <p className="text-sm text-ink-muted">No admin emails configured.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {emails.map((e) => (
              <li key={e} className="flex items-center justify-between rounded-md border border-border bg-surface/40 px-3 py-2">
                <span className="font-mono">{e}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (typeof navigator !== "undefined" && navigator.clipboard) {
                      void navigator.clipboard.writeText(e).then(() => toast.success("Copied."));
                    }
                  }}
                  aria-label={`Copy ${e}`}
                >
                  Copy
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}