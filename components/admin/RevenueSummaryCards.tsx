/**
 * RevenueSummaryCards — four KPI tiles at the top of the analytics
 * dashboard. Server-rendered (no client JS) so they're SSR-fast and
 * indexable for future SEO/admin tools.
 */
import { Card, CardContent } from "@/components/ui/card";
import { TIERS } from "@/lib/tier";
import type { RevenueSummary } from "@/lib/analytics";

interface Props {
  summary: RevenueSummary;
}

const INR_FORMAT = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const USD_FORMAT = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const INTEGER_FORMAT = new Intl.NumberFormat("en-IN");

export function RevenueSummaryCards({ summary }: Props) {
  const topTier = summary.byTier.reduce(
    (acc, t) => (t.totalInrPaise > acc.totalInrPaise ? t : acc),
    { tier: 0, totalInrPaise: 0, count: 0 },
  );
  const topTierConfig = TIERS.find((t) => t.tier === topTier.tier);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="space-y-1 p-5">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Total revenue</p>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {INR_FORMAT.format(summary.totalInrPaise / 100)}
          </p>
          {summary.totalUsdCents > 0 ? (
            <p className="text-xs text-ink-muted">
              + {USD_FORMAT.format(summary.totalUsdCents / 100)} USD
            </p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-5">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Total superchats</p>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {INTEGER_FORMAT.format(summary.totalCount)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-5">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Avg donation</p>
          <p className="font-display text-2xl font-semibold tabular-nums">
            {INR_FORMAT.format(summary.avgInrPaise / 100)}
          </p>
          <p className="text-xs text-ink-muted">INR equivalent</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="space-y-1 p-5">
          <p className="text-xs uppercase tracking-wide text-ink-muted">Top tier</p>
          <p className="font-display text-2xl font-semibold">
            {topTier.tier > 0 ? `Tier ${topTier.tier}` : "—"}
          </p>
          <p className="text-xs text-ink-muted" style={{ color: topTierConfig?.accentColor }}>
            {topTierConfig?.label ?? "no donations yet"}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}