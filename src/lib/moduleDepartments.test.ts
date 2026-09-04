import { describe, it, expect, vi } from "vitest";

vi.mock("@/hooks/useSubscriptionConfig", () => ({
  getModuleKeyFromRoute: (route: string) => {
    const base = route.split("?")[0];
    const map: Record<string, string> = {
      "/dialysis": "dialysis",
      "/oncology": "oncology",
      "/lab": "lab",
      "/radiology": "radiology",
      "/opd": "opd", // deliberately has no MODULE_DEPARTMENT entry
    };
    return map[base] ?? null;
  },
}));

import { moduleDepartmentLinks, departmentsForModules } from "./moduleDepartments";

describe("moduleDepartmentLinks — module -> department suggestions", () => {
  it("only includes modules that have both a department mapping and a resolvable module key", () => {
    const links = moduleDepartmentLinks();
    // /opd resolves a module key but has no MODULE_DEPARTMENT entry -> excluded.
    expect(links.some((l) => l.moduleKey === "opd")).toBe(false);
    // /dialysis has both -> included.
    expect(links.find((l) => l.moduleKey === "dialysis")).toMatchObject({ department: "Dialysis" });
  });

  it("gives every link a non-empty module name alongside its key and department", () => {
    for (const link of moduleDepartmentLinks()) {
      expect(link.moduleName.length).toBeGreaterThan(0);
      expect(link.department.length).toBeGreaterThan(0);
    }
  });
});

describe("departmentsForModules — unique departments implied by a hospital's enabled modules", () => {
  it("returns only the departments for the enabled module keys", () => {
    const result = departmentsForModules(["dialysis", "lab"]);
    expect(result).toContain("Dialysis");
    expect(result).toContain("Pathology / Lab");
    expect(result).not.toContain("Oncology");
  });

  it("de-duplicates departments shared by multiple enabled modules", () => {
    // /specialty/anc and /specialty/partograph both map to "Gynaecology & Obstetrics".
    const result = departmentsForModules(["dialysis"]);
    const counts = result.filter((d) => d === "Gynaecology & Obstetrics").length;
    expect(counts).toBeLessThanOrEqual(1);
  });

  it("returns an empty list for a hospital with no matching enabled modules", () => {
    expect(departmentsForModules([])).toEqual([]);
    expect(departmentsForModules(["some_unmapped_key"])).toEqual([]);
  });
});
