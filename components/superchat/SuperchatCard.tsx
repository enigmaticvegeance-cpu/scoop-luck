/**
 * SuperchatCard — single donation card for the live feed.
 *
 * Visual rules (per spec):
 *   - Tier accent border + neon glow via `tier-glow-*` classes
 *   - Tier 6 (Top Fan) gets the animated gold border
 *   - Tier 5+ (Featured and above) cards display a "pinned" badge
 *     because the platform pins high-value tips for ~60–120s
 *   - Avatar: 48px circle, gradient placeholder if missing
 *   - Display name, amount + tier badge, message, time-ago
 *   - Message is plain text in a `<p>` — NEVER dangerouslySetInnerHTML
 *
 * Animation:
 *   - On mount: framer-motion fades + slides up with spring easing
 *   - `prefers-reduced-motion`: animations collapse to a no-op via the
 *     `@media (prefers-reduced-motion)` rule in globals.css
 *
 * Accessibility:
 *   - Each card is an `<article>` with a hidden `<h2>` naming the donor
 *   - Time-ago uses `aria-label` so screen readers don't read "2m" as "2M"
 */
"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Pin, Sparkles } from "lucide-react";

import { TIERS, type TierConfig } from "@/lib/tier";
import type { LiveSuperchat } from "@/lib/schemas/superchat";
import { formatAmountLabel } from "@/lib/schemas/superchat";
import { cn } from "@/lib/utils";

interface SuperchatCardProps {
  /** The live card to render. */
  item: LiveSuperchat;
  /** If true, the card is currently "pinned" — show the pin badge. */
  pinned?: boolean;
}

const PIN_TIER_THRESHOLD = 5;

function tierFor(tierNumber: number): TierConfig {
  // The schema's tier is 1..6 (server-verified). Defensive lookup so a
  // corrupted row doesn't crash the feed.
  return TIERS.find((t) => t.tier === tierNumber) ?? TIERS[TIERS.length - 1]!;
}

/**
 * Render "time ago" without a date-fns import — the table is small
 * enough that a manual cascade is clearer than a dependency.
 */
function timeAgo(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month}mo ago`;
  const year = Math.floor(day / 365);
  return `${year}y ago`;
}

/**
 * Build a deterministic gradient placeholder from the donor's id so
 * the same person always gets the same hue. Cheap, no extra assets.
 */
function gradientFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue1 = h % 360;
  const hue2 = (hue1 + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue1} 70% 35%), hsl(${hue2} 70% 25%))`;
}

export function SuperchatCard({ item, pinned = false }: SuperchatCardProps) {
  const tier = tierFor(item.tier);
  const amount = formatAmountLabel(item);
  const initial = item.displayName.trim().charAt(0).toUpperCase() || "•";
  const isPinned = pinned || item.tier >= PIN_TIER_THRESHOLD;
  const now = Date.now();
  const reduce = useReducedMotion();

  return (
    <motion.article
      layout
      initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98 }}
      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 24 }}
      className={cn(
        "glass relative flex flex-col gap-3 overflow-hidden rounded-xl p-4",
        // Tier 6 (Top Fan) gets the gold animated border via the
        // existing globals.css `.tier-glow-gold` class. Other tiers
        // get a static glow keyed to their accent color.
        item.tier === 6 ? "tier-glow-gold" : tier.glowClass,
      )}
      style={{
        // CSS variable consumed by the `.tier-glow-*` classes. Layered
        // border so the static tiers get a thin accent edge too.
        borderColor: tier.accentColor,
      }}
      aria-label={`${item.displayName} donated ${amount}`}
    >
      {/* Pinned badge for Featured / Top Fan */}
      {isPinned ? (
        <div
          className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-elevated/70 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide backdrop-blur"
          style={{ color: tier.accentColor }}
          aria-label="Pinned to top of feed"
        >
          <Pin className="size-3" aria-hidden /> Pinned
        </div>
      ) : null}

      <header className="flex items-center gap-3">
        {item.avatarUrl ? (
          // The browser fetches the avatar. `referrerPolicy="no-referrer"`
          // and `crossOrigin` are omitted; signed Supabase URLs don't
          // require them. Note: this URL is whatever the server-side
          // webhook persisted, which is the post-`sharp`-encoded image.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.avatarUrl}
            alt=""
            width={48}
            height={48}
            className="size-12 shrink-0 rounded-full border-2 object-cover"
            style={{ borderColor: tier.accentColor }}
            loading="lazy"
            decoding="async"
          />
        ) : (
          <div
            className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 text-base font-semibold uppercase text-white"
            style={{
              borderColor: tier.accentColor,
              background: gradientFor(item.id),
            }}
            aria-hidden
          >
            {initial}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="sr-only">{item.displayName}</h2>
          <p className="truncate text-sm font-medium" title={item.displayName}>
            {item.displayName}
          </p>
          <div className="mt-0.5 flex items-center gap-2">
            <span
              className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
              style={{
                color: tier.accentColor,
                borderColor: tier.accentColor,
                borderWidth: 1,
              }}
            >
              <Sparkles className="mr-1 size-3" aria-hidden /> {tier.label}
            </span>
            <span className="text-xs text-ink-muted" aria-label={`Donated ${amount}`}>
              {amount}
            </span>
          </div>
        </div>
      </header>

      {/* Message — plain-text <p>. The message was sanitized server-side
          before persisting (sanitizeMessage in lib/security.ts). React
          renders text content safely; we never use dangerouslySetInnerHTML. */}
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-ink">
        {item.message}
      </p>

      <footer className="flex items-center justify-between text-[11px] text-ink-muted">
        <time dateTime={new Date(item.paidAt).toISOString()} aria-label={new Date(item.paidAt).toLocaleString()}>
          {timeAgo(item.paidAt, now)}
        </time>
      </footer>
    </motion.article>
  );
}

/**
 * Pure helper exported for tests / debugging.
 */
export const _internal = { timeAgo, gradientFor, tierFor };