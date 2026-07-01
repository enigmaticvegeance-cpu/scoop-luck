/**
 * Razorpay server SDK wrapper.
 *
 * Server-only. Lazy singleton so we don't crash when the API key is
 * missing in non-production tasks (typecheck, lint).
 *
 * Reference: https://github.com/razorpay/razorpay-node
 */
import "server-only";

import Razorpay from "razorpay";
import crypto from "node:crypto";

import { serverEnv } from "@/lib/env";

let _client: Razorpay | null = null;

/**
 * Returns the singleton, or null if the API key pair isn't set.
 * Callers must handle the null case (throw a 503).
 */
export function getRazorpay(): Razorpay | null {
  if (_client) return _client;
  const env = serverEnv();
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    if (env.NODE_ENV === "production") {
      throw new Error("Razorpay keys are required in production");
    }
    return null;
  }
  _client = new Razorpay({
    key_id: env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });
  return _client;
}

export interface RazorpayOrder {
  id: string;
  amount: number; // paise
  currency: string;
  status: "created" | "attempted" | "paid";
  receipt: string | null;
}

/**
 * Create a Razorpay order. Amount MUST be in paise (1 INR = 100).
 * `receipt` is our internal reference (e.g. the Superchat row UUID).
 *
 * Throws on API error — caller returns 502.
 */
export async function createRazorpayOrder(
  amountPaise: number,
  receipt: string,
  notes: Record<string, string> = {},
): Promise<RazorpayOrder> {
  const rzp = getRazorpay();
  if (!rzp) throw new Error("Razorpay not configured");
  const order = await rzp.orders.create({
    amount: amountPaise,
    currency: "INR",
    receipt,
    notes,
    payment_capture: true,
  });
  return {
    id: order.id,
    // Razorpay's response type allows string|number for amount. We've
    // been passing a JS number, so Number() is safe.
    amount: Number(order.amount),
    currency: order.currency,
    status: order.status,
    receipt: order.receipt ?? null,
  };
}

/**
 * Verify the signature Razorpay sends back on the client-side success
 * callback. Used by the /verify-payment endpoint (defense in depth) in
 * addition to webhook verification.
 *
 * Format: HMAC-SHA256(`${orderId}|${paymentId}`, webhookSecret)
 */
export function verifyRazorpayPaymentSignature(args: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
  secret: string;
}): boolean {
  const { razorpayOrderId, razorpayPaymentId, signature, secret } = args;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${razorpayOrderId}|${razorpayPaymentId}`)
    .digest("hex");
  // Constant-time compare
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Verify a Razorpay webhook signature. `rawBody` must be the exact
 * bytes Razorpay sent (use request.text() in route handlers — JSON.parse
 * normalizes whitespace and breaks the HMAC).
 */
export function verifyRazorpayWebhookSignature(args: {
  rawBody: string;
  signature: string | null;
  secret: string;
}): boolean {
  const { rawBody, signature, secret } = args;
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/**
 * Webhook event typed narrowly — we only handle these.
 */
export interface RazorpayWebhookEvent {
  entity: "event";
  account_id: string;
  event:
    | "payment.captured"
    | "payment.failed"
    | "order.paid"
    | "refund.processed"
    | string;
  contains: string[];
  payload: {
    payment?: {
      entity: {
        id: string;
        order_id: string;
        amount: number;
        currency: string;
        status: string;
        vpa?: string | null;
        email?: string;
        contact?: string;
        fee?: number;
        tax?: number;
        error_code?: string | null;
        error_description?: string | null;
      };
    };
    order?: {
      entity: {
        id: string;
        amount: number;
        amount_paid: number;
        currency: string;
        receipt: string | null;
        status: string;
      };
    };
  };
  created_at: number;
}

export function parseRazorpayWebhook(rawBody: string): RazorpayWebhookEvent {
  return JSON.parse(rawBody) as RazorpayWebhookEvent;
}