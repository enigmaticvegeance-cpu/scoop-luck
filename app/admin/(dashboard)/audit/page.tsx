/**
 * /admin/audit — admin role audit log.
 *
 * Lists AuthEvent rows newest-first with filters for kind (FIRST_LOGIN
 * vs ROLE_CHANGE) and email substring. The table itself lives in
 * components/admin/AuditTable.tsx; this page is responsible only for
 * auth (layout already gates) + fetching.
 *
 * Renders every AuthEvent including those for deactivated users —
 * `userId` is nulled on User delete via `onDelete: SetNull` in the
 * schema, but the row itself survives for audit purposes.
 *
 * The admin layout at app/admin/layout.tsx enforces:
 *   - admin role
 *   - adminOtpVerified cookie
 * so a viewer never reaches this server component.
 */
import { redirect } from "next/navigation";

import { getCurrentUser } from "@/lib/auth";
import { listAuthEvents } from "@/lib/analytics";
import {
  authEventFilterSchema,
  type AuthEventFilterInput,
} from "@/lib/schemas/admin";
import { AuditTable } from "@/components/admin/AuditTable";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function asString(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v;
}

function parseFilter(params: Record<string, string | string[] | undefined>): AuthEventFilterInput {
  const parsed = authEventFilterSchema.safeParse({
    kind: asString(params.kind),
    email: asString(params.email),
    page: asString(params.page),
  });
  if (parsed.success) return parsed.data;
  // Bad query string → fall back to defaults so the page still renders.
  return { page: 1 };
}

export default async function AdminAuditPage({ searchParams }: PageProps) {
  const ctx = await getCurrentUser();
  if (!ctx || ctx.user.role !== "ADMIN") {
    redirect("/admin/login");
  }

  const filter = parseFilter(await searchParams);
  const result = await listAuthEvents(filter);

  return (
    <section>
      <header className="mb-4">
        <h1 className="font-display text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Role assignments and first logins for every account. Promotions and demotions
          show here whenever an admin changes the <code>ADMIN_EMAILS</code> environment
          variable and the affected user logs in again.
        </p>
      </header>
      <AuditTable filter={filter} result={result} />
    </section>
  );
}