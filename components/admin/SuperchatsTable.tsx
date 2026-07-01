/**
 * SuperchatsTable — the All-superchats admin page's data table.
 *
 * Renders:
 *   - A filter form (GET — pushes to URL searchParams)
 *   - A paginated table of rows
 *   - Per-row actions: View Invoice (new tab), Hide/Restore
 *
 * The filter form uses a native <form method="get"> so the page
 * works without JS. The "Apply" button is the implicit submit.
 */
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, FileText, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HideDialog } from "@/components/admin/HideDialog";
import { hideSuperchat, unhideSuperchat } from "@/app/(public)/admin-actions";
import { formatAmountLabel, type LiveSuperchat } from "@/lib/schemas/superchat";
import type { SuperchatFilterInput } from "@/lib/schemas/admin";
import type { SuperchatListResult, SuperchatListItem } from "@/lib/analytics";
import { TIERS, type TierConfig } from "@/lib/tier";
import { cn } from "@/lib/utils";

interface SuperchatsTableProps {
  filter: SuperchatFilterInput;
  result: SuperchatListResult;
}

function tierFor(t: number): TierConfig {
  return TIERS.find((x) => x.tier === t) ?? TIERS[TIERS.length - 1]!;
}

function buildLiveShape(item: SuperchatListItem): LiveSuperchat {
  return {
    id: item.id,
    displayName: item.displayName,
    avatarUrl: item.avatarUrl,
    message: item.message,
    amount: item.amountPaise,
    currency: item.currency,
    inrEquivalentPaise: item.inrEquivalentPaise,
    tier: item.tier,
    paidAt: (item.paidAt ?? item.createdAt).getTime(),
  };
}

export function SuperchatsTable({ filter, result }: SuperchatsTableProps) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const onRefresh = () => {
    start(() => router.refresh());
  };

  return (
    <div className="space-y-4">
      <form
        method="get"
        action="/admin/superchats"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface/40 p-4 sm:grid-cols-2 lg:grid-cols-6"
        onSubmit={(e) => {
          // Native GET submission works without JS — let it through
          // and just nudge the router to pick up the new URL.
          start(() => {
            // The form will navigate on its own; this just keeps
            // the transition active so the user sees a brief loading
            // state.
          });
        }}
      >
        <div className="lg:col-span-2">
          <label htmlFor="q" className="text-xs font-medium text-ink-muted">
            Search
          </label>
          <div className="relative mt-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input
              id="q"
              name="q"
              type="search"
              defaultValue={filter.q ?? ""}
              placeholder="Donor name or message text"
              className="pl-9"
              maxLength={120}
            />
          </div>
        </div>
        <div>
          <label htmlFor="tier" className="text-xs font-medium text-ink-muted">
            Tier
          </label>
          <select
            id="tier"
            name="tier"
            defaultValue={filter.tier?.toString() ?? ""}
            className="mt-1 block h-10 w-full rounded-md border border-border bg-elevated px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">All</option>
            {TIERS.map((t) => (
              <option key={t.tier} value={t.tier}>
                {t.tier} — {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="gateway" className="text-xs font-medium text-ink-muted">
            Gateway
          </label>
          <select
            id="gateway"
            name="gateway"
            defaultValue={filter.gateway ?? ""}
            className="mt-1 block h-10 w-full rounded-md border border-border bg-elevated px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">All</option>
            <option value="RAZORPAY">Razorpay</option>
            <option value="STRIPE">Stripe</option>
            <option value="PAYPAL">PayPal</option>
          </select>
        </div>
        <div>
          <label htmlFor="from" className="text-xs font-medium text-ink-muted">
            From
          </label>
          <Input id="from" name="from" type="date" defaultValue={filter.from ?? ""} className="mt-1" />
        </div>
        <div>
          <label htmlFor="to" className="text-xs font-medium text-ink-muted">
            To
          </label>
          <Input id="to" name="to" type="date" defaultValue={filter.to ?? ""} className="mt-1" />
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit" disabled={pending}>
            Apply filters
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={onRefresh}
            disabled={pending}
          >
            Refresh
          </Button>
          <span className="ml-auto text-xs text-ink-muted tabular-nums" aria-live="polite">
            {result.total} {result.total === 1 ? "row" : "rows"}
            {result.totalPages > 1 ? ` · page ${result.page} of ${result.totalPages}` : null}
          </span>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-elevated/50 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">Donor</th>
              <th className="px-3 py-2">Amount / Tier</th>
              <th className="px-3 py-2">Message</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Gateway</th>
              <th className="px-3 py-2">Paid at</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-ink-muted">
                  No superchats match your filters.
                </td>
              </tr>
            ) : (
              result.items.map((row) => {
                const tier = tierFor(row.tier);
                const live = buildLiveShape(row);
                const label = formatAmountLabel(live);
                return <TableRow key={row.id} row={row} tier={tier} amountLabel={label} />;
              })
            )}
          </tbody>
        </table>
      </div>

      {result.totalPages > 1 ? (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-center gap-2 text-sm"
        >
          {Array.from({ length: result.totalPages }, (_, i) => i + 1).map((p) => {
            const sp = new URLSearchParams();
            if (filter.q) sp.set("q", filter.q);
            if (filter.tier !== undefined) sp.set("tier", String(filter.tier));
            if (filter.gateway) sp.set("gateway", filter.gateway);
            if (filter.from) sp.set("from", filter.from);
            if (filter.to) sp.set("to", filter.to);
            sp.set("page", String(p));
            return (
              <a
                key={p}
                href={`/admin/superchats?${sp.toString()}`}
                aria-current={p === result.page ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1",
                  p === result.page
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-surface hover:bg-elevated",
                )}
              >
                {p}
              </a>
            );
          })}
        </nav>
      ) : null}
    </div>
  );
}

function TableRow({
  row,
  tier,
  amountLabel,
}: {
  row: SuperchatListItem;
  tier: TierConfig;
  amountLabel: string;
}) {
  const [pending, start] = useTransition();
  const [dialogMode, setDialogMode] = useState<"hide" | "unhide" | null>(null);

  const onConfirm = (reason: string | undefined) => {
    start(async () => {
      if (dialogMode === "hide") {
        const res = await hideSuperchat({ id: row.id, reason });
        if (!res.ok) toast.error(res.error);
        else {
          toast.success("Hidden.");
          // Soft-reload so the row's `hidden` state reflects the new value.
          // The table is server-rendered; full refresh is the cleanest path.
          window.location.reload();
        }
      } else if (dialogMode === "unhide") {
        const res = await unhideSuperchat({ id: row.id });
        if (!res.ok) toast.error(res.error);
        else {
          toast.success("Restored.");
          window.location.reload();
        }
      }
      setDialogMode(null);
    });
  };

  const paidAt = row.paidAt ?? row.createdAt;
  const initial = row.displayName.trim().charAt(0).toUpperCase() || "•";

  return (
    <tr className={cn("border-t border-border align-top", row.hidden && "opacity-60")}>
      <td className="px-3 py-3">
        <div className="flex items-center gap-2">
          {row.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.avatarUrl} alt="" width={32} height={32} className="size-8 rounded-full object-cover" />
          ) : (
            <div
              className="flex size-8 items-center justify-center rounded-full text-xs font-semibold text-white"
              style={{ background: "linear-gradient(135deg, hsl(200 70% 35%), hsl(260 70% 25%))" }}
              aria-hidden
            >
              {initial}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate font-medium" title={row.displayName}>
              {row.displayName}
            </p>
            {row.hidden ? (
              <p className="text-[10px] uppercase tracking-wide text-destructive">Hidden</p>
            ) : null}
          </div>
        </div>
      </td>
      <td className="px-3 py-3">
        <p className="font-medium tabular-nums">{amountLabel}</p>
        <p
          className="text-[10px] uppercase tracking-wide"
          style={{ color: tier.accentColor }}
        >
          {tier.label}
        </p>
      </td>
      <td className="max-w-md px-3 py-3 text-ink">
        <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs">{row.message}</p>
      </td>
      <td className="px-3 py-3">
        <span
          className={cn(
            "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            row.status === "PAID" && "bg-neon-green/20 text-neon-green",
            row.status === "PENDING" && "bg-neon-amber/20 text-neon-amber",
            row.status === "FAILED" && "bg-destructive/20 text-destructive",
            row.status === "REFUNDED" && "bg-ink-muted/20 text-ink-muted",
          )}
        >
          {row.status}
        </span>
      </td>
      <td className="px-3 py-3 text-xs text-ink-muted">{row.gateway}</td>
      <td className="px-3 py-3 text-xs text-ink-muted">
        <time dateTime={paidAt.toISOString()} title={paidAt.toLocaleString()}>
          {paidAt.toISOString().slice(0, 10)}
        </time>
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center justify-end gap-1">
          {row.invoiceNumber ? (
            <a
              href={`/api/invoices/${encodeURIComponent(row.id)}/download`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-9 items-center gap-1 rounded-md px-3 text-xs font-medium text-ink-muted transition-colors hover:bg-elevated hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              aria-label="View invoice"
            >
              <FileText className="size-3.5" aria-hidden /> Invoice
            </a>
          ) : null}
          {row.hidden ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDialogMode("unhide")}
              disabled={pending}
              aria-label="Restore this superchat"
            >
              <Eye className="size-3.5" aria-hidden /> Restore
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => setDialogMode("hide")}
              disabled={pending}
              className="text-destructive hover:bg-destructive/15"
              aria-label="Hide this superchat"
            >
              <EyeOff className="size-3.5" aria-hidden /> Hide
            </Button>
          )}
        </div>
        <HideDialog
          open={dialogMode !== null}
          mode={dialogMode ?? "hide"}
          alreadyHidden={row.hidden && dialogMode === "unhide"}
          onClose={() => setDialogMode(null)}
          onConfirm={onConfirm}
        />
      </td>
    </tr>
  );
}