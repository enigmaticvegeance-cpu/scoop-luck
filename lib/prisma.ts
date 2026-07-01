/**
 * Prisma client singleton.
 *
 * Prisma 7 requires a driver adapter. We use @prisma/adapter-pg, which
 * accepts the Postgres connection string from DATABASE_URL.
 *
 * In dev, Next.js HMR re-imports modules on every save — without a
 * singleton we'd exhaust the connection pool. We stash the client on
 * `globalThis` (a Node-no-go-zone in production) so it survives
 * hot reload.
 *
 * The client is created lazily on first call to avoid an import-time
 * network connection when DATABASE_URL is not yet present (e.g. during
 * typecheck-only CI runs).
 */
import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function build(): PrismaClient {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is required to instantiate the Prisma client");
  }
  const adapter = new PrismaPg({ connectionString: url });
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? build();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

export type { PrismaClient } from "@/generated/prisma/client";
export * from "@/generated/prisma/client";