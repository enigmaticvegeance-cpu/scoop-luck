/**
 * Tests for lib/auth.ts:getCurrentUser() — focused on the AuthEvent
 * instrumentation (Phase 8.3). The role recompute itself is exercised
 * implicitly by every protected page; the audit-row writes are the
 * new code path that needs locking down.
 *
 * The shape checks here lock down:
 *   1. First login (no existing User row) writes a FIRST_LOGIN event.
 *   2. Subsequent login with unchanged role writes NOTHING.
 *   3. Login with role change writes a ROLE_CHANGE event with from/to.
 *   4. The audit insert is fire-and-forget — a Prisma error on
 *      authEvent.create does NOT block the user from logging in.
 *
 * We mock Prisma + the Supabase server client. The test does NOT
 * exercise the E2E bypass branch (covered manually).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface UserRow {
  id: string;
  supabaseId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  role: "VIEWER" | "ADMIN";
  createdAt: Date;
  updatedAt: Date;
}

interface AuthEventRow {
  id: string;
  userId: string | null;
  actorEmail: string;
  kind: "ROLE_CHANGE" | "FIRST_LOGIN";
  fromRole: "VIEWER" | "ADMIN" | null;
  toRole: "VIEWER" | "ADMIN";
  createdAt: Date;
}

// Per-test state. We re-initialize in beforeEach so cross-test bleed
// cannot happen — every test gets a fresh Prisma store.
let users = new Map<string, UserRow>(); // keyed by supabaseId
let authEvents: AuthEventRow[] = [];
let authEventWriteShouldFail = false;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: async (args: { where: { supabaseId?: string; id?: string } }) => {
        if (args.where.supabaseId) {
          for (const u of users.values()) if (u.supabaseId === args.where.supabaseId) return u;
          return null;
        }
        if (args.where.id) {
          return users.get(args.where.id) ?? null;
        }
        return null;
      },
      create: async (args: { data: Omit<UserRow, "id" | "createdAt" | "updatedAt"> }) => {
        const existing = [...users.values()].find((u) => u.supabaseId === args.data.supabaseId);
        if (existing) throw new Error("unique constraint: supabaseId");
        const row: UserRow = {
          id: `user_${Math.random().toString(36).slice(2, 10)}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...args.data,
        };
        users.set(row.id, row);
        return row;
      },
      update: async (args: { where: { id: string }; data: Partial<UserRow> }) => {
        const existing = users.get(args.where.id);
        if (!existing) throw new Error("not found");
        const updated = { ...existing, ...args.data, updatedAt: new Date() };
        users.set(args.where.id, updated);
        return updated;
      },
    },
    authEvent: {
      create: async (args: { data: Omit<AuthEventRow, "id" | "createdAt"> }) => {
        if (authEventWriteShouldFail) throw new Error("simulated prisma error");
        const row: AuthEventRow = {
          id: `ae_${Math.random().toString(36).slice(2, 10)}`,
          createdAt: new Date(),
          ...args.data,
        };
        authEvents.push(row);
        return row;
      },
    },
  },
}));

const mockSupabaseUser = {
  id: "supabase_123",
  email: "Anna@Example.com", // Mixed case on purpose — getCurrentUser should lowercase.
  email_confirmed_at: "2026-06-15T10:00:00Z",
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: mockSupabaseUser }, error: null }),
    },
  }),
}));

// Set admin emails BEFORE the module under test reads them via
// getAdminEmails(). We use vi.stubEnv so the value is automatically
// reset between tests.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key-stubs-have-no-real-secret";
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stub-key-stubs-have-no-real-secret");
vi.stubEnv("E2E_AUTH_BYPASS", "");

const { getCurrentUser } = await import("@/lib/auth");

beforeEach(() => {
  users = new Map();
  authEvents = [];
  authEventWriteShouldFail = false;
  // Reset the mock user to the canonical "new admin" shape.
  mockSupabaseUser.id = "supabase_123";
  mockSupabaseUser.email = "Anna@Example.com";
  mockSupabaseUser.email_confirmed_at = "2026-06-15T10:00:00Z";
});

describe("getCurrentUser — first login", () => {
  it("creates a User row and writes a FIRST_LOGIN event", async () => {
    vi.stubEnv("ADMIN_EMAILS", "anna@example.com");
    const ctx = await getCurrentUser();
    expect(ctx).not.toBeNull();
    expect(ctx!.user.email).toBe("anna@example.com"); // lowercased
    expect(ctx!.user.role).toBe("ADMIN");

    // Exactly one audit row, kind=FIRST_LOGIN, fromRole=null.
    expect(authEvents).toHaveLength(1);
    expect(authEvents[0]!.kind).toBe("FIRST_LOGIN");
    expect(authEvents[0]!.fromRole).toBeNull();
    expect(authEvents[0]!.toRole).toBe("ADMIN");
    expect(authEvents[0]!.actorEmail).toBe("anna@example.com");
  });
});

describe("getCurrentUser — idempotent subsequent login", () => {
  it("writes NO AuthEvent when the role is unchanged", async () => {
    // Pre-seed an existing User row at the target role.
    vi.stubEnv("ADMIN_EMAILS", "anna@example.com");
    const first = await getCurrentUser();
    expect(first).not.toBeNull();
    // First login wrote exactly one audit row.
    expect(authEvents).toHaveLength(1);

    // Second login — same env, same user, no role change.
    const second = await getCurrentUser();
    expect(second).not.toBeNull();
    expect(second!.user.id).toBe(first!.user.id);
    // Still exactly one audit row — the second login is silent.
    expect(authEvents).toHaveLength(1);
  });
});

describe("getCurrentUser — role change", () => {
  it("writes a ROLE_CHANGE event when ADMIN_EMAILS no longer lists the user", async () => {
    // Step 1: log in as admin.
    vi.stubEnv("ADMIN_EMAILS", "anna@example.com");
    const admin = await getCurrentUser();
    expect(admin!.user.role).toBe("ADMIN");
    expect(authEvents).toHaveLength(1); // FIRST_LOGIN

    // Step 2: ADMIN_EMAILS env changes — anna is no longer admin.
    vi.stubEnv("ADMIN_EMAILS", "");
    const demoted = await getCurrentUser();
    expect(demoted!.user.role).toBe("VIEWER");
    // TWO audit rows now: FIRST_LOGIN + ROLE_CHANGE.
    expect(authEvents).toHaveLength(2);
    const changeEvent = authEvents[1]!;
    expect(changeEvent.kind).toBe("ROLE_CHANGE");
    expect(changeEvent.fromRole).toBe("ADMIN");
    expect(changeEvent.toRole).toBe("VIEWER");
    expect(changeEvent.actorEmail).toBe("anna@example.com");
  });

  it("writes a ROLE_CHANGE event when a viewer is promoted to admin", async () => {
    // Step 1: log in as a regular viewer.
    vi.stubEnv("ADMIN_EMAILS", "");
    const viewer = await getCurrentUser();
    expect(viewer!.user.role).toBe("VIEWER");
    expect(authEvents).toHaveLength(1); // FIRST_LOGIN

    // Step 2: env flips to grant admin.
    vi.stubEnv("ADMIN_EMAILS", "anna@example.com");
    const promoted = await getCurrentUser();
    expect(promoted!.user.role).toBe("ADMIN");
    expect(authEvents).toHaveLength(2);
    const changeEvent = authEvents[1]!;
    expect(changeEvent.kind).toBe("ROLE_CHANGE");
    expect(changeEvent.fromRole).toBe("VIEWER");
    expect(changeEvent.toRole).toBe("ADMIN");
  });
});

describe("getCurrentUser — audit resilience", () => {
  it("does not block login when the AuthEvent insert fails", async () => {
    vi.stubEnv("ADMIN_EMAILS", "anna@example.com");
    authEventWriteShouldFail = true;

    // The login still returns a valid context — the audit failure is
    // captured by log.error but never propagated.
    const ctx = await getCurrentUser();
    expect(ctx).not.toBeNull();
    expect(ctx!.user.email).toBe("anna@example.com");
    expect(ctx!.user.role).toBe("ADMIN");
  });
});