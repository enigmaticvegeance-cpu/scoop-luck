/**
 * /profile — viewer profile settings.
 *
 * Server component: gates on `requireUser()` and reads the latest
 * profile fields from the User row. Hands them to the client form
 * which owns the avatar-cropper modal.
 *
 * The page re-renders on every navigation because profile data is
 * per-user and changes often.
 */
import { requireUser } from "@/lib/auth";
import { ProfileForm } from "@/components/profile/ProfileForm";
import type { ProfileResponse } from "@/lib/schemas/profile";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const ctx = await requireUser("/login?next=/profile");
  const profile: ProfileResponse = {
    id: ctx.user.id,
    email: ctx.email,
    displayName: ctx.user.displayName,
    avatarUrl: ctx.user.avatarUrl,
    emailVerified: ctx.emailVerified,
  };
  return (
    <main className="container mx-auto max-w-2xl px-4 py-12">
      <header className="mb-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-balance md:text-4xl">
          Your profile
        </h1>
        <p className="mt-2 text-ink-muted">
          Update how you appear on the live feed.
        </p>
      </header>
      <ProfileForm initial={profile} />
    </main>
  );
}