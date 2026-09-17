/**
 * Phase 1 remediation (PHASED_TEST_PLAN.md §8, Phase 1 "fixes expected in-phase") —
 * the `visit_type` vocabulary drift.
 *
 * The valuable assertions here are the ones that pin the DISTINCTION between the three
 * vocabularies, not the ones that prove a Set lookup works. Collapsing them is the
 * tempting "fix" and it would misprice consultations, so each vocabulary is asserted
 * against its own CHECK constraint and the mappings are asserted to be lossy in the
 * direction they are meant to be.
 */
import { describe, it, expect } from "vitest";
import {
  APPOINTMENT_VISIT_TYPES,
  CHARGED_TIERS,
  VISIT_PURPOSES,
  VISIT_TYPES,
  chargedTierToVisitType,
  isFollowUpVisit,
  isReturningVisit,
  toChargedTier,
  toVisitPurpose,
  toVisitType,
  visitPurposeToVisitType,
  visitTypeToAppointmentVisitType,
} from "@/lib/visitTypes";

describe("the vocabularies match their CHECK constraints", () => {
  it("opd_tokens.visit_type (20260904000025)", () => {
    expect([...VISIT_TYPES]).toEqual(["new", "revisit", "followup", "emergency"]);
  });

  it("visit_purpose (20260908000006)", () => {
    expect([...VISIT_PURPOSES]).toEqual(["new", "revisit", "follow_up", "emergency", "procedure", "review"]);
  });

  it("opd_tokens.charged_tier (20261015000002)", () => {
    expect([...CHARGED_TIERS]).toEqual(["new", "follow_up", "emergency"]);
  });

  it("appointments.visit_type", () => {
    expect([...APPOINTMENT_VISIT_TYPES]).toEqual(["new", "follow_up"]);
  });

  it("keeps visit_type and charged_tier as DIFFERENT vocabularies", () => {
    // THE ASSERTION THAT MATTERS. 20261015000002 says conflating them "would let a visit
    // marked 'followup' but billed at full fee still burn the allowance". `followup` is a
    // valid visit_type and NOT a valid charged_tier; `follow_up` is the reverse. If someone
    // ever unifies these, this fails before the mispricing reaches a patient.
    expect(VISIT_TYPES).toContain("followup");
    expect(CHARGED_TIERS).not.toContain("followup");
    expect(CHARGED_TIERS).toContain("follow_up");
    expect(VISIT_TYPES).not.toContain("follow_up");
  });
});

describe("isReturningVisit", () => {
  it.each(["revisit", "followup", "follow_up", "review"])("treats %s as a returning visit", (v) => {
    expect(isReturningVisit(v)).toBe(true);
  });

  it.each(["new", "emergency", "procedure"])("treats %s as not returning", (v) => {
    expect(isReturningVisit(v)).toBe(false);
  });

  it("spans all three vocabularies so a caller need not know the column", () => {
    // The drift came from call sites comparing against whichever spelling their column
    // used. One predicate that accepts all of them is the fix.
    expect(isReturningVisit("followup")).toBe(isReturningVisit("follow_up"));
  });

  it("normalises case and whitespace", () => {
    expect(isReturningVisit("  Follow_Up ")).toBe(true);
    expect(isReturningVisit("REVISIT")).toBe(true);
  });

  it("treats a missing value as a new visit", () => {
    // The revenue-safe direction: a new visit bills the full fee. Defaulting to "returning"
    // would hand an unclassified visit the cheaper rate and spend a follow-up allowance.
    expect(isReturningVisit(null)).toBe(false);
    expect(isReturningVisit(undefined)).toBe(false);
    expect(isReturningVisit("")).toBe(false);
  });

  it("does not substring-match", () => {
    expect(isReturningVisit("not_a_revisit")).toBe(false);
  });
});

describe("isFollowUpVisit is deliberately narrower than isReturningVisit", () => {
  it("excludes revisit", () => {
    // A revisit is the same problem seen again and may attract a revisit DISCOUNT; a
    // follow-up is the doctor's own scheduled review and is what the follow-up FEE and its
    // visit cap are for. Collapsing them spends the follow-up allowance on visits that were
    // never meant to have it — which is the exact cap the hospital asked for.
    expect(isReturningVisit("revisit")).toBe(true);
    expect(isFollowUpVisit("revisit")).toBe(false);
  });

  it.each(["followup", "follow_up", "review"])("includes %s", (v) => {
    expect(isFollowUpVisit(v)).toBe(true);
  });

  it.each(["new", "emergency", "procedure", "", null])("excludes %s", (v) => {
    expect(isFollowUpVisit(v as string | null)).toBe(false);
  });
});

describe("chargedTierToVisitType", () => {
  it("maps the billed tier back to UI-intent vocabulary", () => {
    // This was an inline ternary in ConsultationWorkspace, which is how 'follow_up' came to
    // be compared against a column whose CHECK only allows 'followup'.
    expect(chargedTierToVisitType("follow_up")).toBe("followup");
    expect(chargedTierToVisitType("emergency")).toBe("emergency");
    expect(chargedTierToVisitType("new")).toBe("new");
  });

  it("returns a value the visit_type CHECK accepts, for every charged_tier", () => {
    for (const tier of CHARGED_TIERS) {
      expect(VISIT_TYPES, tier).toContain(chargedTierToVisitType(tier));
    }
  });

  it("defaults an unknown or missing tier to 'new' — the full-fee side", () => {
    expect(chargedTierToVisitType(null)).toBe("new");
    expect(chargedTierToVisitType("")).toBe("new");
    expect(chargedTierToVisitType("followup")).toBe("new"); // not a charged_tier value
  });
});

describe("visitTypeToAppointmentVisitType", () => {
  it("narrows the four-value vocabulary to the two the column allows", () => {
    expect(visitTypeToAppointmentVisitType("revisit")).toBe("follow_up");
    expect(visitTypeToAppointmentVisitType("followup")).toBe("follow_up");
    expect(visitTypeToAppointmentVisitType("new")).toBe("new");
    expect(visitTypeToAppointmentVisitType("emergency")).toBe("new");
  });

  it("only ever emits a value the appointments CHECK accepts", () => {
    for (const vt of VISIT_TYPES) {
      expect(APPOINTMENT_VISIT_TYPES, vt).toContain(visitTypeToAppointmentVisitType(vt));
    }
  });
});

describe("visitPurposeToVisitType", () => {
  it.each([
    ["new", "new"],
    ["revisit", "revisit"],
    ["follow_up", "followup"],
    ["review", "followup"],
    ["emergency", "emergency"],
    ["procedure", "new"],
  ])("maps purpose %s to visit type %s", (purpose, expected) => {
    expect(visitPurposeToVisitType(purpose)).toBe(expected);
  });

  it("only ever emits a value the visit_type CHECK accepts", () => {
    for (const p of VISIT_PURPOSES) {
      expect(VISIT_TYPES, p).toContain(visitPurposeToVisitType(p));
    }
  });

  it("keeps revisit distinct from follow-up through the mapping", () => {
    expect(visitPurposeToVisitType("revisit")).not.toBe(visitPurposeToVisitType("follow_up"));
  });

  it("defaults a missing purpose to 'new'", () => {
    expect(visitPurposeToVisitType(null)).toBe("new");
    expect(visitPurposeToVisitType(undefined)).toBe("new");
    expect(visitPurposeToVisitType("")).toBe("new");
  });
});

describe("coercion of untrusted database values", () => {
  it("passes valid values through", () => {
    expect(toVisitType("followup")).toBe("followup");
    expect(toVisitPurpose("review")).toBe("review");
    expect(toChargedTier("follow_up")).toBe("follow_up");
  });

  it("defaults anything invalid to 'new'", () => {
    for (const bad of ["", "nonsense", null, undefined, 7, {}]) {
      expect(toVisitType(bad), String(bad)).toBe("new");
      expect(toVisitPurpose(bad), String(bad)).toBe("new");
      expect(toChargedTier(bad), String(bad)).toBe("new");
    }
  });

  it("rejects a value valid in a DIFFERENT vocabulary", () => {
    // 'follow_up' is a legitimate charged_tier and an illegitimate visit_type. Silently
    // accepting it is how a CHECK-constraint violation reaches a write.
    expect(toVisitType("follow_up")).toBe("new");
    expect(toChargedTier("followup")).toBe("new");
    expect(toChargedTier("revisit")).toBe("new");
  });

  it("only ever emits values its own CHECK accepts", () => {
    const junk = ["", "x", "follow_up", "followup", "revisit", "review", "procedure", "emergency"];
    for (const v of junk) {
      expect(VISIT_TYPES, v).toContain(toVisitType(v));
      expect(VISIT_PURPOSES, v).toContain(toVisitPurpose(v));
      expect(CHARGED_TIERS, v).toContain(toChargedTier(v));
    }
  });
});
