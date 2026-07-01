/**
 * /admin/otp — second stage of admin sign-in: 6-digit OTP.
 *
 * The email is passed via query string so the OTP form knows what
 * it's verifying without trusting client-side state. We accept the
 * full email here ONLY because the caller already proved knowledge
 * of the password in stage 1; if the URL is bookmared by someone
 * who isn't signed in, the verifyAdminOtp action will reject them
 * anyway (no Supabase session, no ADMIN_EMAILS membership).
 *
 * Defense-in-depth: the URL is user-controlled (query string), so
 * we normalize + strictly validate the email shape before rendering
 * it. Anything that isn't a real-looking email address is redirected
 * back to step 1. React text-escaping handles the actual XSS payload,
 * but rejecting at the page boundary keeps the rendered output
 * boringly sane and limits the URL's blast radius if a future bug
 * ever interpolates this value into a non-text attribute.
 */
import { redirect } from "next/navigation";

import { AdminOtpForm } from "@/components/admin/AdminOtpForm";
import { normalizeEmail } from "@/lib/utils";

export const dynamic = "force-dynamic";

// Permissive RFC-5321-ish local-part + domain check. Real validation
// happens in Zod on the server action; this is just to keep the URL
// bar honest and prevent the page from rendering junk.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function AdminOtpPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string }>;
}) {
  const params = await searchParams;
  if (!params.email) {
    // No email → no challenge to verify. Send the admin back to step 1.
    redirect("/admin/login");
  }
  const email = normalizeEmail(params.email);
  if (!EMAIL_RE.test(email)) {
    redirect("/admin/login?error=invalid_email");
  }

  return (
    <main className="container mx-auto max-w-md px-4 py-16">
      <header className="mb-8 text-center">
        <h1 className="font-display text-3xl font-semibold tracking-tight">Enter your code</h1>
        <p className="mt-2 text-sm text-ink-muted">
          We sent a 6-digit code to <span className="text-ink">{email}</span>. The code expires
          in 10 minutes.
        </p>
      </header>
      <AdminOtpForm email={email} />
    </main>
  );
}
