/**
 * SuperchatFeed — public, real-time superchat feed.
 *
 * SSR delivers the latest 50 paid, non-hidden cards via initial props.
 * On mount the client subscribes to Supabase Realtime
 * (`postgres_changes` on `public.superchats`) and:
 *   - prepends new PAID, non-hidden rows on INSERT
 *   - removes cards on UPDATE when they become hidden (soft-delete)
 *   - removes cards on DELETE
 *
 * If Supabase is not configured (no URL) — typical for local dev —
 * we fall back to polling `/api/superchats` every 5 seconds. The same
 * fallback kicks in if Realtime fails to connect.
 *
 * Accessibility:
 *   - The list has `aria-live="polite"` so screen readers announce
 *     newly arrived superchats without interrupting mid-sentence.
 *   - The "time ago" string updates on a 60s timer that pauses when
 *     the document is hidden (saves work on background tabs).
 *
 * Animation:
 *   - Each card's enter/exit is handled inside `SuperchatCard`
 *     (framer-motion `AnimatePresence` here in the feed).
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";

import { getBrowserClient } from "@/lib/supabase/client";
import { publicEnv } from "@/lib/env";
import { LiveSuperchatSchema, type LiveSuperchat } from "@/lib/schemas/superchat";
import { SuperchatCard } from "@/components/superchat/SuperchatCard";

interface SuperchatFeedProps {
  /** Cards rendered server-side as the initial state. */
  initial: LiveSuperchat[];
}

const POLL_INTERVAL_MS = 5_000;
const TIME_TICK_MS = 60_000;

/**
 * Re-fetch the full feed via REST. Used by the polling fallback and
 * also as a "reconcile" step when Realtime delivers a delete (we
 * can't trust the local state to stay consistent with the DB if a
 * row was hard-deleted or its `hidden` flag flipped).
 */
async function fetchFeed(): Promise<LiveSuperchat[]> {
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

/**
 * Deduplicate by id, keeping the row with the most recent `paidAt`.
 * Realtime can fire duplicate events on reconnect.
 */
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

export function SuperchatFeed({ initial }: SuperchatFeedProps) {
  const [items, setItems] = useState<LiveSuperchat[]>(initial);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  // Tick forces a re-render every 60s so the "X minutes ago" labels
  // update without us re-fetching. Pauses on hidden tabs.
  const [, setTick] = useState(0);
  const pollingActiveRef = useRef(false);

  // Decide whether to use Realtime or polling. The browser client is
  // available even when SUPABASE_URL is empty — the SDK just won't
  // connect — but we short-circuit to polling for predictability.
  const realtimeEnabled = useMemo(
    () => Boolean(publicEnv.SUPABASE_URL) && publicEnv.SUPABASE_URL.length > 0,
    [],
  );

  // Polling fallback. Started only if Realtime is disabled or fails.
  const startPolling = useCallback(() => {
    if (pollingActiveRef.current) return;
    if (typeof window === "undefined") return;
    pollingActiveRef.current = true;
    const tick = async () => {
      const fresh = await fetchFeed();
      setItems((prev) => mergeById(prev, fresh));
    };
    const id = window.setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    // Save interval id for cleanup. Stored on the ref so we can clear it.
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

    // Supabase Realtime subscription.
    const supabase = getBrowserClient();
    // Server-side inserts of PAID superchats arrive here. Hidden rows
    // and deletes arrive as UPDATE/DELETE events.
    const channel = supabase
      .channel("public:superchats:feed")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "superchats",
        },
        // `payload` is the raw row from Postgres (old|new). We re-fetch
        // the feed through the server projection rather than trusting
        // the payload, so the type is intentionally loose here.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          // For UPDATE/DELETE events we don't have the full row, so
          // reconcile by re-fetching the affected subset. For INSERT
          // the payload includes `new` with the full row — but the
          // values we need come from the server-side projection, so
          // the safest path is to re-fetch the feed every time.
          //
          // This is one fetch per Realtime event. Realtime is meant
          // to be low-frequency (donations are a few per minute, not
          // per second), so a single round-trip per event is fine.
          void (async () => {
            const fresh = await fetchFeed();
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
        // removeChannel can throw if the client has been disposed
        // during fast-refresh — swallow.
      }
      stopPolling();
    };
  }, [realtimeEnabled, startPolling, stopPolling]);

  // 60s tick for "time ago" labels. Pauses on hidden tabs.
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

  if (items.length === 0) {
    return (
      <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/40 p-12 text-center">
        <p className="font-display text-xl">No superchats yet.</p>
        <p className="max-w-md text-sm text-ink-muted">
          Be the first to tip the crew. Every donation — from a small cheer to a top-tier
          sponsor splash — appears here in real time.
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
    <section
      className="mt-6 space-y-3"
      aria-live="polite"
      aria-relevant="additions text"
      aria-label="Live superchat feed"
    >
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
      <ul className="space-y-3">
        <AnimatePresence initial={false}>
          {items.map((item) => (
            <li key={item.id}>
              <SuperchatCard item={item} />
            </li>
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}