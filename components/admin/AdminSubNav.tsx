/**
 * AdminSubNav — the chrome strip across the top of every dashboard
 * tab. Renders the four-tab nav, a manual Refresh control with a
 * "last refreshed Xs ago" indicator, and a logout button.
 *
 * The "last refreshed" timer is a client-side interval seeded from
 * a server-rendered `now` (passed as a prop from a server component
 * parent). It pauses when the document is hidden, matching the
 * pattern used in SuperchatFeed.
 */
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { LogOut, RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { adminLogoutAction } from "@/app/(public)/admin-actions";

interface AdminSubNavProps {
  /** Server-rendered "now" timestamp (ms since epoch) so the
   *  "last refreshed" label is correct on first render. */
  serverNow?: number;
}

const TABS: Array<{ href: string; label: string; match: (path: string) => boolean }> = [
  { href: "/admin", label: "Live feed", match: (p) => p === "/admin" },
  { href: "/admin/superchats", label: "All superchats", match: (p) => p.startsWith("/admin/superchats") },
  { href: "/admin/analytics", label: "Analytics", match: (p) => p.startsWith("/admin/analytics") },
  { href: "/admin/audit", label: "Audit log", match: (p) => p.startsWith("/admin/audit") },
  { href: "/admin/settings", label: "Settings", match: (p) => p.startsWith("/admin/settings") },
];

/** Render a compact "Xs ago" / "Xm ago" / "Xh ago" string. */
function timeAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export function AdminSubNav({ serverNow }: AdminSubNavProps) {
  const pathname = usePathname() ?? "/admin";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [lastRefreshed, setLastRefreshed] = useState<number>(serverNow ?? Date.now());
  // Tick forces a re-render every second. Pauses on hidden tabs.
  const [, setTick] = useState(0);

  const onRefresh = useCallback(() => {
    start(() => {
      // `router.refresh()` re-runs every server component under the
      // current layout; that's the only state we need to bump.
      router.refresh();
      setLastRefreshed(Date.now());
    });
  }, [router]);

  const onLogout = useCallback(() => {
    start(async () => {
      try {
        await adminLogoutAction();
        // adminLogoutAction redirects on success; this line only
        // runs on a thrown error.
        toast.error("Could not sign out. Please try again.");
      } catch {
        // Redirect from the server action throws NEXT_REDIRECT;
        // that's the success path.
      }
    });
  }, []);

  // 1s tick for the "X seconds ago" label, paused on hidden tabs.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let intervalId: number | undefined;
    const start = () => {
      if (intervalId !== undefined) return;
      intervalId = window.setInterval(() => setTick((t) => t + 1), 1000);
    };
    const stop = () => {
      if (intervalId !== undefined) {
        window.clearInterval(intervalId);
        intervalId = undefined;
      }
    };
    const onVis = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // Don't expose an inaccurate "0s ago" flash on the very first
  // render — only show the relative time once a tick has fired.
  const tickCount = useMemo(() => lastRefreshed, [lastRefreshed]);
  const nowForLabel = useMemo(() => {
    // If we have a server-rendered `now` AND no tick has fired yet,
    // use it. Otherwise just use Date.now().
    if (typeof window === "undefined") return lastRefreshed;
    return Date.now();
  }, [lastRefreshed, tickCount]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <nav
        aria-label="Admin sections"
        className="flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface/40 p-1"
      >
        {TABS.map((tab) => {
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-primary text-primary-foreground shadow-neon-cyan"
                  : "text-ink-muted hover:bg-elevated hover:text-ink",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-3">
        <span
          className="text-xs text-ink-muted tabular-nums"
          aria-live="polite"
          aria-label={`Last refreshed ${timeAgo(lastRefreshed, nowForLabel)}`}
        >
          Last refreshed: {timeAgo(lastRefreshed, nowForLabel)}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onRefresh}
          disabled={pending}
          aria-label="Refresh"
        >
          <RefreshCw className={cn("size-4", pending && "animate-spin")} aria-hidden />
          Refresh
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onLogout}
          disabled={pending}
          aria-label="Sign out"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </Button>
      </div>
    </div>
  );
}