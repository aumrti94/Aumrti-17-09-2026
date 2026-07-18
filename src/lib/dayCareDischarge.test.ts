import { describe, it, expect } from "vitest";
import { evaluateDayCareDischargeReadiness } from "./dayCareDischarge";

const bill = (balance: number | null, over = {}) => ({
  bill_status: "final",
  payment_status: balance && balance > 0 ? "partial" : "paid",
  balance_due: balance,
  ...over,
});

describe("evaluateDayCareDischargeReadiness", () => {
  it("blocks when no bill exists at all", () => {
    // The old checklist let a user tick "Bill finalised and payment cleared" with no bill
    // in existence — which is exactly how a day care procedure got discharged unbilled.
    const r = evaluateDayCareDischargeReadiness(null, "self_pay");
    expect(r.billExists).toBe(false);
    expect(r.paymentCleared).toBe(false);
    expect(r.blocking).toHaveLength(1);
  });

  it("clears a self-pay patient who has settled in full", () => {
    const r = evaluateDayCareDischargeReadiness(bill(0), "self_pay");
    expect(r.paymentCleared).toBe(true);
    expect(r.blocking).toEqual([]);
  });

  it("blocks a self-pay patient with a balance, naming the amount", () => {
    const r = evaluateDayCareDischargeReadiness(bill(500), "self_pay");
    expect(r.paymentCleared).toBe(false);
    expect(r.blocking[0]).toContain("500");
  });

  it("formats the outstanding amount in Indian grouping", () => {
    const r = evaluateDayCareDischargeReadiness(bill(150000), "self_pay");
    expect(r.blocking[0]).toContain("1,50,000");
  });

  it.each(["insurance", "pmjay", "cghs", "echs"])(
    "lets a %s patient go with a balance outstanding — the payer settles later",
    (payer) => {
      const r = evaluateDayCareDischargeReadiness(bill(5000), payer);
      expect(r.paymentCleared).toBe(true);
      expect(r.blocking).toEqual([]);
    }
  );

  it("treats an unknown payer as self-pay (fail safe: ask for the money)", () => {
    const r = evaluateDayCareDischargeReadiness(bill(5000), "some_new_payer");
    expect(r.paymentCleared).toBe(false);
  });

  it("matches the payer case-insensitively", () => {
    expect(evaluateDayCareDischargeReadiness(bill(5000), "PMJAY").paymentCleared).toBe(true);
  });

  it("treats a null balance_due as nothing owing", () => {
    // Locks the derivation: a bill with no computed balance must not invent a debt and
    // strand the patient at the door.
    const r = evaluateDayCareDischargeReadiness(bill(null), "self_pay");
    expect(r.paymentCleared).toBe(true);
  });

  it("clamps an over-collected (negative) balance to cleared", () => {
    const r = evaluateDayCareDischargeReadiness(bill(-2000), "self_pay");
    expect(r.paymentCleared).toBe(true);
    expect(r.blocking).toEqual([]);
  });
});
