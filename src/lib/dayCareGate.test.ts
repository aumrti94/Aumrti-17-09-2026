import { describe, it, expect } from "vitest";
import {
  DEFAULT_DAY_CARE_POLICY,
  DayCarePaymentPolicy,
  canOverrideDayCareGate,
  computeRequiredDeposit,
  deriveDepositDefault,
  evaluateDayCareClearance,
  parseDayCarePolicy,
} from "./dayCareGate";

const policy = (over: Partial<DayCarePaymentPolicy> = {}): DayCarePaymentPolicy => ({
  ...DEFAULT_DAY_CARE_POLICY,
  ...over,
});

/** A self-pay Cataract: ₹47,000 estimate, ₹47,000 deposit asked, nothing paid. */
const base = {
  policy: policy(),
  payerType: "self_pay",
  preAuthStatus: null as string | null,
  preAuthApprovedAmount: null as number | null,
  estimatedAmount: 47000,
  depositRequired: 47000,
  advanceBalance: 0,
  overrideRecorded: false,
};

/**
 * This truth table IS the gate. It mirrors enforce_daycare_financial_clearance()
 * (migration 20261008000140) — if the SQL and these expectations ever disagree, the UI is
 * lying to the user about why they are blocked.
 */
describe("evaluateDayCareClearance", () => {
  it("clears everything when the policy is switched off", () => {
    const r = evaluateDayCareClearance({ ...base, policy: policy({ requireClearance: false }) });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("policy_off");
  });

  it("an audited override beats everything, including a zero advance", () => {
    const r = evaluateDayCareClearance({ ...base, overrideRecorded: true });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("override_recorded");
    expect(r.shortfall).toBe(0);
  });

  it("clears an insured patient whose pre-auth is fully approved", () => {
    const r = evaluateDayCareClearance({
      ...base, payerType: "insurance", preAuthStatus: "approved", preAuthApprovedAmount: 47000,
    });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("preauth_approved");
    expect(r.basis).toBe("preauth_full");
  });

  it("does NOT clear a self-pay patient just because a pre-auth row says approved", () => {
    // A self-pay patient has no payer. An approved pre-auth on their record cannot pay
    // the bill, so the deposit rule still applies.
    const r = evaluateDayCareClearance({
      ...base, payerType: "self_pay", preAuthStatus: "approved", preAuthApprovedAmount: 47000,
    });
    expect(r.cleared).toBe(false);
    expect(r.basis).toBe("self_pay");
  });

  describe("partially approved — the TPA gap", () => {
    const partial = {
      ...base, payerType: "insurance",
      preAuthStatus: "partially_approved",
      preAuthApprovedAmount: 30000,   // TPA approved ₹30,000 of the ₹47,000 Cataract
    };

    it("requires exactly the un-approved difference, not the full deposit", () => {
      const r = evaluateDayCareClearance({ ...partial, advanceBalance: 0 });
      expect(r.basis).toBe("preauth_gap");
      expect(r.requiredDeposit).toBe(17000);
      expect(r.cleared).toBe(false);
      expect(r.shortfall).toBe(17000);
    });

    it("clears once the patient has paid the gap", () => {
      const r = evaluateDayCareClearance({ ...partial, advanceBalance: 17000 });
      expect(r.cleared).toBe(true);
      expect(r.reason).toBe("deposit_met");
    });

    it("still blocks when the patient has paid only part of the gap", () => {
      const r = evaluateDayCareClearance({ ...partial, advanceBalance: 10000 });
      expect(r.cleared).toBe(false);
      expect(r.shortfall).toBe(7000);
    });

    it("clears when the approval exceeds the estimate (nothing left for the patient)", () => {
      const r = evaluateDayCareClearance({
        ...partial, preAuthApprovedAmount: 50000, advanceBalance: 0,
      });
      expect(r.cleared).toBe(true);
      expect(r.requiredDeposit).toBe(0);
    });

    it("blocks when partially approved but no estimate exists to compute the gap from", () => {
      const r = evaluateDayCareClearance({ ...partial, estimatedAmount: null, advanceBalance: 0 });
      expect(r.cleared).toBe(false);
      expect(r.reason).toBe("no_estimate");
    });
  });

  it.each(["pending", "draft", "submitted", "under_review", "rejected", null])(
    "falls back to the deposit rule when pre-auth status is %s",
    (status) => {
      const r = evaluateDayCareClearance({
        ...base, payerType: "insurance", preAuthStatus: status as string | null, advanceBalance: 0,
      });
      // No payer has committed yet, so the hospital carries the risk — treat as self-pay.
      expect(r.basis).toBe("preauth_absent");
      expect(r.cleared).toBe(false);
      expect(r.shortfall).toBe(47000);
    }
  );

  it("blocks when no estimate was recorded — counselling was skipped", () => {
    const r = evaluateDayCareClearance({ ...base, depositRequired: null, estimatedAmount: null });
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("no_estimate");
  });

  it("clears when the advance exactly equals the deposit (boundary)", () => {
    const r = evaluateDayCareClearance({ ...base, advanceBalance: 47000 });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("deposit_met");
    expect(r.shortfall).toBe(0);
  });

  it("clears when the patient has over-paid", () => {
    const r = evaluateDayCareClearance({ ...base, advanceBalance: 50000 });
    expect(r.cleared).toBe(true);
    expect(r.shortfall).toBe(0);
  });

  it("reports the exact shortfall when short", () => {
    const r = evaluateDayCareClearance({ ...base, advanceBalance: 20000 });
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("deposit_short");
    expect(r.shortfall).toBe(27000);
  });

  it("clears when no deposit was asked for and nothing was paid", () => {
    const r = evaluateDayCareClearance({ ...base, depositRequired: 0, advanceBalance: 0 });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("deposit_met");
  });

  it("never invents money from a null or negative advance balance", () => {
    // Mirrors planAdvanceSettlement's rule: a balance can never count for more than 0.
    expect(evaluateDayCareClearance({ ...base, advanceBalance: null }).shortfall).toBe(47000);
    expect(evaluateDayCareClearance({ ...base, advanceBalance: -5000 }).advanceBalance).toBe(0);
    expect(evaluateDayCareClearance({ ...base, advanceBalance: -5000 }).shortfall).toBe(47000);
  });

  it("orders policy_off above no_estimate", () => {
    const r = evaluateDayCareClearance({
      ...base, policy: policy({ requireClearance: false }), depositRequired: null,
    });
    expect(r.reason).toBe("policy_off");
  });

  it("orders override above deposit_short", () => {
    const r = evaluateDayCareClearance({ ...base, advanceBalance: 0, overrideRecorded: true });
    expect(r.reason).toBe("override_recorded");
  });
});

describe("computeRequiredDeposit", () => {
  it("matches pre-auth status case-insensitively (the column has no CHECK constraint)", () => {
    const r = computeRequiredDeposit({
      payerType: "insurance", preAuthStatus: "APPROVED",
      preAuthApprovedAmount: 47000, estimatedAmount: 47000, depositRequired: 47000,
    });
    expect(r.basis).toBe("preauth_full");
    expect(r.required).toBe(0);
  });

  it("treats pmjay/cghs/echs as payers, not self-pay", () => {
    for (const payer of ["pmjay", "cghs", "echs", "insurance"]) {
      const r = computeRequiredDeposit({
        payerType: payer, preAuthStatus: "approved",
        preAuthApprovedAmount: 47000, estimatedAmount: 47000, depositRequired: 47000,
      });
      expect(r.basis).toBe("preauth_full");
    }
  });

  it("treats a missing approved_amount on a partial approval as zero approved", () => {
    const r = computeRequiredDeposit({
      payerType: "insurance", preAuthStatus: "partially_approved",
      preAuthApprovedAmount: null, estimatedAmount: 47000, depositRequired: 47000,
    });
    expect(r.required).toBe(47000);
  });
});

describe("deriveDepositDefault", () => {
  it("defaults to the full procedure rate at 100%", () => {
    expect(deriveDepositDefault(47000, policy({ depositPercent: 100 }))).toBe(47000);
  });

  it("applies a configured percentage", () => {
    expect(deriveDepositDefault(47000, policy({ depositPercent: 50 }))).toBe(23500);
    expect(deriveDepositDefault(4500, policy({ depositPercent: 25 }))).toBe(1125);
  });

  it("clamps out-of-range percentages instead of inventing charges", () => {
    expect(deriveDepositDefault(47000, policy({ depositPercent: 150 }))).toBe(47000);
    expect(deriveDepositDefault(47000, policy({ depositPercent: -10 }))).toBe(0);
  });

  it("rounds to whole rupees", () => {
    expect(deriveDepositDefault(4500, policy({ depositPercent: 33 }))).toBe(1485);
  });

  it("is safe on a zero or missing rate", () => {
    expect(deriveDepositDefault(0, policy())).toBe(0);
    expect(deriveDepositDefault(NaN, policy())).toBe(0);
  });
});

describe("canOverrideDayCareGate", () => {
  it("allows a role listed in the policy", () => {
    expect(canOverrideDayCareGate("admin", policy())).toBe(true);
    expect(canOverrideDayCareGate("billing", policy())).toBe(true);
    expect(canOverrideDayCareGate("ADMIN", policy())).toBe(true);
  });

  it("refuses a role that is not listed, and a missing role", () => {
    expect(canOverrideDayCareGate("nurse", policy())).toBe(false);
    expect(canOverrideDayCareGate("doctor", policy())).toBe(false);
    expect(canOverrideDayCareGate(null, policy())).toBe(false);
  });
});

describe("parseDayCarePolicy", () => {
  it("defaults to requiring clearance when unset", () => {
    // Default-on is deliberate: the trigger only fires on scheduled -> active, a transition
    // only the new booking flow creates, so defaulting TRUE cannot affect existing paths.
    for (const v of [null, undefined, {}]) {
      expect(parseDayCarePolicy(v)).toEqual(DEFAULT_DAY_CARE_POLICY);
    }
  });

  it("honours an explicit opt-out", () => {
    expect(parseDayCarePolicy({ require_clearance: false }).requireClearance).toBe(false);
  });

  it("reads deposit_percent and override_roles", () => {
    const p = parseDayCarePolicy({ deposit_percent: 50, override_roles: ["admin"] });
    expect(p.depositPercent).toBe(50);
    expect(p.overrideRoles).toEqual(["admin"]);
  });

  it("clamps a nonsense deposit_percent", () => {
    expect(parseDayCarePolicy({ deposit_percent: 500 }).depositPercent).toBe(100);
    expect(parseDayCarePolicy({ deposit_percent: -5 }).depositPercent).toBe(0);
  });

  it("never throws on garbage, and never falls back to an empty override list", () => {
    // An empty override_roles would lock every user out of the override with no recourse.
    for (const v of ["nonsense", 42, [], { override_roles: [] }, { override_roles: "admin" }]) {
      const p = parseDayCarePolicy(v);
      expect(p.overrideRoles.length).toBeGreaterThan(0);
      expect(typeof p.requireClearance).toBe("boolean");
    }
  });
});
