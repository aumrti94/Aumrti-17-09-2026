import { describe, it, expect } from "vitest";
import {
  DEFAULT_DAY_CARE_POLICY,
  deriveDepositDefault,
  computeRequiredDeposit,
  evaluateDayCareClearance,
  canOverrideDayCareGate,
  parseDayCarePolicy,
  type DayCarePaymentPolicy,
} from "@/lib/dayCareGate";

describe("deriveDepositDefault", () => {
  it("applies the configured deposit percent to the procedure rate", () => {
    expect(deriveDepositDefault(10000, { ...DEFAULT_DAY_CARE_POLICY, depositPercent: 100 })).toBe(10000);
    expect(deriveDepositDefault(10000, { ...DEFAULT_DAY_CARE_POLICY, depositPercent: 50 })).toBe(5000);
  });

  it("a different configured percent yields a different default for the same rate", () => {
    const a = deriveDepositDefault(47000, { ...DEFAULT_DAY_CARE_POLICY, depositPercent: 100 });
    const b = deriveDepositDefault(47000, { ...DEFAULT_DAY_CARE_POLICY, depositPercent: 20 });
    expect(a).toBe(47000);
    expect(b).toBe(9400);
    expect(a).not.toBe(b);
  });

  it("clamps an out-of-range percent to 0-100", () => {
    expect(deriveDepositDefault(1000, { ...DEFAULT_DAY_CARE_POLICY, depositPercent: 150 })).toBe(1000);
    expect(deriveDepositDefault(1000, { ...DEFAULT_DAY_CARE_POLICY, depositPercent: -20 })).toBe(0);
  });

  it("returns 0 for a zero or negative rate", () => {
    expect(deriveDepositDefault(0, DEFAULT_DAY_CARE_POLICY)).toBe(0);
    expect(deriveDepositDefault(-500, DEFAULT_DAY_CARE_POLICY)).toBe(0);
  });
});

describe("computeRequiredDeposit", () => {
  it("self-pay: required deposit is the estimate's deposit_required", () => {
    const r = computeRequiredDeposit({
      payerType: "self_pay", preAuthStatus: null, preAuthApprovedAmount: null,
      estimatedAmount: 20000, depositRequired: 20000,
    });
    expect(r).toEqual({ required: 20000, basis: "self_pay" });
  });

  it("insured with full pre-auth approval requires nothing at the door", () => {
    const r = computeRequiredDeposit({
      payerType: "insurance", preAuthStatus: "approved", preAuthApprovedAmount: 47000,
      estimatedAmount: 47000, depositRequired: 47000,
    });
    expect(r).toEqual({ required: 0, basis: "preauth_full" });
  });

  it("insured with partial approval requires exactly the gap, the single biggest day care leak", () => {
    const r = computeRequiredDeposit({
      payerType: "insurance", preAuthStatus: "partially_approved", preAuthApprovedAmount: 30000,
      estimatedAmount: 47000, depositRequired: 47000,
    });
    expect(r).toEqual({ required: 17000, basis: "preauth_gap" });
  });

  it("partial approval never goes negative when approved exceeds the estimate", () => {
    const r = computeRequiredDeposit({
      payerType: "insurance", preAuthStatus: "partially_approved", preAuthApprovedAmount: 60000,
      estimatedAmount: 47000, depositRequired: 47000,
    });
    expect(r.required).toBe(0);
  });

  it("insured with no pre-auth response yet is treated like self-pay, not waved through", () => {
    for (const status of ["pending", "submitted", "rejected", null]) {
      const r = computeRequiredDeposit({
        payerType: "insurance", preAuthStatus: status, preAuthApprovedAmount: null,
        estimatedAmount: 47000, depositRequired: 47000,
      });
      expect(r.basis).toBe("preauth_absent");
      expect(r.required).toBe(47000);
    }
  });

  it("a self-pay patient's stray pre-auth status on the record is ignored", () => {
    const r = computeRequiredDeposit({
      payerType: "self_pay", preAuthStatus: "approved", preAuthApprovedAmount: 47000,
      estimatedAmount: 47000, depositRequired: 20000,
    });
    expect(r.basis).toBe("self_pay");
    expect(r.required).toBe(20000);
  });

  it("no estimate recorded is indeterminable, not zero", () => {
    const r = computeRequiredDeposit({
      payerType: "self_pay", preAuthStatus: null, preAuthApprovedAmount: null,
      estimatedAmount: null, depositRequired: null,
    });
    expect(r.required).toBeNull();
  });

  it("partial approval with no estimate on file is indeterminable, not a bare gap of 0", () => {
    const r = computeRequiredDeposit({
      payerType: "insurance", preAuthStatus: "partially_approved", preAuthApprovedAmount: 30000,
      estimatedAmount: null, depositRequired: null,
    });
    expect(r).toEqual({ required: null, basis: "preauth_gap" });
  });
});

describe("evaluateDayCareClearance — the gate, first match wins", () => {
  const base = {
    policy: DEFAULT_DAY_CARE_POLICY,
    payerType: "self_pay",
    preAuthStatus: null as string | null,
    preAuthApprovedAmount: null as number | null,
    estimatedAmount: 20000,
    depositRequired: 20000,
    advanceBalance: 20000,
    overrideRecorded: false,
  };

  it("policy off clears regardless of money on file", () => {
    const r = evaluateDayCareClearance({
      ...base, policy: { ...DEFAULT_DAY_CARE_POLICY, requireClearance: false },
      advanceBalance: 0,
    });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("policy_off");
  });

  it("a recorded override clears even with zero balance and beats every other rule", () => {
    const r = evaluateDayCareClearance({ ...base, advanceBalance: 0, overrideRecorded: true });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("override_recorded");
  });

  it("no estimate on file blocks — indeterminable is treated as not cleared", () => {
    const r = evaluateDayCareClearance({ ...base, estimatedAmount: null, depositRequired: null });
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("no_estimate");
  });

  it("full pre-auth approval clears with reason preauth_approved", () => {
    const r = evaluateDayCareClearance({
      ...base, payerType: "insurance", preAuthStatus: "approved", preAuthApprovedAmount: 20000,
      advanceBalance: 0,
    });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("preauth_approved");
  });

  it("balance meeting the required deposit clears", () => {
    const r = evaluateDayCareClearance({ ...base, advanceBalance: 20000 });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("deposit_met");
    expect(r.shortfall).toBe(0);
  });

  it("balance short of the required deposit blocks with the exact shortfall", () => {
    const r = evaluateDayCareClearance({ ...base, advanceBalance: 12000 });
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("deposit_short");
    expect(r.shortfall).toBe(8000);
  });

  it("a negative or NaN advance balance is clamped to 0, never invents payment", () => {
    const r = evaluateDayCareClearance({ ...base, advanceBalance: -500 });
    expect(r.advanceBalance).toBe(0);
    expect(r.cleared).toBe(false);
    expect(r.shortfall).toBe(20000);
  });

  it("switching requireClearance false→true for an otherwise-identical patient flips the decision", () => {
    const off = evaluateDayCareClearance({
      ...base, policy: { ...DEFAULT_DAY_CARE_POLICY, requireClearance: false }, advanceBalance: 0,
    });
    const on = evaluateDayCareClearance({
      ...base, policy: { ...DEFAULT_DAY_CARE_POLICY, requireClearance: true }, advanceBalance: 0,
    });
    expect(off.cleared).toBe(true);
    expect(on.cleared).toBe(false);
  });
});

describe("canOverrideDayCareGate", () => {
  it("grants a role listed in the configured override list, case-insensitively", () => {
    expect(canOverrideDayCareGate("Admin", DEFAULT_DAY_CARE_POLICY)).toBe(true);
    expect(canOverrideDayCareGate("BILLING", DEFAULT_DAY_CARE_POLICY)).toBe(true);
  });

  it("denies a role not in the configured list", () => {
    expect(canOverrideDayCareGate("nurse", DEFAULT_DAY_CARE_POLICY)).toBe(false);
  });

  it("a narrower configured override list denies a role the default list would have allowed", () => {
    const narrow: DayCarePaymentPolicy = { ...DEFAULT_DAY_CARE_POLICY, overrideRoles: ["super_admin"] };
    expect(canOverrideDayCareGate("billing", narrow)).toBe(false);
    expect(canOverrideDayCareGate("super_admin", narrow)).toBe(true);
  });

  it("denies with no role", () => {
    expect(canOverrideDayCareGate(null, DEFAULT_DAY_CARE_POLICY)).toBe(false);
  });
});

describe("parseDayCarePolicy", () => {
  it("parses a well-formed stored value", () => {
    const parsed = parseDayCarePolicy({
      require_clearance: false, deposit_percent: 75, override_roles: ["cfo"],
    });
    expect(parsed).toEqual({ requireClearance: false, depositPercent: 75, overrideRoles: ["cfo"] });
  });

  it("never throws on malformed input — falls back to the safe default", () => {
    expect(parseDayCarePolicy(null)).toEqual(DEFAULT_DAY_CARE_POLICY);
    expect(parseDayCarePolicy(undefined)).toEqual(DEFAULT_DAY_CARE_POLICY);
    expect(parseDayCarePolicy("not an object")).toEqual(DEFAULT_DAY_CARE_POLICY);
    expect(parseDayCarePolicy(["array", "not", "object"])).toEqual(DEFAULT_DAY_CARE_POLICY);
    expect(parseDayCarePolicy(42)).toEqual(DEFAULT_DAY_CARE_POLICY);
  });

  it("clamps a malformed deposit_percent and falls back on non-finite values", () => {
    expect(parseDayCarePolicy({ deposit_percent: 300 }).depositPercent).toBe(100);
    expect(parseDayCarePolicy({ deposit_percent: -10 }).depositPercent).toBe(0);
    expect(parseDayCarePolicy({ deposit_percent: "garbage" }).depositPercent).toBe(
      DEFAULT_DAY_CARE_POLICY.depositPercent
    );
  });

  it("falls back to default override roles when the stored list is empty or invalid", () => {
    expect(parseDayCarePolicy({ override_roles: [] }).overrideRoles).toEqual(
      DEFAULT_DAY_CARE_POLICY.overrideRoles
    );
    expect(parseDayCarePolicy({ override_roles: "admin" }).overrideRoles).toEqual(
      DEFAULT_DAY_CARE_POLICY.overrideRoles
    );
    expect(parseDayCarePolicy({ override_roles: [1, 2, 3] }).overrideRoles).toEqual(
      DEFAULT_DAY_CARE_POLICY.overrideRoles
    );
  });

  it("filters non-string entries out of an otherwise-valid override list", () => {
    expect(parseDayCarePolicy({ override_roles: ["admin", 5, "billing"] }).overrideRoles).toEqual([
      "admin", "billing",
    ]);
  });
});
