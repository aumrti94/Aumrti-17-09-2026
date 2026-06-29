// Tally Prime TDML (Tally Data Migration Language) voucher generator.
// All amounts follow Tally sign convention: debit = negative AMOUNT + ISDEEMEDPOSITIVE=Yes.

export interface TallyBill {
  id: string;
  bill_number: string;
  bill_date: string;
  patient_name: string;
  bill_type: string;
  total_amount: number;
  taxable_amount: number;
  gst_amount: number;
}

export interface TallyPayment {
  id: string;
  bill_id: string;
  bill_number: string;
  patient_name: string;
  payment_date: string;
  payment_mode: string;
  amount: number;
  transaction_id?: string;
}

export interface TallyDrugBatch {
  id: string;
  drug_name: string;
  batch_number: string;
  purchase_date: string;
  supplier_name?: string;
  quantity_received: number;
  cost_price: number;
  gst_percent: number;
}

export interface TallyJournalEntry {
  id: string;
  entry_number: string;
  entry_date: string;
  description: string;
  entry_type: string;
}

export interface TallyJournalLine {
  journal_entry_id: string;
  account_code: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
}

export interface TallyLedgerMapping {
  aumrti_revenue_head: string;
  tally_ledger_name: string;
}

// bill_type → tally_ledger_mapping revenue head key
const BILL_TYPE_TO_REVENUE_HEAD: Record<string, string> = {
  opd: "opd_consultation",
  ipd: "ipd_room",
  lab: "lab",
  radiology: "radiology",
  pharmacy: "pharmacy",
  emergency: "ipd_services",
  daycare: "ipd_services",
  package: "misc",
};

// payment_mode → Tally ledger name (accountant can override in ledger mapping)
const PAYMENT_MODE_LEDGER: Record<string, string> = {
  cash: "Cash in Hand",
  upi: "Bank - UPI",
  card: "Bank - Card POS",
  net_banking: "Bank - Net Banking",
  cheque: "Bank - Cheque",
  insurance: "AR - Insurance / TPA",
  pmjay: "AR - PMJAY / CGHS",
  cghs: "AR - PMJAY / CGHS",
  echs: "AR - PMJAY / CGHS",
  credit: "AR - Patients",
  advance_adjust: "Advance from Patients",
};

function fmtDate(iso: string): string {
  return (iso || "").replace(/-/g, "").slice(0, 8);
}

function escXml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ledgerEntry(name: string, isDebit: boolean, amount: number): string {
  const amt = Math.abs(amount);
  return `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${escXml(name)}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
          <AMOUNT>${isDebit ? -amt : amt}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>`;
}

/**
 * Sales vouchers — one per finalized bill.
 * Debit: AR - Patients (total_amount)
 * Credit: Revenue ledger (taxable_amount) + CGST/SGST if GST applies
 */
export function generateSalesVouchers(
  bills: TallyBill[],
  ledgerMap: TallyLedgerMapping[]
): string {
  const mapping: Record<string, string> = {};
  ledgerMap.forEach((m) => { mapping[m.aumrti_revenue_head] = m.tally_ledger_name; });

  return bills
    .filter((b) => b.total_amount > 0)
    .map((bill) => {
      const revenueHead = BILL_TYPE_TO_REVENUE_HEAD[bill.bill_type] || "misc";
      const revenueLedger = mapping[revenueHead] || "Hospital Revenue";
      const taxable = Number(bill.taxable_amount || 0);
      const gst = Number(bill.gst_amount || 0);
      const total = Number(bill.total_amount || 0);

      const entries: string[] = [
        ledgerEntry("AR - Patients", true, total),
      ];
      if (taxable > 0) entries.push(ledgerEntry(revenueLedger, false, taxable));
      if (gst > 0) {
        entries.push(ledgerEntry("CGST Payable", false, gst / 2));
        entries.push(ledgerEntry("SGST Payable", false, gst / 2));
      }
      // Guard: ensure debit = credit (if only taxable, no GST, credit = taxable = total)
      if (gst === 0 && taxable === 0 && total > 0) {
        entries.push(ledgerEntry(revenueLedger, false, total));
      }

      return `      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Sales" ACTION="Create">
          <DATE>${fmtDate(bill.bill_date)}</DATE>
          <VOUCHERNUMBER>${escXml(bill.bill_number)}</VOUCHERNUMBER>
          <PARTYLEDGERNAME>AR - Patients</PARTYLEDGERNAME>
          <NARRATION>Bill ${escXml(bill.bill_number)} — ${escXml(bill.patient_name)}</NARRATION>
${entries.join("\n")}
        </VOUCHER>
      </TALLYMESSAGE>`;
    })
    .join("\n");
}

/**
 * Receipt vouchers — one per payment transaction.
 * Debit: Bank/Cash ledger (by payment_mode)
 * Credit: AR - Patients
 */
export function generateReceiptVouchers(payments: TallyPayment[]): string {
  return payments
    .filter((p) => p.amount > 0)
    .map((p) => {
      const bankLedger = PAYMENT_MODE_LEDGER[p.payment_mode] || "Bank - Other";
      const narration = `Receipt — Bill ${escXml(p.bill_number)}, ${escXml(p.patient_name)}${p.transaction_id ? `, Ref: ${escXml(p.transaction_id)}` : ""}`;

      return `      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Receipt" ACTION="Create">
          <DATE>${fmtDate(p.payment_date)}</DATE>
          <NARRATION>${narration}</NARRATION>
${ledgerEntry(bankLedger, true, p.amount)}
${ledgerEntry("AR - Patients", false, p.amount)}
        </VOUCHER>
      </TALLYMESSAGE>`;
    })
    .join("\n");
}

/**
 * Purchase vouchers — one per drug batch received.
 * Debit: Pharmacy Purchase - Drugs (+ GST Input if applicable)
 * Credit: AP - Drug Suppliers (supplier name as party)
 */
export function generatePurchaseVouchers(batches: TallyDrugBatch[]): string {
  return batches
    .filter((b) => b.quantity_received > 0 && b.cost_price > 0)
    .map((b) => {
      const purchaseAmt = b.cost_price * b.quantity_received;
      const gstAmt = purchaseAmt * (b.gst_percent / 100);
      const totalAmt = purchaseAmt + gstAmt;
      const supplierLedger =
        b.supplier_name && b.supplier_name.trim().length > 0
          ? escXml(b.supplier_name.trim())
          : "AP - Drug Suppliers";
      const narration = `Drug purchase — ${escXml(b.drug_name)}, Batch ${escXml(b.batch_number)}${b.supplier_name ? `, Supplier: ${escXml(b.supplier_name)}` : ""}`;

      const entries: string[] = [
        ledgerEntry("Pharmacy Purchase - Drugs", true, purchaseAmt),
      ];
      if (gstAmt > 0) entries.push(ledgerEntry("GST Input Tax Credit", true, gstAmt));
      entries.push(ledgerEntry(supplierLedger, false, totalAmt));

      return `      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Purchase" ACTION="Create">
          <DATE>${fmtDate(b.purchase_date)}</DATE>
          <NARRATION>${narration}</NARRATION>
${entries.join("\n")}
        </VOUCHER>
      </TALLYMESSAGE>`;
    })
    .join("\n");
}

/**
 * Journal vouchers — manual/adjustment entries from journal_entries table.
 * This is the existing functionality, refactored here for consistency.
 */
export function generateJournalVouchers(
  entries: TallyJournalEntry[],
  lineItems: TallyJournalLine[]
): string {
  return entries
    .map((je) => {
      const lines = lineItems.filter((li) => li.journal_entry_id === je.id);
      if (lines.length === 0) return "";

      const ledgerEntries = lines
        .map((li) => {
          const dr = Number(li.debit_amount || 0);
          const cr = Number(li.credit_amount || 0);
          return ledgerEntry(li.account_name || li.account_code, dr > 0, dr > 0 ? dr : cr);
        })
        .join("\n");

      return `      <TALLYMESSAGE>
        <VOUCHER VCHTYPE="Journal" ACTION="Create">
          <DATE>${fmtDate(je.entry_date)}</DATE>
          <NARRATION>${escXml(je.description)}</NARRATION>
${ledgerEntries}
        </VOUCHER>
      </TALLYMESSAGE>`;
    })
    .filter(Boolean)
    .join("\n");
}

/**
 * Wraps all voucher fragments into a complete TDML envelope for Tally Prime import.
 */
export function wrapTDMLEnvelope(fragments: string[]): string {
  const body = fragments.filter(Boolean).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC><REPORTNAME>Vouchers</REPORTNAME></REQUESTDESC>
      <REQUESTDATA>
${body}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}
