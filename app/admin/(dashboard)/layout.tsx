/**
 * Admin dashboard layout — shared chrome for the four tab routes.
 *
 * Sits inside the existing /admin layout (which enforces the
 * 3-layer auth gate). This layer adds the sub-nav + Refresh panel.
 *
 * The login + OTP pages are NOT inside this group, so they keep the
 * plain chrome from the root /admin layout.
 */
import { AdminSubNav } from "@/components/admin/AdminSubNav";

export const dynamic = "force-dynamic";

export default function AdminDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <AdminSubNav />
      <div className="mt-6">{children}</div>
    </div>
  );
}