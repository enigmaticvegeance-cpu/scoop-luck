"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Zap, ShieldCheck, Radio } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Drop-in transition / initial pairs that respect the OS
 * "prefers-reduced-motion" setting. When `reduce` is true, content
 * snaps to its final state with zero animation; otherwise we apply the
 * handed-in `delay` and `y` offset. The global CSS
 * `prefers-reduced-motion` rule covers CSS animations / transitions
 * already; this hook is what plugs the gap on framer-motion.
 */
function useMotionVariants(reduce: boolean | null) {
  const initial = reduce ? false : { opacity: 0, y: 12 };
  const transition = reduce ? { duration: 0 } : { duration: 0.4, ease: "easeOut" as const };
  return { initial, transition };
}

interface HeroProps {
  isAuthenticated: boolean;
  displayName?: string;
}

const btnBase =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:scale-[1.02] active:scale-[0.99]";

function HeroLink({
  href,
  children,
  variant = "primary",
  size = "lg",
}: {
  href: string;
  children: React.ReactNode;
  variant?: "primary" | "ghost";
  size?: "lg";
}) {
  return (
    <Link
      href={href}
      className={cn(
        btnBase,
        size === "lg" && "h-11 px-8",
        variant === "primary" &&
          "bg-primary text-primary-foreground shadow-neon-cyan hover:bg-primary/90",
        variant === "ghost" && "hover:bg-elevated hover:text-ink",
      )}
    >
      {children}
    </Link>
  );
}

export function LandingHero({ isAuthenticated, displayName }: HeroProps) {
  const reduce = useReducedMotion();
  const v0 = useMotionVariants(reduce);
  const v1 = { ...v0, transition: reduce ? { duration: 0 } : { ...v0.transition, delay: 0.1 } };
  const v2 = { ...v0, transition: reduce ? { duration: 0 } : { ...v0.transition, delay: 0.2 } };

  return (
    <section className="relative overflow-hidden border-b border-border/40">
      <div className="container relative mx-auto flex max-w-5xl flex-col items-center px-4 py-20 text-center">
        <motion.div initial={v0.initial} animate={{ opacity: 1, y: 0 }} transition={v0.transition}>
          <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-elevated/60 px-3 py-1 text-xs text-ink-muted">
            <span className="size-1.5 animate-pulse-glow rounded-full bg-neon-cyan shadow-neon-cyan" />
            Live podcast superchats · India & international
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tight text-balance md:text-6xl">
            Tip the crew <span className="text-neon-cyan shadow-neon-cyan">directly</span>.
            <br />
            <span className="text-ink-muted">Keep your money out of the algorithm.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-pretty text-lg text-ink-muted">
            A YouTube Superchat alternative for podcasts and live streams. UPI for India,
            cards and PayPal for the rest of the world. Your message lands on screen in seconds.
          </p>
        </motion.div>

        <motion.div
          initial={v0.initial}
          animate={{ opacity: 1, y: 0 }}
          transition={v1.transition}
          className="mt-8 flex flex-col items-center gap-3 sm:flex-row"
        >
          {isAuthenticated ? (
            <>
              <HeroLink href="/superchat">
                Send a superchat <ArrowRight className="size-4" />
              </HeroLink>
              <span className="text-sm text-ink-muted">
                Signed in as <span className="font-medium text-ink">{displayName}</span>
              </span>
            </>
          ) : (
            <>
              <HeroLink href="/register">
                Create an account <ArrowRight className="size-4" />
              </HeroLink>
              <HeroLink href="/login" variant="ghost">
                Sign in
              </HeroLink>
            </>
          )}
        </motion.div>

        <motion.ul
          initial={v0.initial}
          animate={{ opacity: 1, y: 0 }}
          transition={v2.transition}
          className="mt-16 grid w-full grid-cols-1 gap-4 text-left sm:grid-cols-3"
        >
          <li className="glass flex items-start gap-3 rounded-xl p-4">
            <Zap className="mt-0.5 size-5 text-neon-cyan" />
            <div>
              <p className="font-medium">Instant on-screen</p>
              <p className="text-sm text-ink-muted">Superchats appear in the live feed the moment payment clears.</p>
            </div>
          </li>
          <li className="glass flex items-start gap-3 rounded-xl p-4">
            <ShieldCheck className="mt-0.5 size-5 text-neon-green" />
            <div>
              <p className="font-medium">Verified webhooks</p>
              <p className="text-sm text-ink-muted">Every payment is verified server-side before it lands on screen.</p>
            </div>
          </li>
          <li className="glass flex items-start gap-3 rounded-xl p-4">
            <Radio className="mt-0.5 size-5 text-neon-purple" />
            <div>
              <p className="font-medium">Multi-gateway</p>
              <p className="text-sm text-ink-muted">Razorpay, Stripe, PayPal — the right rails for wherever you are.</p>
            </div>
          </li>
        </motion.ul>
      </div>

      <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(0,255,255,0.08),transparent_50%)]" />
    </section>
  );
}