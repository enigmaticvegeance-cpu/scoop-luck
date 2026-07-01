/**
 * Resend transactional email client.
 *
 * Server-only. Lazy singleton. Wraps the SDK with our defaults so route
 * handlers never reach for the raw client.
 *
 * We do not include "new" / marketing templates here — this is for
 * transactional email only: invoice delivery, refund confirmations,
 * admin alerts.
 */
import "server-only";

import { Resend } from "resend";

import { serverEnv } from "@/lib/env";
import { log } from "@/lib/log";

let _client: Resend | null = null;

function getClient(): Resend | null {
  if (_client) return _client;
  const env = serverEnv();
  if (!env.RESEND_API_KEY) {
    if (env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY is required in production");
    }
    return null;
  }
  _client = new Resend(env.RESEND_API_KEY);
  return _client;
}

export interface SendInvoiceArgs {
  to: string;
  /** Pre-rendered PDF buffer. */
  pdfBuffer: Uint8Array;
  pdfFilename: string;
  /** What the Superchat said. We render it into the email body. */
  messagePreview: string;
  /** Display name on the invoice. */
  displayName: string;
  /** Already-formatted amount string, e.g. "₹500.00" or "$10.00". */
  amountFormatted: string;
  invoiceNumber: string;
  paidAt: Date;
}

/**
 * Send the invoice email with the PDF attached.
 *
 * Returns the Resend message id on success, or null if the client
 * is unconfigured (dev). Logs but never throws — email failure must
 * not break the payment flow.
 */
export async function sendInvoiceEmail(args: SendInvoiceArgs): Promise<string | null> {
  const env = serverEnv();
  const client = getClient();
  if (!client) {
    log.warn("email.resend_not_configured", { to: "<redacted>" });
    return null;
  }
  if (!env.RESEND_FROM_EMAIL) {
    log.warn("email.from_email_unset", { to: "<redacted>" });
    return null;
  }

  // HTML body — kept simple and accessible. The PDF is the source of
  // truth for compliance; the HTML is just a confirmation.
  const paidAtStr = args.paidAt.toUTCString();
  const html = `
    <!doctype html>
    <html>
      <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111;">
        <h1 style="margin: 0 0 16px 0; font-size: 22px;">Thank you for your support</h1>
        <p style="margin: 0 0 16px 0; line-height: 1.5;">Your superchat of <strong>${escapeHtml(args.amountFormatted)}</strong> was received on ${escapeHtml(paidAtStr)}.</p>
        <blockquote style="border-left: 3px solid #7C3AED; margin: 0 0 16px 0; padding: 8px 16px; color: #444;">${escapeHtml(args.messagePreview)}</blockquote>
        <p style="margin: 0 0 8px 0;">Your invoice is attached as <code>${escapeHtml(args.pdfFilename)}</code>.</p>
        <p style="margin: 0 0 24px 0; color: #666; font-size: 14px;">Invoice number: <strong>${escapeHtml(args.invoiceNumber)}</strong></p>
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="margin: 0; color: #666; font-size: 12px;">This is a transactional message from Scoop Luck. Replies are not monitored.</p>
      </body>
    </html>
  `.trim();

  try {
    const res = await client.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: [args.to],
      subject: `Your Scoop Luck invoice ${args.invoiceNumber}`,
      html,
      attachments: [
        {
          filename: args.pdfFilename,
          // Resend accepts a Buffer or a base64 string. Pass the raw
          // buffer; Resend's SDK converts to base64 internally.
          content: Buffer.from(args.pdfBuffer),
        },
      ],
      headers: {
        "X-Invoice-Number": args.invoiceNumber,
      },
      tags: [{ name: "category", value: "invoice" }],
    });

    if (res.error) {
      log.error("email.send_failed", new Error(res.error.message), {
        invoiceNumber: args.invoiceNumber,
      });
      return null;
    }
    return res.data?.id ?? null;
  } catch (e) {
    log.error("email.send_threw", e instanceof Error ? e : new Error(String(e)), {
      invoiceNumber: args.invoiceNumber,
    });
    return null;
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Send the admin-login OTP email. Best-effort: logs but never throws,
 * matching the invoice email pattern. Returns the Resend message id
 * on success, or null if the client is unconfigured or the send
 * failed.
 *
 * The OTP is included in the email body because it's the secret the
 * user needs to authenticate. We do NOT include it in the subject
 * line (mail clients log subjects in places the user can't see).
 */
export interface SendOtpArgs {
  to: string;
  code: string;
  /** When the code was issued — surfaces in the email so the user
   *  can spot a stale request. */
  issuedAt: Date;
  /** IP address that initiated the request — included as a sanity
   *  check for the user. */
  ip?: string;
}

export async function sendOtpEmail(args: SendOtpArgs): Promise<string | null> {
  const env = serverEnv();
  const client = getClient();
  if (!client) {
    log.warn("email.resend_not_configured", { kind: "otp" });
    return null;
  }
  if (!env.RESEND_FROM_EMAIL) {
    log.warn("email.from_email_unset", { kind: "otp" });
    return null;
  }

  const issuedAtStr = args.issuedAt.toUTCString();
  const html = `
    <!doctype html>
    <html>
      <body style="font-family: -apple-system, system-ui, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #111;">
        <h1 style="margin: 0 0 16px 0; font-size: 22px;">Scoop Luck admin sign-in</h1>
        <p style="margin: 0 0 16px 0; line-height: 1.5;">Enter this 6-digit code to finish signing in. It expires in 10 minutes.</p>
        <div style="margin: 24px 0; padding: 24px; text-align: center; font-size: 32px; letter-spacing: 8px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; background: #f4f4fa; border-radius: 12px;">${escapeHtml(args.code)}</div>
        <p style="margin: 0 0 8px 0; color: #444;">Issued at ${escapeHtml(issuedAtStr)}.</p>
        ${args.ip ? `<p style="margin: 0 0 24px 0; color: #666; font-size: 13px;">From ${escapeHtml(args.ip)}. If this wasn't you, change your password immediately.</p>` : ""}
        <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;" />
        <p style="margin: 0; color: #666; font-size: 12px;">If you didn't request this code, you can ignore this email.</p>
      </body>
    </html>
  `.trim();

  try {
    const res = await client.emails.send({
      from: env.RESEND_FROM_EMAIL,
      to: [args.to],
      subject: "Your Scoop Luck admin code",
      html,
      tags: [{ name: "category", value: "admin-otp" }],
    });
    if (res.error) {
      log.error("email.otp_failed", new Error(res.error.message));
      return null;
    }
    return res.data?.id ?? null;
  } catch (e) {
    log.error("email.otp_threw", e instanceof Error ? e : new Error(String(e)));
    return null;
  }
}