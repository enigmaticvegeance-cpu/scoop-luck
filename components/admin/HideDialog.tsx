/**
 * HideDialog — small confirmation dialog used to hide or unhide a
 * superchat. Reused by both the live feed and the All-superchats
 * table.
 *
 * Submit is wired to the parent via `onConfirm(reason)`. The
 * dialog manages its own loading state and disables the controls
 * while the action is in flight so accidental double-clicks can't
 * fire two moderation actions.
 *
 * Accessibility:
 *   - `role="dialog"`, `aria-modal="true"`, `aria-labelledby="title"`.
 *   - Initial focus moves to the reason textarea when opened.
 *   - ESC closes the dialog (skipped while a server action is pending
 *     so the loader stays visible and not interruptible).
 *   - Tab is trapped between the first and last focusable descendants.
 *   - Click on the dim backdrop closes the dialog.
 *
 * The focus trap is hand-rolled (rather than `focus-trap-react` /
 * Radix Dialog) to keep deps flat; pattern mirrors
 * `components/profile/AvatarCropper.tsx`.
 */
"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface HideDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string | undefined) => void;
  /** "Hide" or "Unhide" — drives the copy and tone. */
  mode: "hide" | "unhide";
  /** When true, show a banner that this card is already hidden. */
  alreadyHidden?: boolean;
}

const REASON_MAX = 500;
// CSS selector for focusable descendants of the dialog container.
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function HideDialog({ open, onClose, onConfirm, mode, alreadyHidden }: HideDialogProps) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const titleId = useId();
  const dialogRef = useRef<HTMLFormElement>(null);
  const reasonRef = useRef<HTMLInputElement>(null);
  // Remember which element opened the dialog so we can restore focus on close.
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // ESC + initial focus + Tab trap.
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = dialogRef.current;
    if (!dialog) return;

    // Initial focus: the reason textarea when in hide mode, the submit
    // button otherwise. Defer one frame so the browser has committed
    // the dialog to the DOM.
    const initialFocusFrame = requestAnimationFrame(() => {
      if (mode === "hide") {
        reasonRef.current?.focus();
        reasonRef.current?.select();
      } else {
        dialog.querySelector<HTMLButtonElement>("button[type=submit]")?.focus();
      }
    });

    const onKeyDown = (e: KeyboardEvent) => {
      if (pending) return; // Don't disturb a server action in flight.
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      // Trap Tab inside the dialog.
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      cancelAnimationFrame(initialFocusFrame);
      document.removeEventListener("keydown", onKeyDown);
      // Restore focus to the element that opened the dialog.
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, mode, pending, onClose]);

  const onSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = reason.trim();
      start(async () => {
        onConfirm(trimmed.length > 0 ? trimmed : undefined);
      });
    },
    [reason, onConfirm],
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={(e) => {
        // Backdrop click closes; ignore clicks that bubbled up from inside
        // the dialog (the <form> below swallows them via stopPropagation).
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <form
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onSubmit={onSubmit}
        className="w-full max-w-md space-y-4 rounded-xl border border-border bg-surface p-6 shadow-2xl"
      >
        <h2 id={titleId} className="font-display text-lg font-semibold">
          {mode === "hide" ? "Hide superchat" : "Restore superchat"}
        </h2>
        <p className="text-sm text-ink-muted">
          {mode === "hide"
            ? "The card is removed from the public feed immediately. The row is never deleted — financial records persist."
            : "The card reappears on the public feed. Existing clients see it on their next poll or Realtime event."}
        </p>
        {alreadyHidden ? (
          <Alert>
            <AlertDescription>This superchat is already hidden. Restoring will make it visible again.</AlertDescription>
          </Alert>
        ) : null}
        {mode === "hide" ? (
          <div>
            <label htmlFor="hide-reason" className="text-sm font-medium">
              Reason <span className="text-ink-muted">(optional, max {REASON_MAX} chars)</span>
            </label>
            <Input
              id="hide-reason"
              ref={reasonRef}
              type="text"
              maxLength={REASON_MAX}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. spam, off-topic, hate speech"
              className="mt-1"
              autoComplete="off"
            />
            <p className="mt-1 text-xs text-ink-muted tabular-nums" aria-live="off">
              {reason.length}/{REASON_MAX}
            </p>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant={mode === "hide" ? "destructive" : "default"} disabled={pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {mode === "hide" ? "Hide" : "Restore"}
          </Button>
        </div>
      </form>
    </div>
  );
}
