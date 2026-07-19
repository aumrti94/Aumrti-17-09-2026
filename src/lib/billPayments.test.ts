import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression suite for recordBillPayment — the shared write path extracted from
 * PaymentsTab.handleCollect so PendingCollectionsPanel and CollectionsTab stop
 * hand-rolling their own (previously broken: fake-collect / overwrite-paid_amount)
 * versions. Revenue surface: a wrong paid_amount/balance_due here is real money
 * silently going missing from the books.
 */

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom },
}));

const { mockAutoPost } = vi.hoisted(() => ({ mockAutoPost: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/accounting", () => ({ autoPostJournalEntry: mockAutoPost }));

const { mockLogAudit } = vi.hoisted(() => ({ mockLogAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/auditLog", () => ({ logAudit: mockLogAudit }));

const { mockSendWhatsApp } = vi.hoisted(() => ({ mockSendWhatsApp: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/whatsapp-send", () => ({ sendWhatsApp: mockSendWhatsApp }));

import { recordBillPayment } from "./billPayments";

// Proxy-based chain builder (same shape as serviceBilling.test.ts) that also
// records insert/update payloads so tests can assert exactly what was written.
function makeChain(returnValue: unknown, onWrite?: (method: string, payload: any) => void) {
  const asPromise = Promise.resolve(returnValue as any);
  function buildProxy(): any {
    return new Proxy({} as any, {
      get(_: any, prop: string) {
        if (prop === "maybeSingle") return vi.fn().mockResolvedValue(returnValue);
        if (prop === "single") return vi.fn().mockResolvedValue(returnValue);
        if (prop === "then") return asPromise.then.bind(asPromise);
        if (prop === "catch") return asPromise.catch.bind(asPromise);
        if (prop === "insert" || prop === "update") {
          return vi.fn((payload: any) => {
            onWrite?.(prop, payload);
            return buildProxy();
          });
        }
        return vi.fn().mockReturnValue(buildProxy());
      },
    });
  }
  return buildProxy();
}

const H_ID = "hosp-uuid";
const BILL_ID = "bill-uuid";

let billPaymentInserts: any[];
let billsUpdates: any[];
let admissionsUpdates: any[];
// Authoritative bill/closure state the pre-flight guards read. Defaults: plenty
// of balance, no bill_date (so the locked-day lookup is skipped) → open path.
let billRow: any;
let closureRow: any;

function setupMocks(patientPhone: string | null = null) {
  billPaymentInserts = [];
  billsUpdates = [];
  admissionsUpdates = [];
  billRow = { bill_date: null, balance_due: 1_000_000, payment_status: "partial" };
  closureRow = null;

  mockFrom.mockImplementation((table: string) => {
    if (table === "bill_payments") {
      return makeChain({ error: null }, (_m, payload) => billPaymentInserts.push(payload));
    }
    if (table === "bills") {
      // maybeSingle() → the guard read; update() → recorded for assertions.
      return makeChain({ data: billRow, error: null }, (_m, payload) => billsUpdates.push(payload));
    }
    if (table === "daily_cash_closure") {
      return makeChain({ data: closureRow, error: null });
    }
    if (table === "admissions") {
      return makeChain({ error: null }, (_m, payload) => admissionsUpdates.push(payload));
    }
    if (table === "patients") {
      return makeChain({ data: patientPhone ? { phone: patientPhone, full_name: "Test Patient" } : null, error: null });
    }
    return makeChain({ data: null, error: null });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupMocks();
});

describe("recordBillPayment — writes", () => {
  it("inserts one bill_payments row per split-payment row and posts one journal entry per mode", async () => {
    await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-001",
      rows: [
        { mode: "cash", amount: 500 },
        { mode: "upi", amount: 300 },
      ],
      collectedBy: "user-1",
      newPaidAmount: 800,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(billPaymentInserts).toHaveLength(2);
    expect(billPaymentInserts[0]).toMatchObject({ payment_mode: "cash", amount: 500 });
    expect(billPaymentInserts[1]).toMatchObject({ payment_mode: "upi", amount: 300 });

    expect(mockAutoPost).toHaveBeenCalledTimes(2);
    expect(mockAutoPost).toHaveBeenCalledWith(expect.objectContaining({ triggerEvent: "bill_payment_cash", amount: 500 }));
    expect(mockAutoPost).toHaveBeenCalledWith(expect.objectContaining({ triggerEvent: "bill_payment_upi", amount: 300 }));
  });

  it("updates bills with exactly the caller-supplied numbers — never overwrites paid_amount with just the new amount", async () => {
    // Bill already had ₹5,000 paid; collecting ₹3,000 more — caller (mirrors
    // PaymentsTab's own formula) computes the additive total.
    await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-002",
      rows: [{ mode: "cash", amount: 3000 }],
      collectedBy: "user-1",
      newPaidAmount: 8000,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(billsUpdates).toHaveLength(1);
    expect(billsUpdates[0]).toEqual({
      paid_amount: 8000,
      balance_due: 0,
      payment_status: "paid",
    });
  });

  it("always uses 'partial', never a nonstandard status like 'partially_paid'", async () => {
    await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-003",
      rows: [{ mode: "cash", amount: 100 }],
      collectedBy: "user-1",
      newPaidAmount: 100,
      newBalanceDue: 900,
      newPaymentStatus: "partial",
    });

    expect(billsUpdates[0].payment_status).toBe("partial");
  });

  it("returns ok:false and writes nothing when there is nothing to collect", async () => {
    const result = await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-004",
      rows: [{ mode: "cash", amount: 0 }],
      collectedBy: "user-1",
      newPaidAmount: 0,
      newBalanceDue: 0,
      newPaymentStatus: "unpaid",
    });

    expect(result.ok).toBe(false);
    expect(billPaymentInserts).toHaveLength(0);
    expect(billsUpdates).toHaveLength(0);
    expect(mockAutoPost).not.toHaveBeenCalled();
  });
});

describe("recordBillPayment — pre-flight guards", () => {
  it("rejects and writes nothing when the bill is already fully paid (balance 0)", async () => {
    billRow = { bill_date: null, balance_due: 0, payment_status: "paid" };

    const result = await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-PAID",
      rows: [{ mode: "cash", amount: 500 }],
      collectedBy: "user-1",
      newPaidAmount: 500,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already fully paid/i);
    expect(billPaymentInserts).toHaveLength(0);
    expect(billsUpdates).toHaveLength(0);
    expect(mockAutoPost).not.toHaveBeenCalled();
  });

  it("rejects and writes nothing when the amount exceeds the balance due", async () => {
    billRow = { bill_date: null, balance_due: 500, payment_status: "partial" };

    const result = await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-OVER",
      rows: [{ mode: "cash", amount: 5000 }],
      collectedBy: "user-1",
      newPaidAmount: 5000,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/exceeds the balance/i);
    expect(billPaymentInserts).toHaveLength(0);
    expect(billsUpdates).toHaveLength(0);
  });

  it("rejects and writes nothing when the bill's day is locked (cash closure)", async () => {
    billRow = { bill_date: "2026-07-16", balance_due: 500, payment_status: "partial" };
    closureRow = { status: "locked" };

    const result = await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-LOCKED",
      rows: [{ mode: "cash", amount: 500 }],
      collectedBy: "user-1",
      newPaidAmount: 500,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/locked/i);
    expect(billPaymentInserts).toHaveLength(0);
    expect(billsUpdates).toHaveLength(0);
  });

  it("allows collection when the bill's day is reconciled (reopened), not locked", async () => {
    billRow = { bill_date: "2026-07-16", balance_due: 500, payment_status: "partial" };
    closureRow = { status: "reconciled" };

    const result = await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-REOPENED",
      rows: [{ mode: "cash", amount: 500 }],
      collectedBy: "user-1",
      newPaidAmount: 500,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(result.ok).toBe(true);
    expect(billPaymentInserts).toHaveLength(1);
    expect(billsUpdates).toHaveLength(1);
  });
});

describe("recordBillPayment — billing_cleared sync", () => {
  it("marks the admission billing_cleared only when status is 'paid' and an admissionId is present", async () => {
    await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-005",
      admissionId: "adm-1",
      rows: [{ mode: "cash", amount: 100 }],
      collectedBy: "user-1",
      newPaidAmount: 1000,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(admissionsUpdates).toHaveLength(1);
    expect(admissionsUpdates[0]).toEqual({ billing_cleared: true });
  });

  it("does not touch admissions when the bill is only partially paid", async () => {
    await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-006",
      admissionId: "adm-1",
      rows: [{ mode: "cash", amount: 100 }],
      collectedBy: "user-1",
      newPaidAmount: 500,
      newBalanceDue: 500,
      newPaymentStatus: "partial",
    });

    expect(admissionsUpdates).toHaveLength(0);
  });
});

describe("recordBillPayment — receipt + audit", () => {
  it("sends a WhatsApp receipt only when sendReceipt is true and the patient has a phone", async () => {
    setupMocks("9876543210");

    await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-007",
      patientId: "pat-1",
      rows: [{ mode: "cash", amount: 100 }],
      collectedBy: "user-1",
      newPaidAmount: 100,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
      sendReceipt: true,
    });

    expect(mockSendWhatsApp).toHaveBeenCalledTimes(1);
  });

  it("skips the WhatsApp receipt when sendReceipt is not requested", async () => {
    setupMocks("9876543210");

    await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-008",
      patientId: "pat-1",
      rows: [{ mode: "cash", amount: 100 }],
      collectedBy: "user-1",
      newPaidAmount: 100,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(mockSendWhatsApp).not.toHaveBeenCalled();
  });

  it("always logs an audit entry for a successful collection", async () => {
    await recordBillPayment({
      hospitalId: H_ID,
      billId: BILL_ID,
      billNumber: "BILL-009",
      rows: [{ mode: "cash", amount: 250 }],
      collectedBy: "user-1",
      newPaidAmount: 250,
      newBalanceDue: 0,
      newPaymentStatus: "paid",
    });

    expect(mockLogAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        module: "billing",
        entityType: "payment",
        entityId: BILL_ID,
        details: expect.objectContaining({ amount: 250 }),
      })
    );
  });
});
