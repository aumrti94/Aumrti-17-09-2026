import { describe, it, expect } from "vitest";
import {
  anyPreAuthRequired,
  describeProcedures,
  filterProcedureOptions,
  lineTotal,
  listProcedures,
  mapProcedureRow,
  normalizeQuantity,
  setProcedureQuantity,
  toggleProcedure,
  totalDurationMinutes,
  totalProcedureCharge,
} from "./dayCareProcedures";

const cataract = { procedureId: "p1", procedureName: "Cataract", rate: 47000, quantity: 1 };
const endoscopy = { procedureId: "p2", procedureName: "Endoscopy", rate: 4500, quantity: 1 };

describe("normalizeQuantity", () => {
  it("floors to a whole number", () => {
    expect(normalizeQuantity(2.9)).toBe(2);
  });
  it("never returns less than 1 — the DB CHECK is quantity > 0", () => {
    expect(normalizeQuantity(0)).toBe(1);
    expect(normalizeQuantity(-3)).toBe(1);
  });
  it("treats junk as 1 rather than letting NaN into money maths", () => {
    expect(normalizeQuantity("abc")).toBe(1);
    expect(normalizeQuantity(null)).toBe(1);
    expect(normalizeQuantity(undefined)).toBe(1);
  });
});

describe("lineTotal", () => {
  it("multiplies the frozen rate by quantity", () => {
    expect(lineTotal({ rate: 47000, quantity: 2 })).toBe(94000);
  });
  it("returns 0 for a negative or non-numeric rate instead of inventing a credit", () => {
    expect(lineTotal({ rate: -100, quantity: 2 })).toBe(0);
    expect(lineTotal({ rate: NaN, quantity: 2 })).toBe(0);
  });
});

describe("totalProcedureCharge", () => {
  it("is the sum across procedures — the bug this feature fixes", () => {
    expect(totalProcedureCharge([cataract, endoscopy])).toBe(51500);
  });
  it("counts quantity (bilateral cataract)", () => {
    expect(totalProcedureCharge([{ ...cataract, quantity: 2 }])).toBe(94000);
  });
  it("is 0 for an empty booking, never NaN", () => {
    expect(totalProcedureCharge([])).toBe(0);
  });
  it("rounds to whole rupees", () => {
    expect(totalProcedureCharge([{ ...cataract, rate: 100.4 }, { ...endoscopy, rate: 100.4 }])).toBe(201);
  });
});

describe("totalDurationMinutes", () => {
  it("sums duration × quantity", () => {
    expect(totalDurationMinutes([
      { durationMinutes: 60, quantity: 2 },
      { durationMinutes: 30, quantity: 1 },
    ])).toBe(150);
  });
  it("tolerates a missing duration", () => {
    expect(totalDurationMinutes([{ durationMinutes: null, quantity: 1 }])).toBe(0);
  });
});

describe("anyPreAuthRequired", () => {
  it("is true when ANY procedure needs pre-auth", () => {
    expect(anyPreAuthRequired([
      { preAuthRequired: false },
      { preAuthRequired: true },
    ])).toBe(true);
  });
  it("is false when none do", () => {
    expect(anyPreAuthRequired([{ preAuthRequired: false }])).toBe(false);
    expect(anyPreAuthRequired([])).toBe(false);
  });
});

describe("describeProcedures", () => {
  it("names a single procedure plainly", () => {
    expect(describeProcedures([cataract])).toBe("Cataract");
  });
  it("shows quantity when more than one of the same", () => {
    expect(describeProcedures([{ ...cataract, quantity: 2 }])).toBe("Cataract ×2");
  });
  it("summarises extras", () => {
    expect(describeProcedures([cataract, endoscopy])).toBe("Cataract +1 more");
  });
  it("is null for no procedures so callers can fall back", () => {
    expect(describeProcedures([])).toBeNull();
  });
});

describe("listProcedures", () => {
  it("names every procedure — the detail panel must not hide one", () => {
    expect(listProcedures([{ ...cataract, quantity: 2 }, endoscopy])).toBe("Cataract ×2, Endoscopy");
  });
});

describe("toggleProcedure", () => {
  const asOption = (p: typeof cataract) => ({
    procedureId: p.procedureId, procedureName: p.procedureName, rate: p.rate,
  });

  it("adds an unselected procedure at quantity 1", () => {
    expect(toggleProcedure([], asOption(cataract))).toEqual([{ ...asOption(cataract), quantity: 1 }]);
  });
  it("removes an already-selected procedure", () => {
    const selected = [{ ...cataract }, { ...endoscopy }];
    expect(toggleProcedure(selected, asOption(cataract)).map(p => p.procedureId)).toEqual(["p2"]);
  });
  it("appends, preserving pick order — the FIRST pick is the primary procedure", () => {
    const after = toggleProcedure([{ ...endoscopy }], asOption(cataract));
    expect(after.map(p => p.procedureId)).toEqual(["p2", "p1"]);
  });
  it("does not mutate the input", () => {
    const selected = [{ ...cataract }];
    toggleProcedure(selected, asOption(endoscopy));
    expect(selected).toHaveLength(1);
  });
});

describe("setProcedureQuantity", () => {
  it("updates only the named procedure", () => {
    const after = setProcedureQuantity([{ ...cataract }, { ...endoscopy }], "p1", 3);
    expect(after.find(p => p.procedureId === "p1")!.quantity).toBe(3);
    expect(after.find(p => p.procedureId === "p2")!.quantity).toBe(1);
  });
  it("clamps a decrement below 1", () => {
    expect(setProcedureQuantity([{ ...cataract }], "p1", 0)[0].quantity).toBe(1);
  });
});

describe("filterProcedureOptions", () => {
  const options = [
    { procedure_name: "Cataract Surgery", procedure_code: "OPH-01", specialty: "Ophthalmology" },
    { procedure_name: "Endoscopy", procedure_code: "GAS-02", specialty: "Gastroenterology" },
    { procedure_name: "Dialysis", procedure_code: null, specialty: null },
  ];

  it("returns everything for an empty or whitespace query", () => {
    expect(filterProcedureOptions(options, "")).toHaveLength(3);
    expect(filterProcedureOptions(options, "   ")).toHaveLength(3);
  });
  it("matches on name, case-insensitively", () => {
    expect(filterProcedureOptions(options, "cata")[0].procedure_name).toBe("Cataract Surgery");
  });
  it("matches on code", () => {
    expect(filterProcedureOptions(options, "gas-02")[0].procedure_name).toBe("Endoscopy");
  });
  it("matches on specialty", () => {
    expect(filterProcedureOptions(options, "ophthalmology")[0].procedure_name).toBe("Cataract Surgery");
  });
  it("requires ALL terms, in any order", () => {
    expect(filterProcedureOptions(options, "ophthalmology cataract")).toHaveLength(1);
    expect(filterProcedureOptions(options, "cataract endoscopy")).toHaveLength(0);
  });
  it("tolerates null code and specialty", () => {
    expect(filterProcedureOptions(options, "dialysis")).toHaveLength(1);
  });
  it("returns nothing when there is no match", () => {
    expect(filterProcedureOptions(options, "zzz")).toEqual([]);
  });
});

describe("mapProcedureRow", () => {
  it("uses the FROZEN rate, not the live master rate", () => {
    const row = {
      procedure_id: "p1", quantity: 2, rate: 47000,
      procedure: { procedure_name: "Cataract", duration_minutes: 60, standard_rate: 52000, pre_auth_required: true },
    };
    const mapped = mapProcedureRow(row);
    expect(mapped.rate).toBe(47000);
    expect(mapped.quantity).toBe(2);
    expect(mapped.preAuthRequired).toBe(true);
  });

  it("falls back to the master rate rather than billing ₹0 for a row with no frozen rate", () => {
    const row = {
      procedure_id: "p1", quantity: 1, rate: 0,
      procedure: { procedure_name: "Cataract", duration_minutes: 60, standard_rate: 52000 },
    };
    expect(mapProcedureRow(row).rate).toBe(52000);
  });
});
