/**
 * AnalyticsCharts — three recharts panels built from the
 * pre-computed revenue summary.
 *
 * The recharts components are heavy and require the window object,
 * so this is a client component even though the data is
 * server-rendered as a prop.
 */
"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { TIERS } from "@/lib/tier";
import type { RevenueSummary } from "@/lib/analytics";

interface Props {
  summary: RevenueSummary;
}

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
  notation: "compact",
});

const GATEWAY_COLORS: Record<"RAZORPAY" | "STRIPE" | "PAYPAL", string> = {
  RAZORPAY: "hsl(196 90% 55%)",
  STRIPE: "hsl(260 90% 65%)",
  PAYPAL: "hsl(36 90% 55%)",
};

function tierColor(tier: number): string {
  const t = TIERS.find((x) => x.tier === tier);
  return t?.accentColor ?? "hsl(0 0% 50%)";
}

export function AnalyticsCharts({ summary }: Props) {
  const tierData = summary.byTier.map((t) => ({
    name: `T${t.tier}`,
    tier: t.tier,
    count: t.count,
    total: t.totalInrPaise / 100,
  }));
  const gatewayData = summary.byGateway.map((g) => ({
    name: g.gateway,
    value: g.count,
    total: g.totalInrPaise / 100,
  }));
  const dailyData = summary.daily.map((d) => ({
    date: d.date.slice(5), // MM-DD
    total: d.totalInrPaise / 100,
    count: d.count,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Tier distribution</CardTitle>
          <CardDescription>Number of paid superchats per tier.</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          {/* role="img" + aria-label gives the recharts <svg> an accessible
              name; the inner <p className="sr-only"> mirrors the chart's
              data so AT users get the actual numbers, not just "bar
              chart". */}
          <div
            role="img"
            aria-label={`Bar chart of paid superchats per tier: ${tierData
              .map((d) => `${d.name} ${d.count}`)
              .join(", ")}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={tierData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="name" stroke="hsl(var(--ink-muted))" fontSize={12} />
                <YAxis allowDecimals={false} stroke="hsl(var(--ink-muted))" fontSize={12} />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))" }}
                  cursor={{ fill: "hsl(var(--elevated))" }}
                />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {tierData.map((d) => (
                    <Cell key={d.tier} fill={tierColor(d.tier)} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="sr-only">
            Paid superchats per tier:{" "}
            {tierData.map((d) => `${d.name} has ${d.count} tip${d.count === 1 ? "" : "s"}`).join("; ")}
            .
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Gateway distribution</CardTitle>
          <CardDescription>How donors are paying — Razorpay, Stripe, or PayPal.</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          <div
            role="img"
            aria-label={`Pie chart of payments by gateway: ${gatewayData
              .map((d) => `${d.name} ${d.value}`)
              .join(", ")}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Tooltip
                  contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v) => `${v} tips`}
                />
                <Legend />
                <Pie
                  data={gatewayData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={90}
                  paddingAngle={2}
                >
                  {gatewayData.map((d) => (
                    <Cell key={d.name} fill={GATEWAY_COLORS[d.name]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="sr-only">
            Payments by gateway:{" "}
            {gatewayData.map((d) => `${d.name} ${d.value} tip${d.value === 1 ? "" : "s"}`).join("; ")}
            .
          </p>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Daily revenue · last 30 days</CardTitle>
          <CardDescription>INR-equivalent total per day, all gateways.</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          <div
            role="img"
            aria-label={`Line chart of daily revenue over the last 30 days, ${dailyData.length} day${
              dailyData.length === 1 ? "" : "s"
            } of data, all gateways combined.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="date" stroke="hsl(var(--ink-muted))" fontSize={12} />
                <YAxis
                  stroke="hsl(var(--ink-muted))"
                  fontSize={12}
                  tickFormatter={(v) => INR_FORMAT.format(Number(v))}
                />
                <Tooltip
                  contentStyle={{ background: "hsl(var(--surface))", border: "1px solid hsl(var(--border))" }}
                  formatter={(v) => INR_FORMAT.format(Number(v))}
                />
                <Line
                  type="monotone"
                  dataKey="total"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="sr-only">
            Daily revenue for the last 30 days, INR equivalent, all gateways combined:{" "}
            {dailyData.map((d) => `${d.date} ${INR_FORMAT.format(d.total)}`).join("; ")}.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}