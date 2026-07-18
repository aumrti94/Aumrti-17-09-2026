import { describe, it, expect } from "vitest";
import {
  ADMISSION_BILL_TYPES,
  admissionBillType,
  admissionBillPrefix,
} from "./admissionBill";

/**
 * These functions decide which bill an admission's charges land on. autoChargeService is
 * the canonical charge path for 18 modules, so a wrong answer here misroutes real money —
 * hence the exhaustive truth table.
 */
describe("admissionBillType", () => {
  it("routes day care admissions to the daycare bill", () => {
    expect(admissionBillType("daycare")).toBe("daycare");
  });

  it("routes every inpatient admission type to the ipd bill", () => {
    expect(admissionBillType("elective")).toBe("ipd");
    expect(admissionBillType("emergency")).toBe("ipd");
    expect(admissionBillType("planned")).toBe("ipd");
    expect(admissionBillType("transfer")).toBe("ipd");
  });

  it("defaults null/undefined/empty to ipd, never daycare", () => {
    // Load-bearing: admission_type has no CHECK constraint, and defaulting an unrecognised
    // type to 'daycare' would strand a real inpatient's charges on a bill the IPD flows
    // never look at. 'ipd' preserves the pre-existing behaviour for anything unexpected.
    expect(admissionBillType(null)).toBe("ipd");
    expect(admissionBillType(undefined)).toBe("ipd");
    expect(admissionBillType("")).toBe("ipd");
  });

  it("defaults an unknown admission type to ipd", () => {
    expect(admissionBillType("some_new_type_added_later")).toBe("ipd");
  });

  it("matches daycare case-insensitively", () => {
    expect(admissionBillType("DAYCARE")).toBe("daycare");
    expect(admissionBillType("DayCare")).toBe("daycare");
  });

  it("does not treat the underscored spelling as day care", () => {
    // 'day_care' is the service_module value, NOT an admission_type. The two vocabularies
    // are separate, and the discharge_type bug (day_care vs daycare) proves how easily
    // they get confused.
    expect(admissionBillType("day_care")).toBe("ipd");
  });
});

describe("admissionBillPrefix", () => {
  it("puts both admission bill types on the shared BILL series", () => {
    // Every admission bill in the system already uses BILL-YYYYMMDD-NNNN.
    expect(admissionBillPrefix("daycare")).toBe("BILL");
    expect(admissionBillPrefix("ipd")).toBe("BILL");
  });

  it("never mints a bill under the 'DC' prefix", () => {
    // Regression lock: 'DC' identifies a day care ADMISSION (DC-20260717-0001). If a bill
    // took it too, an admission number and a bill number would be indistinguishable.
    expect(admissionBillPrefix("daycare")).not.toBe("DC");
  });
});

describe("ADMISSION_BILL_TYPES", () => {
  it("contains exactly the two admission-scoped bill types", () => {
    // Regression lock: widening this set changes which bills every module's charges can
    // land on. Adding a type here without auditing findAdmissionBill's callers would let
    // charges leak onto e.g. a standalone lab bill.
    expect([...ADMISSION_BILL_TYPES]).toEqual(["ipd", "daycare"]);
  });
});
