/**
 * AuditTable — the AuthEvent audit log admin page's data table.
 *
 * Renders:
 *   - A filter form (GET — pushes to URL searchParams) for kind + email
 *   - A paginated table of role/first-login events
 *   - Pagination links below the table when > 1 page
 *
 * Pure server render — no per-row actions, no client-state for the
 * table itself. The filter form is JS-optional (native GET).
 */
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { AuthEventListItem, AuthEventListResult } from "@/lib/analytics";
import type { AuthEventFilterInput } from "@/lib/schemas/admin";

interface AuditTableProps {
  filter: AuthEventFilterInput;
  result: AuthEventListResult;
}

function buildHref(filter: AuthEventFilterInput, page: number): string {
  const sp = new URLSearchParams();
  if (filter.kind) sp.set("kind", filter.kind);
  if (filter.email) sp.set("email", filter.email);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `/admin/audit?${qs}` : "/admin/audit";
}

function kindLabel(kind: AuthEventListItem["kind"]): string {
  return kind === "ROLE_CHANGE" ? "Role change" : "First login";
}

function kindAccent(kind: AuthEventListItem["kind"]): string {
  return kind === "ROLE_CHANGE" ? "text-neon-amber" : "text-neon-cyan";
}

function formatRoleTransition(item: AuthEventListItem): string {
  // FIRST_LOGIN: only toRole is meaningful.
  if (item.kind === "FIRST_LOGIN") {
    return item.toRole === "ADMIN" ? "→ ADMIN" : "→ VIEWER";
  }
  // ROLE_CHANGE: from → to. Both are required by the schema.
  const arrow = item.fromRole === "ADMIN" ? "ADMIN → VIEWER" : "VIEWER → ADMIN";
  return arrow;
}

export function AuditTable({ filter, result }: AuditTableProps) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const onRefresh = () => {
    start(() => router.refresh());
  };

  return (
    <div className="space-y-4">
      <form
        method="get"
        action="/admin/audit"
        className="grid grid-cols-1 gap-3 rounded-xl border border-border bg-surface/40 p-4 sm:grid-cols-2 lg:grid-cols-6"
      >
        <div className="lg:col-span-2">
          <label htmlFor="email" className="text-xs font-medium text-ink-muted">
            Email contains
          </label>
          <div className="relative mt-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
              aria-hidden
            />
            <Input
              id="email"
              name="email"
              type="search"
              defaultValue={filter.email ?? ""}
              placeholder="anna@example.com"
              className="pl-9"
              maxLength={120}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="lg:col-span-2">
          <label htmlFor="kind" className="text-xs font-medium text-ink-muted">
            Event kind
          </label>
          <select
            id="kind"
            name="kind"
            defaultValue={filter.kind ?? ""}
            className="mt-1 block h-10 w-full rounded-md border border-border bg-elevated px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <option value="">All events</option>
            <option value="ROLE_CHANGE">Role change</option>
            <option value="FIRST_LOGIN">First login</option>
          </select>
        </div>
        <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-6">
          <Button type="submit" disabled={pending}>
            Apply filters
          </Button>
          <Button type="button" variant="ghost" onClick={onRefresh} disabled={pending}>
            Refresh
          </Button>
          <span
            className="ml-auto text-xs text-ink-muted tabular-nums"
            aria-live="polite"
          >
            {result.total} {result.total === 1 ? "event" : "events"}
            {result.totalPages > 1 ? ` · page ${result.page} of ${result.totalPages}` : null}
          </span>
        </div>
      </form>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="bg-elevated/50 text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Event</th>
              <th className="px-3 py-2">Role transition</th>
            </tr>
          </thead>
          <tbody>
            {result.items.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-ink-muted">
                  No audit events match your filters.
                </td>
              </tr>
            ) : (
              result.items.map((row) => (
                <tr key={row.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-3 py-3 text-xs text-ink-muted">
                    <time
                      dateTime={row.createdAt.toISOString()}
                      title={row.createdAt.toLocaleString()}
                    >
                      {row.createdAt.toISOString().slice(0, 19).replace("T", " ")}
                    </time>
                  </td>
                  <td className="px-3 py-3 font-mono text-xs">{row.actorEmail}</td>
                  <td className="px-3 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                        row.kind === "ROLE_CHANGE"
                          ? "bg-neon-amber/20 text-neon-amber"
                          : "bg-neon-cyan/20 text-neon-cyan",
                      )}
                    >
                      {kindLabel(row.kind)}
                    </span>
                  </td>
                  <td className={cn("px-3 py-3 text-xs font-medium", kindAccent(row.kind))}>
                    {formatRoleTransition(row)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {result.totalPages > 1 ? (
        <nav
          aria-label="Audit log pagination"
          className="flex items-center justify-center gap-2 text-sm"
        >
          {Array.from({ length: result.totalPages }, (_, i) => i + 1).map((p) => (
            <a
              key={p}
              href={buildHref(filter, p)}
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
          ))}
        </nav>
      ) : null}
    </div>
  );
}