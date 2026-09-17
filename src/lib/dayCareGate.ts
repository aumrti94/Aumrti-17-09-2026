/**
 * dayCareGate — the definition of "financially cleared to admit a day care patient".
 *
 * Why a gate at all: an elective day care patient walks out the same day. There is no
 * leverage to collect afterwards, which is why Indian day care units take the money (or a
 * payer's approval) up front. Today nothing is enforced — the discharge checklist has a
 * "Bill finalised and payment cleared" checkbox a user simply ticks.
 *
 * IMPORTANT: evaluateDayCareClearance mirrors the SQL function
 * enforce_daycare_financial_clearance() (migration 20261008000140) exactly. The trigger is
 * the enforcement — it cannot be bypassed by a client — and this is the UI's explanation of
 * the same rule. If one changes, change both. UNGUARDED as of 2026-09-05 — the truth-table
 * tests in dayCareGate.test.ts that locked the shared definition were removed with the rest
 * of the suite; nothing currently checks that the two stay in step.
 */

import { supabase } from "@/integrations/supabase/client";

export interface DayCarePaymentPolicy {
  /** Master switch. Default TRUE — see the migration for why that is safe. */
  requireClearance: boolean;
  /** % of the procedure's standard_rate seeded as deposit_required on the estimate. */
  depositPercent: number;
  /** Roles allowed to override the gate with an audited reason. */
  overrideRoles: string[];
}

export const DEFAULT_DAY_CARE_POLICY: DayCarePaymentPolicy = {
  requireClearance: true,
  depositPercent: 100,
  overrideRoles: ["admin", "billing"],
};

/** hospital_settings key holding the policy — mirrors the 'teleconsult_payment' shape. */
export const DAY_CARE_POLICY_KEY = "daycare_payment";

/** Pre-auth statuses that mean the payer has committed to the FULL requested amount. */
const PREAUTH_FULL = "approved";
/** The payer approved LESS than asked — the balance is the patient's to pay. */
const PREAUTH_PARTIAL = "partially_approved";

export type DepositBasis =
  /** Self-pay: the estimate's deposit_required is the bar. */
  | "self_pay"
  /** Payer approved in full: nothing to collect at the door. */
  | "preauth_full"
  /** Payer approved part: the patient owes estimate − approved. */
  | "preauth_gap"
  /** Insured but no approval yet: treat exactly like self-pay until the TPA responds. */
  | "preauth_absent";

export type ClearanceReason =
  | "policy_off"
  | "override_recorded"
  | "preauth_approved"
  | "deposit_met"
  | "deposit_short"
  | "no_estimate";

export interface DayCareClearance {
  cleared: boolean;
  reason: ClearanceReason;
  basis: DepositBasis;
  /** ₹ still to collect before admitting. 0 when cleared. */
  shortfall: number;
  /** ₹ the patient must have paid. null = indeterminable (no estimate given). */
  requiredDeposit: number | null;
  advanceBalance: number;
}

/** Coerce to a finite number, else null. Guards against NaN leaking into money maths. */
function num(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * PURE. Seeds the estimate modal's deposit field from the procedure rate.
 * Clamped to 0–100% and rounded to whole rupees.
 */
export function deriveDepositDefault(
  standardRate: number,
  policy: DayCarePaymentPolicy
): number {
  const rate = num(standardRate) ?? 0;
  if (rate <= 0) return 0;
  const pct = Math.min(100, Math.max(0, num(policy.depositPercent) ?? 100));
  return Math.round((rate * pct) / 100);
}

/**
 * PURE. What the patient must have paid before we let them in.
 *
 * `required: null` means indeterminable — no estimate was recorded, so there is no bar to
 * clear against. That is treated as NOT cleared: it means counselling was skipped, which is
 * exactly when money goes missing.
 */
export function computeRequiredDeposit(input: {
  payerType: string;
  preAuthStatus: string | null;
  preAuthApprovedAmount: number | null;
  estimatedAmount: number | null;
  depositRequired: number | null;
}): { required: number | null; basis: DepositBasis } {
  const payer = (input.payerType || "self_pay").toLowerCase();
  const isSelfPay = payer === "self_pay";
  const status = (input.preAuthStatus || "").toLowerCase();

  // A self-pay patient has no payer, so a pre-auth on the record is meaningless to them.
  if (!isSelfPay && status === PREAUTH_FULL) {
    return { required: 0, basis: "preauth_full" };
  }

  if (!isSelfPay && status === PREAUTH_PARTIAL) {
    // The TPA approving ₹30,000 of a ₹47,000 cataract means ₹17,000 is the patient's.
    // Not collecting that gap is the single biggest day care leak.
    const est = num(input.estimatedAmount);
    const approved = num(input.preAuthApprovedAmount) ?? 0;
    if (est === null) return { required: null, basis: "preauth_gap" };
    return { required: Math.max(0, est - approved), basis: "preauth_gap" };
  }

  // Self-pay, or insured with no approval yet (pending/submitted/rejected/none) — until a
  // payer actually commits, the hospital is carrying the risk, so the deposit rule applies.
  return {
    required: num(input.depositRequired),
    basis: isSelfPay ? "self_pay" : "preauth_absent",
  };
}

/**
 * PURE. The gate. First match wins.
 */
export function evaluateDayCareClearance(input: {
  policy: DayCarePaymentPolicy;
  payerType: string;
  preAuthStatus: string | null;
  preAuthApprovedAmount: number | null;
  estimatedAmount: number | null;
  depositRequired: number | null;
  advanceBalance: number | null;
  overrideRecorded: boolean;
}): DayCareClearance {
  // Never let a negative or NaN balance invent money the patient hasn't paid.
  const balance = Math.max(0, num(input.advanceBalance) ?? 0);

  const { required, basis } = computeRequiredDeposit(input);

  const base = { basis, advanceBalance: balance, requiredDeposit: required };

  if (!input.policy.requireClearance) {
    return { ...base, cleared: true, reason: "policy_off", shortfall: 0 };
  }

  if (input.overrideRecorded) {
    return { ...base, cleared: true, reason: "override_recorded", shortfall: 0 };
  }

  if (required === null) {
    return { ...base, cleared: false, reason: "no_estimate", shortfall: 0 };
  }

  if (required <= 0) {
    return {
      ...base,
      cleared: true,
      reason: basis === "preauth_full" ? "preauth_approved" : "deposit_met",
      shortfall: 0,
    };
  }

  if (balance >= required) {
    return { ...base, cleared: true, reason: "deposit_met", shortfall: 0 };
  }

  return {
    ...base,
    cleared: false,
    reason: "deposit_short",
    shortfall: Math.round(required - balance),
  };
}

/** PURE. Role check for the audited override. */
export function canOverrideDayCareGate(
  role: string | null,
  policy: DayCarePaymentPolicy
): boolean {
  if (!role) return false;
  return policy.overrideRoles.map((r) => r.toLowerCase()).includes(role.toLowerCase());
}

/** PURE. Never throws — a malformed settings row must not block the ward. */
export function parseDayCarePolicy(value: unknown): DayCarePaymentPolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_DAY_CARE_POLICY };
  }
  const v = value as Record<string, unknown>;

  const pct = Number(v.deposit_percent);
  const roles = Array.isArray(v.override_roles)
    ? v.override_roles.filter((r): r is string => typeof r === "string")
    : null;

  return {
    requireClearance:
      typeof v.require_clearance === "boolean"
        ? v.require_clearance
        : DEFAULT_DAY_CARE_POLICY.requireClearance,
    depositPercent: Number.isFinite(pct)
      ? Math.min(100, Math.max(0, pct))
      : DEFAULT_DAY_CARE_POLICY.depositPercent,
    overrideRoles: roles && roles.length > 0 ? roles : [...DEFAULT_DAY_CARE_POLICY.overrideRoles],
  };
}

export async function fetchDayCarePolicy(hospitalId: string): Promise<DayCarePaymentPolicy> {
  const { data } = await (supabase as any)
    .from("hospital_settings")
    .select("value")
    .eq("hospital_id", hospitalId)
    .eq("key", DAY_CARE_POLICY_KEY)
    .maybeSingle();
  return parseDayCarePolicy(data?.value);
}

/**
 * I/O wrapper: gathers the four inputs the gate needs and evaluates it.
 * Kept thin — all decisions live in the pure functions above.
 */
export async function checkDayCareClearance(
  hospitalId: string,
  admissionId: string
): Promise<DayCareClearance> {
  const [policy, admRes, estRes, balRes, paRes] = await Promise.all([
    fetchDayCarePolicy(hospitalId),
    (supabase as any)
      .from("admissions")
      .select("insurance_type, financial_override_by, financial_override_reason")
      .eq("id", admissionId)
      .maybeSingle(),
    (supabase as any)
      .from("admission_estimates")
      .select("estimated_amount, deposit_required")
      .eq("admission_id", admissionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    (supabase as any)
      .from("ipd_advance_balances")
      .select("balance")
      .eq("admission_id", admissionId)
      .maybeSingle(),
    (supabase as any)
      .from("insurance_pre_auth")
      .select("status, approved_amount")
      .eq("admission_id", admissionId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const adm = admRes?.data;
  const est = estRes?.data;
  const pa = paRes?.data;

  return evaluateDayCareClearance({
    policy,
    payerType: adm?.insurance_type || "self_pay",
    preAuthStatus: pa?.status ?? null,
    preAuthApprovedAmount: pa?.approved_amount ?? null,
    estimatedAmount: est?.estimated_amount ?? null,
    depositRequired: est?.deposit_required ?? null,
    advanceBalance: balRes?.data?.balance ?? 0,
    overrideRecorded:
      !!adm?.financial_override_by && !!(adm?.financial_override_reason || "").trim(),
  });
}
