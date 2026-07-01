/**
 * Cloudflare Turnstile widget — client component.
 *
 * Loads the Turnstile script dynamically, renders an invisible widget,
 * and surfaces the resulting token via `onChange`. The parent form
 * submits the token to the server, which calls `verifyTurnstile()`.
 *
 * We use the explicit-render API (turnstile.render) instead of the
 * auto-injected div so we can mount it lazily and clean up on unmount.
 */
"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "error-callback"?: () => void;
          "expired-callback"?: () => void;
          theme?: "light" | "dark" | "auto";
        },
      ) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  siteKey: string;
  onToken: (token: string) => void;
  /** Class for the wrapping div. */
  className?: string;
  theme?: "light" | "dark" | "auto";
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js";

function loadScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("ssr"));
    if (window.turnstile) return resolve();
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("turnstile-load-failed")), { once: true });
      return;
    }
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("turnstile-load-failed"));
    document.head.appendChild(s);
  });
}

export function TurnstileWidget({ siteKey, onToken, className, theme = "dark" }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!siteKey || !containerRef.current) return;
    let cancelled = false;

    loadScript()
      .then(() => {
        if (cancelled || !containerRef.current || !window.turnstile) return;
        // Clean up any prior widget on this container.
        if (widgetIdRef.current) {
          try {
            window.turnstile.remove(widgetIdRef.current);
          } catch {
            /* ignore */
          }
        }
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme,
          callback: (token) => {
            setError(null);
            onToken(token);
          },
          "error-callback": () => {
            setError("Captcha failed to load. Refresh and try again.");
            onToken("");
          },
          "expired-callback": () => {
            onToken("");
          },
        });
      })
      .catch(() => {
        if (!cancelled) setError("Captcha could not be loaded.");
      });

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          /* ignore */
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, theme, onToken]);

  if (!siteKey) {
    // Dev fallback — show a no-op so the layout doesn't jump.
    return (
      <div className={cn("h-[65px] w-full rounded-md border border-dashed border-border bg-elevated/40 p-3 text-xs text-ink-muted", className)}>
        Turnstile not configured — set <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div ref={containerRef} />
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}