import { describe, it, expect } from "vitest";
import {
  FLAG_STYLE, FLAG_LABEL, isCriticalFlag, isAbnormalFlag,
  isLabItemReleased, isLabOrderReleased, isRadReportReleased,
  isPathologyReleased, isExternalReportReceived, isAmended,
  formatIndianDate, humaniseStatus, groupBy,
} from "./investigationDisplay";

/**
 * These predicates decide whether a doctor is shown a result as readable or as still pending.
 * Getting one wrong in the permissive direction means a clinician acts on a value nobody has
 * signed off; in the strict direction it means a released report stays invisible. Both are
 * the failure this feature exists to prevent, so the rules are pinned here.
 */

describe("result flags", () => {
  it("treats only CH and CL as critical", () => {
    expect(isCriticalFlag("CH")).toBe(true);
    expect(isCriticalFlag("CL")).toBe(true);
    for (const f of ["H", "L", "A", "N", null, undefined, ""]) {
      expect(isCriticalFlag(f as string)).toBe(false);
    }
  });

  it("treats anything other than N (or absent) as abnormal", () => {
    for (const f of ["H", "L", "CH", "CL", "A"]) expect(isAbnormalFlag(f)).toBe(true);
    expect(isAbnormalFlag("N")).toBe(false);
    expect(isAbnormalFlag(null)).toBe(false);
    expect(isAbnormalFlag(undefined)).toBe(false);
  });

  it("has a style and a label for every non-normal flag the lab can write", () => {
    for (const f of ["H", "L", "CH", "CL", "A"]) {
      expect(FLAG_STYLE[f]).toBeTruthy();
      expect(FLAG_LABEL[f]).toBeTruthy();
    }
    // 'N' is deliberately unstyled — a normal result must not be decorated.
    expect(FLAG_STYLE.N).toBeUndefined();
    expect(FLAG_LABEL.N).toBeUndefined();
  });
});

describe("release predicates", () => {
  it("a lab item is readable only once reported or validated", () => {
    expect(isLabItemReleased({ status: "reported" })).toBe(true);
    expect(isLabItemReleased({ status: "validated" })).toBe(true);
    // result_entered means a value is typed but nobody has signed it off yet.
    expect(isLabItemReleased({ status: "result_entered" })).toBe(false);
    expect(isLabItemReleased({ status: "ordered" })).toBe(false);
    expect(isLabItemReleased({ status: null })).toBe(false);
  });

  it("a lab order is released only when completed", () => {
    expect(isLabOrderReleased({ status: "completed" })).toBe(true);
    expect(isLabOrderReleased({ status: "pending_validation" })).toBe(false);
    expect(isLabOrderReleased({ status: "partial_results" })).toBe(false);
  });

  it("radiology counts as released on a done status or a signed report", () => {
    expect(isRadReportReleased({ status: "reported" }, null)).toBe(true);
    expect(isRadReportReleased({ status: "validated" }, null)).toBe(true);
    // A signed report is authoritative even if the order status lags behind it.
    expect(isRadReportReleased({ status: "in_progress" }, { is_signed: true })).toBe(true);
    expect(isRadReportReleased({ status: "in_progress" }, { is_signed: false })).toBe(false);
    expect(isRadReportReleased({ status: "ordered" }, null)).toBe(false);
  });

  it("an amended pathology case is still released — and flagged as amended", () => {
    expect(isPathologyReleased({ status: "signed_off" })).toBe(true);
    expect(isPathologyReleased({ status: "amended" })).toBe(true);
    expect(isPathologyReleased({ status: "pending_signoff" })).toBe(false);

    expect(isAmended({ status: "amended" })).toBe(true);
    expect(isAmended({ status: "signed_off" })).toBe(false);
  });

  it("an external report counts as received on a timestamp or a completed status", () => {
    expect(isExternalReportReceived({ report_received_at: "2026-08-24T10:00:00Z" })).toBe(true);
    expect(isExternalReportReceived({ status: "completed" })).toBe(true);
    expect(isExternalReportReceived({ status: "report_awaited" })).toBe(false);
    expect(isExternalReportReceived({ status: "pending", report_received_at: null })).toBe(false);
  });
});

describe("formatting", () => {
  it("renders dates in Indian locale and never crashes on bad input", () => {
    expect(formatIndianDate("2026-08-24")).toContain("2026");
    expect(formatIndianDate(null)).toBe("—");
    expect(formatIndianDate("")).toBe("—");
    expect(formatIndianDate("not-a-date")).toBe("—");
  });

  it("humanises snake_case statuses", () => {
    expect(humaniseStatus("pending_validation")).toBe("pending validation");
    expect(humaniseStatus(null)).toBe("—");
  });
});

describe("groupBy", () => {
  it("groups lab items by category so a profile reads as one block", () => {
    const items = [
      { name: "Hb", category: "Haematology" },
      { name: "Urea", category: "Biochemistry" },
      { name: "WBC", category: "Haematology" },
    ];
    const grouped = groupBy(items, (i) => i.category);
    expect(Object.keys(grouped)).toEqual(["Haematology", "Biochemistry"]);
    expect(grouped.Haematology.map((i) => i.name)).toEqual(["Hb", "WBC"]);
    expect(grouped.Biochemistry).toHaveLength(1);
  });

  it("returns an empty object for no rows", () => {
    expect(groupBy([], () => "x")).toEqual({});
  });
});
