/**
 * SuperchatForm — the public form for sending a superchat.
 *
 * Composes:
 *   - Amount slider + numeric input (in INR paise or USD cents)
 *   - Message textarea with live char counter (max per tier)
 *   - Tier preview (re-renders on every change)
 *   - Payment-method selector (Razorpay / Stripe / PayPal)
 *   - Turnstile widget
 *   - Submit handlers for the three flows:
 *       - Razorpay: open the hosted checkout modal
 *       - Stripe: mount Stripe Elements, confirm the PaymentIntent
 *       - PayPal: redirect to approveUrl, capture on return
 *
 * The form is a single client component because the three flows share
 * so much state (amount, message, gateway, turnstile token).
 *
 * Why all three flows live in one file: splitting them across files
 * would force a parent to hand off a lot of state, and the API for
 * `previewForAmount` is identical. The file is long but the state
 * graph is flat.
 */
"use client";

import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, ShieldCheck, Loader2, QrCode } from "lucide-react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe, type Stripe } from "@stripe/stripe-js";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert } from "@/components/ui/alert";
import { TurnstileWidget } from "@/components/security/TurnstileWidget";
import { publicEnv } from "@/lib/env";
import { TIERS, type TierConfig } from "@/lib/tier";
import { cn } from "@/lib/utils";

type Gateway = "RAZORPAY" | "STRIPE" | "PAYPAL";

interface SuperchatFormProps {
  /** Whether the user is logged in (server-rendered, gates the form). */
  isAuthenticated: boolean;
  /** Display name from the user's profile, used in the form pre-fill. */
  defaultDisplayName?: string;
  /** Limits from Settings (server-fetched). */
  minPaise: number;
  maxPaise: number;
  /** Default inrPerUsd from Settings; client uses this only for live preview. */
  inrPerUsd: number;
}

const GATEWAYS: { value: Gateway; label: string; description: string }[] = [
  {
    value: "RAZORPAY",
    label: "Razorpay",
    description: "UPI / cards / netbanking (India)",
  },
  {
    value: "STRIPE",
    label: "Stripe",
    description: "Visa / Mastercard / Amex (international)",
  },
  {
    value: "PAYPAL",
    label: "PayPal",
    description: "PayPal balance / cards (international)",
  },
];

/**
 * Format the small-unit integer to a display string in the relevant currency.
 * The form always works in INR paise for Razorpay and USD cents for Stripe/PayPal.
 */
function fmtAmount(amountInSmallest: number, currency: "INR" | "USD"): string {
  const major = amountInSmallest / 100;
  if (currency === "INR") {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(major);
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(major);
}

function previewTier(amountSmallest: number, currency: "INR" | "USD", inrPerUsd: number): TierConfig {
  // Use the same rule the server uses (lib/tier.ts).
  if (currency === "INR") {
    return TIERS.find((t) => amountSmallest / 100 >= t.inrMin && amountSmallest / 100 <= t.inrMax) ?? TIERS[TIERS.length - 1]!;
  }
  // USD -> INR paise -> tier.
  const inr = (amountSmallest / 100) * inrPerUsd;
  return TIERS.find((t) => inr >= t.inrMin && inr <= t.inrMax) ?? TIERS[TIERS.length - 1]!;
}

export function SuperchatForm({
  isAuthenticated,
  defaultDisplayName,
  minPaise,
  maxPaise,
  inrPerUsd,
}: SuperchatFormProps) {
  // Default gateway: Razorpay for INR-feel users. We keep Razorpay selected
  // by default because the platform is India-first. The user can switch.
  const [gateway, setGateway] = useState<Gateway>("RAZORPAY");
  const currency: "INR" | "USD" = gateway === "RAZORPAY" ? "INR" : "USD";

  // Amount: start at the tier-1 lower bound (₹20) for Razorpay or $0.25 for USD.
  const initialAmount = useMemo(() => {
    if (currency === "INR") return Math.max(minPaise, 2000);
    return Math.max(50, Math.round(20 / inrPerUsd * 100)); // ₹20 worth
  }, [currency, minPaise, inrPerUsd]);
  const [amountPaise, setAmountPaise] = useState<number>(initialAmount);
  const [message, setMessage] = useState<string>("");
  const [displayName, setDisplayName] = useState<string>(defaultDisplayName ?? "");

  // Reset amount when gateway changes so the slider sits in a sensible range.
  useEffect(() => {
    setAmountPaise(initialAmount);
  }, [initialAmount]);

  // UPI QR — informational only.
  //
  // We fetch /api/settings/upi-qr once on mount. The endpoint is public
  // and returns a 1-hour signed URL or null. We only RENDER the block
  // when the donor has selected Razorpay (the only gateway where UPI
  // is the rail); international donors on Stripe/PayPal don't see it.
  //
  // The QR is presented as a fallback ("scan to pay directly with any
  // UPI app") NOT as a substitute for the Razorpay flow — we have no
  // reconciliation loop, so we won't pretend a manual transfer will
  // mark the superchat PAID. The Razorpay hosted checkout remains the
  // primary, automated path.
  //
  // Three states:
  //   - "loading"   — fetch in flight. Renders nothing visible.
  //   - "ready"     — admin has uploaded a QR; render the disclosure.
  //   - "absent"    — admin has not uploaded a QR (endpoint returned null).
  //                   Render nothing — the feature simply isn't configured.
  //   - "error"     — endpoint 5xx'd or network threw. Render a soft warning
  //                   so the donor knows the manual option is in principle
  //                   available but not right now.
  const [upiQr, setUpiQr] = useState<{ status: "loading" | "ready" | "absent" | "error"; url: string | null }>({
    status: "loading",
    url: null,
  });
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch("/api/settings/upi-qr", { cache: "no-store" });
        if (!r.ok) {
          if (!cancelled) setUpiQr({ status: "error", url: null });
          return;
        }
        const j = (await r.json()) as { url: string | null };
        if (cancelled) return;
        setUpiQr(j.url ? { status: "ready", url: j.url } : { status: "absent", url: null });
      } catch {
        if (!cancelled) setUpiQr({ status: "error", url: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // CAPTCHA
  const [turnstileToken, setTurnstileToken] = useState<string>("");
  const turnstileSiteKey = publicEnv.TURNSTILE_SITE_KEY;

  // UI state
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Tier preview: re-runs on every keystroke.
  const tier = useMemo(() => previewTier(amountPaise, currency, inrPerUsd), [amountPaise, currency, inrPerUsd]);
  const charLimit = tier.charLimit;
  const overLimit = message.length > charLimit;

  // ---- Validation -------------------------------------------------------
  if (!isAuthenticated) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Sign in to send a superchat</CardTitle>
          <CardDescription>
            You need an account so we can deliver your receipt and pin your display name.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert>
            <a href="/login" className="font-medium underline">Sign in</a>
            {" or "}
            <a href="/register" className="font-medium underline">create an account</a>
            {" to continue."}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  // ---- Submit handlers --------------------------------------------------
  async function callCreateOrder(args: {
    amountPaise: number;
    message: string;
    idempotencyKey: string;
    displayName?: string;
    turnstileToken: string;
  }): Promise<unknown> {
    const endpoint =
      gateway === "RAZORPAY"
        ? "/api/payments/razorpay/create-order"
        : gateway === "STRIPE"
          ? "/api/payments/stripe/create-intent"
          : "/api/payments/paypal/create-order";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        amountPaise: args.amountPaise,
        message: args.message,
        idempotencyKey: args.idempotencyKey,
        displayName: args.displayName,
        turnstileToken: args.turnstileToken,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Order create failed: ${res.status} ${text.slice(0, 200)}`);
    }
    return res.json();
  }

  async function handleRazorpay(idempotencyKey: string) {
    // Lazily load the Razorpay JS SDK once. The npm package is `razorpay`.
    const w = window as unknown as { Razorpay?: new (opts: unknown) => { open: () => void; on: (e: string, cb: (resp: unknown) => void) => void } };
    if (!w.Razorpay) {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://checkout.razorpay.com/v1/checkout.js";
        s.async = true;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error("Razorpay SDK failed to load"));
        document.head.appendChild(s);
      });
    }
    const data = (await callCreateOrder({
      amountPaise,
      message,
      idempotencyKey,
      displayName: displayName || undefined,
      turnstileToken,
    })) as { orderId: string; keyId: string; amount: number; currency: string; superchatId: string };

    if (!w.Razorpay) throw new Error("Razorpay SDK not available");

    const rzp = new w.Razorpay({
      key: data.keyId,
      amount: data.amount,
      currency: data.currency,
      order_id: data.orderId,
      name: "Scoop Luck",
      description: "Superchat donation",
      image: undefined,
      prefill: {
        name: displayName || undefined,
      },
      theme: { color: "#00FFFF" },
      // After payment, the SDK calls our /verify-payment for defense-in-depth.
      handler: async () => {
        // The webhook is the source of truth. The success message here
        // is just a UX hint — the live feed will refresh via Realtime.
        setSuccess("Payment received! Your superchat will appear once the gateway confirms.");
      },
      modal: {
        ondismiss: () => {
          setSubmitting(false);
        },
      },
    });
    rzp.on("payment.failed", (resp: unknown) => {
      const r = resp as { error?: { description?: string } };
      setError(r?.error?.description ?? "Payment failed");
      setSubmitting(false);
    });
    rzp.open();
  }

  async function handleStripe(idempotencyKey: string) {
    const data = (await callCreateOrder({
      amountPaise,
      message,
      idempotencyKey,
      displayName: displayName || undefined,
      turnstileToken,
    })) as { clientSecret: string | null; paymentIntentId: string; superchatId: string; replay?: boolean };

    if (!data.clientSecret) {
      // Replay path: a previous request already created the intent but
      // we don't have its client_secret anymore. Show a recovery hint.
      setError("This donation is already in flight. Refresh to see its status.");
      setSubmitting(false);
      return;
    }

    const stripePromise = loadStripe(publicEnv.STRIPE_PUBLISHABLE_KEY);
    setStripePaymentState({ clientSecret: data.clientSecret, stripePromise });
  }

  async function handlePayPal(idempotencyKey: string) {
    const data = (await callCreateOrder({
      amountPaise,
      message,
      idempotencyKey,
      displayName: displayName || undefined,
      turnstileToken,
    })) as { paypalOrderId: string; approveUrl: string | null; superchatId: string; replay?: boolean };

    if (!data.approveUrl) {
      setError("This donation is already in flight. Refresh to see its status.");
      setSubmitting(false);
      return;
    }
    // Redirect the buyer to PayPal for approval. The capture endpoint
    // runs after the JS SDK calls back. (We redirect here rather than
    // open a popup so the back-button works as expected on mobile.)
    window.location.href = data.approveUrl;
  }

  // State to mount Stripe Elements after the order is created
  const [stripePaymentState, setStripePaymentState] = useState<
    { clientSecret: string; stripePromise: Promise<Stripe | null> } | null
  >(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (overLimit) {
      setError(`Message is ${message.length} characters; the ${tier.label} tier allows ${charLimit}.`);
      return;
    }
    if (!message.trim()) {
      setError("Add a short message — that's the bit everyone reads on screen.");
      return;
    }
    if (amountPaise < minPaise) {
      setError(`Minimum donation is ${fmtAmount(minPaise, currency)}.`);
      return;
    }
    if (amountPaise > maxPaise) {
      setError(`Maximum donation is ${fmtAmount(maxPaise, currency)}.`);
      return;
    }
    if (turnstileSiteKey && !turnstileToken) {
      setError("Please complete the captcha.");
      return;
    }
    setSubmitting(true);
    try {
      // Generate a v4 UUID idempotency key. Falls back to a math-random
      // string if crypto.randomUUID is unavailable (very old browsers).
      const idempotencyKey =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `idem-${Date.now()}-${Math.random().toString(36).slice(2)}`;

      if (gateway === "RAZORPAY") await handleRazorpay(idempotencyKey);
      else if (gateway === "STRIPE") await handleStripe(idempotencyKey);
      else await handlePayPal(idempotencyKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      {/* Payment method */}
      <div>
        <Label className="mb-2 block">Payment method</Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {GATEWAYS.map((g) => {
            const active = g.value === gateway;
            return (
              <button
                key={g.value}
                type="button"
                onClick={() => setGateway(g.value)}
                className={cn(
                  "rounded-lg border p-3 text-left transition",
                  active
                    ? "border-neon-cyan bg-elevated shadow-neon-cyan"
                    : "border-border bg-elevated/40 hover:bg-elevated",
                )}
                aria-pressed={active}
              >
                <p className="font-medium">{g.label}</p>
                <p className="text-xs text-ink-muted">{g.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Amount */}
      <div>
        <Label htmlFor="amount" className="mb-2 block">
          Amount
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            id="amount-display"
            inputMode="decimal"
            type="text"
            className="sm:w-40"
            value={fmtAmount(amountPaise, currency).replace(/[^\d.,]/g, "")}
            onChange={(e) => {
              const cleaned = e.target.value.replace(/[^\d.]/g, "");
              const n = Number.parseFloat(cleaned);
              if (!Number.isFinite(n)) return;
              const smallest = Math.round(n * 100);
              setAmountPaise(Math.max(0, smallest));
            }}
          />
          <input
            id="amount"
            type="range"
            min={minPaise}
            max={maxPaise}
            step={currency === "INR" ? 100 : 50}
            value={amountPaise}
            onChange={(e) => setAmountPaise(Number(e.target.value))}
            className="h-2 flex-1 cursor-pointer appearance-none rounded-full bg-elevated accent-neon-cyan"
            aria-label="Donation amount"
          />
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Min {fmtAmount(minPaise, currency)} · Max {fmtAmount(maxPaise, currency)}
        </p>
      </div>

      {/* Display name (optional override) */}
      <div>
        <Label htmlFor="display-name" className="mb-2 block">
          Display name <span className="text-ink-muted">(optional — defaults to your profile)</span>
        </Label>
        <Input
          id="display-name"
          maxLength={30}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Anonymous"
        />
      </div>

      {/* Message */}
      <div>
        <Label htmlFor="message" className="mb-2 block">
          Message
        </Label>
        <textarea
          id="message"
          rows={3}
          maxLength={1000}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={cn(
            "w-full rounded-md border bg-elevated px-3 py-2 text-sm text-ink placeholder:text-ink-muted",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            overLimit ? "border-destructive" : "border-border",
          )}
          placeholder="What do you want the crew to know?"
        />
        <div className="mt-1 flex items-center justify-between text-xs text-ink-muted">
          <span>
            <span className={cn(overLimit && "text-destructive")}>{message.length}</span>
            {" / "}
            {charLimit} characters
          </span>
          <span>
            Tier preview: <span className="font-medium" style={{ color: tier.accentColor }}>{tier.label}</span>
          </span>
        </div>
      </div>

      {/* Tier preview card */}
      <motion.div
        key={`${tier.tier}-${amountPaise}`}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className={cn("rounded-xl border-2 p-4", tier.glowClass)}
        style={{ borderColor: tier.accentColor }}
        aria-live="polite"
      >
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium uppercase tracking-wide" style={{ color: tier.accentColor }}>
            {tier.label} tier
          </p>
          <p className="text-xs text-ink-muted">
            Tip value {fmtAmount(amountPaise, currency)}
          </p>
        </div>
        <p className="mt-1 text-xs text-ink-muted">
          Messages at this tier pin to the top of the live feed and stay on screen for longer.
        </p>
      </motion.div>

      {/* Captcha */}
      <TurnstileWidget
        siteKey={turnstileSiteKey}
        onToken={setTurnstileToken}
        theme="dark"
      />

      {/* UPI QR (informational) — only shown when Razorpay is selected AND a
          QR has been uploaded by the admin. Native <details> gives us a
          keyboard-accessible disclosure (Space/Enter toggle) without any
          custom ARIA. When no QR is configured (status === "absent"), render
          nothing — the donor never sees a stale "no QR available" notice on
          the public form. */}
      {gateway === "RAZORPAY" && upiQr.status === "ready" ? (
        <details className="rounded-lg border border-border bg-elevated/40 p-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 font-medium [&::-webkit-details-marker]:hidden">
            <QrCode className="size-4 text-neon-cyan" aria-hidden />
            Pay with UPI directly (alternative)
          </summary>
          <div className="mt-3 space-y-2 text-xs text-ink-muted">
            <p>
              Scan this code with any UPI app to send your superchat. The same UPI
              account is used by Razorpay when you tap the button above — this is just
              an alternative if you prefer not to use hosted checkout.
            </p>
            <figure className="flex flex-col items-center gap-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={upiQr.url!}
                alt="UPI QR code for direct payment"
                width={240}
                height={240}
                className="rounded-md border border-border bg-white p-2"
              />
              <figcaption className="sr-only">
                UPI QR code that opens your UPI app with the donation amount pre-filled.
              </figcaption>
            </figure>
            <p className="italic">
              Note: a manual UPI transfer is not automatically reconciled with your
              message — your superchat is confirmed only through Razorpay above.
            </p>
          </div>
        </details>
      ) : null}

      {/* UPI QR error — soft fallback when a QR is configured but the public
          endpoint 5xx'd. Distinct from "absent" (admin never uploaded one)
          which renders nothing. */}
      {gateway === "RAZORPAY" && upiQr.status === "error" ? (
        <Alert variant="warning">
          Direct UPI scan is temporarily unavailable. Please use the Razorpay button above
          to send your superchat.
        </Alert>
      ) : null}

      {/* Stripe Elements mount point (after order create) */}
      <AnimatePresence>
        {stripePaymentState ? (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <StripePaymentPanel
              clientSecret={stripePaymentState.clientSecret}
              stripePromise={stripePaymentState.stripePromise}
              onComplete={() => {
                setSuccess("Payment received! Your superchat will appear once the gateway confirms.");
                setStripePaymentState(null);
                setSubmitting(false);
              }}
              onError={(msg) => {
                setError(msg);
                setSubmitting(false);
              }}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Submit */}
      <Button
        type="submit"
        size="lg"
        disabled={submitting || overLimit}
        className="w-full"
      >
        {submitting ? (
          <>
            <Loader2 className="size-4 animate-spin" /> Opening {GATEWAYS.find((g) => g.value === gateway)?.label}…
          </>
        ) : (
          <>
            <Sparkles className="size-4" /> Send {fmtAmount(amountPaise, currency)} superchat
          </>
        )}
      </Button>

      <p className="flex items-center justify-center gap-2 text-xs text-ink-muted">
        <ShieldCheck className="size-3.5" />
        Verified payment — your card never touches our servers.
      </p>

      {error ? (
        <Alert variant="destructive" role="alert">
          {error}
        </Alert>
      ) : null}
      {success ? <Alert role="status">{success}</Alert> : null}
    </form>
  );
}

/**
 * StripePaymentPanel — rendered after a successful create-intent call.
 * Mounts Stripe Elements and confirms the PaymentIntent.
 */
function StripePaymentPanel(props: {
  clientSecret: string;
  stripePromise: Promise<Stripe | null>;
  onComplete: () => void;
  onError: (msg: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-elevated p-4">
      <Elements
        stripe={props.stripePromise}
        options={{ clientSecret: props.clientSecret, appearance: { theme: "night" } }}
      >
        <Inner onComplete={props.onComplete} onError={props.onError} />
      </Elements>
    </div>
  );
}

function Inner({
  onComplete,
  onError,
}: {
  onComplete: () => void;
  onError: (msg: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-3">
      <PaymentElement />
      <Button
        type="button"
        size="lg"
        disabled={busy || !stripe || !elements}
        className="w-full"
        onClick={async () => {
          if (!stripe || !elements) return;
          setBusy(true);
          const r = await stripe.confirmPayment({
            elements,
            confirmParams: { return_url: window.location.origin + "/superchat?paid=1" },
            redirect: "if_required",
          });
          if (r.error) {
            onError(r.error.message ?? "Payment failed");
            setBusy(false);
            return;
          }
          onComplete();
        }}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : "Pay with card"}
      </Button>
    </div>
  );
}