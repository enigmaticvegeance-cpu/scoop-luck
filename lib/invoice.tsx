/**
 * Invoice PDF generator.
 *
 * Server-only. Renders a one-page invoice PDF from a Superchat row +
 * platform Settings. Returns a Buffer ready to attach to an email or
 * serve from an API route.
 *
 * Reference: https://react-pdf.org/components
 *
 * Important: we render every free-text field with htmlEscape (NOT
 * React's default for PDF strings, which is plain text). The PDF text
 * doesn't interpret HTML, but we want to neutralize any angle brackets
 * or ampersands so the file renders identically across PDF readers.
 */
import "server-only";

import React from "react";
import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";

import type { Superchat, Settings } from "@/generated/prisma/client";
import { htmlEscape } from "@/lib/security";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 10,
    paddingTop: 48,
    paddingHorizontal: 48,
    paddingBottom: 64,
    color: "#111",
    lineHeight: 1.5,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 32,
  },
  platformName: {
    fontSize: 18,
    fontWeight: 700,
  },
  platformMeta: {
    fontSize: 9,
    color: "#555",
    marginTop: 4,
  },
  invoiceMeta: {
    textAlign: "right",
    fontSize: 9,
  },
  invoiceTitle: {
    fontSize: 22,
    fontWeight: 700,
    color: "#7C3AED",
    marginBottom: 4,
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    marginVertical: 16,
  },
  twoColRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  col: {
    width: "48%",
  },
  colLabel: {
    fontSize: 9,
    color: "#666",
    textTransform: "uppercase",
    marginBottom: 4,
  },
  colValue: {
    fontSize: 11,
  },
  messageBox: {
    padding: 12,
    backgroundColor: "#f8f8fb",
    borderLeftWidth: 3,
    borderLeftColor: "#7C3AED",
    marginVertical: 12,
    fontSize: 11,
    fontStyle: "italic",
  },
  table: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#eee",
  },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f4f4f8",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
    fontWeight: 700,
    fontSize: 10,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f4",
  },
  tableRowLast: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#fafafe",
    fontWeight: 700,
  },
  cellDescription: { width: "60%" },
  cellAmount: { width: "20%", textAlign: "right" },
  cellAmountWide: { width: "40%", textAlign: "right" },
  footer: {
    position: "absolute",
    fontSize: 8,
    bottom: 32,
    left: 48,
    right: 48,
    textAlign: "center",
    color: "#999",
  },
  paidStamp: {
    fontSize: 12,
    color: "#10B981",
    fontWeight: 700,
    marginTop: 4,
  },
});

interface InvoiceProps {
  superchat: Superchat;
  settings: Settings;
  /** Pre-computed invoice number (caller stores it on the Superchat row). */
  invoiceNumber: string;
}

/**
 * Render a single Superchat + Settings into an invoice PDF buffer.
 *
 * Currency formatting uses Intl.NumberFormat with the Superchat's
 * recorded currency (INR or USD). For tier preview / display on the
 * PDF we just show the gross amount — the original receipt.
 */
export async function renderInvoicePdf(args: InvoiceProps): Promise<Buffer> {
  const { superchat, settings, invoiceNumber } = args;
  const paidAt = superchat.paidAt ?? new Date();

  const fmt = new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: superchat.currency,
    minimumFractionDigits: 2,
  });
  const amountFormatted = fmt.format(superchat.amountPaise / 100);

  // Gateway label. We don't expose internal IDs in the receipt.
  const gatewayLabel =
    superchat.gateway === "RAZORPAY"
      ? "Razorpay (UPI / Card / NetBanking)"
      : superchat.gateway === "STRIPE"
        ? "Stripe (Card)"
        : "PayPal";

  const doc = (
    <Document
      title={`Invoice ${invoiceNumber}`}
      author={settings.platformLegalName}
      subject="Scoop Luck superchat receipt"
    >
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.platformName}>{htmlEscape(settings.platformLegalName)}</Text>
            {settings.platformAddress ? (
              <Text style={styles.platformMeta}>{htmlEscape(settings.platformAddress)}</Text>
            ) : null}
            {settings.platformGstin ? (
              <Text style={styles.platformMeta}>GSTIN: {htmlEscape(settings.platformGstin)}</Text>
            ) : null}
          </View>
          <View style={styles.invoiceMeta}>
            <Text style={styles.invoiceTitle}>INVOICE</Text>
            <Text>{htmlEscape(invoiceNumber)}</Text>
            <Text>Issued: {paidAt.toUTCString()}</Text>
            <Text style={styles.paidStamp}>PAID</Text>
          </View>
        </View>

        <View style={styles.hr} />

        {/* Bill-to / Payment summary */}
        <View style={styles.twoColRow}>
          <View style={styles.col}>
            <Text style={styles.colLabel}>From</Text>
            <Text style={styles.colValue}>{htmlEscape(settings.platformLegalName)}</Text>
            {settings.platformAddress ? (
              <Text style={styles.platformMeta}>{htmlEscape(settings.platformAddress)}</Text>
            ) : null}
          </View>
          <View style={styles.col}>
            <Text style={styles.colLabel}>Payment method</Text>
            <Text style={styles.colValue}>{gatewayLabel}</Text>
            <Text style={styles.platformMeta}>
              Reference: {htmlEscape(superchat.gatewayOrderId)}
            </Text>
            {superchat.gatewayPaymentId ? (
              <Text style={styles.platformMeta}>
                Gateway txn: {htmlEscape(superchat.gatewayPaymentId)}
              </Text>
            ) : null}
          </View>
        </View>

        {/* Message preview */}
        <View>
          <Text style={styles.colLabel}>Superchat message</Text>
          <View style={styles.messageBox}>
            <Text>{htmlEscape(superchat.message)}</Text>
          </View>
          <Text style={styles.platformMeta}>
            From: {htmlEscape(superchat.displayName)}
            {superchat.userId ? "" : " (anonymous)"}
          </Text>
        </View>

        {/* Line items */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={styles.cellDescription}>Description</Text>
            <Text style={styles.cellAmount}>Qty</Text>
            <Text style={styles.cellAmount}>Amount</Text>
          </View>
          <View style={styles.tableRow}>
            <Text style={styles.cellDescription}>Superchat donation</Text>
            <Text style={styles.cellAmount}>1</Text>
            <Text style={styles.cellAmount}>{amountFormatted}</Text>
          </View>
          <View style={styles.tableRowLast}>
            <Text style={styles.cellDescription}>Total paid</Text>
            <Text style={styles.cellAmount}></Text>
            <Text style={styles.cellAmount}>{amountFormatted}</Text>
          </View>
        </View>

        {/* Footer */}
        <Text style={styles.footer} fixed>
          Invoice {htmlEscape(invoiceNumber)} — generated by Scoop Luck.
          {"\n"}
          This is a computer-generated receipt and is valid without a signature.
        </Text>
      </Page>
    </Document>
  );

  return renderToBuffer(doc);
}

/**
 * Generate a deterministic invoice number from a Superchat UUID.
 *
 * Format: INV-YYYYMM-XXXXXXXX (8 hex chars of the UUID's first 16 bits).
 * For multi-month usage we still get collisions under extreme volume, but
 * we keep the unique index on Superchat.invoiceNumber as the safety net.
 */
export function mintInvoiceNumber(superchatId: string, when: Date = new Date()): string {
  const yyyy = when.getUTCFullYear();
  const mm = String(when.getUTCMonth() + 1).padStart(2, "0");
  // First 8 hex chars of the UUID — no PII, just an identifier.
  const tail = superchatId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `INV-${yyyy}${mm}-${tail}`;
}