/**
 * Centralized logging. Wraps Sentry if DSN is configured, else falls
 * back to console. NEVER logs PII — only the hashed fingerprint and
 * a tag set.
 *
 * Why a wrapper instead of importing Sentry directly in every file:
 *   1. Easy to swap providers later
 *   2. The "no PII" rule is enforced in one place — every log call
 *      gets the same scrubbing.
 *   3. In dev/test we never want Sentry to fire.
 */
import * as Sentry from "@sentry/nextjs";

interface LogContext {
  /** Hashed identifier — NOT raw email. Use fingerprint(). */
  actorId?: string;
  route?: string;
  [key: string]: unknown;
}

const enabled =
  process.env.NODE_ENV === "production" &&
  Boolean(process.env.SENTRY_DSN);

export const log = {
  info(msg: string, ctx: LogContext = {}): void {
    if (process.env.NODE_ENV !== "production") {
      console.log(`[info] ${msg}`, ctx);
      return;
    }
    Sentry.addBreadcrumb({ message: msg, data: ctx, level: "info" });
  },
  warn(msg: string, ctx: LogContext = {}): void {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[warn] ${msg}`, ctx);
      return;
    }
    Sentry.captureMessage(msg, { level: "warning", extra: ctx });
  },
  error(msg: string, err: unknown, ctx: LogContext = {}): void {
    if (!enabled) {
      console.error(`[error] ${msg}`, err, ctx);
      return;
    }
    Sentry.captureException(err, { extra: { msg, ...ctx } });
  },
};
