import { describe, it, expect } from "vitest";
import { getSpecialtySheet, specialtyTabMeta } from "./specialtyDetection";

describe("getSpecialtySheet — department name → specialty sheet routing", () => {
  it("detects obstetric/gynae departments under multiple spellings", () => {
    expect(getSpecialtySheet("Obstetrics & Gynaecology")).toBe("obstetric");
    expect(getSpecialtySheet("Gynecology")).toBe("obstetric");
    expect(getSpecialtySheet("Maternity Ward")).toBe("obstetric");
  });

  it("detects neonatal/paediatric departments under multiple spellings", () => {
    expect(getSpecialtySheet("Paediatrics")).toBe("neonatal");
    expect(getSpecialtySheet("Pediatrics")).toBe("neonatal");
    expect(getSpecialtySheet("NICU")).toBe("neonatal");
  });

  it("detects anaesthesia/OT departments under multiple spellings", () => {
    expect(getSpecialtySheet("Anaesthesiology")).toBe("anaesthesia");
    expect(getSpecialtySheet("Anesthesia")).toBe("anaesthesia");
    expect(getSpecialtySheet("Operation Theatre")).toBe("anaesthesia");
  });

  it("detects ophthalmology/eye departments", () => {
    expect(getSpecialtySheet("Ophthalmology")).toBe("ophthalmology");
    expect(getSpecialtySheet("Eye Care Unit")).toBe("ophthalmology");
  });

  it("is case-insensitive", () => {
    expect(getSpecialtySheet("OBSTETRICS")).toBe("obstetric");
  });

  it("returns null for a department with no specialty sheet", () => {
    expect(getSpecialtySheet("General Medicine")).toBeNull();
    expect(getSpecialtySheet(null)).toBeNull();
    expect(getSpecialtySheet(undefined)).toBeNull();
  });
});

describe("specialtyTabMeta", () => {
  it("has display metadata for every SpecialtySheet value getSpecialtySheet can return", () => {
    for (const sheet of ["obstetric", "neonatal", "anaesthesia", "ophthalmology"] as const) {
      expect(specialtyTabMeta[sheet].label.length).toBeGreaterThan(0);
      expect(specialtyTabMeta[sheet].icon.length).toBeGreaterThan(0);
    }
  });
});
