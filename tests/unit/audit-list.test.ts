/**
 * Tests for listAuthEvents — the audit-log query at lib/analytics.ts.
 *
 * Locks down the where-clause construction (kind + email filter) and
 * the pagination math (totalPages, perPage=50). The page itself is
 * covered by Playwright axe, so this stays at the SQL-shape level.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface AuthEventRow {
  id: string;
  userId: string | null;
  actorEmail: string;
  kind: "ROLE_CHANGE" | "FIRST_LOGIN";
  fromRole: "VIEWER" | "ADMIN" | null;
  toRole: "VIEWER" | "ADMIN";
  createdAt: Date;
}

let store: AuthEventRow[] = [];
let lastFindWhere: unknown = null;
let lastCountWhere: unknown = null;
let lastSkip: number | null = null;
let lastTake: number | null = null;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    authEvent: {
      findMany: async (args: { where: unknown; skip: number; take: number; orderBy: unknown }) => {
        lastFindWhere = args.where;
        lastSkip = args.skip;
        lastTake = args.take;
        // Naive in-memory where application so we can verify ordering + pagination.
        const where = args.where as { kind?: string; actorEmail?: { contains: string; mode: string } };
        let rows = [...store];
        if (where?.kind) rows = rows.filter((r) => r.kind === where.kind);
        if (where?.actorEmail?.contains) {
          const needle = where.actorEmail.contains.toLowerCase();
          rows = rows.filter((r) => r.actorEmail.toLowerCase().includes(needle));
        }
        // orderBy createdAt desc is applied by the real query.
        rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return rows.slice(args.skip, args.skip + args.take);
      },
      count: async (args: { where: unknown }) => {
        lastCountWhere = args.where;
        const where = args.where as { kind?: string; actorEmail?: { contains: string; mode: string } };
        let rows = [...store];
        if (where?.kind) rows = rows.filter((r) => r.kind === where.kind);
        if (where?.actorEmail?.contains) {
          const needle = where.actorEmail.contains.toLowerCase();
          rows = rows.filter((r) => r.actorEmail.toLowerCase().includes(needle));
        }
        return rows.length;
      },
    },
  },
}));

const { listAuthEvents } = await import("@/lib/analytics");

beforeEach(() => {
  store = [];
  lastFindWhere = null;
  lastCountWhere = null;
  lastSkip = null;
  lastTake = null;
});

function seed(n: number): void {
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    store.push({
      id: `ae_${i}`,
      userId: `user_${i}`,
      actorEmail: `u${i}@example.com`,
      kind: i % 2 === 0 ? "FIRST_LOGIN" : "ROLE_CHANGE",
      fromRole: i % 2 === 0 ? null : "VIEWER",
      toRole: i % 4 === 0 ? "ADMIN" : "VIEWER",
      createdAt: new Date(now - i * 60_000),
    });
  }
}

describe("listAuthEvents — pagination", () => {
  it("caps perPage at 50", async () => {
    seed(120);
    const r = await listAuthEvents({ page: 1 });
    expect(lastTake).toBe(50);
    expect(r.items).toHaveLength(50);
    expect(r.total).toBe(120);
    expect(r.totalPages).toBe(3); // ceil(120/50)
    expect(r.page).toBe(1);
  });

  it("returns the right slice for page=2", async () => {
    seed(75);
    const r = await listAuthEvents({ page: 2 });
    expect(lastSkip).toBe(50);
    expect(r.items).toHaveLength(25); // remaining after page 1's 50
    expect(r.page).toBe(2);
  });

  it("clamps page=0 to page=1", async () => {
    seed(10);
    const r = await listAuthEvents({ page: 0 });
    expect(r.page).toBe(1);
    expect(r.items).toHaveLength(10);
  });
});

describe("listAuthEvents — filters", () => {
  it("filters by kind=ROLE_CHANGE", async () => {
    seed(20); // 10 ROLE_CHANGE, 10 FIRST_LOGIN
    const r = await listAuthEvents({ kind: "ROLE_CHANGE", page: 1 });
    expect(r.total).toBe(10);
    expect(r.items.every((it) => it.kind === "ROLE_CHANGE")).toBe(true);
  });

  it("filters by email substring (case-insensitive)", async () => {
    store.push({
      id: "ae_anna_1",
      userId: null,
      actorEmail: "Anna@Example.com",
      kind: "FIRST_LOGIN",
      fromRole: null,
      toRole: "ADMIN",
      createdAt: new Date(),
    });
    store.push({
      id: "ae_other",
      userId: null,
      actorEmail: "bob@example.com",
      kind: "FIRST_LOGIN",
      fromRole: null,
      toRole: "VIEWER",
      createdAt: new Date(),
    });
    const r = await listAuthEvents({ email: "ANNA", page: 1 });
    expect(r.total).toBe(1);
    expect(r.items[0]!.actorEmail).toBe("Anna@Example.com");
    // The where-clause is case-insensitive.
    expect((lastFindWhere as { actorEmail: { mode: string } }).actorEmail.mode).toBe("insensitive");
  });

  it("combines kind + email filters", async () => {
    seed(20);
    // Add a custom row that should match both.
    store.push({
      id: "ae_match",
      userId: null,
      actorEmail: "special@example.com",
      kind: "ROLE_CHANGE",
      fromRole: "VIEWER",
      toRole: "ADMIN",
      createdAt: new Date(),
    });
    const r = await listAuthEvents({ kind: "ROLE_CHANGE", email: "special", page: 1 });
    expect(r.total).toBe(1);
    expect(r.items[0]!.actorEmail).toBe("special@example.com");
  });

  it("returns total=0 with empty items when no rows match", async () => {
    seed(5);
    const r = await listAuthEvents({ kind: "ROLE_CHANGE", email: "nope", page: 1 });
    expect(r.total).toBe(0);
    expect(r.items).toHaveLength(0);
    expect(r.totalPages).toBe(1); // min 1 page even when empty
  });
});