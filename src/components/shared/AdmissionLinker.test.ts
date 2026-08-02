import { describe, it, expect } from "vitest";
import { type ActiveAdmission } from "./AdmissionLinker";
import { pickDefaultAdmission } from "@/lib/pickDefaultAdmission";

const ipd: ActiveAdmission = { id: "ipd-1", admission_number: "IPD-1", admission_type: "elective" };
const ipd2: ActiveAdmission = { id: "ipd-2", admission_number: "IPD-2", admission_type: "emergency" };
const day: ActiveAdmission = { id: "dc-1", admission_number: "DC-1", admission_type: "daycare" };

describe("pickDefaultAdmission", () => {
  it("returns null when there are no active admissions", () => {
    expect(pickDefaultAdmission([])).toBeNull();
  });

  it("returns the only admission", () => {
    expect(pickDefaultAdmission([day])?.id).toBe("dc-1");
  });

  it("prefers an inpatient admission over a day care one — the reported bug", () => {
    // The list is ordered newest-first; day care is newer here, yet the inpatient stay wins.
    expect(pickDefaultAdmission([day, ipd])?.id).toBe("ipd-1");
  });

  it("honours an explicitly requested admission even if it is day care", () => {
    expect(pickDefaultAdmission([ipd, day], "dc-1")?.id).toBe("dc-1");
  });

  it("ignores a requested id that is not among the active admissions", () => {
    expect(pickDefaultAdmission([day, ipd], "gone")?.id).toBe("ipd-1");
  });

  it("keeps the list order among inpatient admissions (most recent first)", () => {
    expect(pickDefaultAdmission([ipd2, ipd])?.id).toBe("ipd-2");
  });

  it("falls back to the first when every admission is day care", () => {
    const day2 = { ...day, id: "dc-2", admission_number: "DC-2" };
    expect(pickDefaultAdmission([day2, day])?.id).toBe("dc-2");
  });
});
