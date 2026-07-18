/**
 * ipdAncillaryGate — per-hospital choice of WHEN an admitted patient's ancillary orders
 * (pharmacy / lab / radiology) are paid for.
 *
 * Two models exist in real hospitals, and we now support both per service type:
 *   - post_paid  — the order accrues to the IPD bill and is settled at discharge. This is
 *                  what the system has always done, and it stays the default.
 *   - pre_paid   — the attendant pays at the cash counter before the service is rendered;
 *                  the sample isn't collected / the scan isn't started / the drug isn't
 *                  dispensed until the money is in.
 *
 * WHY THIS IS NOT MODELLED ON OPD. OPD looks like it has a payment gate; it does not. Its
 * order modals simply refuse to create the order row until cash is taken (see
 * NewLabOrderModal.handleCollectAndCreate), so there is never an unpaid order to block. IPD
 * cannot work that way: a doctor orders on the ward round, a cashier collects minutes or
 * hours later, and the lab acts later still. The order must exist while unpaid — hence a
 * real status gate, plus a block at the point the service is actually delivered.
 *
 * WHY THERE IS NO DB TRIGGER (unlike dayCareGate, which this file otherwise mirrors).
 * Day care needs one because the patient walks out the same day — an uncollected deposit is
 * gone forever, and its trigger fires on an elective, never-time-critical transition. This
 * gate's equivalents would fire on sample collection, "Start Study" and "Confirm Dispense" —
 * time-critical clinical actions. An IPD bypass merely costs float (the charge still lands on
 * the admission bill and is collected at discharge), so the trade is bad in both directions:
 * little to gain, and a malformed settings row could make a STAT troponin unclampable at 3am
 * with no client-side escape. Enforcement is deliberately client-side.
 *
 * The gate errs toward LETTING CLINICAL WORK PROCEED. See `no_charge_found` below.
 */

import { supabase } from "@/integrations/supabase/client";

/** The three services this gate governs. Everything else is always post_paid. */
export type IpdAncillaryService = "pharmacy" | "lab" | "radiology";

export type IpdAncillaryMode = "post_paid" | "pre_paid";

/**
 * Where a pre_paid charge lands.
 *  - consolidated — stays on the one admission bill; each line carries its own
 *    payment_status and the cashier collects against the IPD bill.
 *  - separate — the order gets its own small paid bill/receipt, like OPD.
 */
export type IpdReceiptShape = "consolidated" | "separate";

/** payment_status values postCharge can assign at order time. */
export type ChargePaymentStatus = "pending_payment" | "advance_covered";

export interface IpdServicePolicy {
  mode: IpdAncillaryMode;
  receipt: IpdReceiptShape;
}

export interface IpdOverridePolicy {
  /** Master switch for the audited manual override. */
  allow: boolean;
  /** Roles permitted to record that override. */
  roles: string[];
  /** Let urgent orders through the gate without anyone having to act. */
  autoBypassUrgent: boolean;
  /** Order priorities treated as urgent. Matched case-insensitively. */
  urgentPriorities: string[];
}

export interface IpdAncillaryPolicy {
  pharmacy: IpdServicePolicy;
  lab: IpdServicePolicy;
  radiology: IpdServicePolicy;
  override: IpdOverridePolicy;
}

/**
 * Default: every service post_paid, consolidated — i.e. EXACTLY what the system does today.
 *
 * This is the opposite stance to DEFAULT_DAY_CARE_POLICY (which defaults its gate ON). The
 * reason is that the settings key is absent for every hospital already using the product, and
 * an absent key must mean "nothing changed". A gate that switched itself on at deploy would
 * block live wards.
 */
export const DEFAULT_IPD_ANCILLARY_POLICY: IpdAncillaryPolicy = {
  pharmacy: { mode: "post_paid", receipt: "consolidated" },
  lab: { mode: "post_paid", receipt: "consolidated" },
  radiology: { mode: "post_paid", receipt: "consolidated" },
  override: {
    allow: true,
    roles: ["admin", "billing"],
    autoBypassUrgent: true,
    urgentPriorities: ["stat", "urgent", "emergency"],
  },
};

/** hospital_settings key holding the policy — mirrors the 'daycare_payment' shape. */
export const IPD_ANCILLARY_POLICY_KEY = "ipd_ancillary_payment";

/** Line-item payment_status values that mean "this line is not blocking the service". */
const CLEARED_LINE_STATUSES = ["paid", "advance_covered", "waived", "insurance_auth"];

export type AncillaryClearanceReason =
  /** Not an admitted patient — OPD gates itself by not creating the order until paid. */
  | "not_ipd"
  /** This hospital accrues this service to the discharge bill. */
  | "policy_post_paid"
  /** Urgent order, and the hospital allows urgent work to proceed unpaid. */
  | "urgent_bypass"
  /** An authorised user recorded a reason. */
  | "override_recorded"
  /** No charge line exists to block on — see the note in evaluateAncillaryGate. */
  | "no_charge_found"
  /** Every charge for this order is settled. */
  | "cleared_paid"
  /** Money is outstanding and nothing excuses it. */
  | "blocked_unpaid";

export interface AncillaryClearance {
  cleared: boolean;
  reason: AncillaryClearanceReason;
  /** ₹ still to collect before the service may proceed. 0 when cleared. */
  unpaidAmount: number;
  /** True when an authorised user could clear this by recording a reason. */
  overrideAvailable: boolean;
}

/** Coerce to a finite number, else 0. Guards against NaN leaking into money maths. */
function num(v: number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function lower(v: string | null | undefined): string {
  return (v || "").toLowerCase().trim();
}

/**
 * PURE. Maps a postCharge sourceModule to the service whose policy governs it.
 *
 * THIS IS THE BACK-COMPAT LOCK. postCharge is shared with dialysis, physio, OT, blood bank
 * and nursing. Returning null for those forces post_paid, which reproduces postCharge's
 * original hardcoded `isIPD ? "advance_covered" : "pending_payment"` exactly — so wiring this
 * policy in cannot move a module the hospital never opted into. It also means no settings
 * fetch happens on their charge path.
 */
export function serviceForSourceModule(
  sourceModule: string | null | undefined
): IpdAncillaryService | null {
  const m = lower(sourceModule);
  return m === "pharmacy" || m === "lab" || m === "radiology" ? m : null;
}

/**
 * PURE. The extracted chargePosting.ts payment_status decision.
 *
 * OPD is always pending_payment (unchanged). An IPD post_paid charge is advance_covered,
 * meaning "carried by the admission, settle at discharge" — NOT "money has been received".
 * An IPD pre_paid charge is pending_payment, which is what puts it in the cashier's worklist
 * and what the gate blocks on.
 */
export function resolveChargePaymentStatus(input: {
  isIPD: boolean;
  mode: IpdAncillaryMode;
}): ChargePaymentStatus {
  if (!input.isIPD) return "pending_payment";
  return input.mode === "pre_paid" ? "pending_payment" : "advance_covered";
}

/**
 * PURE. Whether postCharge should debit the admission's advance ledger.
 *
 * THE SINGLE MOST IMPORTANT RULE IN THIS FILE. postCharge used to debit on `isIPD` alone. In
 * pre_paid mode the cashier physically takes cash for this charge — debiting the advance as
 * well would take the money twice from a patient who already handed it over. The debit must
 * follow the payment_status ("the admission is carrying this"), never the care setting.
 *
 * `debitAdvance` lets a caller opt out entirely; the lab/radiology/pharmacy paths pass false
 * because the discharge sweep never debited advances for them and silently starting to would
 * move ipd_advance_balances for every admitted patient in the system.
 */
export function shouldDebitAdvance(input: {
  paymentStatus: ChargePaymentStatus;
  debitAdvance?: boolean;
}): boolean {
  if (input.debitAdvance === false) return false;
  return input.paymentStatus === "advance_covered";
}

/** PURE. Is this order urgent enough to skip the gate, per the hospital's own list? */
export function isUrgentPriority(
  priority: string | null | undefined,
  policy: IpdAncillaryPolicy
): boolean {
  const p = lower(priority);
  if (!p) return false;
  return policy.override.urgentPriorities.map(lower).includes(p);
}

/** PURE. Role check for the audited override. */
export function canOverrideAncillaryGate(
  role: string | null | undefined,
  policy: IpdAncillaryPolicy
): boolean {
  if (!policy.override.allow) return false;
  const r = lower(role);
  if (!r) return false;
  return policy.override.roles.map(lower).includes(r);
}

export interface AncillaryChargeLine {
  payment_status?: string | null;
  total_amount?: number | null;
  /**
   * True when the bill this line sits on is fully settled (balance_due <= 0) — e.g. an
   * advance deposit covers it. Such a line is paid FOR even if its own payment_status still
   * reads 'pending_payment', so the service must be allowed to proceed. Without this an
   * advance-covered charge would deadlock: hidden from the cashier's worklist (nothing to
   * collect) yet treated as unpaid by the gate (forever blocked).
   */
  billSettled?: boolean;
}

/**
 * PURE. The gate. First match wins.
 */
export function evaluateAncillaryGate(input: {
  policy: IpdAncillaryPolicy;
  service: IpdAncillaryService;
  isIPD: boolean;
  priority?: string | null;
  role?: string | null;
  overrideRecorded?: boolean;
  /** The bill_line_items found for this order. null/[] = none found. */
  charges: AncillaryChargeLine[] | null | undefined;
}): AncillaryClearance {
  const { policy, service, isIPD } = input;

  const unpaid = (input.charges || [])
    // A line is outstanding only if it is neither individually settled NOR carried by a bill
    // an advance has already covered.
    .filter((c) => !c.billSettled && !CLEARED_LINE_STATUSES.includes(lower(c.payment_status) || "pending_payment"))
    .reduce((s, c) => s + num(c.total_amount), 0);

  const overrideAvailable = canOverrideAncillaryGate(input.role, policy);
  const clear = (reason: AncillaryClearanceReason): AncillaryClearance => ({
    cleared: true,
    reason,
    unpaidAmount: 0,
    overrideAvailable,
  });

  // OPD/standalone never reaches this gate's premise — its order does not exist until paid.
  if (!isIPD) return clear("not_ipd");

  if (policy[service].mode !== "pre_paid") return clear("policy_post_paid");

  // Urgency is checked BEFORE payment, deliberately. A STAT troponin must not wait on a
  // cashier. The charge is still posted and still appears in the collections worklist —
  // bypass means "don't block the clinician", not "don't bill".
  if (policy.override.autoBypassUrgent && isUrgentPriority(input.priority, policy)) {
    return clear("urgent_bypass");
  }

  if (input.overrideRecorded) return clear("override_recorded");

  // No charge line means we have nothing to assert about — the rate was ₹0, postCharge failed,
  // or the order predates this feature. Blocking here would strand a clinical action on a
  // billing glitch, so this CLEARS. The order paths compensate by refusing to create an order
  // whose postCharge failed, which is where that failure belongs.
  if (!input.charges || input.charges.length === 0) return clear("no_charge_found");

  if (unpaid <= 0) return clear("cleared_paid");

  return {
    cleared: false,
    reason: "blocked_unpaid",
    unpaidAmount: Math.round(unpaid),
    overrideAvailable,
  };
}

/** PURE. Never throws — a malformed settings row must not block the ward. */
function parseServicePolicy(value: unknown, fallback: IpdServicePolicy): IpdServicePolicy {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...fallback };
  const v = value as Record<string, unknown>;
  // Anything unrecognised falls back to post_paid: an unreadable policy must not invent a
  // gate that blocks care.
  const mode: IpdAncillaryMode = v.mode === "pre_paid" ? "pre_paid" : "post_paid";
  const receipt: IpdReceiptShape = v.receipt === "separate" ? "separate" : "consolidated";
  return { mode, receipt };
}

/**
 * PURE. Never throws.
 *
 * A malformed value is treated as an empty object rather than short-circuiting to
 * DEFAULT_IPD_ANCILLARY_POLICY, so every returned policy is freshly constructed. Returning
 * the default object (or a shallow spread of it) would alias the module-level singleton:
 * one caller mutating its own policy would silently rewrite the defaults for every hospital
 * for the life of the process.
 */
export function parseIpdAncillaryPolicy(value: unknown): IpdAncillaryPolicy {
  const d = DEFAULT_IPD_ANCILLARY_POLICY;
  const v = (
    value && typeof value === "object" && !Array.isArray(value) ? value : {}
  ) as Record<string, unknown>;
  const o = (v.override && typeof v.override === "object" && !Array.isArray(v.override)
    ? v.override
    : {}) as Record<string, unknown>;

  const roles = Array.isArray(o.roles)
    ? o.roles.filter((r): r is string => typeof r === "string")
    : null;
  const urgent = Array.isArray(o.urgent_priorities)
    ? o.urgent_priorities.filter((r): r is string => typeof r === "string")
    : null;

  return {
    pharmacy: parseServicePolicy(v.pharmacy, d.pharmacy),
    lab: parseServicePolicy(v.lab, d.lab),
    radiology: parseServicePolicy(v.radiology, d.radiology),
    override: {
      allow: typeof o.allow === "boolean" ? o.allow : d.override.allow,
      roles: roles && roles.length > 0 ? roles : [...d.override.roles],
      autoBypassUrgent:
        typeof o.auto_bypass_urgent === "boolean" ? o.auto_bypass_urgent : d.override.autoBypassUrgent,
      // An empty urgent list is honoured (a hospital may genuinely want no auto-bypass), but
      // a missing/malformed one falls back to the defaults.
      urgentPriorities: urgent ?? [...d.override.urgentPriorities],
    },
  };
}

/** PURE. TS camelCase → the snake_case JSONB actually stored. */
export function serialiseIpdAncillaryPolicy(p: IpdAncillaryPolicy): Record<string, unknown> {
  const svc = (s: IpdServicePolicy) => ({ mode: s.mode, receipt: s.receipt });
  return {
    pharmacy: svc(p.pharmacy),
    lab: svc(p.lab),
    radiology: svc(p.radiology),
    override: {
      allow: p.override.allow,
      roles: p.override.roles,
      auto_bypass_urgent: p.override.autoBypassUrgent,
      urgent_priorities: p.override.urgentPriorities,
    },
  };
}

export async function fetchIpdAncillaryPolicy(hospitalId: string): Promise<IpdAncillaryPolicy> {
  const { data } = await (supabase as any)
    .from("hospital_settings")
    .select("value")
    .eq("hospital_id", hospitalId)
    .eq("key", IPD_ANCILLARY_POLICY_KEY)
    .maybeSingle();
  return parseIpdAncillaryPolicy(data?.value);
}

/**
 * I/O wrapper: gathers what the gate needs and evaluates it. Kept thin — every decision lives
 * in the pure functions above.
 *
 * `dedupeKeys` are the source_dedupe_key values postCharge wrote for this order. They are the
 * only reliable link from an order back to its money: the same keys the discharge sweep uses
 * (lab:{lab_order_items.id}, radiology:{radiology_orders.id},
 * pharmacy:dispense-item:{pharmacy_dispensing_items.id}).
 */
export async function checkAncillaryClearance(
  hospitalId: string,
  opts: {
    service: IpdAncillaryService;
    admissionId?: string | null;
    dedupeKeys: string[];
    priority?: string | null;
    role?: string | null;
    overrideRecorded?: boolean;
    /** Skips the settings read when the caller already has the policy. */
    policy?: IpdAncillaryPolicy;
  }
): Promise<AncillaryClearance> {
  const policy = opts.policy ?? (await fetchIpdAncillaryPolicy(hospitalId));
  const isIPD = !!opts.admissionId;

  // Short-circuit before touching the DB: post_paid and OPD can't be blocked, so there is no
  // reason to make the ward wait on a query.
  if (!isIPD || policy[opts.service].mode !== "pre_paid") {
    return evaluateAncillaryGate({ ...opts, policy, isIPD, charges: null });
  }

  let charges: AncillaryChargeLine[] | null = null;
  if (opts.dedupeKeys.length > 0) {
    const { data } = await (supabase as any)
      .from("bill_line_items")
      .select("payment_status, total_amount, bills!inner(balance_due, paid_amount)")
      .eq("hospital_id", hospitalId)
      .in("source_dedupe_key", opts.dedupeKeys);
    charges = ((data as any[]) || []).map((r) => ({
      payment_status: r.payment_status,
      total_amount: r.total_amount,
      // Covered by an advance: the bill has something paid and nothing left owing.
      billSettled: Number(r.bills?.balance_due) <= 0 && Number(r.bills?.paid_amount) > 0,
    }));
  }

  return evaluateAncillaryGate({ ...opts, policy, isIPD, charges });
}
