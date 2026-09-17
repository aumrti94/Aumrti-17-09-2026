/**
 * Phase 1 (PHASED_TEST_PLAN.md §8) — pure, cheap, adjacent.
 *
 * This gate decides whether an admitted patient's lab sample is collected, scan started or
 * drug dispensed before the attendant has paid. It errs toward LETTING CLINICAL WORK PROCEED,
 * and every fork below is asserted in the direction the file says it should fail — a gate
 * that fails closed here makes a STAT troponin unclampable at 3am.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => {
  const state: { settings: unknown; lines: unknown[] | null; lineFilters: unknown[] } = {
    settings: null,
    lines: null,
    lineFilters: [],
  };

  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    b.select = () => b;
    b.eq = (col: string, val: unknown) => {
      state.lineFilters.push([col, val]);
      return b;
    };
    b.in = (col: string, vals: unknown) => {
      state.lineFilters.push([col, vals]);
      return b;
    };
    b.maybeSingle = async () => ({ data: state.settings, error: null });
    b.then = (ok: unknown, err: unknown) =>
      Promise.resolve({ data: table === "bill_line_items" ? state.lines : null, error: null }).then(
        ok as never,
        err as never,
      );
    return b;
  };

  return { state, supabase: { from: (table: string) => builder(table) } };
});

vi.mock("@/integrations/supabase/client", () => ({ supabase: mocks.supabase }));

import {
  DEFAULT_IPD_ANCILLARY_POLICY,
  IPD_ANCILLARY_POLICY_KEY,
  fetchIpdAncillaryPolicy,
  checkAncillaryClearance,
  serviceForSourceModule,
  resolveChargePaymentStatus,
  shouldDebitAdvance,
  isUrgentPriority,
  canOverrideAncillaryGate,
  evaluateAncillaryGate,
  parseIpdAncillaryPolicy,
  serialiseIpdAncillaryPolicy,
  type IpdAncillaryPolicy,
  type IpdAncillaryService,
} from "@/lib/ipdAncillaryGate";

/** A policy with one service switched to pre_paid, everything else at defaults. */
const prePaid = (service: IpdAncillaryService): IpdAncillaryPolicy => ({
  ...parseIpdAncillaryPolicy(null),
  [service]: { mode: "pre_paid", receipt: "consolidated" },
});

describe("DEFAULT_IPD_ANCILLARY_POLICY", () => {
  it("leaves every service post_paid — an absent settings key must mean 'nothing changed'", () => {
    // The opposite stance to DEFAULT_DAY_CARE_POLICY, deliberately. The settings key is
    // absent for every hospital already using the product; a gate that switched itself on at
    // deploy would block live wards.
    expect(DEFAULT_IPD_ANCILLARY_POLICY.pharmacy.mode).toBe("post_paid");
    expect(DEFAULT_IPD_ANCILLARY_POLICY.lab.mode).toBe("post_paid");
    expect(DEFAULT_IPD_ANCILLARY_POLICY.radiology.mode).toBe("post_paid");
  });

  it("defaults every receipt to consolidated", () => {
    for (const s of ["pharmacy", "lab", "radiology"] as const) {
      expect(DEFAULT_IPD_ANCILLARY_POLICY[s].receipt).toBe("consolidated");
    }
  });

  it("lets urgent orders through and allows an audited override by default", () => {
    expect(DEFAULT_IPD_ANCILLARY_POLICY.override.allow).toBe(true);
    expect(DEFAULT_IPD_ANCILLARY_POLICY.override.autoBypassUrgent).toBe(true);
    expect(DEFAULT_IPD_ANCILLARY_POLICY.override.urgentPriorities).toEqual(["stat", "urgent", "emergency"]);
    expect(DEFAULT_IPD_ANCILLARY_POLICY.override.roles).toEqual(["admin", "billing"]);
  });

  it("stores under the hospital_settings key that mirrors daycare_payment", () => {
    expect(IPD_ANCILLARY_POLICY_KEY).toBe("ipd_ancillary_payment");
  });
});

describe("serviceForSourceModule — the back-compat lock", () => {
  it.each(["pharmacy", "lab", "radiology"])("governs %s", (module) => {
    expect(serviceForSourceModule(module)).toBe(module);
  });

  it("matches case-insensitively and trims", () => {
    expect(serviceForSourceModule("Pharmacy")).toBe("pharmacy");
    expect(serviceForSourceModule("  LAB  ")).toBe("lab");
  });

  it.each(["dialysis", "physio", "ot", "blood_bank", "nursing", "", null, undefined])(
    "returns null for %s, forcing post_paid",
    (module) => {
      // Returning null reproduces postCharge's original hardcoded behaviour exactly, so
      // wiring this policy in cannot move a module the hospital never opted into. It also
      // means no settings fetch happens on their charge path.
      expect(serviceForSourceModule(module as string | null | undefined)).toBeNull();
    },
  );
});

describe("resolveChargePaymentStatus", () => {
  it("is always pending_payment for OPD, whatever the policy says", () => {
    // OPD gates itself by not creating the order until cash is taken, so its charge is
    // pending by construction. The IPD policy must not reach it.
    expect(resolveChargePaymentStatus({ isIPD: false, mode: "post_paid" })).toBe("pending_payment");
    expect(resolveChargePaymentStatus({ isIPD: false, mode: "pre_paid" })).toBe("pending_payment");
  });

  it("marks an IPD post_paid charge advance_covered — 'carried by the admission', not 'received'", () => {
    expect(resolveChargePaymentStatus({ isIPD: true, mode: "post_paid" })).toBe("advance_covered");
  });

  it("marks an IPD pre_paid charge pending_payment so it reaches the cashier's worklist", () => {
    expect(resolveChargePaymentStatus({ isIPD: true, mode: "pre_paid" })).toBe("pending_payment");
  });
});

describe("shouldDebitAdvance — the single most important rule in the file", () => {
  it("debits the advance ledger for a charge the admission is carrying", () => {
    expect(shouldDebitAdvance({ paymentStatus: "advance_covered" })).toBe(true);
  });

  it("does NOT debit the advance for a pre_paid charge the cashier collects in cash", () => {
    // Debiting here would take the money twice from a patient who already handed it over.
    // The debit follows payment_status, never the care setting.
    expect(shouldDebitAdvance({ paymentStatus: "pending_payment" })).toBe(false);
  });

  it("honours an explicit opt-out regardless of status", () => {
    // lab/radiology/pharmacy pass false because the discharge sweep never debited advances
    // for them; silently starting to would move ipd_advance_balances for every admitted
    // patient in the system.
    expect(shouldDebitAdvance({ paymentStatus: "advance_covered", debitAdvance: false })).toBe(false);
    expect(shouldDebitAdvance({ paymentStatus: "pending_payment", debitAdvance: false })).toBe(false);
  });

  it("treats an omitted or true flag as opting in", () => {
    expect(shouldDebitAdvance({ paymentStatus: "advance_covered", debitAdvance: true })).toBe(true);
    expect(shouldDebitAdvance({ paymentStatus: "advance_covered", debitAdvance: undefined })).toBe(true);
  });

  it("composes with resolveChargePaymentStatus so pre_paid never double-charges", () => {
    // The end-to-end statement of the rule, asserted as one expression rather than two
    // separate unit facts that a refactor could decouple.
    const prePaidStatus = resolveChargePaymentStatus({ isIPD: true, mode: "pre_paid" });
    const postPaidStatus = resolveChargePaymentStatus({ isIPD: true, mode: "post_paid" });
    expect(shouldDebitAdvance({ paymentStatus: prePaidStatus })).toBe(false);
    expect(shouldDebitAdvance({ paymentStatus: postPaidStatus })).toBe(true);
  });
});

describe("isUrgentPriority", () => {
  const policy = parseIpdAncillaryPolicy(null);

  it.each(["stat", "urgent", "emergency", "STAT", "  Urgent  "])("treats %s as urgent", (priority) => {
    expect(isUrgentPriority(priority, policy)).toBe(true);
  });

  it.each(["routine", "normal", "", null, undefined])("treats %s as not urgent", (priority) => {
    expect(isUrgentPriority(priority as string | null | undefined, policy)).toBe(false);
  });

  it("honours a hospital's own urgent vocabulary", () => {
    const custom = parseIpdAncillaryPolicy({ override: { urgent_priorities: ["asap", "Code Blue"] } });
    expect(isUrgentPriority("asap", custom)).toBe(true);
    expect(isUrgentPriority("code blue", custom)).toBe(true);
    expect(isUrgentPriority("stat", custom)).toBe(false);
  });

  it("does not substring-match", () => {
    expect(isUrgentPriority("non-urgent", policy)).toBe(false);
  });
});

describe("canOverrideAncillaryGate", () => {
  const policy = parseIpdAncillaryPolicy(null);

  it("permits the configured roles", () => {
    expect(canOverrideAncillaryGate("admin", policy)).toBe(true);
    expect(canOverrideAncillaryGate("billing", policy)).toBe(true);
    expect(canOverrideAncillaryGate("ADMIN", policy)).toBe(true);
  });

  it("refuses any other role", () => {
    for (const role of ["nurse", "doctor", "lab_tech", "pharmacist", "", null, undefined]) {
      expect(canOverrideAncillaryGate(role as string | null | undefined, policy), String(role)).toBe(false);
    }
  });

  it("refuses everyone when the master switch is off", () => {
    const locked = parseIpdAncillaryPolicy({ override: { allow: false } });
    expect(canOverrideAncillaryGate("admin", locked)).toBe(false);
    expect(canOverrideAncillaryGate("billing", locked)).toBe(false);
  });
});

describe("evaluateAncillaryGate — first match wins, in this order", () => {
  const unpaidCharge = [{ payment_status: "pending_payment", total_amount: 1200 }];

  it("1. OPD is never gated, even with an unpaid charge", () => {
    const r = evaluateAncillaryGate({
      policy: prePaid("lab"),
      service: "lab",
      isIPD: false,
      charges: unpaidCharge,
    });
    expect(r).toMatchObject({ cleared: true, reason: "not_ipd", unpaidAmount: 0 });
  });

  it("2. a post_paid service is never gated", () => {
    const r = evaluateAncillaryGate({
      policy: parseIpdAncillaryPolicy(null),
      service: "lab",
      isIPD: true,
      charges: unpaidCharge,
    });
    expect(r).toMatchObject({ cleared: true, reason: "policy_post_paid" });
  });

  it("3. urgency is checked BEFORE payment — a STAT troponin does not wait on a cashier", () => {
    const r = evaluateAncillaryGate({
      policy: prePaid("lab"),
      service: "lab",
      isIPD: true,
      priority: "stat",
      charges: unpaidCharge,
    });
    expect(r).toMatchObject({ cleared: true, reason: "urgent_bypass", unpaidAmount: 0 });
  });

  it("3b. urgency does not bypass when the hospital has turned auto-bypass off", () => {
    const policy = parseIpdAncillaryPolicy({ lab: { mode: "pre_paid" }, override: { auto_bypass_urgent: false } });
    const r = evaluateAncillaryGate({ policy, service: "lab", isIPD: true, priority: "stat", charges: unpaidCharge });
    expect(r.cleared).toBe(false);
    expect(r.reason).toBe("blocked_unpaid");
  });

  it("4. a recorded override clears the gate", () => {
    const r = evaluateAncillaryGate({
      policy: prePaid("lab"),
      service: "lab",
      isIPD: true,
      overrideRecorded: true,
      charges: unpaidCharge,
    });
    expect(r).toMatchObject({ cleared: true, reason: "override_recorded" });
  });

  it("5. no charge line found CLEARS rather than blocks", () => {
    // The stated stance: blocking here would strand a clinical action on a billing glitch —
    // a ₹0 rate, a failed postCharge, or an order predating the feature. The order paths
    // compensate by refusing to create an order whose postCharge failed.
    for (const charges of [null, undefined, []]) {
      const r = evaluateAncillaryGate({ policy: prePaid("lab"), service: "lab", isIPD: true, charges });
      expect(r).toMatchObject({ cleared: true, reason: "no_charge_found" });
    }
  });

  it("6. a fully settled charge clears", () => {
    const r = evaluateAncillaryGate({
      policy: prePaid("lab"),
      service: "lab",
      isIPD: true,
      charges: [{ payment_status: "paid", total_amount: 1200 }],
    });
    expect(r).toMatchObject({ cleared: true, reason: "cleared_paid", unpaidAmount: 0 });
  });

  it("7. an outstanding charge blocks, with the amount to collect", () => {
    const r = evaluateAncillaryGate({
      policy: prePaid("lab"),
      service: "lab",
      isIPD: true,
      charges: [{ payment_status: "pending_payment", total_amount: 1200 }],
    });
    expect(r).toMatchObject({ cleared: false, reason: "blocked_unpaid", unpaidAmount: 1200 });
  });
});

describe("evaluateAncillaryGate — which line statuses count as settled", () => {
  it.each(["paid", "advance_covered", "waived", "insurance_auth"])("%s does not block", (status) => {
    const r = evaluateAncillaryGate({
      policy: prePaid("pharmacy"),
      service: "pharmacy",
      isIPD: true,
      charges: [{ payment_status: status, total_amount: 500 }],
    });
    expect(r.cleared).toBe(true);
    expect(r.reason).toBe("cleared_paid");
  });

  it("a line covered by a settled bill clears even while its own status reads pending", () => {
    // Without billSettled an advance-covered charge deadlocks: hidden from the cashier's
    // worklist (nothing to collect) yet treated as unpaid by the gate (blocked forever).
    const r = evaluateAncillaryGate({
      policy: prePaid("pharmacy"),
      service: "pharmacy",
      isIPD: true,
      charges: [{ payment_status: "pending_payment", total_amount: 500, billSettled: true }],
    });
    expect(r).toMatchObject({ cleared: true, reason: "cleared_paid" });
  });

  it("treats a missing payment_status as pending", () => {
    const r = evaluateAncillaryGate({
      policy: prePaid("pharmacy"),
      service: "pharmacy",
      isIPD: true,
      charges: [{ total_amount: 500 }],
    });
    expect(r.cleared).toBe(false);
    expect(r.unpaidAmount).toBe(500);
  });

  it("sums several outstanding lines and rounds to whole rupees", () => {
    const r = evaluateAncillaryGate({
      policy: prePaid("radiology"),
      service: "radiology",
      isIPD: true,
      charges: [
        { payment_status: "pending_payment", total_amount: 1200.4 },
        { payment_status: "pending_payment", total_amount: 800.3 },
        { payment_status: "paid", total_amount: 5000 },
      ],
    });
    expect(r.unpaidAmount).toBe(2001);
  });

  it("ignores a null or unparseable amount rather than producing NaN", () => {
    // One NaN in the sum makes unpaidAmount NaN, which renders as "₹NaN to collect" and —
    // worse — NaN <= 0 is false, so the gate blocks forever with no collectable figure.
    const r = evaluateAncillaryGate({
      policy: prePaid("radiology"),
      service: "radiology",
      isIPD: true,
      charges: [
        { payment_status: "pending_payment", total_amount: null },
        { payment_status: "pending_payment", total_amount: "abc" as unknown as number },
        { payment_status: "pending_payment", total_amount: 500 },
      ],
    });
    expect(r.unpaidAmount).toBe(500);
    expect(Number.isNaN(r.unpaidAmount)).toBe(false);
  });

  it("clears when the outstanding total nets to zero or less", () => {
    const r = evaluateAncillaryGate({
      policy: prePaid("radiology"),
      service: "radiology",
      isIPD: true,
      charges: [{ payment_status: "pending_payment", total_amount: 0 }],
    });
    expect(r).toMatchObject({ cleared: true, reason: "cleared_paid" });
  });

  it("gates each service independently", () => {
    const policy = prePaid("lab");
    const lab = evaluateAncillaryGate({ policy, service: "lab", isIPD: true, charges: [{ total_amount: 100 }] });
    const pharmacy = evaluateAncillaryGate({ policy, service: "pharmacy", isIPD: true, charges: [{ total_amount: 100 }] });
    expect(lab.cleared).toBe(false);
    expect(pharmacy.cleared).toBe(true);
    expect(pharmacy.reason).toBe("policy_post_paid");
  });
});

describe("evaluateAncillaryGate — overrideAvailable", () => {
  it("reports whether the current user could clear a block", () => {
    const blocked = (role: string | null) =>
      evaluateAncillaryGate({
        policy: prePaid("lab"),
        service: "lab",
        isIPD: true,
        role,
        charges: [{ payment_status: "pending_payment", total_amount: 100 }],
      });
    expect(blocked("admin").overrideAvailable).toBe(true);
    expect(blocked("nurse").overrideAvailable).toBe(false);
    expect(blocked(null).overrideAvailable).toBe(false);
  });

  it("is reported on cleared outcomes too, not only on blocks", () => {
    const r = evaluateAncillaryGate({
      policy: parseIpdAncillaryPolicy(null),
      service: "lab",
      isIPD: true,
      role: "admin",
      charges: null,
    });
    expect(r.cleared).toBe(true);
    expect(r.overrideAvailable).toBe(true);
  });
});

describe("parseIpdAncillaryPolicy — a malformed settings row must not block the ward", () => {
  it.each([null, undefined, "garbage", 42, [], true])("falls back to defaults for %s", (value) => {
    expect(parseIpdAncillaryPolicy(value)).toEqual(DEFAULT_IPD_ANCILLARY_POLICY);
  });

  it("falls back per service, keeping the ones it could read", () => {
    const p = parseIpdAncillaryPolicy({ lab: { mode: "pre_paid", receipt: "separate" }, pharmacy: "nonsense" });
    expect(p.lab).toEqual({ mode: "pre_paid", receipt: "separate" });
    expect(p.pharmacy).toEqual({ mode: "post_paid", receipt: "consolidated" });
    expect(p.radiology).toEqual({ mode: "post_paid", receipt: "consolidated" });
  });

  it("treats any unrecognised mode as post_paid — never inventing a gate", () => {
    // "An unreadable policy must not invent a gate that blocks care."
    for (const mode of ["prepaid", "PRE_PAID", "", null, 1]) {
      expect(parseIpdAncillaryPolicy({ lab: { mode } }).lab.mode, String(mode)).toBe("post_paid");
    }
  });

  it("treats any unrecognised receipt shape as consolidated", () => {
    expect(parseIpdAncillaryPolicy({ lab: { mode: "pre_paid", receipt: "Separate" } }).lab.receipt).toBe("consolidated");
  });

  it("reads the snake_case keys the JSONB actually stores", () => {
    const p = parseIpdAncillaryPolicy({
      override: { allow: false, roles: ["cashier"], auto_bypass_urgent: false, urgent_priorities: ["asap"] },
    });
    expect(p.override).toEqual({
      allow: false,
      roles: ["cashier"],
      autoBypassUrgent: false,
      urgentPriorities: ["asap"],
    });
  });

  it("ignores camelCase override keys — they are not what is stored", () => {
    const p = parseIpdAncillaryPolicy({ override: { autoBypassUrgent: false, urgentPriorities: ["asap"] } });
    expect(p.override.autoBypassUrgent).toBe(true);
    expect(p.override.urgentPriorities).toEqual(["stat", "urgent", "emergency"]);
  });

  it("filters non-strings out of roles and priorities", () => {
    const p = parseIpdAncillaryPolicy({ override: { roles: ["admin", 7, null], urgent_priorities: ["stat", {}] } });
    expect(p.override.roles).toEqual(["admin"]);
    expect(p.override.urgentPriorities).toEqual(["stat"]);
  });

  it("restores the default roles when the list is empty — never locking everyone out", () => {
    expect(parseIpdAncillaryPolicy({ override: { roles: [] } }).override.roles).toEqual(["admin", "billing"]);
  });

  it("HONOURS an empty urgent list — a hospital may genuinely want no auto-bypass", () => {
    // The documented asymmetry with roles, and it is deliberate. Asserted because the two
    // look like the same code and are not.
    expect(parseIpdAncillaryPolicy({ override: { urgent_priorities: [] } }).override.urgentPriorities).toEqual([]);
  });

  it("restores default priorities when the list is malformed rather than empty", () => {
    expect(parseIpdAncillaryPolicy({ override: { urgent_priorities: "stat" } }).override.urgentPriorities).toEqual([
      "stat",
      "urgent",
      "emergency",
    ]);
  });

  it("treats a non-boolean allow / auto_bypass_urgent as the default", () => {
    const p = parseIpdAncillaryPolicy({ override: { allow: "yes", auto_bypass_urgent: 0 } });
    expect(p.override.allow).toBe(true);
    expect(p.override.autoBypassUrgent).toBe(true);
  });
});

describe("parseIpdAncillaryPolicy — no aliasing of the module singleton", () => {
  it("returns a freshly constructed policy every time", () => {
    const a = parseIpdAncillaryPolicy(null);
    const b = parseIpdAncillaryPolicy(null);
    expect(a).not.toBe(b);
    expect(a.override).not.toBe(b.override);
    expect(a.override.roles).not.toBe(b.override.roles);
    expect(a.pharmacy).not.toBe(DEFAULT_IPD_ANCILLARY_POLICY.pharmacy);
  });

  it("cannot let one caller's mutation rewrite the defaults for every hospital", () => {
    // The stated reason the function is written the way it is: returning the default object
    // (or a shallow spread) would alias the module-level singleton for the life of the
    // process — one tenant's edit silently becoming every tenant's policy.
    const mine = parseIpdAncillaryPolicy(null);
    mine.override.roles.push("nurse");
    mine.lab.mode = "pre_paid";

    expect(DEFAULT_IPD_ANCILLARY_POLICY.override.roles).toEqual(["admin", "billing"]);
    expect(DEFAULT_IPD_ANCILLARY_POLICY.lab.mode).toBe("post_paid");
    expect(parseIpdAncillaryPolicy(null).override.roles).toEqual(["admin", "billing"]);
    expect(parseIpdAncillaryPolicy(null).lab.mode).toBe("post_paid");
  });

  it("does not alias the urgent priority list either", () => {
    const mine = parseIpdAncillaryPolicy(null);
    mine.override.urgentPriorities.length = 0;
    expect(DEFAULT_IPD_ANCILLARY_POLICY.override.urgentPriorities).toEqual(["stat", "urgent", "emergency"]);
  });
});

describe("serialiseIpdAncillaryPolicy", () => {
  it("writes the snake_case shape the JSONB column stores", () => {
    expect(serialiseIpdAncillaryPolicy(DEFAULT_IPD_ANCILLARY_POLICY)).toEqual({
      pharmacy: { mode: "post_paid", receipt: "consolidated" },
      lab: { mode: "post_paid", receipt: "consolidated" },
      radiology: { mode: "post_paid", receipt: "consolidated" },
      override: {
        allow: true,
        roles: ["admin", "billing"],
        auto_bypass_urgent: true,
        urgent_priorities: ["stat", "urgent", "emergency"],
      },
    });
  });

  it("round-trips through parse without loss", () => {
    // A settings screen saves and immediately re-reads. Any key that does not survive the
    // round trip is a setting that silently reverts on the next page load.
    const custom: IpdAncillaryPolicy = {
      pharmacy: { mode: "pre_paid", receipt: "separate" },
      lab: { mode: "pre_paid", receipt: "consolidated" },
      radiology: { mode: "post_paid", receipt: "separate" },
      override: { allow: false, roles: ["cashier", "admin"], autoBypassUrgent: false, urgentPriorities: ["asap"] },
    };
    expect(parseIpdAncillaryPolicy(serialiseIpdAncillaryPolicy(custom))).toEqual(custom);
  });

  it("round-trips an empty urgent list rather than resurrecting the defaults", () => {
    const noBypass = parseIpdAncillaryPolicy({ override: { urgent_priorities: [] } });
    expect(parseIpdAncillaryPolicy(serialiseIpdAncillaryPolicy(noBypass)).override.urgentPriorities).toEqual([]);
  });
});

// ── The I/O wrappers, kept thin on purpose ────────────────────────────────────

const HOSPITAL_A = "11111111-1111-4111-8111-111111111111";

describe("fetchIpdAncillaryPolicy", () => {
  beforeEach(() => {
    mocks.state.settings = null;
    mocks.state.lines = null;
    mocks.state.lineFilters = [];
  });

  it("returns the defaults when the hospital has no settings row", async () => {
    mocks.state.settings = null;
    await expect(fetchIpdAncillaryPolicy(HOSPITAL_A)).resolves.toEqual(DEFAULT_IPD_ANCILLARY_POLICY);
  });

  it("parses a stored policy", async () => {
    mocks.state.settings = { value: { lab: { mode: "pre_paid", receipt: "separate" } } };
    const p = await fetchIpdAncillaryPolicy(HOSPITAL_A);
    expect(p.lab).toEqual({ mode: "pre_paid", receipt: "separate" });
    expect(p.pharmacy.mode).toBe("post_paid");
  });

  it("scopes the settings read to the hospital and the policy key", async () => {
    await fetchIpdAncillaryPolicy(HOSPITAL_A);
    expect(mocks.state.lineFilters).toEqual([
      ["hospital_id", HOSPITAL_A],
      ["key", IPD_ANCILLARY_POLICY_KEY],
    ]);
  });
});

describe("checkAncillaryClearance", () => {
  beforeEach(() => {
    mocks.state.settings = null;
    mocks.state.lines = null;
    mocks.state.lineFilters = [];
  });

  it("does not touch the database for an OPD order", async () => {
    // The stated short-circuit: post_paid and OPD cannot be blocked, so there is no reason
    // to make the ward wait on a query.
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: null,
      dedupeKeys: ["lab:1"],
      policy: prePaid("lab"),
    });
    expect(r.reason).toBe("not_ipd");
    expect(mocks.state.lineFilters).toEqual([]);
  });

  it("does not touch the database for a post_paid service", async () => {
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:1"],
      policy: parseIpdAncillaryPolicy(null),
    });
    expect(r.reason).toBe("policy_post_paid");
    expect(mocks.state.lineFilters).toEqual([]);
  });

  it("treats a present admissionId as IPD", async () => {
    mocks.state.lines = [];
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:1"],
      policy: prePaid("lab"),
    });
    expect(r.reason).toBe("no_charge_found");
  });

  it("looks charges up by source_dedupe_key, scoped to the hospital", async () => {
    // dedupeKeys are the only reliable link from an order back to its money.
    mocks.state.lines = [];
    await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:order-item-1", "lab:order-item-2"],
      policy: prePaid("lab"),
    });
    expect(mocks.state.lineFilters).toEqual([
      ["hospital_id", HOSPITAL_A],
      ["source_dedupe_key", ["lab:order-item-1", "lab:order-item-2"]],
    ]);
  });

  it("blocks on an outstanding charge", async () => {
    mocks.state.lines = [
      { payment_status: "pending_payment", total_amount: 1200, bills: { balance_due: 1200, paid_amount: 0 } },
    ];
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:1"],
      policy: prePaid("lab"),
    });
    expect(r).toMatchObject({ cleared: false, reason: "blocked_unpaid", unpaidAmount: 1200 });
  });

  it("derives billSettled from the joined bill — a settled bill clears a pending line", async () => {
    mocks.state.lines = [
      { payment_status: "pending_payment", total_amount: 1200, bills: { balance_due: 0, paid_amount: 5000 } },
    ];
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:1"],
      policy: prePaid("lab"),
    });
    expect(r).toMatchObject({ cleared: true, reason: "cleared_paid" });
  });

  it("does not treat a zero-balance bill with nothing paid as settled", async () => {
    // Both conditions are required: balance_due <= 0 AND paid_amount > 0. A draft bill with
    // no lines yet has balance 0 and would otherwise clear every gate.
    mocks.state.lines = [
      { payment_status: "pending_payment", total_amount: 1200, bills: { balance_due: 0, paid_amount: 0 } },
    ];
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:1"],
      policy: prePaid("lab"),
    });
    expect(r.cleared).toBe(false);
  });

  it("clears rather than blocks when the order has no dedupe keys", async () => {
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: [],
      policy: prePaid("lab"),
    });
    expect(r).toMatchObject({ cleared: true, reason: "no_charge_found" });
    expect(mocks.state.lineFilters).toEqual([]);
  });

  it("fetches the policy itself when the caller does not supply one", async () => {
    mocks.state.settings = { value: { lab: { mode: "pre_paid" } } };
    mocks.state.lines = [
      { payment_status: "pending_payment", total_amount: 300, bills: { balance_due: 300, paid_amount: 0 } },
    ];
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:1"],
    });
    expect(r).toMatchObject({ cleared: false, reason: "blocked_unpaid", unpaidAmount: 300 });
  });

  it("lets an urgent order through without querying for charges", async () => {
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:1"],
      priority: "stat",
      policy: prePaid("lab"),
    });
    expect(r.reason).toBe("urgent_bypass");
  });

  it("treats a null charge result as no charge found, not as unpaid", async () => {
    mocks.state.lines = null;
    const r = await checkAncillaryClearance(HOSPITAL_A, {
      service: "lab",
      admissionId: "adm-1",
      dedupeKeys: ["lab:1"],
      policy: prePaid("lab"),
    });
    expect(r).toMatchObject({ cleared: true, reason: "no_charge_found" });
  });
});
