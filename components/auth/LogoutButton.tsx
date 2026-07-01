"use client";

import { useTransition } from "react";
import { LogOut } from "lucide-react";

import { logoutAction } from "@/app/(public)/auth-actions";
import { cn } from "@/lib/utils";

export function LogoutButton({ className }: { className?: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      onClick={() => {
        start(async () => {
          await logoutAction();
        });
      }}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink disabled:opacity-50",
        className,
      )}
      aria-label="Sign out"
    >
      <LogOut className="size-4" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}