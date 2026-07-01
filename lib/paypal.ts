/**
 * PayPal REST API wrapper.
 *
 * Server-only. The official @paypal/paypal-server-sdk pulls in a heavy
 * dependency tree that's not always necessary — for two endpoints
 * (create order, capture order) plus an OAuth dance, a thin hand-rolled
 * wrapper is clearer and easier to test.
 *
 * References:
 *   - https://developer.paypal.com/api/rest/reference/orders/v2/orders/create/
 *   - https://developer.paypal.com/api/rest/reference/orders/v2/orders/capture/
 *   - https://developer.paypal.com/api/rest/webhooks/event-names/
 */
import "server-only";

import { serverEnv } from "@/lib/env";

type PayPalEnv = "sandbox" | "live";

function paypalBaseUrl(env: PayPalEnv): string {
  return env === "live"
    ? "https://api-m.paypal.com"
    : "https://api-m.sandbox.paypal.com";
}

function paypalEnvVar(): PayPalEnv {
  return process.env.PAYPAL_ENV === "live" ? "live" : "sandbox";
}

/**
 * OAuth access token. PayPal short-lived; we cache until expiry.
 */
interface TokenCache {
  accessToken: string;
  expiresAt: number; // epoch ms
}

let _tokenCache: TokenCache | null = null;

async function getAccessToken(): Promise<string> {
  const env = serverEnv();
  if (!env.PAYPAL_CLIENT_ID || !env.PAYPAL_CLIENT_SECRET) {
    throw new Error("PayPal credentials not configured");
  }
  if (_tokenCache && _tokenCache.expiresAt > Date.now() + 30_000) {
    return _tokenCache.accessToken;
  }
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${paypalBaseUrl(paypalEnvVar())}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal OAuth failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  _tokenCache = {
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

export interface PayPalOrderSummary {
  id: string;
  status: string;
  approveUrl: string | null;
}

interface RawPayPalOrder {
  id: string;
  status: string;
  links: { href: string; rel: string }[];
}

function extractApproveUrl(order: RawPayPalOrder): string | null {
  return order.links.find((l) => l.rel === "approve")?.href ?? null;
}

/**
 * Create a PayPal order with capture-on-approval intent.
 * The PayPal JS SDK redirects the buyer to `approveUrl`; on return we
 * capture server-side.
 */
export async function createPayPalOrder(args: {
  amountUsd: string; // string because PayPal accepts fractional dollars
  receipt: string;
  description: string;
}): Promise<PayPalOrderSummary> {
  const token = await getAccessToken();
  const res = await fetch(`${paypalBaseUrl(paypalEnvVar())}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: args.receipt,
          description: args.description,
          amount: {
            currency_code: "USD",
            value: args.amountUsd,
          },
        },
      ],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal createOrder failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as RawPayPalOrder;
  return {
    id: json.id,
    status: json.status,
    approveUrl: extractApproveUrl(json),
  };
}

export interface PayPalCapture {
  id: string; // order id
  status: "COMPLETED" | "DECLINED" | string;
  payerEmail?: string;
}

/**
 * Capture a previously-created order. Called by the /capture-payment
 * endpoint after the PayPal JS SDK reports the buyer approved.
 */
export async function capturePayPalOrder(orderId: string): Promise<PayPalCapture> {
  const token = await getAccessToken();
  const res = await fetch(`${paypalBaseUrl(paypalEnvVar())}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PayPal captureOrder failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    id: string;
    status: string;
    payer?: { email_address?: string };
  };
  return {
    id: json.id,
    status: json.status,
    payerEmail: json.payer?.email_address,
  };
}

/**
 * Verify a PayPal webhook signature using the REST API.
 *
 * Reference: https://developer.paypal.com/api/rest/webhooks/event-names/
 *
 * PayPal no longer supports SDK-based verification — you must POST to
 * /v1/notifications/verify-webhook-signature with the headers + body
 * and check the response's `verification_status`.
 */
export interface PayPalWebhookHeaders {
  authAlgo: string;
  certUrl: string;
  certId: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
}

export async function verifyPayPalWebhook(args: {
  headers: PayPalWebhookHeaders;
  rawBody: string;
}): Promise<boolean> {
  const env = serverEnv();
  if (!env.PAYPAL_WEBHOOK_ID) return false;
  const token = await getAccessToken();
  const res = await fetch(
    `${paypalBaseUrl(paypalEnvVar())}/v1/notifications/verify-webhook-signature`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        auth_algo: args.headers.authAlgo,
        cert_url: args.headers.certUrl,
        cert_id: args.headers.certId,
        transmission_id: args.headers.transmissionId,
        transmission_sig: args.headers.transmissionSig,
        transmission_time: args.headers.transmissionTime,
        webhook_id: env.PAYPAL_WEBHOOK_ID,
        webhook_event: JSON.parse(args.rawBody),
      }),
    },
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { verification_status: "SUCCESS" | "FAILURE" | "PENDING" };
  return json.verification_status === "SUCCESS";
}

/**
 * Shape of the events we handle. PayPal sends many; we only care about
 * capture-completed and capture-refunded.
 */
export interface PayPalWebhookEvent {
  id: string;
  event_type:
    | "CHECKOUT.ORDER.COMPLETED"
    | "PAYMENT.CAPTURE.COMPLETED"
    | "PAYMENT.CAPTURE.REFUNDED"
    | "CHECKOUT.ORDER.APPROVED"
    | string;
  resource: {
    id: string; // capture id
    supplementary_data?: { related_ids?: { order_id?: string } };
    amount?: { currency_code: string; value: string };
    status?: string;
    payer?: { email_address?: string };
  };
  create_time: string;
}

export function parsePayPalWebhook(rawBody: string): PayPalWebhookEvent {
  return JSON.parse(rawBody) as PayPalWebhookEvent;
}