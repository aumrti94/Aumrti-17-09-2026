import { describe, it, expect } from "vitest";
import {
  buildProfitAndLoss,
  buildBalanceSheet,
  type LedgerAccountBalance,
} from "./financialStatements";

// Helper to build a ledger row (balance is recomputed by the builders).
const row = (
  code: string,
  name: string,
  type: string,
  debit: number,
  credit: number,
): LedgerAccountBalance => ({
  account_code: code,
  account_name: name,
  account_type: type,
  total_debit: debit,
  total_credit: credit,
  balance: debit - credit,
});

// A tiny but fully-balanced ledger (ΣDr = ΣCr = 100000):
//   Bill finalized:  Dr AR 100000 / Cr OPD Revenue 100000
//   Payment:         Dr Cash 60000 / Cr AR 60000
//   Salary expense:  Dr Salaries 30000 / Cr Cash 30000
//   Depreciation:    Dr Depreciation 5000 / Cr Accumulated Dep 5000
const LEDGER: LedgerAccountBalance[] = [
  row("1001", "Cash in Hand", "asset", 60000, 30000),      // net Dr 30000
  row("1010", "AR - Patients", "asset", 100000, 60000),    // net Dr 40000
  row("1110", "Accumulated Depreciation", "asset", 0, 5000), // contra-asset, Cr 5000
  row("4001", "OPD Revenue", "revenue", 0, 100000),        // Cr 100000
  row("5001", "Salaries", "expense", 30000, 0),            // Dr 30000
  row("5050", "Depreciation", "expense", 5000, 0),         // Dr 5000
];

describe("buildProfitAndLoss", () => {
  it("nets revenue (credit) against expenses (debit)", () => {
    const pl = buildProfitAndLoss(LEDGER);
    expect(pl.totalRevenue).toBe(100000);
    expect(pl.totalExpenses).toBe(35000);
    expect(pl.netProfit).toBe(65000);
    expect(pl.revenue.map((r) => r.account_code)).toEqual(["4001"]);
    expect(pl.expenses.map((r) => r.account_code)).toEqual(["5001", "5050"]);
  });
});

describe("buildBalanceSheet", () => {
  it("ties Assets = Liabilities + Equity + retained earnings, with no plug", () => {
    const bs = buildBalanceSheet(LEDGER);
    // Assets: cash 30000 + AR 40000 − accumulated dep 5000 = 65000
    expect(bs.totalAssets).toBe(65000);
    expect(bs.totalLiabilities).toBe(0);
    // No equity accounts posted; retained earnings = net profit = 65000
    expect(bs.retainedEarnings).toBe(65000);
    expect(bs.totalEquity).toBe(65000);
    expect(bs.isBalanced).toBe(true);
    expect(bs.difference).toBeCloseTo(0, 6);
  });

  it("contra-asset (accumulated depreciation) reduces total assets", () => {
    const withoutDep = LEDGER.filter((r) => r.account_code !== "1110" && r.account_code !== "5050");
    const bs = buildBalanceSheet(withoutDep);
    expect(bs.totalAssets).toBe(70000); // no −5000 contra, no −5000 dep expense
    expect(bs.retainedEarnings).toBe(70000);
    expect(bs.isBalanced).toBe(true);
  });

  it("flags an unbalanced ledger", () => {
    const broken = [...LEDGER, row("9999", "Orphan", "asset", 1000, 0)];
    const bs = buildBalanceSheet(broken);
    expect(bs.isBalanced).toBe(false);
    expect(Math.abs(bs.difference)).toBeCloseTo(1000, 6);
  });
});
