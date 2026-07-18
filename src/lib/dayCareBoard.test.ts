import { describe, it, expect } from "vitest";
import { dayCareDateColumn, dayCareStatusFilter, dayCareSortAscending } from "./dayCareBoard";

describe("dayCareDateColumn", () => {
  it("filters the Scheduled tab on scheduled_at, not admitted_at", () => {
    // Regression lock. A booking has admitted_at NULL (20261008000138), so filtering this
    // tab on admitted_at would silently return an empty board and make every booking
    // invisible — the exact failure that would make the feature look broken.
    expect(dayCareDateColumn("scheduled")).toBe("scheduled_at");
  });

  it("filters Active and Discharged on admitted_at (real arrival)", () => {
    expect(dayCareDateColumn("active")).toBe("admitted_at");
    expect(dayCareDateColumn("discharged")).toBe("admitted_at");
  });

  it("filters Cancelled on scheduled_at — a cancelled booking never got an admitted_at", () => {
    expect(dayCareDateColumn("cancelled")).toBe("scheduled_at");
  });
});

describe("dayCareStatusFilter", () => {
  it("maps each working tab to its single admissions.status value", () => {
    expect(dayCareStatusFilter("scheduled")).toEqual(["scheduled"]);
    expect(dayCareStatusFilter("active")).toEqual(["active"]);
    expect(dayCareStatusFilter("discharged")).toEqual(["discharged"]);
  });

  it("gathers both 'did not happen' outcomes under Cancelled", () => {
    // Cancelled and no-show stay distinct in the data (different fee policy, and no-show
    // rate is its own KPI) but share one list.
    expect(dayCareStatusFilter("cancelled")).toEqual(["cancelled", "no_show"]);
  });

  it("never lets a cancelled booking leak into the working tabs", () => {
    for (const tab of ["scheduled", "active", "discharged"] as const) {
      expect(dayCareStatusFilter(tab)).not.toContain("cancelled");
      expect(dayCareStatusFilter(tab)).not.toContain("no_show");
    }
  });
});

describe("dayCareSortAscending", () => {
  it("sorts Scheduled soonest-first — it is a worklist of what is coming up", () => {
    expect(dayCareSortAscending("scheduled")).toBe(true);
  });

  it("sorts Active and Discharged newest-first — they are logs of what happened", () => {
    expect(dayCareSortAscending("active")).toBe(false);
    expect(dayCareSortAscending("discharged")).toBe(false);
    expect(dayCareSortAscending("cancelled")).toBe(false);
  });
});
