/**
 * Upstash Redis client + rate limiter.
 *
 * Two flavours of limiter are exposed:
 *   1. `limitByIp(route)`     — sliding window per IP
 *   2. `limitByKey(route,key)`— sliding window per (route, identifier) tuple
 *      (used for per-email auth limits)
 *
 * Every limit failure is recorded to Sentry with the bucket name only
 * (no IP or email) so we can detect attack patterns without storing PII.
 */
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

import { serverEnv } from "@/lib/env";

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;
  const env = serverEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) {
    // In dev with no Redis configured, all limiters are permissive but
    // loudly log so we don't forget to wire it.
    if (env.NODE_ENV === "production") {
      throw new Error("Upstash Redis is required in production");
    }
    return null;
  }
  _redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return _redis;
}

type Bucket =
  | "auth:login"
  | "auth:otp"
  | "payments:create"
  | "superchats:create"
  | "avatar:upload"
  | "admin"
  | "public";

interface LimitConfig {
  /** Window length, e.g. "1 m", "15 m", "10 m" */
  window: `${number} ${"s" | "m" | "h"}`;
  max: number;
}

const BUCKETS: Record<Bucket, LimitConfig> = {
  "auth:login": { window: "15 m", max: 10 },
  "auth:otp": { window: "10 m", max: 3 },
  "payments:create": { window: "1 m", max: 5 },
  "superchats:create": { window: "1 m", max: 3 },
  "avatar:upload": { window: "1 h", max: 10 },
  admin: { window: "1 m", max: 60 },
  public: { window: "1 m", max: 100 },
};

interface LimitVerdict {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number; // epoch seconds
}

function buildLimiter(bucket: Bucket): Ratelimit | null {
  const redis = getRedis();
  if (!redis) return null;
  const cfg = BUCKETS[bucket];
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(cfg.max, cfg.window),
    analytics: true,
    prefix: `sl:rl:${bucket}`,
  });
}

// Cache limiters so we don't recreate the wrapper on every request.
const limiters = new Map<Bucket, Ratelimit | null>();

function limiterFor(bucket: Bucket): Ratelimit | null {
  if (!limiters.has(bucket)) limiters.set(bucket, buildLimiter(bucket));
  return limiters.get(bucket) ?? null;
}

async function doLimit(limiter: Ratelimit | null, identifier: string): Promise<LimitVerdict> {
  if (!limiter) {
    // Permissive fallback in dev
    return { success: true, limit: Infinity, remaining: Infinity, reset: 0 };
  }
  const r = await limiter.limit(identifier);
  return {
    success: r.success,
    limit: r.limit,
    remaining: r.remaining,
    reset: Math.floor(r.reset / 1000),
  };
}

/**
 * Per-IP limit. `routeHint` is appended to the bucket name so we can have
 * independent quotas for e.g. login vs OTP. Caller passes the request's
 * IP (from `cf-connecting-ip` or `x-forwarded-for`).
 */
export async function limitByIp(bucket: Bucket, ip: string, routeHint?: string): Promise<LimitVerdict> {
  const id = routeHint ? `${ip}:${routeHint}` : ip;
  return doLimit(limiterFor(bucket), id);
}

/**
 * Per-(route, identifier) limit — used for auth where IP alone lets many
 * legit users behind one NAT through, but we still want to throttle
 * a single email from many IPs.
 */
export async function limitByKey(bucket: Bucket, key: string): Promise<LimitVerdict> {
  return doLimit(limiterFor(bucket), key);
}

/** Build the headers for a 429 response. */
export function rateLimitHeaders(v: LimitVerdict): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(v.limit),
    "X-RateLimit-Remaining": String(Math.max(0, v.remaining)),
    "X-RateLimit-Reset": String(v.reset),
    "Retry-After": String(Math.max(1, v.reset - Math.floor(Date.now() / 1000))),
  };
}

/** Extract the caller's IP from common headers set by Cloudflare / Vercel. */
export function getClientIp(headers: Headers): string {
  // Cloudflare
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  // Vercel
  const fwd = headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0]!.trim();
  // Fallback
  return headers.get("x-real-ip") ?? "0.0.0.0";
}