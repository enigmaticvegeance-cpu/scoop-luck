/**
 * POST /api/payments/paypal/capture
 *
 * Capture a previously-created PayPal order. The PayPal JS SDK calls
 * this after the buyer approves (onApprove). We re-verify on the server
 * before performing the capture to prevent a tampered client from
 * completing an order with a different amount.
 *
 * Idempotent: PayPal capture is itself idempotent on the order id. If
 * the row is already PAID, we return success without calling PayPal
 * again.
 */
import { NextResponse } from "next/server";

import { z } from "zod";

import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { capturePayPalOrder } from "@/lib/paypal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const captureSchema = z.object({
  paypalOrderId: z.string().min(1).max(64),
  superchatId: z.string().uuid(),
});

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ error: "method_not_allowed" }, { status: 405 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const ctx = await getCurrentUser();
  if (!ctx) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = captureSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { paypalOrderId, superchatId } = parsed.data;

  // Make sure the row belongs to this user.
  const superchat = await prisma.superchat.findUnique({
    where: { id: superchatId },
  });
  if (!superchat) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (superchat.userId !== ctx.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (superchat.gatewayOrderId !== paypalOrderId) {
    return NextResponse.json({ error: "order_mismatch" }, { status: 400 });
  }

  // Already captured? Skip the PayPal call.
  if (superchat.status === "PAID" || superchat.status === "REFUNDED") {
    return NextResponse.json({ ok: true, status: superchat.status });
  }

  let capture;
  try {
    capture = await capturePayPalOrder(paypalOrderId);
  } catch (e) {
    log.error("payments.paypal.capture_failed", {
      actorId: await fingerprint(ctx.email),
      superchatId,
      note: e instanceof Error ? e.message : "unknown",
    });
    return NextResponse.json(
      { error: "Payment provider is unavailable. Please try again." },
      { status: 502 },
    );
  }

  // PayPal returns COMPLETED on success, DECLINED on failure. We mark
  // the row PAID only on COMPLETED — the webhook is still the source
  // of truth, but this gives the client fast feedback.
  if (capture.status !== "COMPLETED") {
    await prisma.superchat.update({
      where: { id: superchatId },
      data: { status: "FAILED", webhookVerified: false },
    });
    log.warn("payments.paypal.capture_not_completed", {
      superchatId,
      status: capture.status,
    });
    return NextResponse.json({ ok: false, status: capture.status }, { status: 200 });
  }

  // Note: tier recompute is the webhook's job. We do NOT touch tier
  // here — the webhook will overwrite with the verified amount. If the
  // webhook is delayed, the row stays as PENDING with webhookVerified=false.
  // The UI should rely on the Realtime subscription to learn about PAID.
  log.info("payments.paypal.captured_client_side", {
    superchatId,
    actorId: await fingerprint(ctx.email),
  });
  return NextResponse.json({ ok: true, status: "COMPLETED" });
}