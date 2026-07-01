import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

import {
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from "@/lib/razorpay";

describe("verifyRazorpayPaymentSignature", () => {
  const secret = "whsec_test_super_secret";

  it("accepts a signature produced with the canonical format", () => {
    // Format: HMAC-SHA256(`${orderId}|${paymentId}`, secret)
    const orderId = "order_AAA";
    const paymentId = "pay_BBB";
    const expected = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    expect(
      verifyRazorpayPaymentSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        signature: expected,
        secret,
      }),
    ).toBe(true);
  });

  it("rejects a signature with a tampered payment id", () => {
    const orderId = "order_AAA";
    const paymentId = "pay_BBB";
    const sig = crypto
      .createHmac("sha256", secret)
      .update(`${orderId}|${paymentId}`)
      .digest("hex");
    expect(
      verifyRazorpayPaymentSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: "pay_CCC", // tampered
        signature: sig,
        secret,
      }),
    ).toBe(false);
  });

  it("rejects a signature with a wrong secret", () => {
    const sig = crypto
      .createHmac("sha256", "wrong-secret")
      .update("order_AAA|pay_BBB")
      .digest("hex");
    expect(
      verifyRazorpayPaymentSignature({
        razorpayOrderId: "order_AAA",
        razorpayPaymentId: "pay_BBB",
        signature: sig,
        secret,
      }),
    ).toBe(false);
  });

  it("rejects a different-length signature", () => {
    // Buffer.from(sig, 'hex') requires even length. A truncated input
    // should fail the length check.
    expect(
      verifyRazorpayPaymentSignature({
        razorpayOrderId: "order_AAA",
        razorpayPaymentId: "pay_BBB",
        signature: "abc",
        secret,
      }),
    ).toBe(false);
  });
});

describe("verifyRazorpayWebhookSignature", () => {
  const secret = "whsec_test_super_secret";

  it("accepts a signature produced over the exact raw body", () => {
    const body = JSON.stringify({ event: "payment.captured", payload: { x: 1 } });
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(
      verifyRazorpayWebhookSignature({ rawBody: body, signature: sig, secret }),
    ).toBe(true);
  });

  it("rejects when the body has been modified", () => {
    // Simulate a tamper: the canonical body has a specific structure;
    // an attacker who re-serialized it (or edited a field) produces a
    // different byte sequence and the HMAC fails.
    const original = '{"event":"payment.captured","payload":{"x":1}}';
    const sig = crypto.createHmac("sha256", secret).update(original).digest("hex");
    const tampered = '{"event":"payment.failed","payload":{"x":1}}';
    expect(
      verifyRazorpayWebhookSignature({ rawBody: tampered, signature: sig, secret }),
    ).toBe(false);
  });

  it("accepts a body with extra trailing whitespace IF the signature was computed over that whitespace", () => {
    // Whitespace differences break the HMAC. The server-side handler
    // MUST pass request.text() verbatim — never JSON.parse then re-stringify.
    const body = '{"a":1}';
    const sig = crypto.createHmac("sha256", secret).update(body).digest("hex");
    // Same content but a trailing newline: different bytes, different HMAC.
    expect(
      verifyRazorpayWebhookSignature({ rawBody: body + "\n", signature: sig, secret }),
    ).toBe(false);
  });

  it("rejects an absent signature", () => {
    expect(
      verifyRazorpayWebhookSignature({ rawBody: "{}", signature: null, secret }),
    ).toBe(false);
  });

  it("rejects a signature produced with a different secret", () => {
    const body = '{"a":1}';
    const sig = crypto.createHmac("sha256", "wrong-secret").update(body).digest("hex");
    expect(
      verifyRazorpayWebhookSignature({ rawBody: body, signature: sig, secret }),
    ).toBe(false);
  });
});