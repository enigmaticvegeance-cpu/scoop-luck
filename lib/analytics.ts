/**
 * Server-only aggregations + list queries backing the admin tabs.
 *
 * Every export here is "use server"-friendly — it talks to Prisma
 * directly, returns plain JSON-serializable shapes, and never logs
 * PII. Helpers used by the All-superchats page also live here so the
 * page can stay declarative.
 */
import "server-only";

import { prisma } from "@/lib/prisma";
import type { SuperchatFilterInput, AuthEventFilterInput } from "@/lib/schemas/admin";
import { buildSuperchatWhere } from "@/lib/superchat-where";

/* -------------------------------------------------------------------------
 * Shapes
 * ------------------------------------------------------------------------- */

export interface RevenueSummary {
  /** Total PAID superchats in INR paise. */
  totalInrPaise: number;
  /** Total PAID superchats in USD cents (sum of `amountPaise` where
   *  the row's `currency = USD`). */
  totalUsdCents: number;
  /** Count of paid superchats. */
  totalCount: number;
  /** Average donation in INR paise. */
  avgInrPaise: number;
  /** Distribution by tier (1..6). Missing tiers are 0. */
  byTier: Array<{ tier: number; count: number; totalInrPaise: number }>;
  /** Distribution by gateway. */
  byGateway: Array<{ gateway: "RAZORPAY" | "STRIPE" | "PAYPAL"; count: number; totalInrPaise: number }>;
  /** Daily series for the last `days` days, oldest first. */
  daily: Array<{ date: string; count: number; totalInrPaise: number }>;
}

export interface TopDonor {
  displayName: string;
  avatarUrl: string | null;
  tipCount: number;
  totalInrPaise: number;
}

export interface SuperchatListItem {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  message: string;
  amountPaise: number;
  currency: "INR" | "USD";
  inrEquivalentPaise: number;
  tier: number;
  gateway: "RAZORPAY" | "STRIPE" | "PAYPAL";
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  hidden: boolean;
  paidAt: Date | null;
  createdAt: Date;
  invoiceNumber: string | null;
}

export interface SuperchatListResult {
  items: SuperchatListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/* -------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------- */

const PER_PAGE = 25;

// Re-export the pure where-builder so existing callers stay happy.
export { buildSuperchatWhere };

/* -------------------------------------------------------------------------
 * List (All-superchats table)
 * ------------------------------------------------------------------------- */

export async function listSuperchats(filter: SuperchatFilterInput): Promise<SuperchatListResult> {
  const where = buildSuperchatWhere(filter);
  const page = filter.page ?? 1;

  const [rows, total] = await Promise.all([
    prisma.superchat.findMany({
      where,
      orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * PER_PAGE,
      take: PER_PAGE,
      select: {
        id: true,
        displayName: true,
        avatarUrl: true,
        message: true,
        amountPaise: true,
        currency: true,
        inrEquivalentPaise: true,
        tier: true,
        gateway: true,
        status: true,
        hidden: true,
        paidAt: true,
        createdAt: true,
        invoiceNumber: true,
      },
    }),
    prisma.superchat.count({ where }),
  ]);

  const items: SuperchatListItem[] = rows.map((r) => ({
    id: r.id,
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    message: r.message,
    amountPaise: r.amountPaise,
    currency: r.currency === "USD" ? "USD" : "INR",
    inrEquivalentPaise: r.inrEquivalentPaise,
    tier: r.tier,
    gateway: r.gateway,
    status: r.status,
    hidden: r.hidden,
    paidAt: r.paidAt,
    createdAt: r.createdAt,
    invoiceNumber: r.invoiceNumber,
  }));

  return {
    items,
    total,
    page,
    perPage: PER_PAGE,
    totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
  };
}

/* -------------------------------------------------------------------------
 * Analytics aggregations
 * ------------------------------------------------------------------------- */

/**
 * Build a revenue summary covering all PAID superchats. The chart
 * data is for the last 30 days.
 *
 * The aggregations are intentionally narrow: we keep each query small
 * so Prisma's prepared-statement cache hits and so the dashboard
 * stays fast even with millions of rows. For a deep history, this
 * should run against a materialized view (Phase 5).
 */
export async function getRevenueSummary(days = 30): Promise<RevenueSummary> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  const [totals, byTierRaw, byGatewayRaw, dailyRaw] = await Promise.all([
    prisma.superchat.aggregate({
      where: { status: "PAID" },
      _count: { _all: true },
      _sum: { inrEquivalentPaise: true, amountPaise: true },
    }),
    prisma.superchat.groupBy({
      by: ["tier"],
      where: { status: "PAID" },
      _count: { _all: true },
      _sum: { inrEquivalentPaise: true },
    }),
    prisma.superchat.groupBy({
      by: ["gateway"],
      where: { status: "PAID" },
      _count: { _all: true },
      _sum: { inrEquivalentPaise: true },
    }),
    prisma.superchat.findMany({
      where: { status: "PAID", paidAt: { gte: since } },
      select: { paidAt: true, inrEquivalentPaise: true },
    }),
  ]);

  // Tier distribution. Pre-fill 1..6 so the chart shows empty slots.
  const byTier = Array.from({ length: 6 }, (_, i) => ({
    tier: i + 1,
    count: 0,
    totalInrPaise: 0,
  }));
  for (const row of byTierRaw) {
    if (row.tier >= 1 && row.tier <= 6) {
      byTier[row.tier - 1] = {
        tier: row.tier,
        count: row._count._all,
        totalInrPaise: row._sum.inrEquivalentPaise ?? 0,
      };
    }
  }

  // Gateway distribution, ordered by count desc.
  const byGateway = byGatewayRaw
    .map((row) => ({
      gateway: row.gateway,
      count: row._count._all,
      totalInrPaise: row._sum.inrEquivalentPaise ?? 0,
    }))
    .sort((a, b) => b.count - a.count);

  // Build the daily series. Pre-fill all days so the chart x-axis is
  // continuous even if no donations landed on a given day.
  const dailyMap = new Map<string, { count: number; totalInrPaise: number }>();
  for (const row of dailyRaw) {
    if (!row.paidAt) continue;
    const key = row.paidAt.toISOString().slice(0, 10); // YYYY-MM-DD
    const cur = dailyMap.get(key) ?? { count: 0, totalInrPaise: 0 };
    cur.count += 1;
    cur.totalInrPaise += row.inrEquivalentPaise;
    dailyMap.set(key, cur);
  }
  const daily: RevenueSummary["daily"] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(since);
    d.setUTCDate(d.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const cur = dailyMap.get(key);
    daily.push({
      date: key,
      count: cur?.count ?? 0,
      totalInrPaise: cur?.totalInrPaise ?? 0,
    });
  }

  const totalInrPaise = totals._sum.inrEquivalentPaise ?? 0;
  const totalCount = totals._count._all;
  // USD total: rows with `currency = USD` carry the raw amount in
  // cents; we sum separately to avoid double-counting INR. (For
  // gateway grouping we already mixed both currencies into one INR
  // equivalent bucket; the per-currency total is what shows on the
  // KPI tile.)
  const usdSum = await prisma.superchat.aggregate({
    where: { status: "PAID", currency: "USD" },
    _sum: { amountPaise: true },
  });

  return {
    totalInrPaise,
    totalUsdCents: usdSum._sum.amountPaise ?? 0,
    totalCount,
    avgInrPaise: totalCount > 0 ? Math.round(totalInrPaise / totalCount) : 0,
    byTier,
    byGateway,
    daily,
  };
}

/**
 * Top donors by total INR-equivalent amount, grouped by display
 * name. Anonymous tips (no userId) are kept in the grouping using
 * whatever display name the donor typed at the form.
 */
export async function getTopDonors(limit = 10): Promise<TopDonor[]> {
  const rows = await prisma.superchat.groupBy({
    by: ["displayName", "avatarUrl"],
    where: { status: "PAID" },
    _count: { _all: true },
    _sum: { inrEquivalentPaise: true },
    orderBy: { _sum: { inrEquivalentPaise: "desc" } },
    take: limit,
  });

  return rows.map((r) => ({
    displayName: r.displayName,
    avatarUrl: r.avatarUrl,
    tipCount: r._count._all,
    totalInrPaise: r._sum.inrEquivalentPaise ?? 0,
  }));
}

/* -------------------------------------------------------------------------
 * AuthEvent audit listing
 * ------------------------------------------------------------------------- */

export interface AuthEventListItem {
  id: string;
  actorEmail: string;
  kind: "ROLE_CHANGE" | "FIRST_LOGIN";
  fromRole: "VIEWER" | "ADMIN" | null;
  toRole: "VIEWER" | "ADMIN";
  createdAt: Date;
}

export interface AuthEventListResult {
  items: AuthEventListItem[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

/**
 * List AuthEvent rows newest-first with pagination + filters.
 *
 * No PII filtering — the actorEmail column IS the data this page is
 * about. The viewer is admin-only (enforced at the layout level), so
 * showing emails is fine.
 *
 * Note: we deliberately limit the per-page count (50) because the
 * table is dense and a misconfigured filter shouldn't load 10,000 rows.
 */
export async function listAuthEvents(
  filter: AuthEventFilterInput,
): Promise<AuthEventListResult> {
  const where: { kind?: "ROLE_CHANGE" | "FIRST_LOGIN"; actorEmail?: { contains: string; mode: "insensitive" } } = {};
  if (filter.kind) where.kind = filter.kind;
  if (filter.email) {
    // Postgres `contains` is case-insensitive when paired with `mode: "insensitive"`.
    // We lowercase the email in getCurrentUser, so a case-mixed query would miss —
    // normalize here too.
    where.actorEmail = { contains: filter.email.toLowerCase(), mode: "insensitive" };
  }

  const page = Math.max(1, filter.page ?? 1);
  const perPage = 50;

  const [rows, total] = await Promise.all([
    prisma.authEvent.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      skip: (page - 1) * perPage,
      take: perPage,
      select: {
        id: true,
        actorEmail: true,
        kind: true,
        fromRole: true,
        toRole: true,
        createdAt: true,
      },
    }),
    prisma.authEvent.count({ where }),
  ]);

  return {
    items: rows,
    total,
    page,
    perPage,
    totalPages: Math.max(1, Math.ceil(total / perPage)),
  };
}