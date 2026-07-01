/**
 * POST /api/payments/razorpay/verify-payment
 *
 * Defense-in-depth: the Razorpay JS SDK calls this with the
 * razorpay_payment_id, razorpay_order_id, and signature it received
 * after a successful client-side flow. We re-verify the HMAC here so
 * a tampered client can't claim success on an order that wasn't paid.
 *
 * NOTE: this is NOT the source of truth — the webhook is. This endpoint
 * only lets us tell the client "yes, this looks paid" before the
 * webhook round-trip completes. We update the Superchat row's
 * `webhookVerified` only if the webhook has also confirmed; otherwise
 * we leave the row as PENDING.
 */
import { NextResponse } from "next/server";

import { z } from "zod";

import { log } from "@/lib/log";
import { fingerprint } from "@/lib/utils";
import { serverEnv } from "@/lib/env";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { verifyRazorpayPaymentSignature } from "@/lib/razorpay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  razorpayOrderId: z.string().min(1).max(64),
  razorpayPaymentId: z.string().min(1).max(64),
  signature: z.string().min(1).max(256),
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
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { razorpayOrderId, razorpayPaymentId, signature, superchatId } = parsed.data;

  const env = serverEnv();
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "server misconfigured" }, { status: 500 });
  }

  const ok = verifyRazorpayPaymentSignature({
    razorpayOrderId,
    razorpayPaymentId,
    signature,
    secret: env.RAZORPAY_WEBHOOK_SECRET,
  });
  if (!ok) {
    log.warn("payments.razorpay.verify_signature_invalid", {
      actorId: await fingerprint(ctx.email),
      superchatId,
    });
    return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  }

  const superchat = await prisma.superchat.findUnique({
    where: { id: superchatId },
  });
  if (!superchat) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (superchat.userId !== ctx.user.id) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (superchat.gatewayOrderId !== razorpayOrderId) {
    return NextResponse.json({ error: "order_mismatch" }, { status: 400 });
  }

  // We don't change status here — the webhook owns that. We just
  // confirm "yes the client-side callback signature is genuine".
  // The client should rely on the Realtime feed for the PAID event.
  return NextResponse.json({ ok: true });
}