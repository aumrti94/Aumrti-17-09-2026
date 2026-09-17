/**
 * Phase 1 (PHASED_TEST_PLAN.md §8) — "the esi/cghs drift already bit once".
 *
 * This file exists because the pre-auth prompt and the nursing-charge rule had drifted apart
 * on which payer spellings they recognised. The tests that matter here are therefore about
 * the LISTS agreeing with each other, not about `Set.has` working.
 */
import { describe, it, expect } from "vitest";
import {
  INSURANCE_PAYER_TYPES,
  BUNDLED_NURSING_PAYER_TYPES,
  REFERRAL_REQUIRED_CATEGORIES,
  bundlesNursingIntoRoom,
  requiresSchemeReferral,
} from "@/lib/payerTypes";

describe("INSURANCE_PAYER_TYPES", () => {
  it("lists exactly the payers whose claims need a pre-authorisation", () => {
    expect(INSURANCE_PAYER_TYPES).toEqual([
      "tpa",
      "pmjay",
      "cghs",
      "esi",
      "state_scheme",
      "corporate",
    ]);
  });

  it("does not treat cash or self-pay as insurance", () => {
    for (const cash of ["cash", "self", "self_pay", ""]) {
      expect(INSURANCE_PAYER_TYPES, cash).not.toContain(cash);
    }
  });

  it("holds only lowercase snake_case values", () => {
    // These are compared against `admissions.payer_type` directly, with no normalisation on
    // the read side. A capitalised entry here silently never matches.
    for (const p of INSURANCE_PAYER_TYPES) expect(p, p).toBe(p.toLowerCase().trim());
  });
});

describe("the two lists must not drift apart again", () => {
  it("bundles nursing for every payer that needs a pre-authorisation", () => {
    // The drift this file was created to end. Any scheme payer added to the pre-auth list
    // but not to the nursing-bundling set gets a separately-billed nursing line that the TPA
    // deducts — a guaranteed write-off or patient dispute on every such admission.
    for (const payer of INSURANCE_PAYER_TYPES) {
      expect(bundlesNursingIntoRoom(payer), `${payer} must bundle nursing`).toBe(true);
    }
  });

  it("carries both spellings of the schemes whose data is mixed", () => {
    // The pre-auth check wrote "esi"; BillEditor's finalize check reads patient_category
    // values "cghs"/"echs". Both vocabularies exist in live rows, so both must resolve.
    expect(bundlesNursingIntoRoom("esi")).toBe(true);
    expect(bundlesNursingIntoRoom("esic")).toBe(true);
    expect(bundlesNursingIntoRoom("cghs")).toBe(true);
    expect(bundlesNursingIntoRoom("echs")).toBe(true);
  });

  it("bundles for the generic 'insurance' value as well as named schemes", () => {
    expect(bundlesNursingIntoRoom("insurance")).toBe(true);
  });

  it("holds only lowercase values in the bundling set", () => {
    for (const p of BUNDLED_NURSING_PAYER_TYPES) expect(p, p).toBe(p.toLowerCase().trim());
  });
});

describe("bundlesNursingIntoRoom", () => {
  it.each(["tpa", "insurance", "pmjay", "cghs", "echs", "esi", "esic", "state_scheme", "corporate"])(
    "bundles nursing into room rent for %s",
    (payer) => {
      expect(bundlesNursingIntoRoom(payer)).toBe(true);
    },
  );

  it.each(["cash", "self", "self_pay", "credit", "employee", "camp"])(
    "bills nursing separately for %s",
    (payer) => {
      // Special/private-duty nursing is a genuine cash item for these payers and must NOT be
      // suppressed — suppressing it here is lost revenue on every cash admission.
      expect(bundlesNursingIntoRoom(payer)).toBe(false);
    },
  );

  it("treats a missing payer as cash — bill nursing, do not suppress it", () => {
    // Failing to `false` is the revenue-safe direction: worst case a TPA deducts one line.
    // Failing to `true` would silently suppress nursing charges on every unclassified
    // admission, which is unrecoverable revenue nobody would notice.
    expect(bundlesNursingIntoRoom(null)).toBe(false);
    expect(bundlesNursingIntoRoom(undefined)).toBe(false);
    expect(bundlesNursingIntoRoom("")).toBe(false);
  });

  it("normalises case and surrounding whitespace before matching", () => {
    expect(bundlesNursingIntoRoom("CGHS")).toBe(true);
    expect(bundlesNursingIntoRoom("  Tpa  ")).toBe(true);
    expect(bundlesNursingIntoRoom("\tPMJAY\n")).toBe(true);
  });

  it("does not match on a substring", () => {
    // "tpa_pending" is not "tpa". Substring matching here would suppress nursing charges for
    // payer values nobody intended to cover.
    expect(bundlesNursingIntoRoom("tpa_pending")).toBe(false);
    expect(bundlesNursingIntoRoom("non_cghs")).toBe(false);
  });
});

describe("requiresSchemeReferral", () => {
  it("covers exactly CGHS and ECHS", () => {
    expect([...REFERRAL_REQUIRED_CATEGORIES].sort()).toEqual(["cghs", "echs"]);
  });

  it.each(["cghs", "echs"])("requires a referral for %s", (category) => {
    expect(requiresSchemeReferral(category)).toBe(true);
  });

  it("normalises case — the gap this replaced", () => {
    // BillEditor compared `patient_category === "cghs"` raw, so a stored "CGHS" skipped the
    // referral block entirely and the bill finalised into a claim the scheme would reject —
    // after the patient had gone home.
    expect(requiresSchemeReferral("CGHS")).toBe(true);
    expect(requiresSchemeReferral("Echs")).toBe(true);
    expect(requiresSchemeReferral("  cghs  ")).toBe(true);
  });

  it.each(["general", "tpa", "pmjay", "esi", "cash", "", null, undefined])(
    "does not require a referral for %s",
    (category) => {
      // PMJAY and ESI have their own eligibility paths; blocking finalisation on a CGHS
      // referral they will never have would stop those bills from ever being raised.
      expect(requiresSchemeReferral(category as string | null | undefined)).toBe(false);
    },
  );

  it("does not substring-match", () => {
    expect(requiresSchemeReferral("non_cghs")).toBe(false);
    expect(requiresSchemeReferral("cghs_pending")).toBe(false);
  });
});
