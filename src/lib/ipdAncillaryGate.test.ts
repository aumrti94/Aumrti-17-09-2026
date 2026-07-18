import { describe, it, expect } from "vitest";
import {
  DEFAULT_IPD_ANCILLARY_POLICY,
  IpdAncillaryPolicy,
  IpdAncillaryService,
  canOverrideAncillaryGate,
  evaluateAncillaryGate,
  isUrgentPriority,
  parseIpdAncillaryPolicy,
  resolveChargePaymentStatus,
  serialiseIpdAncillaryPolicy,
  serviceForSourceModule,
  shouldDebitAdvance,
} from "./ipdAncillaryGate";

const policy = (over: Partial<IpdAncillaryPolicy> = {}): IpdAncillaryPolicy => ({
  ...DEFAULT_IPD_ANCILLARY_POLICY,
  ...over,
});

/** Turn one service pre_paid, leaving the rest at their defaults. */
const prePaid = (service: IpdAncillaryService, over: Partial<IpdAncillaryPolicy> = {}) =>
  policy({ [service]: { mode: "pre_paid", receipt: "consolidated" }, ...over } as Partial<IpdAncillaryPolicy>);

/** An admitted patient's ₹450 lab test, unpaid, at a pre_paid-lab hospital. */
const base = {
  policy: prePaid("lab"),
  service: "lab" as IpdAncillaryService,
  isIPD: true,
  priority: "routine" as string | null,
  role: "nurse" as string | null,
  overrideRecorded: false,
  charges: [{ payment_status: "pending_payment", total_amount: 450 }],
};

// ─────────────────────────────────────────────────────────────────────────────
// The back-compat proof. postCharge is shared with dialysis/physio/OT/blood_bank/
// nursing, and this matrix is the executable evidence that routing it through the
// policy did not move them. If this table changes, a module that never opted into
// pre-payment just started behaving differently.
// ─────────────────────────────────────────────────────────────────────────────
describe("resolveChargePaymentStatus × shouldDebitAdvance (the back-compat matrix)", () => {
  it("OPD is always pending_payment and never debits an advance", () => {
    for (const mode of ["post_paid", "pre_paid"] as const) {
      const paymentStatus = resolveChargePaymentStatus({ isIPD: false, mode });
      expect(paymentStatus).toBe("pending_payment");
      expect(shouldDebitAdvance({ paymentStatus })).toBe(false);
    }
  });

  it("IPD post_paid is advance_covered and DOES debit — today's behaviour, unchanged", () => {
    const paymentStatus = resolveChargePaymentStatus({ isIPD: true, mode: "post_paid" });
    expect(paymentStatus).toBe("advance_covered");
    expect(shouldDebitAdvance({ paymentStatus })).toBe(true);
  });

  it("IPD pre_paid is pending_payment and must NOT debit — the double-charge rule", () => {
    // The cashier physically takes cash for this charge. Debiting the advance as well would
    // take the money twice from a patient who already handed it over.
    const paymentStatus = resolveChargePaymentStatus({ isIPD: true, mode: "pre_paid" });
    expect(paymentStatus).toBe("pending_payment");
    expect(shouldDebitAdvance({ paymentStatus })).toBe(false);
  });

  it("debitAdvance:false opts out even when the status would otherwise debit", () => {
    // lab/radiology/pharmacy pass this: the discharge sweep never debited advances for them,
    // and silently starting to would move ipd_advance_balances for every admitted patient.
    expect(shouldDebitAdvance({ paymentStatus: "advance_covered", debitAdvance: false })).toBe(false);
  });

  it("debitAdvance defaults to true, so existing callers that omit it are untouched", () => {
    expect(shouldDebitAdvance({ paymentStatus: "advance_covered", debitAdvance: undefined })).toBe(true);
    expect(shouldDebitAdvance({ paymentStatus: "advance_covered", debitAdvance: true })).toBe(true);
  });
});

describe("serviceForSourceModule (the back-compat lock)", () => {
  it("maps only the three governed services", () => {
    expect(serviceForSourceModule("lab")).toBe("lab");
    expect(serviceForSourceModule("radiology")).toBe("radiology");
    expect(serviceForSourceModule("pharmacy")).toBe("pharmacy");
  });

  it("returns null for every module that shares postCharge but is not governed", () => {
    // null forces post_paid, which reproduces postCharge's original hardcoded ternary and
    // means no settings fetch happens on their charge path.
    for (const m of ["dialysis", "physio", "ot", "blood_bank", "nursing"]) {
      expect(serviceForSourceModule(m)).toBeNull();
    }
  });

  it("is case-insensitive and null-safe", () => {
    expect(serviceForSourceModule("LAB")).toBe("lab");
    expect(serviceForSourceModule(" Radiology ")).toBe("radiology");
    expect(serviceForSourceModule(null)).toBeNull();
    expect(serviceForSourceModule(undefined)).toBeNull();
    expect(serviceForSourceModule("")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The gate itself. Order matters — these assert first-match-wins.
// ─────────────────────────────────────────────────────────────────────────────
describe("evaluateAncillaryGate", () => {
  it("blocks an unpaid pre_paid IPD order and reports the shortfall", () => {
    const r = evaluateAncillaryGate(base);
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("blocked_unpaid");
    expect(r.unpaidAmount).toBe(450);
  });

  it("never blocks OPD — its order does not exist until paid", () => {
    const r = evaluateAncillaryGate({ ...base, isIPD: false });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("not_ipd");
  });

  it("never blocks a post_paid service — today's default", () => {
    const r = evaluateAncillaryGate({ ...base, policy: policy() });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("policy_post_paid");
  });

  it("gates each service independently", () => {
    // lab pre_paid, radiology still post_paid — the same unpaid charge blocks one, not the other.
    expect(evaluateAncillaryGate({ ...base, service: "lab" }).cleared).toBe(false);
    expect(evaluateAncillaryGate({ ...base, service: "radiology" }).cleared).toBe(true);
  });

  it("lets an urgent order through, and urgency beats an unpaid balance", () => {
    for (const p of ["stat", "STAT", "urgent", "emergency"]) {
      const r = evaluateAncillaryGate({ ...base, priority: p });
      expect(r.cleared).toBe(true);
      expect(r.reason).toBe("urgent_bypass");
    }
  });

  it("does not bypass urgent orders when the hospital switched that off", () => {
    const p = prePaid("lab", {
      override: { ...DEFAULT_IPD_ANCILLARY_POLICY.override, autoBypassUrgent: false },
    });
    const r = evaluateAncillaryGate({ ...base, policy: p, priority: "stat" });
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("blocked_unpaid");
  });

  it("honours a hospital's own urgent-priority list", () => {
    const p = prePaid("lab", {
      override: { ...DEFAULT_IPD_ANCILLARY_POLICY.override, urgentPriorities: ["asap"] },
    });
    expect(evaluateAncillaryGate({ ...base, policy: p, priority: "asap" }).reason).toBe("urgent_bypass");
    expect(evaluateAncillaryGate({ ...base, policy: p, priority: "stat" }).reason).toBe("blocked_unpaid");
  });

  it("an audited override clears the gate", () => {
    const r = evaluateAncillaryGate({ ...base, overrideRecorded: true });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("override_recorded");
    expect(r.unpaidAmount).toBe(0);
  });

  it("urgency is evaluated BEFORE the override, so no one has to act on a STAT order", () => {
    const r = evaluateAncillaryGate({ ...base, priority: "stat", overrideRecorded: true });
    expect(r.reason).toBe("urgent_bypass");
  });

  it("CLEARS when no charge line exists — a billing glitch must not strand clinical work", () => {
    for (const charges of [null, undefined, []]) {
      const r = evaluateAncillaryGate({ ...base, charges });
      expect(r.cleared).toBe(true);
      expect(r.reason).toBe("no_charge_found");
    }
  });

  it("clears once every line is settled", () => {
    const r = evaluateAncillaryGate({
      ...base,
      charges: [{ payment_status: "paid", total_amount: 450 }],
    });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("cleared_paid");
    expect(r.unpaidAmount).toBe(0);
  });

  it("treats waived / insurance_auth / advance_covered lines as settled", () => {
    for (const s of ["waived", "insurance_auth", "advance_covered"]) {
      const r = evaluateAncillaryGate({ ...base, charges: [{ payment_status: s, total_amount: 450 }] });
      expect(r.cleared).toBe(true);
      expect(r.reason).toBe("cleared_paid");
    }
  });

  it("blocks on a partially paid order and sums only the unpaid lines", () => {
    const r = evaluateAncillaryGate({
      ...base,
      charges: [
        { payment_status: "paid", total_amount: 450 },
        { payment_status: "pending_payment", total_amount: 800 },
        { payment_status: "pending_payment", total_amount: 200 },
      ],
    });
    expect(r.cleared).toBe(false);
    expect(r.unpaidAmount).toBe(1000);
  });

  it("treats a null/absent line status as unpaid (the DB default is pending_payment)", () => {
    const r = evaluateAncillaryGate({ ...base, charges: [{ payment_status: null, total_amount: 450 }] });
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("blocked_unpaid");
  });

  it("clears a pending line whose bill an advance has already covered — the deadlock fix", () => {
    // The charge reads 'pending_payment', but its bill is settled (advance covers it), so it
    // is paid FOR. Blocking here would strand the service: the cashier's worklist hides
    // settled bills, so there would be nothing to collect and the gate would never open.
    const r = evaluateAncillaryGate({
      ...base,
      charges: [{ payment_status: "pending_payment", total_amount: 450, billSettled: true }],
    });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("cleared_paid");
    expect(r.unpaidAmount).toBe(0);
  });

  it("still blocks a genuinely unpaid line whose bill is NOT settled", () => {
    const r = evaluateAncillaryGate({
      ...base,
      charges: [{ payment_status: "pending_payment", total_amount: 450, billSettled: false }],
    });
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("blocked_unpaid");
  });

  it("counts only the lines on unsettled bills toward the shortfall", () => {
    const r = evaluateAncillaryGate({
      ...base,
      charges: [
        { payment_status: "pending_payment", total_amount: 450, billSettled: true },
        { payment_status: "pending_payment", total_amount: 800, billSettled: false },
      ],
    });
    expect(r.cleared).toBe(false);
    expect(r.unpaidAmount).toBe(800);
  });

  it("does not let a NaN or null amount invent a balance", () => {
    const r = evaluateAncillaryGate({
      ...base,
      charges: [{ payment_status: "pending_payment", total_amount: null }],
    });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("cleared_paid");
    expect(r.unpaidAmount).toBe(0);
  });

  it("reports whether the current user could override, without granting it", () => {
    expect(evaluateAncillaryGate({ ...base, role: "nurse" }).overrideAvailable).toBe(false);
    expect(evaluateAncillaryGate({ ...base, role: "billing" }).overrideAvailable).toBe(true);
  });
});

describe("canOverrideAncillaryGate", () => {
  it("allows the configured roles, case-insensitively", () => {
    expect(canOverrideAncillaryGate("admin", policy())).toBe(true);
    expect(canOverrideAncillaryGate("BILLING", policy())).toBe(true);
  });

  it("refuses everyone else", () => {
    expect(canOverrideAncillaryGate("nurse", policy())).toBe(false);
    expect(canOverrideAncillaryGate(null, policy())).toBe(false);
    expect(canOverrideAncillaryGate("", policy())).toBe(false);
  });

  it("refuses everyone when the hospital disabled overrides outright", () => {
    const p = policy({ override: { ...DEFAULT_IPD_ANCILLARY_POLICY.override, allow: false } });
    expect(canOverrideAncillaryGate("admin", p)).toBe(false);
  });
});

describe("isUrgentPriority", () => {
  it("matches case-insensitively and is null-safe", () => {
    expect(isUrgentPriority("STAT", policy())).toBe(true);
    expect(isUrgentPriority("routine", policy())).toBe(false);
    expect(isUrgentPriority(null, policy())).toBe(false);
    expect(isUrgentPriority("", policy())).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// A malformed settings row must never block a ward. Every one of these must
// return a usable policy, and an unreadable one must mean post_paid.
// ─────────────────────────────────────────────────────────────────────────────
describe("parseIpdAncillaryPolicy", () => {
  it("never throws, and falls back to today's behaviour", () => {
    for (const v of [null, undefined, [], "x", 42, {}, true]) {
      const p = parseIpdAncillaryPolicy(v);
      expect(p.lab.mode).toBe("post_paid");
      expect(p.pharmacy.mode).toBe("post_paid");
      expect(p.radiology.mode).toBe("post_paid");
    }
  });

  it("an unrecognised mode falls back to post_paid, never to a gate", () => {
    const p = parseIpdAncillaryPolicy({ lab: { mode: "banana", receipt: "consolidated" } });
    expect(p.lab.mode).toBe("post_paid");
  });

  it("an unrecognised receipt falls back to consolidated", () => {
    const p = parseIpdAncillaryPolicy({ lab: { mode: "pre_paid", receipt: "banana" } });
    expect(p.lab.receipt).toBe("consolidated");
  });

  it("reads a fully-specified policy", () => {
    const p = parseIpdAncillaryPolicy({
      pharmacy: { mode: "pre_paid", receipt: "separate" },
      lab: { mode: "pre_paid", receipt: "consolidated" },
      radiology: { mode: "post_paid", receipt: "consolidated" },
      override: { allow: false, roles: ["cashier"], auto_bypass_urgent: false, urgent_priorities: ["asap"] },
    });
    expect(p.pharmacy).toEqual({ mode: "pre_paid", receipt: "separate" });
    expect(p.lab).toEqual({ mode: "pre_paid", receipt: "consolidated" });
    expect(p.radiology).toEqual({ mode: "post_paid", receipt: "consolidated" });
    expect(p.override).toEqual({
      allow: false, roles: ["cashier"], autoBypassUrgent: false, urgentPriorities: ["asap"],
    });
  });

  it("fills in only the services a partial policy omits", () => {
    const p = parseIpdAncillaryPolicy({ lab: { mode: "pre_paid", receipt: "separate" } });
    expect(p.lab).toEqual({ mode: "pre_paid", receipt: "separate" });
    expect(p.radiology.mode).toBe("post_paid");
    expect(p.override.roles).toEqual(["admin", "billing"]);
  });

  it("honours an explicitly empty urgent list but not a malformed one", () => {
    // A hospital may genuinely want no auto-bypass; a broken row should not mean that.
    expect(parseIpdAncillaryPolicy({ override: { urgent_priorities: [] } }).override.urgentPriorities).toEqual([]);
    expect(parseIpdAncillaryPolicy({ override: { urgent_priorities: "stat" } }).override.urgentPriorities)
      .toEqual(["stat", "urgent", "emergency"]);
  });

  it("drops non-string entries from roles", () => {
    expect(parseIpdAncillaryPolicy({ override: { roles: ["admin", 7, null] } }).override.roles).toEqual(["admin"]);
  });

  it("falls back rather than accept an empty roles list, which would strand the override", () => {
    expect(parseIpdAncillaryPolicy({ override: { roles: [] } }).override.roles).toEqual(["admin", "billing"]);
  });

  it("does not alias the defaults — a parsed policy must not mutate DEFAULT_*", () => {
    const p = parseIpdAncillaryPolicy(null);
    p.override.roles.push("hacked");
    p.lab.mode = "pre_paid";
    expect(DEFAULT_IPD_ANCILLARY_POLICY.override.roles).toEqual(["admin", "billing"]);
    expect(DEFAULT_IPD_ANCILLARY_POLICY.lab.mode).toBe("post_paid");
  });
});

describe("serialiseIpdAncillaryPolicy", () => {
  it("round-trips through the snake_case JSONB boundary", () => {
    const original = parseIpdAncillaryPolicy({
      pharmacy: { mode: "pre_paid", receipt: "separate" },
      lab: { mode: "post_paid", receipt: "consolidated" },
      radiology: { mode: "pre_paid", receipt: "separate" },
      override: { allow: true, roles: ["admin"], auto_bypass_urgent: false, urgent_priorities: ["stat"] },
    });
    expect(parseIpdAncillaryPolicy(serialiseIpdAncillaryPolicy(original))).toEqual(original);
  });

  it("writes snake_case keys, not the TS camelCase", () => {
    const s = serialiseIpdAncillaryPolicy(DEFAULT_IPD_ANCILLARY_POLICY) as any;
    expect(s.override).toHaveProperty("auto_bypass_urgent");
    expect(s.override).toHaveProperty("urgent_priorities");
    expect(s.override).not.toHaveProperty("autoBypassUrgent");
  });
});
