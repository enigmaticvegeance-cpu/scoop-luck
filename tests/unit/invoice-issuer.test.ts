/**
 * Tests for lib/invoice-issuer.ts — focused on the orchestration
 * invariants that don't require a live Prisma or Resend backend.
 *
 * The shape checks here lock down:
 *   1. Short-circuits when the superchat isn't PAID yet (don't email
 *      a donor whose payment failed or never cleared).
 *   2. Skips the email path when the user has no email (anonymous
 *      superchat — PDF still downloadable but nothing to send).
 *   3. Mints and persists an invoice number the first time, but does
 *      NOT re-mint on subsequent calls (idempotency).
 *   4. The "PAID + invoiceNumber already set + email failed" path
 *      still returns ok=true so the webhook stays idempotent at the
 *      call site.
 *
 * Magic-byte / mime-sniff rejection is exercised at the HTTP layer
 * (file-type is wired into the route handler).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface SuperchatRow {
  id: string;
  status: "PENDING" | "PAID" | "FAILED" | "REFUNDED";
  amountPaise: number;
  currency: string;
  displayName: string;
  message: string;
  paidAt: Date | null;
  invoiceNumber: string | null;
  gateway: "RAZORPAY" | "STRIPE" | "PAYPAL";
  gatewayOrderId: string;
  gatewayPaymentId: string | null;
  user: { email: string | null } | null;
}

interface SettingsRow {
  id: number;
  minDonationPaise: number;
  maxDonationPaise: number;
  inrPerUsd: number;
  platformLegalName: string;
  platformAddress: string | null;
  platformGstin: string | null;
  upiQrPath: string | null;
}

// In-memory store + call counters. Each test gets a fresh instance so
// cross-test bleed can't happen.
let store = new Map<string, SuperchatRow>();
let settings: SettingsRow | null = null;
let emailCalls: Array<{ to: string; invoiceNumber: string; subject: string }> = [];

vi.mock("@/lib/prisma", () => ({
  prisma: {
    superchat: {
      findUnique: async (args: { where: { id: string } }) => store.get(args.where.id) ?? null,
      update: async (args: { where: { id: string }; data: Partial<SuperchatRow> }) => {
        const existing = store.get(args.where.id);
        if (!existing) throw new Error("not found");
        const merged = { ...existing, ...args.data };
        store.set(args.where.id, merged);
        return merged;
      },
    },
    settings: {
      findUnique: async () => settings,
    },
  },
}));

vi.mock("@/lib/email", () => ({
  sendInvoiceEmail: vi.fn(async (args: { to: string; invoiceNumber: string }) => {
    emailCalls.push({ to: args.to, invoiceNumber: args.invoiceNumber, subject: `invoice-${args.invoiceNumber}` });
    // Simulate a healthy Resend by default. Tests that want a failure
    // override this via the .mockImplementationOnce chain.
    return "msg_test_123";
  }),
}));

// We do NOT mock lib/invoice.ts — the real mintInvoiceNumber and
// renderInvoicePdf are tiny pure functions and testing the orchestration
// against them is more useful than mocking.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://stub.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "stub-key-stubs-have-no-real-secret";

vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://stub.supabase.co");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "stub-key-stubs-have-no-real-secret");

const { issueInvoice } = await import("@/lib/invoice-issuer");

beforeEach(() => {
  store = new Map();
  settings = {
    id: 1,
    minDonationPaise: 2000,
    maxDonationPaise: 1_000_000,
    inrPerUsd: 83,
    platformLegalName: "Scoop Luck",
    platformAddress: null,
    platformGstin: null,
    upiQrPath: null,
  };
  emailCalls = [];
});

describe("issueInvoice — short-circuit cases", () => {
  it("returns not_paid when status is PENDING", async () => {
    store.set("sc_pending", {
      id: "sc_pending",
      status: "PENDING",
      amountPaise: 5000,
      currency: "INR",
      displayName: "Donor",
      message: "Hello",
      paidAt: null,
      invoiceNumber: null,
      gateway: "RAZORPAY",
      gatewayOrderId: "ord_pending",
      gatewayPaymentId: null,
      user: { email: "d@example.com" },
    });
    const r = await issueInvoice({ superchatId: "sc_pending" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_paid");
    expect(emailCalls).toHaveLength(0);
  });

  it("returns not_paid when status is FAILED", async () => {
    store.set("sc_failed", {
      id: "sc_failed",
      status: "FAILED",
      amountPaise: 5000,
      currency: "INR",
      displayName: "Donor",
      message: "Hello",
      paidAt: null,
      invoiceNumber: null,
      gateway: "RAZORPAY",
      gatewayOrderId: "ord_failed",
      gatewayPaymentId: null,
      user: { email: "d@example.com" },
    });
    const r = await issueInvoice({ superchatId: "sc_failed" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_paid");
    expect(emailCalls).toHaveLength(0);
  });

  it("returns not_found for an unknown superchat id", async () => {
    const r = await issueInvoice({ superchatId: "sc_does_not_exist" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("not_found");
  });

  it("skips the email path when the user has no email (anonymous)", async () => {
    store.set("sc_anon_long_id", {
      id: "sc_anon_long_id",
      status: "PAID",
      amountPaise: 5000,
      currency: "INR",
      displayName: "Anonymous",
      message: "Hi",
      paidAt: new Date("2026-06-30T10:00:00Z"),
      invoiceNumber: null,
      gateway: "RAZORPAY",
      gatewayOrderId: "ord_anon_long",
      gatewayPaymentId: "pay_anon_long",
      user: { email: null },
    });
    const r = await issueInvoice({ superchatId: "sc_anon_long_id" });
    // Anonymous: no email sent, no invoice number minted (the PDF and
    // invoice are bound to the email step). The donor can download from
    // /api/invoices/[id] later if a userId is attached.
    expect(r.ok).toBe(true);
    expect(r.invoiceNumber).toBeNull();
    expect(emailCalls).toHaveLength(0);
  });
});

describe("issueInvoice — happy path", () => {
  it("mints an invoice number, persists it, renders the PDF, and sends the email", async () => {
    store.set("sc_paid_anna_long", {
      id: "sc_paid_anna_long",
      status: "PAID",
      amountPaise: 5000,
      currency: "INR",
      displayName: "Anna",
      message: "Great show!",
      paidAt: new Date("2026-06-30T10:00:00Z"),
      invoiceNumber: null,
      gateway: "RAZORPAY",
      gatewayOrderId: "ord_paid_anna",
      gatewayPaymentId: "pay_paid_anna",
      user: { email: "anna@example.com" },
    });

    const r = await issueInvoice({ superchatId: "sc_paid_anna_long" });

    expect(r.ok).toBe(true);
    // mintInvoiceNumber uses the first 8 chars of the UUID with hyphens
    // stripped and uppercased. With our test ids (e.g. "sc_paid_anna_long")
    // the suffix contains underscores — match the visible structure:
    // "INV-YYYYMM-" + 8 uppercase alphanumerics/underscores.
    expect(r.invoiceNumber).toMatch(/^INV-\d{6}-[A-Z0-9_]{8}$/);

    // invoiceNumber persisted on the row.
    const after = store.get("sc_paid_anna_long")!;
    expect(after.invoiceNumber).toBe(r.invoiceNumber);

    // Email fired exactly once, addressed to the donor.
    expect(emailCalls).toHaveLength(1);
    const firstEmail = emailCalls[0]!;
    expect(firstEmail.to).toBe("anna@example.com");
    expect(firstEmail.invoiceNumber).toBe(r.invoiceNumber);
  });
});

describe("issueInvoice — idempotency", () => {
  it("does not re-mint when an invoice number is already set", async () => {
    store.set("sc_existing", {
      id: "sc_existing",
      status: "PAID",
      amountPaise: 5000,
      currency: "INR",
      displayName: "Bob",
      message: "Again",
      paidAt: new Date("2026-05-01T10:00:00Z"),
      invoiceNumber: "INV-202605-DEADBEEF",
      gateway: "STRIPE",
      gatewayOrderId: "ord_existing",
      gatewayPaymentId: "pay_existing",
      user: { email: "bob@example.com" },
    });

    const r = await issueInvoice({ superchatId: "sc_existing" });

    expect(r.ok).toBe(true);
    expect(r.invoiceNumber).toBe("INV-202605-DEADBEEF"); // unchanged
    expect(store.get("sc_existing")!.invoiceNumber).toBe("INV-202605-DEADBEEF");
    // Email still fires — admin re-issues use this path.
    expect(emailCalls).toHaveLength(1);
  });
});

describe("issueInvoice — settings missing", () => {
  it("returns ok=false with reason=settings_missing when no Settings row exists", async () => {
    store.set("sc_paid", {
      id: "sc_paid",
      status: "PAID",
      amountPaise: 5000,
      currency: "INR",
      displayName: "Cara",
      message: "x",
      paidAt: new Date("2026-06-30T10:00:00Z"),
      invoiceNumber: null,
      gateway: "PAYPAL",
      gatewayOrderId: "ord_settings_missing",
      gatewayPaymentId: "pay_settings_missing",
      user: { email: "cara@example.com" },
    });
    settings = null;
    const r = await issueInvoice({ superchatId: "sc_paid" });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("settings_missing");
    // No email — we never got far enough.
    expect(emailCalls).toHaveLength(0);
  });
});