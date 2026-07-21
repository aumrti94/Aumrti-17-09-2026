import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Guard: every patient SEARCH must exclude soft-deleted patients.
 *
 * Deleting a patient sets `patients.is_active = false` (the row is retained for
 * medico-legal reasons). Historically only the patient registry honoured that flag, so a
 * "deleted" patient still surfaced in ~38 other search surfaces — billing, lab, OPD/IPD,
 * MRD, the kiosk, and even the patient-portal login, which let a deleted patient
 * authenticate. This test fails if a new patient search forgets the filter.
 *
 * Only SEARCH queries are checked (those using ilike / textSearch). Resolving a patient
 * already referenced by id — a bill, a discharge summary, an old order — must keep working
 * for inactive patients and is deliberately not flagged.
 */

const SRC = path.resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name) && !full.includes(`${path.sep}tests${path.sep}`)) out.push(full);
  }
  return out;
}

function findUnfilteredPatientSearches(): string[] {
  const offenders: string[] = [];
  for (const file of walk(SRC)) {
    const src = fs.readFileSync(file, "utf8");
    const re = /from\(\s*["']patients["']\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const start = m.index + m[0].length;
      const seg = src.slice(start, start + 800);
      const end = seg.indexOf(";");
      const block = seg.slice(0, end > 0 ? end : 400);

      const isSearch = /\.ilike\(|ilike\.|textSearch/.test(block);
      if (isSearch && !block.includes("is_active")) {
        const line = src.slice(0, m.index).split("\n").length;
        offenders.push(`${path.relative(SRC, file).split(path.sep).join("/")}:${line}`);
      }
    }
  }
  return offenders;
}

describe("patient soft-delete", () => {
  it("no patient search query omits the is_active filter", () => {
    const offenders = findUnfilteredPatientSearches();
    expect(
      offenders,
      `Patient search(es) missing an is_active filter — a deleted patient would still be ` +
        `findable here. Add .eq("is_active", true) to:\n  ${offenders.join("\n  ")}`,
    ).toEqual([]);
  });

  it("the registry is the only surface allowed to opt into showing inactive patients", () => {
    const registry = fs.readFileSync(path.join(SRC, "pages/patients/PatientsPage.tsx"), "utf8");
    // The "Show Inactive" toggle is the deliberate admin escape hatch.
    expect(registry).toContain("showInactive");
    expect(registry).toContain('query.eq("is_active", true)');
  });
});
