import { describe, it, expect } from "vitest";
import { BUILT_IN_ORDER_ALIASES } from "./orderAliases";
import { LAB_TEST_CATALOG, LAB_TEST_GROUP_CATALOG } from "./labTestCatalog";
import { normalizeTerm } from "./medicalLexicon";

/**
 * The radiology studies seeded by 20260903000003_radiology_study_master.sql.
 *
 * Mirrored here rather than imported because that catalogue lives in SQL. If you add a study
 * there and alias it, add it here too — the test below is what stops an alias pointing at a
 * study name that does not exist, which resolves to nothing and silently drops the order.
 */
const SEEDED_RADIOLOGY_STUDIES = [
  "X-Ray Chest PA View", "X-Ray Chest AP View", "X-Ray KUB", "X-Ray LS Spine AP/Lat",
  "X-Ray Knee AP/Lat", "X-Ray Skull AP/Lat",
  "USG Abdomen", "USG Pelvis", "USG Abdomen + Pelvis", "USG Neck", "USG Breast",
  "USG KUB + Prostate", "USG Obstetric", "USG Thyroid", "Doppler Study",
  "CT Brain Plain", "CT Chest", "CT Abdomen + Pelvis", "HRCT Chest", "CECT Abdomen",
  "MRI Brain", "MRI Spine", "MRI Knee", "MRI Shoulder",
  "2D Echo + Doppler", "Stress Echo",
  "ECG (12-Lead)", "Stress ECG (TMT)",
  "DEXA Scan (Spine + Hip)",
  "Mammography Bilateral", "Mammography Unilateral",
  "Fluoroscopy Upper GI", "Barium Swallow",
];

const knownNames = new Set(
  [
    ...LAB_TEST_CATALOG.map((t) => t.name),
    ...LAB_TEST_GROUP_CATALOG.map((g) => g.name),
    ...SEEDED_RADIOLOGY_STUDIES,
  ].map(normalizeTerm),
);

describe("BUILT_IN_ORDER_ALIASES", () => {
  it("only points at names that actually exist in a shipped catalogue", () => {
    // An alias whose canonical name is misspelled resolves to nothing. It does not throw and
    // it does not warn — the test is simply never ordered, which is the exact failure this
    // whole feature exists to remove.
    const dangling = BUILT_IN_ORDER_ALIASES
      .filter((a) => !knownNames.has(normalizeTerm(a.canonical)))
      .map((a) => `${a.alias} -> ${a.canonical}`);
    expect(dangling).toEqual([]);
  });

  it("has no duplicate keys", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const a of BUILT_IN_ORDER_ALIASES) {
      const key = normalizeTerm(a.alias);
      const prior = seen.get(key);
      if (prior && prior !== a.canonical) clashes.push(`${a.alias}: ${prior} vs ${a.canonical}`);
      seen.set(key, a.canonical);
    }
    expect(clashes).toEqual([]);
  });

  it("never shadows a real catalogue name with a different test", () => {
    // `loadOrderCatalogue` checks byExact before byAlias, so a clash would be dead weight at
    // best. If the two disagree it is a sign the alias is wrong.
    const shadowing = BUILT_IN_ORDER_ALIASES
      .filter((a) => knownNames.has(normalizeTerm(a.alias))
        && normalizeTerm(a.alias) !== normalizeTerm(a.canonical))
      .map((a) => `${a.alias} -> ${a.canonical}`);
    expect(shadowing).toEqual([]);
  });

  it("excludes abbreviations that are ambiguous in an order context", () => {
    // "CT" is Clotting Time in the lab and a scan in radiology; "KUB" is both an X-ray and an
    // ultrasound. Resolving either without context bills the wrong department.
    const keys = new Set(BUILT_IN_ORDER_ALIASES.map((a) => normalizeTerm(a.alias)));
    for (const ambiguous of ["ct", "bt", "kub", "na", "k"]) {
      expect(keys.has(ambiguous)).toBe(false);
    }
  });
});
