import Link from "next/link";

import { getCurrentUser } from "@/lib/auth";
import { LogoutButton } from "@/components/auth/LogoutButton";

/**
 * Shared header for public routes. Server component so the auth
 * state is read on the server — no flash of "Sign in" when already
 * signed in.
 */
export async function PublicHeader() {
  const user = await getCurrentUser();
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-base/80 backdrop-blur-md">
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 font-display text-lg font-semibold">
          <span className="size-2 rounded-full bg-neon-cyan shadow-neon-cyan" />
          Scoop Luck
        </Link>

        <nav className="flex items-center gap-2 text-sm">
          {user ? (
            <>
              <Link
                href="/superchat"
                className="rounded-full px-3 py-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink"
              >
                Send a superchat
              </Link>
              <Link
                href="/profile"
                className="rounded-full px-3 py-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink"
              >
                {user.user.displayName ?? user.email}
              </Link>
              <LogoutButton />
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-full px-3 py-1.5 text-ink-muted transition hover:bg-elevated hover:text-ink"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-primary px-4 py-1.5 font-medium text-primary-foreground shadow-neon-cyan transition hover:scale-[1.02]"
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}