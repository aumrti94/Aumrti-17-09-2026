import { describe, it, expect } from "vitest";
import {
  generateSalesVouchers,
  generateReceiptVouchers,
  generatePurchaseVouchers,
  generateJournalVouchers,
  wrapTDMLEnvelope,
  TallyBill,
  TallyPayment,
  TallyDrugBatch,
  TallyJournalEntry,
  TallyJournalLine,
} from "./tallyXmlGenerator";

// Tally's sign convention is load-bearing here: AMOUNT is negative for a debit
// (ISDEEMEDPOSITIVE=Yes) and positive for a credit. Getting this backwards silently
// corrupts the hospital's real accounting ledger on import — every voucher type's
// debit/credit split is asserted explicitly, not just "produces XML".

describe("generateSalesVouchers", () => {
  const bill: TallyBill = {
    id: "b1", bill_number: "OPD-2026-001", bill_date: "2026-08-24",
    patient_name: "Jane Doe", bill_type: "opd",
    total_amount: 1180, taxable_amount: 1000, gst_amount: 180,
  };

  it("debits AR - Patients for the full total, as a negative amount", () => {
    const xml = generateSalesVouchers([bill], []);
    expect(xml).toMatch(/<LEDGERNAME>AR - Patients<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-1180<\/AMOUNT>/);
  });

  it("splits GST evenly across CGST and SGST as credits", () => {
    const xml = generateSalesVouchers([bill], []);
    expect(xml).toContain("<LEDGERNAME>CGST Payable</LEDGERNAME>");
    expect(xml).toMatch(/CGST Payable<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>90<\/AMOUNT>/);
    expect(xml).toMatch(/SGST Payable<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>90<\/AMOUNT>/);
  });

  it("credits the mapped revenue ledger for the bill type, falling back to a default name", () => {
    const withMapping = generateSalesVouchers([bill], [{ aumrti_revenue_head: "opd_consultation", tally_ledger_name: "OPD Fees" }]);
    expect(withMapping).toContain("<LEDGERNAME>OPD Fees</LEDGERNAME>");

    const withoutMapping = generateSalesVouchers([bill], []);
    expect(withoutMapping).toContain("<LEDGERNAME>Hospital Revenue</LEDGERNAME>");
  });

  it("excludes a zero-or-negative-total bill entirely — nothing to post", () => {
    const xml = generateSalesVouchers([{ ...bill, total_amount: 0 }], []);
    expect(xml).toBe("");
  });

  it("still balances (credits the full total) for a GST-exempt bill with no taxable/gst split recorded", () => {
    const exempt: TallyBill = { ...bill, taxable_amount: 0, gst_amount: 0, total_amount: 5000 };
    const xml = generateSalesVouchers([exempt], []);
    expect(xml).toMatch(/Hospital Revenue<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>5000<\/AMOUNT>/);
  });

  it("escapes XML special characters in the patient name and bill number", () => {
    const xml = generateSalesVouchers([{ ...bill, patient_name: "O'Brien & Sons <Ltd>" }], []);
    expect(xml).not.toContain("<Ltd>");
    expect(xml).toContain("&amp;");
    expect(xml).toContain("&lt;");
  });
});

describe("generateReceiptVouchers", () => {
  const payment: TallyPayment = {
    id: "p1", bill_id: "b1", bill_number: "OPD-2026-001", patient_name: "Jane Doe",
    payment_date: "2026-08-24", payment_mode: "upi", amount: 1180,
  };

  it("debits the payment-mode bank ledger and credits AR - Patients", () => {
    const xml = generateReceiptVouchers([payment]);
    expect(xml).toMatch(/Bank - UPI<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-1180<\/AMOUNT>/);
    expect(xml).toMatch(/AR - Patients<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>1180<\/AMOUNT>/);
  });

  it("maps government-scheme payment modes to the shared AR ledger", () => {
    for (const mode of ["pmjay", "cghs", "echs"]) {
      const xml = generateReceiptVouchers([{ ...payment, payment_mode: mode }]);
      expect(xml).toContain("AR - PMJAY / CGHS");
    }
  });

  it("falls back to 'Bank - Other' for an unrecognised payment mode", () => {
    const xml = generateReceiptVouchers([{ ...payment, payment_mode: "crypto" }]);
    expect(xml).toContain("Bank - Other");
  });

  it("excludes a zero-amount payment", () => {
    expect(generateReceiptVouchers([{ ...payment, amount: 0 }])).toBe("");
  });

  it("includes the transaction reference in the narration when present", () => {
    const xml = generateReceiptVouchers([{ ...payment, transaction_id: "UPI123456" }]);
    expect(xml).toContain("Ref: UPI123456");
  });
});

describe("generatePurchaseVouchers", () => {
  const batch: TallyDrugBatch = {
    id: "d1", drug_name: "Paracetamol 500mg", batch_number: "B2026-01",
    purchase_date: "2026-08-24", supplier_name: "MedSupply Co",
    quantity_received: 100, cost_price: 2, gst_percent: 12,
  };

  it("debits purchase + GST input credit, and credits the named supplier ledger", () => {
    const xml = generatePurchaseVouchers([batch]);
    // purchase = 2*100=200, gst = 200*0.12=24, total credit = 224
    expect(xml).toMatch(/Pharmacy Purchase - Drugs<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-200<\/AMOUNT>/);
    expect(xml).toMatch(/GST Input Tax Credit<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-24<\/AMOUNT>/);
    expect(xml).toMatch(/MedSupply Co<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>224<\/AMOUNT>/);
  });

  it("falls back to the generic AP ledger when no supplier name is recorded", () => {
    const xml = generatePurchaseVouchers([{ ...batch, supplier_name: undefined }]);
    expect(xml).toContain("AP - Drug Suppliers");
  });

  it("omits the GST input line entirely for a zero-rated purchase", () => {
    const xml = generatePurchaseVouchers([{ ...batch, gst_percent: 0 }]);
    expect(xml).not.toContain("GST Input Tax Credit");
  });

  it("excludes a batch with no quantity or no cost recorded", () => {
    expect(generatePurchaseVouchers([{ ...batch, quantity_received: 0 }])).toBe("");
    expect(generatePurchaseVouchers([{ ...batch, cost_price: 0 }])).toBe("");
  });
});

describe("generateJournalVouchers", () => {
  const entry: TallyJournalEntry = { id: "je1", entry_number: "JE-2026-0001", entry_date: "2026-08-24", description: "Rent expense", entry_type: "manual" };
  const lines: TallyJournalLine[] = [
    { journal_entry_id: "je1", account_code: "5020", account_name: "Rent", debit_amount: 5000, credit_amount: 0 },
    { journal_entry_id: "je1", account_code: "1002", account_name: "Bank", debit_amount: 0, credit_amount: 5000 },
  ];

  it("writes each line with the correct debit/credit sign", () => {
    const xml = generateJournalVouchers([entry], lines);
    expect(xml).toMatch(/Rent<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>Yes<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>-5000<\/AMOUNT>/);
    expect(xml).toMatch(/Bank<\/LEDGERNAME>\s*<ISDEEMEDPOSITIVE>No<\/ISDEEMEDPOSITIVE>\s*<AMOUNT>5000<\/AMOUNT>/);
  });

  it("skips an entry with no matching line items rather than emitting an empty voucher", () => {
    const xml = generateJournalVouchers([entry], []);
    expect(xml).toBe("");
  });

  it("only includes lines belonging to the given journal entry", () => {
    const otherEntry: TallyJournalEntry = { ...entry, id: "je2", entry_number: "JE-2026-0002" };
    const xml = generateJournalVouchers([entry, otherEntry], lines); // lines only reference je1
    expect(xml).toContain("JE-2026-0001".slice(0, 0)); // sanity no-op
    expect((xml.match(/<VOUCHER/g) || []).length).toBe(1); // only je1 produced a voucher
  });
});

describe("wrapTDMLEnvelope", () => {
  it("wraps non-empty fragments in the TDML envelope structure", () => {
    const xml = wrapTDMLEnvelope(["<TALLYMESSAGE>x</TALLYMESSAGE>"]);
    expect(xml).toContain("<ENVELOPE>");
    expect(xml).toContain("Import Data");
    expect(xml).toContain("<TALLYMESSAGE>x</TALLYMESSAGE>");
  });

  it("filters out empty fragments (e.g. from a journal entry with no lines)", () => {
    const xml = wrapTDMLEnvelope(["<TALLYMESSAGE>x</TALLYMESSAGE>", "", "<TALLYMESSAGE>y</TALLYMESSAGE>"]);
    const messageCount = (xml.match(/<TALLYMESSAGE>/g) || []).length;
    expect(messageCount).toBe(2);
  });
});
