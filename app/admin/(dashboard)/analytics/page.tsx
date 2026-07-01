/**
 * /admin/analytics — revenue + count breakdown.
 *
 * Server-fetches the aggregations and renders:
 *   - 4 KPI tiles (total revenue, total count, avg donation, top tier)
 *   - 3 recharts panels (tier distribution, gateway distribution,
 *     last-30-days daily revenue)
 *   - top donors table
 */
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { getRevenueSummary, getTopDonors } from "@/lib/analytics";
import { RevenueSummaryCards } from "@/components/admin/RevenueSummaryCards";
import { AnalyticsCharts } from "@/components/admin/AnalyticsCharts";
import { TopDonors } from "@/components/admin/TopDonors";

export const dynamic = "force-dynamic";

export default async function AdminAnalyticsPage() {
  const ctx = await getCurrentUser();
  if (!ctx || ctx.user.role !== "ADMIN") {
    redirect("/admin/login");
  }

  const [summary, topDonors] = await Promise.all([
    getRevenueSummary(30),
    getTopDonors(10),
  ]);

  return (
    <section className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Paid superchats only. Daily series covers the last 30 days. All amounts in
          INR (paise) unless a USD payment is shown separately.
        </p>
      </header>
      <RevenueSummaryCards summary={summary} />
      {summary.totalCount === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-12 text-center">
          <p className="font-display text-lg">No data yet</p>
          <p className="mt-2 text-sm text-ink-muted">
            Once a few superchats come in, you'll see tier / gateway / daily breakdowns here.
          </p>
        </div>
      ) : (
        <AnalyticsCharts summary={summary} />
      )}
      <TopDonors donors={topDonors} />
    </section>
  );
}