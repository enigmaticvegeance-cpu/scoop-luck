/**
 * AdminSuperchatCard — wraps the public SuperchatCard with admin
 * moderation controls.
 *
 * - If the card is hidden, it renders with a "Hidden" overlay so the
 *   admin can see what they hid and unhide it from the same place.
 * - Otherwise it shows Hide / View Invoice controls in the corner.
 *
 * The actual moderation actions live in the parent so the same
 * card component works in both the live feed and the All-superchats
 * table.
 */
"use client";

import { useState } from "react";
import { Eye, EyeOff, FileText } from "lucide-react";

import { SuperchatCard } from "@/components/superchat/SuperchatCard";
import { Button } from "@/components/ui/button";
import { HideDialog } from "@/components/admin/HideDialog";
import type { LiveSuperchat } from "@/lib/schemas/superchat";

interface AdminSuperchatCardProps {
  item: LiveSuperchat;
  hidden?: boolean;
  invoiceNumber?: string | null;
  onHide: (id: string, reason?: string) => void;
  onUnhide: (id: string) => void;
}

export function AdminSuperchatCard({
  item,
  hidden = false,
  invoiceNumber,
  onHide,
  onUnhide,
}: AdminSuperchatCardProps) {
  const [dialogMode, setDialogMode] = useState<"hide" | "unhide" | null>(null);

  const invoiceHref = invoiceNumber
    ? `/api/invoices/${encodeURIComponent(item.id)}/download`
    : null;

  return (
    <div className="relative">
      <div className={hidden ? "opacity-60" : undefined}>
        <SuperchatCard item={item} />
      </div>
      {/* Top-left overlay: hidden badge. */}
      {hidden ? (
        <div className="absolute left-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive-foreground">
          <EyeOff className="size-3" aria-hidden /> Hidden
        </div>
      ) : null}
      {/* Bottom-right overlay: admin toolbar. Always visible. */}
      <div className="absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-full bg-elevated/85 p-1 shadow-md backdrop-blur">
        {hidden ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDialogMode("unhide")}
            aria-label="Restore this superchat"
          >
            <Eye className="size-3.5" aria-hidden /> Restore
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setDialogMode("hide")}
            aria-label="Hide this superchat"
            className="text-destructive hover:bg-destructive/15"
          >
            <EyeOff className="size-3.5" aria-hidden /> Hide
          </Button>
        )}
        {invoiceHref ? (
          <a
            href={invoiceHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-9 items-center justify-center gap-1 rounded-md px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label="View invoice"
          >
            <FileText className="size-3.5" aria-hidden /> Invoice
          </a>
        ) : null}
      </div>
      <HideDialog
        open={dialogMode !== null}
        mode={dialogMode ?? "hide"}
        alreadyHidden={hidden && dialogMode === "unhide"}
        onClose={() => setDialogMode(null)}
        onConfirm={(reason) => {
          if (dialogMode === "hide") onHide(item.id, reason);
          else onUnhide(item.id);
          setDialogMode(null);
        }}
      />
    </div>
  );
}