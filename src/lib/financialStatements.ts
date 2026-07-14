import { supabase } from "@/integrations/supabase/client";

// ─────────────────────────────────────────────────────────────────────────────
// Ledger-based financial statements.
//
// Single source of truth: the general ledger (journal_entries +
// journal_line_items) resolved against chart_of_accounts. Because every posting
// is balanced (ΣDr = ΣCr), a Balance Sheet built from cumulative account balances
// ties exactly — Assets = Liabilities + Equity + Net Profit — with NO plug.
//
// account_type in this codebase is one of:
//   asset | liability | equity | revenue | expense
// (income accounts use 'revenue'; 'income' is NOT used — see seed_hospital_defaults).
// ─────────────────────────────────────────────────────────────────────────────

export interface LedgerAccountBalance {
  account_code: string;
  account_name: string;
  account_type: string;            // asset | liability | equity | revenue | expense | other
  account_subtype?: string | null;
  total_debit: number;
  total_credit: number;
  /** Signed balance, debit − credit. */
  balance: number;
}

export interface RawLedgerLine {
  account_id: string;
  account_code: string;
  account_name: string;
  debit_amount: number;
  credit_amount: number;
  cost_centre_id: string | null;
}

/**
 * Fetch raw journal line items for a hospital, filtered by the journal entry's
 * `entry_date` (never `created_at` — a backdated entry must land in the period
 * it was dated for, not the day it was keyed in). Paginated to bypass the
 * 1000-row cap. This is the shared raw-fetch step behind `fetchLedgerBalances`;
 * call it directly when you need per-line detail (e.g. cost-centre breakdowns)
 * rather than account-level aggregates.
 *
 * @param fromDate inclusive lower bound on entry_date, or null for from inception.
 * @param toDate   inclusive upper bound on entry_date.
 */
export async function fetchLedgerLines(
  hospitalId: string,
  fromDate: string | null,
  toDate: string,
  costCentreId?: string | null,
): Promise<RawLedgerLine[]> {
  // Step 1 — journal entry IDs in the date window.
  let entryQuery = (supabase as any)
    .from("journal_entries")
    .select("id")
    .eq("hospital_id", hospitalId)
    .lte("entry_date", toDate);
  if (fromDate) entryQuery = entryQuery.gte("entry_date", fromDate);
  const { data: entries, error: entriesErr } = await entryQuery;
  if (entriesErr) throw entriesErr;
  const entryIds = (entries || []).map((e: any) => e.id);
  if (entryIds.length === 0) return [];

  // Step 2 — line items for those entries (paginated to bypass the 1000-row cap).
  const allLines: RawLedgerLine[] = [];
  const PAGE = 1000;
  for (let i = 0; i < entryIds.length; i += 200) {
    const slice = entryIds.slice(i, i + 200);
    let from = 0;
    while (true) {
      let q = (supabase as any)
        .from("journal_line_items")
        .select("account_id, account_code, account_name, debit_amount, credit_amount, cost_centre_id")
        .eq("hospital_id", hospitalId)
        .in("journal_id", slice);
      if (costCentreId) q = q.eq("cost_centre_id", costCentreId);
      const { data: lines, error } = await q.range(from, from + PAGE - 1);
      if (error) throw error;
      if (!lines || lines.length === 0) break;
      allLines.push(...lines);
      if (lines.length < PAGE) break;
      from += PAGE;
    }
  }
  return allLines;
}

/**
 * Aggregate journal line-item balances by account for a hospital.
 *
 * @param fromDate     inclusive lower bound on entry_date, or null to aggregate
 *                     from inception (used for cumulative Balance Sheet balances).
 * @param toDate       inclusive upper bound on entry_date.
 * @param costCentreId optional — restrict to journal lines tagged to this cost
 *                     centre (for a cost-centre P&L). Omit for the whole entity.
 *
 * Mirrors the paginated fetch strategy proven in TrialBalanceTab so both the
 * Trial Balance and the statements read identical numbers.
 */
export async function fetchLedgerBalances(
  hospitalId: string,
  fromDate: string | null,
  toDate: string,
  costCentreId?: string | null,
): Promise<LedgerAccountBalance[]> {
  const allLines = await fetchLedgerLines(hospitalId, fromDate, toDate, costCentreId);
  if (allLines.length === 0) return [];

  // Chart of accounts, to resolve type/subtype per code.
  const { data: coa, error: coaErr } = await (supabase as any)
    .from("chart_of_accounts")
    .select("code, name, account_type, account_subtype")
    .eq("hospital_id", hospitalId);
  if (coaErr) throw coaErr;
  const coaMap: Record<string, { name: string; account_type: string; account_subtype?: string | null }> = {};
  (coa || []).forEach((a: any) => {
    coaMap[a.code] = { name: a.name, account_type: a.account_type, account_subtype: a.account_subtype };
  });

  // Aggregate by account_code.
  const agg: Record<string, LedgerAccountBalance> = {};
  for (const li of allLines) {
    const code = li.account_code || "—";
    if (!agg[code]) {
      agg[code] = {
        account_code: code,
        account_name: coaMap[code]?.name || li.account_name || code,
        account_type: coaMap[code]?.account_type || "other",
        account_subtype: coaMap[code]?.account_subtype ?? null,
        total_debit: 0,
        total_credit: 0,
        balance: 0,
      };
    }
    agg[code].total_debit += Number(li.debit_amount || 0);
    agg[code].total_credit += Number(li.credit_amount || 0);
  }

  return Object.values(agg)
    .map((r) => ({ ...r, balance: r.total_debit - r.total_credit }))
    .filter((r) => r.total_debit !== 0 || r.total_credit !== 0)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
}

// ── Profit & Loss (period rows: fromDate..toDate) ────────────────────────────

export interface PLLine extends LedgerAccountBalance {
  /** Positive = income (revenue) or cost (expense). */
  amount: number;
}

export interface ProfitAndLoss {
  revenue: PLLine[];
  expenses: PLLine[];
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
}

export function buildProfitAndLoss(rows: LedgerAccountBalance[]): ProfitAndLoss {
  const revenue = rows
    .filter((r) => r.account_type === "revenue")
    .map((r) => ({ ...r, amount: r.total_credit - r.total_debit }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
  const expenses = rows
    .filter((r) => r.account_type === "expense")
    .map((r) => ({ ...r, amount: r.total_debit - r.total_credit }))
    .filter((r) => r.amount !== 0)
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
  const totalRevenue = revenue.reduce((s, r) => s + r.amount, 0);
  const totalExpenses = expenses.reduce((s, r) => s + r.amount, 0);
  return { revenue, expenses, totalRevenue, totalExpenses, netProfit: totalRevenue - totalExpenses };
}

// ── Balance Sheet (cumulative rows: inception..toDate) ───────────────────────

export interface BSLine extends LedgerAccountBalance {
  /** Natural-sign balance for the account's side. */
  amount: number;
}

export interface BalanceSheet {
  assets: BSLine[];
  liabilities: BSLine[];
  equity: BSLine[];
  totalAssets: number;
  totalLiabilities: number;
  /** Equity from equity accounts only (before folding in retained earnings). */
  totalEquityBase: number;
  /** Net profit since inception — unclosed P&L that belongs in equity. */
  retainedEarnings: number;
  totalEquity: number;
  isBalanced: boolean;
  difference: number;
}

export function buildBalanceSheet(rows: LedgerAccountBalance[]): BalanceSheet {
  // Assets are debit-normal; liabilities/equity are credit-normal. Contra-asset
  // accounts (e.g. Accumulated Depreciation, credit balance) naturally reduce
  // total assets because their debit−credit balance is negative.
  const assets = rows
    .filter((r) => r.account_type === "asset")
    .map((r) => ({ ...r, amount: r.total_debit - r.total_credit }))
    .filter((r) => r.amount !== 0);
  const liabilities = rows
    .filter((r) => r.account_type === "liability")
    .map((r) => ({ ...r, amount: r.total_credit - r.total_debit }))
    .filter((r) => r.amount !== 0);
  const equity = rows
    .filter((r) => r.account_type === "equity")
    .map((r) => ({ ...r, amount: r.total_credit - r.total_debit }))
    .filter((r) => r.amount !== 0);

  const revenue = rows.filter((r) => r.account_type === "revenue").reduce((s, r) => s + (r.total_credit - r.total_debit), 0);
  const expense = rows.filter((r) => r.account_type === "expense").reduce((s, r) => s + (r.total_debit - r.total_credit), 0);
  const retainedEarnings = revenue - expense; // net profit not yet closed to equity

  const totalAssets = assets.reduce((s, r) => s + r.amount, 0);
  const totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0);
  const totalEquityBase = equity.reduce((s, r) => s + r.amount, 0);
  const totalEquity = totalEquityBase + retainedEarnings;
  const difference = totalAssets - (totalLiabilities + totalEquity);

  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabilities,
    totalEquityBase,
    retainedEarnings,
    totalEquity,
    isBalanced: Math.abs(difference) < 0.01,
    difference,
  };
}
