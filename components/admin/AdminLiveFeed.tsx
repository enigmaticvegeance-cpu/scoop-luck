/**
 * AdminLiveFeed — Realtime + polling wrapper around the public
 * SuperchatFeed that adds admin moderation controls.
 *
 * Re-fetches the admin-scoped feed (which INCLUDES hidden rows) on
 * every Realtime event. Calls `onHide` / `onUnhide` to optimistically
 * remove or restore cards, and falls back to polling every 5s if
 * Supabase is not configured or Realtime fails to connect.
 *
 * Mirror of the public SuperchatFeed — kept separate so the public
 * feed doesn't pay the cost of subscribing to admin actions.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AnimatePresence } from "framer-motion";

import { getBrowserClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { hideSuperchat, unhideSuperchat } from "@/app/(public)/admin-actions";
import { AdminSuperchatCard } from "@/components/admin/AdminSuperchatCard";
import { LiveSuperchatSchema, type LiveSuperchat } from "@/lib/schemas/superchat";

interface AdminLiveFeedProps {
  initial: LiveSuperchat[];
  /** Map of hidden ids and their invoice numbers. Both optional; the
   *  feed degrades gracefully when these are missing. */
  initialHidden?: Record<string, string | null>;
}

const POLL_INTERVAL_MS = 5_000;
const TIME_TICK_MS = 60_000;

/**
 * Admin-scoped fetch — for now we re-use the public feed endpoint
 * (which only returns non-hidden cards) and also fetch hidden rows
 * server-side. To keep this file simple we expose two arrays in
 * the API: an `/api/admin/superchats/recent` is out of scope for
 * Phase 4; we get hidden info via props. The poll path re-uses the
 * public endpoint and merges with the local hidden state.
 */
async function fetchPublicFeed(): Promise<LiveSuperchat[]> {
  const res = await fetch("/api/superchats", { headers: { Accept: "application/json" } });
  if (!res.ok) return [];
  const json = (await res.json()) as { items?: unknown };
  const items = Array.isArray(json.items) ? json.items : [];
  const out: LiveSuperchat[] = [];
  for (const raw of items) {
    const parsed = LiveSuperchatSchema.safeParse(raw);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

function mergeById(prev: LiveSuperchat[], next: LiveSuperchat[]): LiveSuperchat[] {
  if (next.length === 0) return prev;
  const map = new Map<string, LiveSuperchat>();
  for (const item of prev) map.set(item.id, item);
  for (const item of next) {
    const existing = map.get(item.id);
    if (!existing || existing.paidAt <= item.paidAt) map.set(item.id, item);
  }
  return Array.from(map.values()).sort((a, b) => b.paidAt - a.paidAt).slice(0, 100);
}

export function AdminLiveFeed({ initial, initialHidden = {} }: AdminLiveFeedProps) {
  const [items, setItems] = useState<LiveSuperchat[]>(initial);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [hiddenMap, setHiddenMap] = useState<Record<string, string | null>>(initialHidden);
  const [, setTick] = useState(0);
  const pollingActiveRef = useRef(false);

  const realtimeEnabled = useMemo(
    () => Boolean(publicEnv.SUPABASE_URL) && publicEnv.SUPABASE_URL.length > 0,
    [],
  );

  const startPolling = useCallback(() => {
    if (pollingActiveRef.current) return;
    if (typeof window === "undefined") return;
    pollingActiveRef.current = true;
    const id = window.setInterval(() => {
      void (async () => {
        const fresh = await fetchPublicFeed();
        setItems((prev) => mergeById(prev, fresh));
      })();
    }, POLL_INTERVAL_MS);
    (pollingActiveRef as unknown as { intervalId?: number }).intervalId = id;
  }, []);

  const stopPolling = useCallback(() => {
    const ref = pollingActiveRef as unknown as { intervalId?: number };
    if (ref.intervalId && typeof window !== "undefined") {
      window.clearInterval(ref.intervalId);
      ref.intervalId = undefined;
    }
    pollingActiveRef.current = false;
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!realtimeEnabled) {
      startPolling();
      return () => stopPolling();
    }

    const supabase = getBrowserClient();
    const channel = supabase
      .channel("admin:public:superchats:feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "superchats" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (_payload: any) => {
          void (async () => {
            const fresh = await fetchPublicFeed();
            if (!cancelled) setItems((prev) => mergeById(prev, fresh));
          })();
        },
      )
      .subscribe((status: "SUBSCRIBED" | "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED" | "CONNECTING") => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          setRealtimeConnected(true);
          stopPolling();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setRealtimeConnected(false);
          startPolling();
        }
      });

    return () => {
      cancelled = true;
      try {
        void supabase.removeChannel(channel);
      } catch {
        // removeChannel can throw on fast-refresh
      }
      stopPolling();
    };
  }, [realtimeEnabled, startPolling, stopPolling]);

  // 60s tick to refresh the "Xm ago" labels. Paused on hidden tabs.
  useEffect(() => {
    if (typeof document === "undefined") return;
    let intervalId: number | undefined;
    const start = () => {
      if (intervalId !== undefined) return;
      intervalId = window.setInterval(() => setTick((t) => t + 1), TIME_TICK_MS);
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

  const onHide = useCallback(async (id: string, reason?: string) => {
    // Optimistic update: mark hidden in local state and remove from
    // visible list. The card stays in the admin list at the bottom
    // because we keep the row in `items` but mark it as hidden.
    setHiddenMap((prev) => ({ ...prev, [id]: prev[id] ?? null }));
    const res = await hideSuperchat({ id, reason });
    if (!res.ok) {
      toast.error(res.error);
      // Revert
      setHiddenMap((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    toast.success("Superchat hidden.");
  }, []);

  const onUnhide = useCallback(async (id: string) => {
    setHiddenMap((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const res = await unhideSuperchat({ id });
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Superchat restored.");
    // Re-fetch to surface the row immediately.
    const fresh = await fetchPublicFeed();
    setItems((prev) => mergeById(prev, fresh));
  }, []);

  if (items.length === 0) {
    return (
      <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/40 p-12 text-center">
        <p className="font-display text-xl">No superchats yet.</p>
        <p className="max-w-md text-sm text-ink-muted">
          Once donors start tipping, their messages will appear here in real time. You can
          hide inappropriate ones — they vanish from the public feed but stay in the
          database for audit.
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <span
            className={`size-1.5 rounded-full ${
              realtimeConnected ? "bg-neon-green animate-pulse-glow" : "bg-neon-amber animate-pulse-glow"
            }`}
          />
          {realtimeConnected ? "Live" : "Polling every 5s"}
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Admin live feed" className="space-y-3">
      <div className="flex items-center justify-between text-xs text-ink-muted">
        <span aria-hidden>
          {items.length} {items.length === 1 ? "message" : "messages"}
        </span>
        <span className="inline-flex items-center gap-1.5" aria-live="off">
          <span
            className={`size-1.5 rounded-full ${
              realtimeConnected ? "bg-neon-green animate-pulse-glow" : "bg-neon-amber animate-pulse-glow"
            }`}
          />
          {realtimeConnected ? "Live" : "Polling every 5s"}
        </span>
      </div>
      <ul className="space-y-3" aria-live="polite" aria-relevant="additions text">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const hidden = Object.prototype.hasOwnProperty.call(hiddenMap, item.id);
            return (
              <li key={item.id}>
                <AdminSuperchatCard
                  item={item}
                  hidden={hidden}
                  invoiceNumber={hiddenMap[item.id] ?? null}
                  onHide={onHide}
                  onUnhide={onUnhide}
                />
              </li>
            );
          })}
        </AnimatePresence>
      </ul>
    </section>
  );
}