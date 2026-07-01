/**
 * Pure helpers for building Prisma where-clauses for the Superchat
 * table. Extracted from lib/analytics.ts so they can be unit-tested
 * without booting Prisma.
 */
import type { Prisma } from "@/generated/prisma/client";

export type SuperchatWhereInput = Prisma.SuperchatWhereInput;

export interface SuperchatFilter {
  q?: string | undefined;
  tier?: number | undefined;
  gateway?: "RAZORPAY" | "STRIPE" | "PAYPAL" | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Build the Prisma `where` clause for a superchat filter. Exported
 * so unit tests can compare structures without re-implementing it.
 */
export function buildSuperchatWhere(filter: SuperchatFilter): SuperchatWhereInput {
  const where: SuperchatWhereInput = {};

  if (filter.tier !== undefined) where.tier = filter.tier;
  if (filter.gateway) where.gateway = filter.gateway;

  if (filter.from || filter.to) {
    const range: { gte?: Date; lte?: Date } = {};
    if (filter.from) {
      const d = new Date(`${filter.from}T00:00:00.000Z`);
      if (!Number.isNaN(d.getTime())) range.gte = d;
    }
    if (filter.to) {
      // Inclusive end-of-day: 23:59:59.999Z.
      const d = new Date(`${filter.to}T23:59:59.999Z`);
      if (!Number.isNaN(d.getTime())) range.lte = d;
    }
    if (range.gte || range.lte) where.paidAt = range;
  }

  if (filter.q) {
    // Case-insensitive OR on display name OR message body.
    where.OR = [
      { displayName: { contains: filter.q, mode: "insensitive" } },
      { message: { contains: filter.q, mode: "insensitive" } },
    ];
  }

  return where;
}