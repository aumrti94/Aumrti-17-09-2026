import { describe, it, expect } from "vitest";
import { isLockExempt, isRunningBill, lockedDayMessage } from "./lockedDay";

/**
 * Parity with the SQL predicate in
 * supabase/migrations/20261008000152_draft_admission_bill_locked_day_exemption.sql.
 * If the exemption changes there, it changes here — a silent drift between the
 * two means the client pre-check passes and the DB then rejects mid-write,
 * which is the exact failure this module exists to prevent.
 */
describe("isLockExempt", () => {
  it("exempts an open admission's running bill", () => {
    // An IPD bill accrues charges every day of the stay but keeps its
    // admission-day bill_date. Without this, closing the admission day freezes
    // billing for a patient who is still in the ward.
    expect(isLockExempt({ billDate: "2026-07-16", billStatus: "draft", admissionId: "adm-1" })).toBe(true);
  });

  it("stays exempt while a discount approval is pending", () => {
    // DiscountTab sets bill_status = 'pending_approval'. The earlier, stricter
    // `bill_status === "draft"` test silently re-locked the running bill the
    // moment anyone requested a discount mid-admission.
    expect(isLockExempt({ billDate: "2026-07-16", billStatus: "pending_approval", admissionId: "adm-1" })).toBe(true);
  });

  it("stays exempt once the running bill is part-paid", () => {
    for (const status of ["partially_paid", "paid", "insurance_pending"]) {
      expect(isLockExempt({ billDate: "2026-07-16", billStatus: status, admissionId: "adm-1" })).toBe(true);
    }
  });

  it("locks again once the bill is finalised at discharge", () => {
    // Finalisation, not day closure, is the real boundary: the final bill is
    // validated and issued at discharge, and is a closed document thereafter.
    for (const status of ["final", "irn_locked", "cancelled", "refunded"]) {
      expect(isLockExempt({ billDate: "2026-07-16", billStatus: status, admissionId: "adm-1" })).toBe(false);
    }
  });

  it("does not exempt a bill with no admission (OPD, pharmacy, lab)", () => {
    expect(isLockExempt({ billDate: "2026-07-16", billStatus: "draft", admissionId: null })).toBe(false);
  });

  it("does not exempt on a missing status", () => {
    expect(isLockExempt({ billDate: "2026-07-16", billStatus: null, admissionId: "adm-1" })).toBe(false);
  });
});

/**
 * Gates whether the IPD ledger re-runs the charge sweep, i.e. whether room and
 * nursing charges keep following the length of stay. Too strict here and the
 * bill silently stops accruing mid-admission.
 */
describe("isRunningBill", () => {
  it("keeps accruing through every mid-stay status", () => {
    for (const status of ["draft", "pending_approval", "partially_paid", "paid", "insurance_pending"]) {
      expect(isRunningBill(status)).toBe(true);
    }
  });

  it("treats a missing status as still running", () => {
    // Unlike isLockExempt, which fails closed: this only decides whether to
    // RECOMPUTE charges, and a bill row with no status is an open worksheet.
    expect(isRunningBill(null)).toBe(true);
    expect(isRunningBill(undefined)).toBe(true);
  });

  it("stops accruing once the bill is finalised at discharge", () => {
    for (const status of ["final", "irn_locked", "cancelled", "refunded"]) {
      expect(isRunningBill(status)).toBe(false);
    }
  });
});

describe("lockedDayMessage", () => {
  it("points at Reopen Day, not the CFO override", () => {
    // The old wording told users to ask the CFO to set an override that no code
    // path ever sets, steering them away from the button that actually works.
    const msg = lockedDayMessage("2026-07-16");
    expect(msg).toContain("2026-07-16");
    expect(msg).toContain("Reopen Day");
    expect(msg).not.toContain("CFO");
  });
});
