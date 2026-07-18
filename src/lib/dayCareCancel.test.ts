import { describe, it, expect } from "vitest";
import { planDepositDisposition } from "./dayCareCancel";

/**
 * The deposit is real money the patient has already handed over for a procedure that is now
 * not happening. This table is the whole rule.
 */
describe("planDepositDisposition", () => {
  describe("refund", () => {
    it("refunds the entire held balance and bills nothing", () => {
      const p = planDepositDisposition(5000, "refund", null);
      expect(p).toEqual({ feeToBill: 0, refundAmount: 5000, holdAmount: 0 });
    });

    it("ignores any fee that happens to be passed", () => {
      // The UI hides the fee field unless retain_fee is chosen; this locks it out anyway.
      expect(planDepositDisposition(5000, "refund", 1000).feeToBill).toBe(0);
      expect(planDepositDisposition(5000, "refund", 1000).refundAmount).toBe(5000);
    });

    it("is a no-op when nothing was collected", () => {
      const p = planDepositDisposition(0, "refund", null);
      expect(p).toEqual({ feeToBill: 0, refundAmount: 0, holdAmount: 0 });
    });
  });

  describe("retain_fee", () => {
    it("bills the fee and refunds the remainder", () => {
      const p = planDepositDisposition(5000, "retain_fee", 1000);
      expect(p).toEqual({ feeToBill: 1000, refundAmount: 4000, holdAmount: 0 });
    });

    it("retains the whole deposit when the fee equals the balance (boundary)", () => {
      const p = planDepositDisposition(5000, "retain_fee", 5000);
      expect(p).toEqual({ feeToBill: 5000, refundAmount: 0, holdAmount: 0 });
    });

    it("clamps a fee larger than the balance instead of inventing a debt", () => {
      // Retaining ₹8,000 of a ₹5,000 deposit must not leave the patient owing ₹3,000 for a
      // procedure that never happened.
      const p = planDepositDisposition(5000, "retain_fee", 8000);
      expect(p.feeToBill).toBe(5000);
      expect(p.refundAmount).toBe(0);
    });

    it("bills nothing when a fee is retained against a zero balance", () => {
      const p = planDepositDisposition(0, "retain_fee", 1000);
      expect(p.feeToBill).toBe(0);
      expect(p.refundAmount).toBe(0);
    });

    it("errors on a missing fee rather than silently retaining zero", () => {
      const p = planDepositDisposition(5000, "retain_fee", null);
      expect(p.error).toBeTruthy();
      expect(p.refundAmount).toBe(0);
    });

    it("errors on a negative fee", () => {
      const p = planDepositDisposition(5000, "retain_fee", -500);
      expect(p.error).toBeTruthy();
    });

    it("errors on a NaN fee", () => {
      const p = planDepositDisposition(5000, "retain_fee", NaN);
      expect(p.error).toBeTruthy();
    });

    it("treats a zero fee as a full refund, not an error", () => {
      const p = planDepositDisposition(5000, "retain_fee", 0);
      expect(p.error).toBeUndefined();
      expect(p.feeToBill).toBe(0);
      expect(p.refundAmount).toBe(5000);
    });
  });

  describe("carry_forward", () => {
    it("moves no money — the balance stays held on this admission", () => {
      const p = planDepositDisposition(5000, "carry_forward", null);
      expect(p).toEqual({ feeToBill: 0, refundAmount: 0, holdAmount: 5000 });
    });

    it("never raises a refund even if a fee was typed", () => {
      expect(planDepositDisposition(5000, "carry_forward", 1000).refundAmount).toBe(0);
      expect(planDepositDisposition(5000, "carry_forward", 1000).feeToBill).toBe(0);
    });
  });

  describe("balance guards", () => {
    it.each([null, undefined, NaN, -5000] as any[])(
      "never refunds money that was never collected (balance %s)",
      (bad) => {
        const p = planDepositDisposition(bad, "refund", null);
        expect(p.refundAmount).toBe(0);
      }
    );

    it("clamps a negative balance to zero for every disposition", () => {
      expect(planDepositDisposition(-100, "carry_forward", null).holdAmount).toBe(0);
      expect(planDepositDisposition(-100, "retain_fee", 50).feeToBill).toBe(0);
    });
  });

  it("never pays out more than was held, across the whole table", () => {
    // Invariant: feeToBill + refundAmount + holdAmount can never exceed the deposit.
    const balances = [0, 1, 4500, 5000, 47000];
    const fees = [0, 1, 1000, 5000, 99999];
    const dispositions = ["refund", "retain_fee", "carry_forward"] as const;

    for (const b of balances) {
      for (const f of fees) {
        for (const d of dispositions) {
          const p = planDepositDisposition(b, d, f);
          if (p.error) continue;
          expect(p.feeToBill + p.refundAmount + p.holdAmount).toBeLessThanOrEqual(b);
        }
      }
    }
  });
});
