// Catalogue integrity — the regression that stops the three-catalogue drift from
// coming back.
//
// Each assertion below corresponds to a defect that was live in the seeded
// catalogue. If someone hand-edits the generated SQL or the QA fixture, or adds a
// test with a lowercase category, this suite is what catches it before a hospital
// does.
import { describe, it, expect } from "vitest";
import {
  LAB_TEST_CATALOG,
  LAB_TEST_GROUP_CATALOG,
  LAB_TEST_CATEGORIES,
  LAB_SAMPLE_TYPES,
  LAB_TEST_RETIRED,
} from "./labTestCatalog";

const names = LAB_TEST_CATALOG.map(t => t.name);
const codes = LAB_TEST_CATALOG.map(t => t.code);

describe("catalogue vocabulary", () => {
  it("uses only categories that exist in the lab_test_categories config list", () => {
    // The original defect: seeded rows carried 'hematology', 'urine' and
    // 'cardiology', none of which the dropdown offered. The category filter does an
    // exact match, so filtering returned zero of the 45 seeded tests, and the
    // dual-validation gate — which compares test_category exactly — never fired.
    const bad = LAB_TEST_CATALOG
      .filter(t => !(LAB_TEST_CATEGORIES as readonly string[]).includes(t.category))
      .map(t => `${t.name} -> ${t.category}`);
    expect(bad).toEqual([]);
  });

  it("uses only sample types that exist in the sample_types config list", () => {
    const bad = LAB_TEST_CATALOG
      .filter(t => !(LAB_SAMPLE_TYPES as readonly string[]).includes(t.sampleType))
      .map(t => `${t.name} -> ${t.sampleType}`);
    expect(bad).toEqual([]);
  });

  it("has no lowercase-only category or sample type", () => {
    const lower = LAB_TEST_CATALOG
      .filter(t => t.category === t.category.toLowerCase() || t.sampleType === t.sampleType.toLowerCase())
      .map(t => t.name);
    expect(lower).toEqual([]);
  });

  it("uses Indian English spelling for the haematology discipline", () => {
    expect(LAB_TEST_CATEGORIES).toContain("Haematology");
    expect(LAB_TEST_CATEGORIES as readonly string[]).not.toContain("Hematology");
  });
});

describe("catalogue uniqueness", () => {
  it("has no duplicate test names", () => {
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it("has no duplicate test codes", () => {
    // lab_test_master is unique on (hospital_id, test_name) only, so a duplicate
    // code inserts silently and then makes analyzer mapping ambiguous.
    const dupes = codes.filter((c, i) => codes.indexOf(c) !== i);
    expect(dupes).toEqual([]);
  });
});

describe("orderability prerequisites (TC-P5L-001)", () => {
  it("gives every test a non-zero fee", () => {
    // A test at zero produces an order that bills nothing — revenue that leaks with
    // no error anywhere. The old seed had fee 0 on all 45 rows.
    expect(LAB_TEST_CATALOG.filter(t => !t.fee).map(t => t.name)).toEqual([]);
  });

  it("gives every test a sample type and a turnaround", () => {
    expect(LAB_TEST_CATALOG.filter(t => !t.sampleType || !t.tatMinutes).map(t => t.name)).toEqual([]);
  });

  it("gives every test a name and a code", () => {
    expect(LAB_TEST_CATALOG.filter(t => !t.name?.trim() || !t.code?.trim()).map(t => t.code)).toEqual([]);
  });
});

describe("range coherence", () => {
  it("never sets a critical bound on a test with no reference interval", () => {
    // A qualitative test cannot have a panic value — there is no number to compare.
    const bad = LAB_TEST_CATALOG
      .filter(t => t.normalMin == null && t.normalMax == null && (t.criticalLow != null || t.criticalHigh != null))
      .map(t => t.name);
    expect(bad).toEqual([]);
  });

  it("keeps normalMin below normalMax", () => {
    const bad = LAB_TEST_CATALOG
      .filter(t => t.normalMin != null && t.normalMax != null && t.normalMin >= t.normalMax)
      .map(t => t.name);
    expect(bad).toEqual([]);
  });

  it("keeps criticalLow below criticalHigh", () => {
    const bad = LAB_TEST_CATALOG
      .filter(t => t.criticalLow != null && t.criticalHigh != null && t.criticalLow >= t.criticalHigh)
      .map(t => t.name);
    expect(bad).toEqual([]);
  });

  it("keeps the critical low at or below the reference floor", () => {
    // A panic low ABOVE the normal floor would flag healthy results as critical.
    const bad = LAB_TEST_CATALOG
      .filter(t => t.criticalLow != null && t.normalMin != null && t.criticalLow > t.normalMin)
      .map(t => `${t.name}: crit ${t.criticalLow} > normal ${t.normalMin}`);
    expect(bad).toEqual([]);
  });

  it("keeps the critical high at or above the reference ceiling", () => {
    const bad = LAB_TEST_CATALOG
      .filter(t => t.criticalHigh != null && t.normalMax != null && t.criticalHigh < t.normalMax)
      .map(t => `${t.name}: crit ${t.criticalHigh} < normal ${t.normalMax}`);
    expect(bad).toEqual([]);
  });

  it("keeps each sex-specific interval internally ordered", () => {
    const bad = LAB_TEST_CATALOG.filter(t =>
      (t.maleNormalMin != null && t.maleNormalMax != null && t.maleNormalMin >= t.maleNormalMax) ||
      (t.femaleNormalMin != null && t.femaleNormalMax != null && t.femaleNormalMin >= t.femaleNormalMax),
    ).map(t => t.name);
    expect(bad).toEqual([]);
  });

  it("gives a sex-specific test both a male and a female interval", () => {
    // Half-populating this is worse than not populating it: one sex silently falls
    // back to the merged band while the other does not.
    const bad = LAB_TEST_CATALOG.filter(t => {
      const hasMale = t.maleNormalMin != null || t.maleNormalMax != null;
      const hasFemale = t.femaleNormalMin != null || t.femaleNormalMax != null;
      return hasMale !== hasFemale;
    }).map(t => t.name);
    expect(bad).toEqual([]);
  });
});

describe("qualitative tests", () => {
  it("marks every rangeless test with unit 'report'", () => {
    // The settings page's own Unit Field Guide documents this convention; the old
    // seed left the unit NULL and relied on the ranges being blank.
    const bad = LAB_TEST_CATALOG
      .filter(t => t.normalMin == null && t.normalMax == null && t.unit !== "report")
      .map(t => `${t.name} -> unit "${t.unit}"`);
    expect(bad).toEqual([]);
  });

  it("never marks a quantitative test as 'report'", () => {
    const bad = LAB_TEST_CATALOG
      .filter(t => t.unit === "report" && (t.normalMin != null || t.normalMax != null))
      .map(t => t.name);
    expect(bad).toEqual([]);
  });
});

describe("unit hygiene", () => {
  it("uses the micro sign U+00B5 and never Greek mu U+03BC", () => {
    // The old seed mixed both. Two unit strings that render identically but do not
    // compare equal break grouping, dedup and analyzer mapping.
    const bad = LAB_TEST_CATALOG.filter(t => t.unit.includes("μ")).map(t => t.name);
    expect(bad).toEqual([]);
  });

  it("uses no superscript digits in units", () => {
    const bad = LAB_TEST_CATALOG
      .filter(t => /[²³¹⁰-₟]/.test(t.unit))
      .map(t => `${t.name} -> ${t.unit}`);
    expect(bad).toEqual([]);
  });

  it("has no leading or trailing whitespace anywhere", () => {
    const bad = LAB_TEST_CATALOG.filter(t =>
      t.name !== t.name.trim() || t.code !== t.code.trim() || t.unit !== t.unit.trim(),
    ).map(t => t.code);
    expect(bad).toEqual([]);
  });
});

describe("auto-verification opt-in", () => {
  it("only enables auto-verify on quantitative tests", () => {
    // A qualitative result has no range to prove it normal, so it can never be
    // auto-released.
    const bad = LAB_TEST_CATALOG
      .filter(t => t.autoverifyEligible && t.normalMin == null && t.normalMax == null)
      .map(t => t.name);
    expect(bad).toEqual([]);
  });
});

describe("test groups", () => {
  it("references only tests that exist in the catalogue", () => {
    const missing = LAB_TEST_GROUP_CATALOG.flatMap(g =>
      g.members.filter(m => !names.includes(m)).map(m => `${g.name} -> ${m}`),
    );
    expect(missing).toEqual([]);
  });

  it("has at least one member per group", () => {
    expect(LAB_TEST_GROUP_CATALOG.filter(g => g.members.length === 0).map(g => g.name)).toEqual([]);
  });

  it("prices every group below the sum of its members", () => {
    // A panel priced at or above its parts is not a panel — the patient would be
    // better off ordering the tests individually, and the group price never applies.
    const feeOf = new Map(LAB_TEST_CATALOG.map(t => [t.name, t.fee]));
    const bad = LAB_TEST_GROUP_CATALOG
      .map(g => ({ g, sum: g.members.reduce((a, m) => a + (feeOf.get(m) ?? 0), 0) }))
      .filter(({ g, sum }) => g.fee >= sum)
      .map(({ g, sum }) => `${g.name}: group ₹${g.fee} >= members ₹${sum}`);
    expect(bad).toEqual([]);
  });

  it("uses valid categories on groups too", () => {
    const bad = LAB_TEST_GROUP_CATALOG
      .filter(g => !(LAB_TEST_CATEGORIES as readonly string[]).includes(g.category))
      .map(g => g.name);
    expect(bad).toEqual([]);
  });
});

describe("coverage the rest of the app already assumes", () => {
  it("includes the blood group test that labSampleIntegrity looks for", () => {
    // checkDeterministicMixupIndicators matches /blood group/i against test names to
    // detect a wrong-blood-in-tube event. Without a row it can never trigger.
    expect(names.some(n => /blood group/i.test(n))).toBe(true);
  });

  it("includes the reflex tests labReflexTests suggests by name", () => {
    for (const t of ["Free T4", "Serum Ferritin"]) expect(names).toContain(t);
  });

  it("includes the four mandatory pre-operative screening tests", () => {
    for (const t of ["HIV I & II", "HBsAg", "Anti-HCV", "VDRL / RPR"]) expect(names).toContain(t);
  });

  it("includes a histopathology test so the dual-validation gate has something to gate", () => {
    expect(LAB_TEST_CATALOG.some(t => t.category === "Histopathology")).toBe(true);
  });

  it("does not carry ECG, which is not a laboratory test", () => {
    // Ordering it through the lab pipeline minted a specimen and a barcode for a
    // patient from whom nothing is drawn.
    expect(names).not.toContain("ECG");
  });

  it("has at least two distinct sample types so multi-tube collection is exercisable", () => {
    // TC-P5B-008 needs one order to produce two tubes.
    expect(new Set(LAB_TEST_CATALOG.map(t => t.sampleType)).size).toBeGreaterThan(1);
  });
});

describe("retirement", () => {
  it("carries no test that has been retired", () => {
    const live = LAB_TEST_RETIRED.filter(r => names.includes(r.name)).map(r => r.name);
    expect(live).toEqual([]);
  });

  it("keeps every retired pseudo-panel orderable as an identically named group", () => {
    // This is the whole safety argument for retiring them. investigationSync matches a
    // prescribed investigation against lab_test_master BY NAME and silently drops a
    // miss into `unmatched`. Retiring 'Complete Blood Count' without a group of exactly
    // that name means every prescribed CBC stops producing a lab order — and nothing
    // raises. The group fallback only works if the names line up, so assert they do.
    const groupNames = LAB_TEST_GROUP_CATALOG.map(g => g.name);
    const orphaned = LAB_TEST_RETIRED
      .filter(r => r.reason.includes("Replaced by the identically named group"))
      .filter(r => !groupNames.includes(r.name))
      .map(r => r.name);
    expect(orphaned).toEqual([]);
  });
});

describe("alert fatigue (Dr. Ramesh's rule: more alerts is NOT better)", () => {
  const byName = (n: string) => LAB_TEST_CATALOG.find(t => t.name === n);

  it("puts no panic value on a lipid except triglyceride", () => {
    // A cholesterol of 410 or an LDL of 310 is a statin conversation in clinic, and a
    // low HDL is the most ordinary abnormal result in the profile. None is a phone call.
    for (const n of ["Total Cholesterol", "LDL Cholesterol", "HDL Cholesterol", "VLDL Cholesterol"]) {
      const t = byName(n)!;
      expect([n, t.criticalLow, t.criticalHigh]).toEqual([n, null, null]);
    }
  });

  it("pages on triglyceride only at the pancreatitis threshold", () => {
    expect(byName("Triglycerides")!.criticalHigh).toBe(1000);
  });

  it("does not page twice for one clinical event on one draw", () => {
    // eGFR is calculated FROM creatinine, and CK-MB is drawn WITH troponin. Each pair
    // would otherwise place the same phone call twice.
    expect(byName("eGFR")!.criticalLow).toBeNull();
    expect(byName("CK-MB")!.criticalHigh).toBeNull();
    expect(byName("Serum Creatinine")!.criticalHigh).toBe(5.0);
    expect(byName("Troponin I")!.criticalHigh).toBe(0.04);
  });

  it("uses one pair of panic thresholds for all three blood sugars", () => {
    const sugars = ["Blood Sugar Fasting", "Blood Sugar Post Prandial", "Blood Sugar Random"]
      .map(n => byName(n)!)
      .map(t => `${t.criticalLow}/${t.criticalHigh}`);
    expect(new Set(sugars).size).toBe(1);
  });
});

describe("critical-care and screening coverage", () => {
  const byName = (n: string) => LAB_TEST_CATALOG.find(t => t.name === n);

  it("draws an arterial gas into an arterial tube, not the venous one", () => {
    // investigationSync mints one specimen per distinct sample_type. Collapsing an ABG
    // into 'Blood' prints one barcode for two genuinely separate draws.
    expect(byName("Arterial Blood Gas")!.sampleType).toBe("Arterial Blood");
  });

  it("carries a lactate that pages at the sepsis-bundle threshold", () => {
    const lactate = byName("Serum Lactate")!;
    expect(lactate.criticalHigh).toBe(4.0);
    // A plain tube keeps glycolysing and manufactures the alert on its own.
    expect(lactate.sampleType).toBe("Fluoride Blood");
  });

  it("can screen for the haemoglobinopathies the NHM programme mandates", () => {
    for (const n of ["Haemoglobin Electrophoresis (HPLC)", "Sickling / Solubility Test"]) {
      expect(names).toContain(n);
    }
  });

  it("can work up acute viral hepatitis, not just screen for carriage", () => {
    // HBsAg and Anti-HCV cover pre-op screening; A and E are what a jaundiced patient
    // presenting to OPD actually needs, and both were missing.
    for (const n of ["Hepatitis A IgM", "Hepatitis E IgM"]) expect(names).toContain(n);
  });

  it("files infectious PCR under Molecular Biology, never Genetics", () => {
    // 'Genetics' must mean hereditary disease testing; a dual-validation rule set for
    // genetics should never fire on a COVID swab.
    const genetics = LAB_TEST_CATALOG.filter(t => t.category === "Genetics").map(t => t.name);
    expect(genetics).toEqual(["Karyotyping", "Thalassaemia Mutation Panel"]);
    expect(byName("COVID-19 RT-PCR")!.category).toBe("Molecular Biology");
  });
});
