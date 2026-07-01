/**
 * /admin/login — first stage of admin sign-in: email + password.
 *
 * Server component. Reads `?error=` to surface friendly messages and
 * `?next=` to forward the admin to where they intended to go.
 *
 * Form posts to the `requestAdminOtp` server action. On success the
 * page redirects to `/admin/otp?email=<masked>` so the OTP screen
 * knows what to verify.
 */
import { AdminLoginForm } from "@/components/admin/AdminLoginForm";

export const dynamic = "force-dynamic";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = params.error === "otp" ? "Please sign in again to continue." : null;

  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <header className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Admin sign-in</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Two-factor required. After your password we'll email a 6-digit code.
        </p>
      </header>
      <AdminLoginForm next={params.next ?? "/admin"} initialError={errorMessage} />
    </main>
  );
}
