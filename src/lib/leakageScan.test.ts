/**
 * Phase 2 — extraction 2 (PHASED_TEST_PLAN.md §8, Phase 2).
 *
 * The plan names the boundary cases explicitly: 11h59m vs 12h01m for lab/radiology/pharmacy,
 * 23h59m vs 24h01m for OT. Those had never been assertable because the cutoffs were computed
 * inline from `Date.now()` inside a Deno function no vitest run can import.
 *
 * WHY THIS FILE LIVES HERE AND NOT NEXT TO ITS SOURCE. The module under test is
 * `supabase/functions/_shared/leakageScan.ts`, not anything in `src/lib/`. Normal
 * co-location would put this file there too — but `vitest.config.ts` test.include is
 * "src/star-star/star.{test,spec}.{ts,tsx}" (glob, written out here to avoid closing this
 * comment), so a test outside `src/` is never collected. It does
 * not error or warn; it just silently stops running. Do not "fix" this by moving the file
 * to sit next to `leakageScan.ts` — that would remove it from the suite. `coverage.include`
 * already names the source file explicitly so its coverage is still a real gate.
 */
import { describe, it, expect } from "vitest";
import {
  ANCILLARY_GRACE_HOURS,
  LAB_FALLBACK_RATE,
  OT_BILLING_SOURCE_MODULE,
  OT_FALLBACK_RATE,
  OT_GRACE_HOURS,
  RAD_FALLBACK_RATE,
  billedOtAdmissions,
  buildLeakageReport,
  isPastGraceWindow,
  leakageCutoffs,
  leakageSeverity,
  modulesWithLeaks,
} from "../../supabase/functions/_shared/leakageScan";

/** Fixed instant so every boundary assertion is deterministic. */
const NOW = Date.parse("2026-09-11T12:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60 * 1000).toISOString();
const minutesAgo = (m: number) => new Date(NOW - m * 60 * 1000).toISOString();

describe("grace windows", () => {
  it("gives ancillary services 12 hours and OT 24", () => {
    // OT gets longer because its billing waits on the surgeon's notes and the implant list.
    expect(ANCILLARY_GRACE_HOURS).toBe(12);
    expect(OT_GRACE_HOURS).toBe(24);
  });

  it("computes cutoffs from the supplied instant, not the wall clock", () => {
    const c = leakageCutoffs(NOW);
    expect(c.ancillary).toBe(hoursAgo(12));
    expect(c.ot).toBe(hoursAgo(24));
  });

  it("accepts a Date as well as a timestamp", () => {
    expect(leakageCutoffs(new Date(NOW))).toEqual(leakageCutoffs(NOW));
  });
});

describe("isPastGraceWindow — the boundaries the plan names", () => {
  const { ancillary, ot } = leakageCutoffs(NOW);

  it("does not flag an ancillary order at 11h59m", () => {
    // Inside the window. Flagging here means billing is chased before it has had its agreed
    // time, and the report becomes noise the CFO learns to ignore.
    expect(isPastGraceWindow(minutesAgo(11 * 60 + 59), ancillary)).toBe(false);
  });

  it("flags an ancillary order at 12h01m", () => {
    expect(isPastGraceWindow(minutesAgo(12 * 60 + 1), ancillary)).toBe(true);
  });

  it("does not flag an ancillary order at exactly 12h00m", () => {
    // The queries use `.lt(cutoff)`, so exactly-at-the-boundary is still inside the window.
    // Asserted so the client-side and query-side answers cannot drift apart.
    expect(isPastGraceWindow(hoursAgo(12), ancillary)).toBe(false);
  });

  it("does not flag an OT case at 23h59m", () => {
    expect(isPastGraceWindow(minutesAgo(23 * 60 + 59), ot)).toBe(false);
  });

  it("flags an OT case at 24h01m", () => {
    expect(isPastGraceWindow(minutesAgo(24 * 60 + 1), ot)).toBe(true);
  });

  it("does not flag an OT case at exactly 24h00m", () => {
    expect(isPastGraceWindow(hoursAgo(24), ot)).toBe(false);
  });

  it("applies the ancillary window to an OT case only if asked with the ancillary cutoff", () => {
    // An OT case 13 hours old is past the ancillary window but inside its own. Passing the
    // wrong cutoff would halve OT's grace period silently.
    const thirteen = hoursAgo(13);
    expect(isPastGraceWindow(thirteen, ancillary)).toBe(true);
    expect(isPastGraceWindow(thirteen, ot)).toBe(false);
  });

  it("treats a missing or unparseable timestamp as inside the window", () => {
    // Failing to "not leakage" is the quiet direction, and deliberately so: a row with no
    // created_at is a data defect, and reporting it as revenue at risk would put a fabricated
    // rupee figure in front of a CFO.
    for (const bad of [null, undefined, "", "not-a-date"]) {
      expect(isPastGraceWindow(bad, ancillary), String(bad)).toBe(false);
    }
  });
});

// ── Report construction ──────────────────────────────────────────────────────

describe("buildLeakageReport", () => {
  it("returns an empty report for a hospital with nothing outstanding", () => {
    expect(buildLeakageReport({})).toEqual({
      items: [],
      lab_count: 0,
      radiology_count: 0,
      pharmacy_count: 0,
      ot_count: 0,
      total_items: 0,
      estimated_amount: 0,
    });
  });

  it("counts each category separately and totals the estimate", () => {
    const report = buildLeakageReport({
      labOrders: [{ id: "lo-1" }, { id: "lo-2" }],
      radiologyOrders: [{ id: "ro-1", study_name: "Chest X-Ray" }],
      otCases: [{ id: "ot-1", surgery_name: "Appendicectomy", admission_id: "adm-1" }],
    });

    expect(report.lab_count).toBe(2);
    expect(report.radiology_count).toBe(1);
    expect(report.ot_count).toBe(1);
    expect(report.total_items).toBe(4);
    expect(report.estimated_amount).toBe(2 * LAB_FALLBACK_RATE + RAD_FALLBACK_RATE + OT_FALLBACK_RATE);
  });

  it("prices pharmacy from the dispense line, not a fallback", () => {
    // Pharmacy is the one category with a real price on the row, so its estimate should be
    // the actual value at risk rather than a guess.
    const report = buildLeakageReport({
      pharmacyDispenses: [
        {
          id: "pd-1",
          pharmacy_dispensing_items: [
            { drug_name: "Paracetamol", unit_price: 12.5, quantity_dispensed: 4 },
            { drug_name: "Amoxicillin", unit_price: 30, quantity_dispensed: 2 },
          ],
        },
      ],
    });

    expect(report.pharmacy_count).toBe(2);
    expect(report.estimated_amount).toBe(12.5 * 4 + 30 * 2);
  });

  it("defaults a missing dispense quantity to 1, not 0", () => {
    // Estimating a quantity-less dispense at ₹0 would hide it from the report meant to
    // surface it — the item would be counted but contribute nothing to the rupee figure.
    const report = buildLeakageReport({
      pharmacyDispenses: [
        { id: "pd-1", pharmacy_dispensing_items: [{ drug_name: "X", unit_price: 40, quantity_dispensed: null }] },
      ],
    });
    expect(report.estimated_amount).toBe(40);
  });

  it("treats a missing unit price as 0 without producing NaN", () => {
    // One NaN turns the whole estimate into "₹NaN at risk" on a CFO's WhatsApp.
    const report = buildLeakageReport({
      pharmacyDispenses: [
        { id: "pd-1", pharmacy_dispensing_items: [{ drug_name: "X", unit_price: "abc", quantity_dispensed: 3 }] },
      ],
      labOrders: [{ id: "lo-1" }],
    });
    expect(Number.isNaN(report.estimated_amount)).toBe(false);
    expect(report.estimated_amount).toBe(LAB_FALLBACK_RATE);
  });

  it("names a radiology study, falling back rather than rendering undefined", () => {
    const report = buildLeakageReport({ radiologyOrders: [{ id: "ro-1", study_name: null }] });
    expect(report.items[0].description).toBe("Radiology: Study");
  });

  it("names an OT case, falling back rather than rendering undefined", () => {
    const report = buildLeakageReport({ otCases: [{ id: "ot-1", surgery_name: null, admission_id: "a" }] });
    expect(report.items[0].description).toBe("OT: Surgery");
  });

  it("honours a hospital's configured OT rate over the fallback", () => {
    const report = buildLeakageReport({
      otCases: [{ id: "ot-1", surgery_name: "S", admission_id: "a" }],
      otRate: 42000,
    });
    expect(report.estimated_amount).toBe(42000);
  });

  it("skips rows with no id rather than emitting an unactionable item", () => {
    // An item with no entity_id cannot be opened from the report, so it is noise on a CFO's
    // alert — a number they cannot act on.
    const report = buildLeakageReport({
      labOrders: [{ id: "" }, { id: "lo-1" }],
      radiologyOrders: [{ id: "", study_name: "Orphan scan" }],
      pharmacyDispenses: [
        { id: "", pharmacy_dispensing_items: [{ drug_name: "X", unit_price: 10, quantity_dispensed: 1 }] },
      ],
      otCases: [{ id: "", admission_id: "a" }],
    });
    expect(report.total_items).toBe(1);
    expect(report.radiology_count).toBe(0);
    expect(report.pharmacy_count).toBe(0);
  });

  it("tolerates a dispense header with no item rows", () => {
    const report = buildLeakageReport({ pharmacyDispenses: [{ id: "pd-1", pharmacy_dispensing_items: null }] });
    expect(report.pharmacy_count).toBe(0);
    expect(report.total_items).toBe(0);
  });

  it("names a drug, falling back rather than rendering undefined", () => {
    const report = buildLeakageReport({
      pharmacyDispenses: [
        { id: "pd-1", pharmacy_dispensing_items: [{ drug_name: null, unit_price: 10, quantity_dispensed: 1 }] },
      ],
    });
    expect(report.items[0].description).toBe("Pharmacy IP: Drug");
  });

  it("tolerates null collections", () => {
    const report = buildLeakageReport({
      labOrders: null,
      radiologyOrders: null,
      pharmacyDispenses: null,
      otCases: null,
      billedOtAdmissionIds: null,
    });
    expect(report.total_items).toBe(0);
  });
});

describe("OT cases already billed", () => {
  it("excludes an OT case whose admission already carries OT billing", () => {
    const report = buildLeakageReport({
      otCases: [
        { id: "ot-1", surgery_name: "Billed", admission_id: "adm-1" },
        { id: "ot-2", surgery_name: "Not billed", admission_id: "adm-2" },
      ],
      billedOtAdmissionIds: ["adm-1"],
    });

    expect(report.ot_count).toBe(1);
    expect(report.items[0].description).toBe("OT: Not billed");
  });

  it("still reports an OT case with no admission id", () => {
    // Nothing to match against, so it cannot be proven billed. Reporting it is the
    // revenue-safe direction — a human checks, rather than the case silently vanishing.
    const report = buildLeakageReport({
      otCases: [{ id: "ot-1", surgery_name: "Orphan", admission_id: null }],
      billedOtAdmissionIds: ["adm-1"],
    });
    expect(report.ot_count).toBe(1);
  });
});

describe("billedOtAdmissions", () => {
  const billToAdmission = new Map([
    ["bill-1", "adm-1"],
    ["bill-2", "adm-2"],
  ]);

  it("maps OT bill lines back to their admissions", () => {
    const billed = billedOtAdmissions([{ bill_id: "bill-1", source_module: "ot" }], billToAdmission);
    expect([...billed]).toEqual(["adm-1"]);
  });

  it("uses source_module 'ot' — the value the real OT billing path writes", () => {
    // THE DEFECT THIS GUARDS. The scan filtered `source_module = 'surgery'`, which
    // serviceBilling.chargeOTCase has never written, so nothing ever matched and EVERY
    // completed OT case was reported as leakage regardless of its billing status. A scanner
    // that cries wolf on every case is a scanner nobody reads.
    expect(OT_BILLING_SOURCE_MODULE).toBe("ot");
    const stale = billedOtAdmissions([{ bill_id: "bill-1", source_module: "surgery" }], billToAdmission);
    expect(stale.size).toBe(0);
  });

  it("accepts a line with no source_module, trusting the query's own filter", () => {
    const billed = billedOtAdmissions([{ bill_id: "bill-2" }], billToAdmission);
    expect([...billed]).toEqual(["adm-2"]);
  });

  it("ignores a line whose bill is not in the admission lookup", () => {
    expect(billedOtAdmissions([{ bill_id: "bill-unknown", source_module: "ot" }], billToAdmission).size).toBe(0);
  });

  it("ignores a line with no bill id", () => {
    expect(billedOtAdmissions([{ bill_id: null, source_module: "ot" }], billToAdmission).size).toBe(0);
  });

  it("accepts a plain object lookup as well as a Map", () => {
    const billed = billedOtAdmissions([{ bill_id: "bill-1", source_module: "ot" }], { "bill-1": "adm-1" });
    expect([...billed]).toEqual(["adm-1"]);
  });

  it("de-duplicates several OT lines on one bill", () => {
    // An OT case bills a theatre charge, a surgeon fee and an anaesthesia fee — three lines,
    // one admission.
    const billed = billedOtAdmissions(
      [
        { bill_id: "bill-1", source_module: "ot" },
        { bill_id: "bill-1", source_module: "ot" },
        { bill_id: "bill-1", source_module: "ot" },
      ],
      billToAdmission,
    );
    expect(billed.size).toBe(1);
  });

  it("handles a null line list", () => {
    expect(billedOtAdmissions(null, billToAdmission).size).toBe(0);
  });

  it("handles a null lookup without throwing", () => {
    // The caller builds this map from a query that can come back empty.
    expect(
      billedOtAdmissions([{ bill_id: "bill-1", source_module: "ot" }], null as unknown as Record<string, string>).size,
    ).toBe(0);
  });
});

describe("modulesWithLeaks", () => {
  it("counts only categories that actually have items", () => {
    const report = buildLeakageReport({
      labOrders: [{ id: "lo-1" }],
      otCases: [{ id: "ot-1", admission_id: "a" }],
    });
    expect(modulesWithLeaks(report)).toBe(2);
  });

  it("is 0 for a clean scan — distinguishable from a scan that never ran", () => {
    // The edge function returned `undefined` here, so the UI toasted "Found 0 unbilled items
    // across 0 modules" on every successful scan — a real result and a broken one looked
    // identical. A number, even zero, is the fix.
    expect(modulesWithLeaks(buildLeakageReport({}))).toBe(0);
  });

  it("caps at 4", () => {
    const report = buildLeakageReport({
      labOrders: [{ id: "l" }],
      radiologyOrders: [{ id: "r" }],
      pharmacyDispenses: [{ id: "p", pharmacy_dispensing_items: [{ drug_name: "d", unit_price: 1, quantity_dispensed: 1 }] }],
      otCases: [{ id: "o", admission_id: "a" }],
    });
    expect(modulesWithLeaks(report)).toBe(4);
  });
});

describe("leakageSeverity", () => {
  it.each([
    [0, "high"],
    [49999, "high"],
    [50000, "critical"],
    [50001, "critical"],
  ])("₹%i → %s", (amount, expected) => {
    // ₹50,000 exactly is critical — the branch is `>=`. This drives the severity on a
    // clinical_alerts row, so the boundary is worth pinning.
    expect(leakageSeverity(amount)).toBe(expected);
  });
});
