import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { calculateAnnualTax, calculatePayslip, computeForm16, SalaryStructure, AttendanceInput } from "./payrollEngine";

// Statutory payroll engine (PF/ESI/PT/TDS) — every number here is a legal obligation, not a
// UX detail, so slab boundaries and the rebate/cess interaction are pinned explicitly.

describe("calculateAnnualTax — New Regime FY 2025-26", () => {
  it("owes nothing when income is below the standard deduction", () => {
    expect(calculateAnnualTax(50000)).toBe(0);
  });

  it("applies the 87A rebate exactly at the ₹7L taxable-income boundary", () => {
    // 775000 - 75000 standard deduction = 700000 taxable, exactly the rebate limit.
    expect(calculateAnnualTax(775000)).toBe(0);
  });

  it("taxes progressively once taxable income exceeds the rebate limit", () => {
    // taxable = 1000000 - 75000 = 925000 -> 20000 (5% slab) + 22500 (10% slab) = 42500,
    // *1.04 cess = 44200.
    expect(calculateAnnualTax(1000000)).toBe(44200);
  });

  it("applies the top 30% slab for high income", () => {
    // taxable = 2000000 - 75000 = 1925000: 0 + 20000 (5%) + 30000 (10%) + 30000 (15%)
    // + 60000 (20%) + 127500 (30% on the 425000 above 1500000) = 267500, *1.04 cess.
    expect(calculateAnnualTax(2000000)).toBe(278200);
  });
});

describe("calculatePayslip", () => {
  const structure: SalaryStructure = {
    basic_pct: 50, hra_pct: 40, da_pct: 10, ta_fixed: 1600,
    special_allowance_pct: 0, medical_allowance: 1250, lta_annual: 0,
    pf_employee_pct: 12, pf_employer_pct: 12,
    esi_employee_pct: 0.75, esi_employer_pct: 3.25,
    pt_state: "KA",
  };
  const fullAttendance: AttendanceInput = { total_days: 26, present_days: 26, paid_leaves: 0, lop_days: 0 };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15)); // June 15 2026 -> fiscal month 3, 10 months remaining
  });
  afterEach(() => vi.useRealTimers());

  it("computes a full-attendance payslip end to end for a mid-band earner", () => {
    const calc = calculatePayslip(structure, 30000, fullAttendance);
    expect(calc.basic).toBe(15000);
    expect(calc.hra).toBe(6000);
    expect(calc.da).toBe(1500);
    expect(calc.ta).toBe(1600);
    expect(calc.medical_allowance).toBe(1250);
    expect(calc.special_allowance).toBe(4650);
    expect(calc.gross_earned).toBe(30000);
    expect(calc.pf_employee).toBe(1800); // 12% of basic, under the ₹15k ceiling
    expect(calc.pf_employer).toBe(1800);
    expect(calc.esi_employee).toBe(0); // gross > ₹21,000 ESI threshold
    expect(calc.pt).toBe(200); // Karnataka slab above ₹15,000
    expect(calc.tds_monthly).toBe(0); // projected annual income too low to tax after rebate
    expect(calc.net_pay).toBe(28000); // 30000 - (1800 pf + 0 esi + 200 pt + 0 tds)
  });

  it("prorates earnings for partial attendance", () => {
    const half: AttendanceInput = { total_days: 26, present_days: 13, paid_leaves: 0, lop_days: 13 };
    const calc = calculatePayslip(structure, 30000, half);
    expect(calc.gross_earned).toBe(15000); // 30000 * 13/26
  });

  it("counts paid leave the same as a present day for proration", () => {
    const withPaidLeave: AttendanceInput = { total_days: 26, present_days: 20, paid_leaves: 6, lop_days: 0 };
    const calc = calculatePayslip(structure, 30000, withPaidLeave);
    expect(calc.gross_earned).toBe(30000); // 26/26, fully paid
  });

  it("caps proration at 1 even if present+paid-leave days exceed total_days", () => {
    const overcounted: AttendanceInput = { total_days: 26, present_days: 26, paid_leaves: 5, lop_days: 0 };
    const calc = calculatePayslip(structure, 30000, overcounted);
    expect(calc.gross_earned).toBe(30000); // not 35714 — capped at ratio 1
  });

  it("applies ESI only when gross_earned is at or below ₹21,000", () => {
    const belowThreshold = calculatePayslip(structure, 20000, fullAttendance);
    expect(belowThreshold.esi_employee).toBeCloseTo(150, 2); // 0.75% of 20000
    expect(belowThreshold.esi_employer).toBeCloseTo(650, 2); // 3.25% of 20000

    const aboveThreshold = calculatePayslip(structure, 21001, fullAttendance);
    expect(aboveThreshold.esi_employee).toBe(0);
  });

  it("caps PF on a ₹15,000 ceiling wage even when basic exceeds it", () => {
    const highEarner = calculatePayslip(structure, 100000, fullAttendance);
    // basic = 50% of 100000 = 50000, but PF is capped at the 15000 ceiling wage.
    expect(highEarner.pf_employee).toBe(1800); // 12% of 15000, not 12% of 50000
  });

  it("returns zero professional tax for a state with no configured slab, or no state at all", () => {
    const noSlabState = calculatePayslip({ ...structure, pt_state: "ZZ" }, 30000, fullAttendance);
    expect(noSlabState.pt).toBe(0);

    const noState = calculatePayslip({ ...structure, pt_state: null }, 30000, fullAttendance);
    expect(noState.pt).toBe(0);
  });

  it("computes overtime pay from the hourly basic rate times the configured multiplier", () => {
    const calc = calculatePayslip(structure, 30000, fullAttendance, 0, 0, 10);
    // hourly basic = 15000 / (26*8) = 72.115..., * 1.5 multiplier * 10 hours
    const expectedOt = Math.round((15000 / (26 * 8)) * 1.5 * 10 * 100) / 100;
    expect(calc.overtime_amount).toBe(expectedOt);
    expect(calc.overtime_amount).toBeGreaterThan(0);
  });

  it("reduces the monthly TDS by tax already deducted year-to-date", () => {
    // A high earner with substantial YTD gross should owe some monthly TDS...
    const highEarner = calculatePayslip(structure, 150000, fullAttendance, 900000, 0);
    expect(highEarner.tds_monthly).toBeGreaterThan(0);
    // ...and owing less once YTD TDS already covers part of the projected annual tax.
    const partiallyPaid = calculatePayslip(structure, 150000, fullAttendance, 900000, 50000);
    expect(partiallyPaid.tds_monthly).toBeLessThan(highEarner.tds_monthly);
  });
});

describe("computeForm16", () => {
  it("reports no TDS liability when net taxable income is within the rebate limit", () => {
    const result = computeForm16(775000, 21600, 2400);
    expect(result.taxPayable).toBe(0);
    expect(result.tdsRemark).toContain("No TDS liability");
  });

  it("computes tax payable and an empty remark once liable", () => {
    const result = computeForm16(1200000, 21600, 2400);
    expect(result.taxPayable).toBeGreaterThan(0);
    expect(result.tdsRemark).toBe("");
  });

  it("applies the ₹75,000 standard deduction before computing net taxable income", () => {
    const result = computeForm16(500000, 0, 0);
    expect(result.netTaxableIncome).toBe(425000);
    expect(result.standardDeduction).toBe(75000);
  });

  it("never lets net taxable income go negative for a gross salary below the deduction", () => {
    const result = computeForm16(50000, 0, 0);
    expect(result.netTaxableIncome).toBe(0);
  });
});
