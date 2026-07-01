/**
 * Stripe server SDK wrapper.
 *
 * Server-only. Lazy singleton. Returns a narrow PaymentIntent shape and
 * a single `verifyWebhookEvent()` helper that maps to stripe.webhooks.constructEvent.
 *
 * Reference: https://github.com/stripe/stripe-node
 */
import "server-only";

import Stripe from "stripe";

import { serverEnv } from "@/lib/env";

let _client: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (_client) return _client;
  const env = serverEnv();
  if (!env.STRIPE_SECRET_KEY) {
    if (env.NODE_ENV === "production") throw new Error("Stripe is required in production");
    return null;
  }
  _client = new Stripe(env.STRIPE_SECRET_KEY, {
    // Pin the API version. Stripe recommends pinning to the version the
    // SDK was built against so payload shapes stay stable.
    // (Using the SDK's LatestApiVersion constant.)
    apiVersion: "2026-06-24.dahlia",
    typescript: true,
    // Network knobs — fail fast in dev so we don't hold requests.
    timeout: 20_000,
    maxNetworkRetries: 2,
  });
  return _client;
}

export interface StripePaymentIntentSummary {
  id: string;
  clientSecret: string;
  amount: number; // cents
  currency: string;
  status: Stripe.PaymentIntent.Status;
}

/**
 * Create a PaymentIntent in `automatic_payment_methods` so a single
 * client can capture Visa, Mastercard, Amex, Discover in one form.
 *
 * Stripe Elements handles the PCI-DSS side; we never see card numbers.
 *
 * `idempotencyKey` is sent via the request options (Stripe enforces
 * single-result idempotency for 24h on its end); we ALSO mirror it in
 * metadata so the webhook handler can correlate the PaymentIntent to
 * our Superchat row by metadata.receipt.
 */
export async function createStripePaymentIntent(args: {
  amountCents: number;
  currency: "usd";
  /** UUID we generate to dedupe (and to use as Stripe's idempotency key). */
  receipt: string;
  metadata: Record<string, string>;
}): Promise<StripePaymentIntentSummary> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe not configured");
  const intent = await stripe.paymentIntents.create(
    {
      amount: args.amountCents,
      currency: args.currency,
      automatic_payment_methods: { enabled: true },
      metadata: { receipt: args.receipt, ...args.metadata },
    },
    { idempotencyKey: args.receipt },
  );
  if (!intent.client_secret) {
    throw new Error("Stripe returned a payment intent without a client_secret");
  }
  return {
    id: intent.id,
    clientSecret: intent.client_secret,
    amount: intent.amount,
    currency: intent.currency,
    status: intent.status,
  };
}

/**
 * Verify a Stripe webhook event using the official SDK. Throws on
 * invalid signature — callers MUST catch and return 400.
 *
 * `rawBody` MUST be the un-parsed string the gateway sent (use request.text()).
 * Construct-event uses the SHA-256 HMAC under the hood; whitespace
 * normalization breaks it.
 */
export function verifyStripeWebhookEvent(args: {
  rawBody: string;
  signature: string | null;
}): Stripe.Event {
  const env = serverEnv();
  const stripe = getStripe();
  if (!stripe || !env.STRIPE_WEBHOOK_SECRET) throw new Error("Stripe webhook not configured");
  if (!args.signature) throw new Error("Missing Stripe-Signature header");
  return stripe.webhooks.constructEvent(args.rawBody, args.signature, env.STRIPE_WEBHOOK_SECRET);
}