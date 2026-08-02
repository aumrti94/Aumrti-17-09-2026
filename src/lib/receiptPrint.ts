/**
 * receiptPrint — the ONE money-receipt renderer.
 *
 * Sibling of billPrint.ts. A receipt acknowledges money RECEIVED (an advance/deposit, a TPA
 * settlement, a donation) and is a different document from an itemised bill — it has no charge
 * breakup and no "balance due" as its subject. Before this, every collect flow (advance,
 * OPD walk-in, pharmacy, TPA, 80G) hand-built its own receipt HTML, so the same hospital
 * issued receipts that looked nothing alike. They all render here now, sharing the branded
 * header/footer, fonts and amount-in-words with the bill so paper from any module reads as
 * one system.
 *
 * Reuses amt / escapeHtml / amountInWords from billPrint.ts — the words-and-money helpers
 * have exactly one definition across bills and receipts.
 */

import { supabase } from "@/integrations/supabase/client";
import { amt, escapeHtml, amountInWords } from "@/lib/billPrint";
import { fetchHospitalBrand, printHeader, printDocument } from "@/lib/printUtils";

type Money = number | string | null | undefined;

const num = (v: Money): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** An optional priced line in a "what this money is against" breakup. */
export interface ReceiptLineItem {
  description: string;
  rate?: Money;
  quantity?: Money;
  amount: Money;
}

export interface ReceiptPrintInput {
  /** RECEIPT (default) / ADVANCE RECEIPT / DEPOSIT RECEIPT / TPA PAYMENT RECEIPT / DONATION RECEIPT. */
  title?: string;
  receiptNumber: string;
  /** ISO or already-formatted; ISO is formatted to en-IN. */
  date?: string | null;
  patientName?: string | null;
  uhid?: string | null;
  phone?: string | null;
  admissionNumber?: string | null;
  /** "Received with thanks from" — defaults to patientName. */
  receivedFrom?: string | null;
  /** What the money is towards (procedure, purpose, claim no). */
  towards?: string | null;
  /** Optional priced breakup ("Charges Covered"). */
  lineItems?: ReceiptLineItem[];
  lineItemsLabel?: string;
  totalCharges?: Money;
  amountReceived: Money;
  paymentMode?: string | null;
  reference?: string | null;
  notes?: string | null;
  /** Still owed after this receipt — shown in red when > 0. */
  balance?: Money;
  balanceLabel?: string;
  /** "Received Rupees … Only" prefix; set null to hide the words line. */
  amountInWordsPrefix?: string | null;
  /** Small dashed footer note (e.g. advance disclaimer, 80G statute). */
  footerNote?: string | null;
  /** Raw HTML appended before the footer note (statutory blocks). */
  extraSections?: string;
}

const RECEIPT_PRINT_STYLES = `<style>
  .rc-title { text-align:center; border-bottom:1px dashed #cbd5e1; padding-bottom:6px; margin-bottom:8px; }
  .rc-title strong { font-size:15px; letter-spacing:0.5px; }
  .rc-title small { color:#64748b; font-size:11px; }
  .rc-row { display:flex; justify-content:space-between; margin-bottom:3px; font-size:12px; }
  .rc-label { color:#64748b; }
  .rc-value { font-weight:600; color:#1e293b; text-align:right; }
  .rc-amount { font-family:monospace; font-weight:600; }
  .rc-paid { color:#059669; font-weight:600; }
  .rc-block { border-top:1px dashed #cbd5e1; padding-top:6px; margin-top:6px; }
  .rc-received { font-size:16px; }
  .rc-items { width:100%; border-collapse:collapse; margin-top:4px; }
  .rc-items th { text-align:left; font-size:10px; color:#64748b; text-transform:uppercase;
                 border-bottom:1px solid #e2e8f0; padding:2px 4px; }
  .rc-items td { font-size:11px; padding:2px 4px; border-bottom:1px solid #f1f5f9; }
  .rc-words { margin-top:6px; font-size:11px; font-style:italic; color:#475569;
              border-top:1px dashed #cbd5e1; padding-top:5px; }
  .rc-note { text-align:center; font-size:11px; color:#94a3b8; margin-top:10px;
             border-top:1px dashed #cbd5e1; padding-top:6px; }
  .rc-sign { margin-top:18px; text-align:right; font-size:11px; color:#475569; }
  .rc-balance { color:#dc2626; font-weight:700; }
</style>`;

function kv(label: string, value?: string | null, opts?: { amount?: boolean; cls?: string }): string {
  if (!value) return "";
  const valCls = opts?.cls ?? (opts?.amount ? "rc-amount" : "rc-value");
  return `<div class="rc-row"><span class="rc-label">${escapeHtml(label)}</span><span class="${valCls}">${escapeHtml(value)}</span></div>`;
}

/** PURE. The receipt body, minus the hospital header — callers prepend printHeader(). */
export function renderReceiptHtml(input: ReceiptPrintInput): string {
  const title = input.title || "RECEIPT";
  const date = input.date
    ? (/^\d{4}-\d{2}-\d{2}/.test(input.date)
        ? new Date(input.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
        : input.date)
    : "";

  const items = input.lineItems || [];
  const itemsHtml = items.length > 0
    ? `<div class="rc-block">
        <p style="font-size:11px;font-weight:700;text-transform:uppercase;color:#64748b;margin:0 0 4px;">${escapeHtml(input.lineItemsLabel || "Charges Covered")}</p>
        <table class="rc-items">
          <thead><tr><th>Particulars</th><th style="text-align:right">Rate</th><th style="text-align:center">Qty</th><th style="text-align:right">Amount</th></tr></thead>
          <tbody>${items.map(p => `<tr>
            <td>${escapeHtml(p.description)}</td>
            <td style="text-align:right" class="rc-amount">${amt(p.rate)}</td>
            <td style="text-align:center">${p.quantity != null ? escapeHtml(String(p.quantity)) : "1"}</td>
            <td style="text-align:right" class="rc-amount">${amt(p.amount)}</td>
          </tr>`).join("")}</tbody>
        </table>
        ${input.totalCharges != null ? `<div class="rc-row" style="margin-top:6px;"><span class="rc-label">Total Charges</span><span class="rc-amount">₹${amt(input.totalCharges)}</span></div>` : ""}
      </div>`
    : "";

  const balance = num(input.balance);
  const wordsPrefix = input.amountInWordsPrefix === undefined ? "Received Rupees" : input.amountInWordsPrefix;

  return `${RECEIPT_PRINT_STYLES}
<div class="rc-title"><strong>${escapeHtml(title)}</strong>${date ? `<br/><small>${escapeHtml(date)}</small>` : ""}</div>

${kv("Receipt No.", input.receiptNumber, { amount: true })}
${kv("Received From", input.receivedFrom || input.patientName)}
${kv("UHID", input.uhid, { amount: true })}
${kv("Phone", input.phone, { amount: true })}
${kv("Admission No.", input.admissionNumber, { amount: true })}
${kv("Towards", input.towards)}

${itemsHtml}

<div class="rc-block">
  <div class="rc-row"><span class="rc-label">Amount Received</span><span class="rc-amount rc-received">₹${amt(input.amountReceived)}</span></div>
  ${input.paymentMode ? `<div class="rc-row"><span class="rc-label">Payment</span><span class="rc-paid">Paid (${escapeHtml(input.paymentMode)})</span></div>` : ""}
  ${kv("Reference", input.reference, { amount: true })}
  ${kv("Notes", input.notes)}
  ${balance > 0 ? `<div class="rc-row rc-balance"><span>${escapeHtml(input.balanceLabel || "Balance Payable")}</span><span class="rc-amount">₹${amt(balance)}</span></div>` : ""}
</div>

${wordsPrefix ? `<div class="rc-words">${escapeHtml(wordsPrefix)} ${escapeHtml(amountInWords(num(input.amountReceived)))} Only</div>` : ""}
${input.extraSections || ""}
${input.footerNote ? `<div class="rc-note">${escapeHtml(input.footerNote)}</div>` : ""}
<div class="rc-sign">Authorised Signatory</div>`;
}

/**
 * Fetch branding, render, open the print window. The one call every receipt surface makes.
 * fetchHospitalBrand must run before printHeader/printDocument — it warms the brand cache
 * those read for logo/layout/font/footer.
 */
export async function printReceiptDoc(
  hospitalId: string,
  input: ReceiptPrintInput,
  opts?: { width?: number; height?: number }
): Promise<void> {
  const brand = await fetchHospitalBrand(supabase, hospitalId);
  const body = `${printHeader(brand.name, brand.address || undefined)}${renderReceiptHtml(input)}`;
  printDocument(`${input.title || "Receipt"} — ${input.receiptNumber}`, body, {
    width: opts?.width ?? 480,
    height: opts?.height ?? 680,
  });
}
