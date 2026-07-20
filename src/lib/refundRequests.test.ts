import { describe, it, expect } from "vitest";
import {
  OPEN_REFUND_STATUSES,
  isDuplicateRefundError,
  DUPLICATE_REFUND_MESSAGE,
} from "./refundRequests";

describe("OPEN_REFUND_STATUSES", () => {
  it("treats pending and approved refunds as live", () => {
    expect(OPEN_REFUND_STATUSES).toContain("pending_approval");
    expect(OPEN_REFUND_STATUSES).toContain("approved");
  });

  it("does not treat a processed refund as live", () => {
    // A settled refund must NOT block a later, genuinely new overpayment on
    // the same bill — the patient could legitimately be owed money twice.
    expect(OPEN_REFUND_STATUSES).not.toContain("processed");
  });

  it("does not treat a rejected refund as live", () => {
    expect(OPEN_REFUND_STATUSES).not.toContain("rejected");
  });

  it("matches the statuses the DB unique indexes constrain", () => {
    // supabase/migrations/20261008000153_one_open_refund_per_bill.sql
    expect([...OPEN_REFUND_STATUSES].sort()).toEqual(["approved", "pending_approval"]);
  });
});

describe("isDuplicateRefundError", () => {
  it("recognises a Postgres unique violation", () => {
    expect(isDuplicateRefundError({ code: "23505", message: "duplicate key value" })).toBe(true);
  });

  it("recognises the index by name when no code is present", () => {
    expect(
      isDuplicateRefundError({
        message: 'duplicate key value violates unique constraint "refund_payables_one_open_per_bill_idx"',
      })
    ).toBe(true);
  });

  it("recognises the admission-scoped index too", () => {
    expect(
      isDuplicateRefundError({
        message: 'violates unique constraint "refund_payables_one_open_per_admission_idx"',
      })
    ).toBe(true);
  });

  it("does not swallow unrelated failures", () => {
    expect(isDuplicateRefundError({ code: "23503", message: "foreign key violation" })).toBe(false);
    expect(isDuplicateRefundError({ message: "network error" })).toBe(false);
    expect(isDuplicateRefundError(null)).toBe(false);
    expect(isDuplicateRefundError(undefined)).toBe(false);
  });
});

describe("DUPLICATE_REFUND_MESSAGE", () => {
  it("tells the user where the existing request is", () => {
    expect(DUPLICATE_REFUND_MESSAGE).toMatch(/already awaiting approval/i);
    expect(DUPLICATE_REFUND_MESSAGE).toMatch(/Refunds/);
  });
});
