"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

/**
 * Public live-feed teaser on the landing page.
 *
 * In Phase 3 this reads from `superchats` via a server action and a
 * Realtime subscription. For the Phase 1 scaffold we render a
 * placeholder so the layout is locked in.
 */
export function LandingLiveFeedTeaser() {
  const [empty, setEmpty] = useState(true);
  useEffect(() => {
    // We can't call Prisma from a client component. Hook the feed up
    // in Phase 3 via a server action or Realtime subscription.
    setEmpty(true);
  }, []);

  if (empty) {
    return (
      <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-surface/40 p-12 text-center">
        <p className="font-display text-xl">The feed lights up during live streams.</p>
        <p className="max-w-md text-sm text-ink-muted">
          Once the crew goes live, every superchat — from the small cheer to the top-tier
          sponsor splash — appears here in real time.
        </p>
        <div className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
          <span className="size-1.5 animate-pulse-glow rounded-full bg-neon-amber" />
          Realtime feed wires up in Phase 3
        </div>
      </div>
    );
  }
  return (
    <AnimatePresence>
      {/* superchat cards go here in Phase 3 */}
      <motion.div key="placeholder" />
    </AnimatePresence>
  );
}