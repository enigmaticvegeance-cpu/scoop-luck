/**
 * /admin/superchats — full table of all superchats with filters.
 *
 * Reads filters from the URL query string. Filter form posts back
 * via plain HTML <form method="get"> so the JS can be down and the
 * page still works.
 *
 * The table renders all superchats (including hidden ones). Each
 * row exposes a Hide/Restore control and a View Invoice link.
 */
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { listSuperchats } from "@/lib/analytics";
import { superchatFilterSchema, type SuperchatFilterInput } from "@/lib/schemas/admin";
import { SuperchatsTable } from "@/components/admin/SuperchatsTable";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseFilter(params: Record<string, string | string[] | undefined>): SuperchatFilterInput {
  const raw = {
    q: asString(params.q),
    tier: asString(params.tier),
    gateway: asString(params.gateway),
    from: asString(params.from),
    to: asString(params.to),
    page: asString(params.page),
  };
  const parsed = superchatFilterSchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  // Fall back to defaults on any malformed query string so the
  // page still renders something useful.
  return { page: 1 };
}

export default async function AdminSuperchatsPage({ searchParams }: PageProps) {
  const ctx = await getCurrentUser();
  if (!ctx || ctx.user.role !== "ADMIN") {
    redirect("/admin/login");
  }

  const params = await searchParams;
  const filter = parseFilter(params);
  const result = await listSuperchats(filter);

  return (
    <section>
      <header className="mb-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">All superchats</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Every row in the database, including hidden ones. Use the filters to narrow by
          tier, gateway, date, or donor / message text.
        </p>
      </header>
      <SuperchatsTable filter={filter} result={result} />
    </section>
  );
}