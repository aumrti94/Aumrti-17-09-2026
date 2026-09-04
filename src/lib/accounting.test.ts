import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockRpc } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockRpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom, rpc: mockRpc } }));

import {
  autoPostJournalEntry,
  postManualExpenseJournal,
  postMultiLineJournal,
  EXPENSE_CATEGORY_ACCOUNT,
  PAYMENT_MODE_ACCOUNT,
} from "./accounting";

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
});

describe("EXPENSE_CATEGORY_ACCOUNT / PAYMENT_MODE_ACCOUNT", () => {
  it("maps every category/mode to a 4-digit account code", () => {
    for (const code of Object.values(EXPENSE_CATEGORY_ACCOUNT)) expect(code).toMatch(/^\d{4}$/);
    for (const code of Object.values(PAYMENT_MODE_ACCOUNT)) expect(code).toMatch(/^\d{4}$/);
  });
});

describe("autoPostJournalEntry", () => {
  const BASE = {
    triggerEvent: "charge_posted_dialysis",
    sourceModule: "dialysis",
    sourceId: "bill-1",
    amount: 2000,
    description: "Dialysis session",
    hospitalId: "h1",
    postedBy: "u1",
  };

  it("skips posting when the bill was already posted by the DB trigger", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { posted_to_journal: true } }) }) }) });
    expect(await autoPostJournalEntry(BASE)).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("logs an accounting_posting_failures row and returns null when no matching rule exists", async () => {
    const failureInsert = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) };
      if (table === "auto_posting_rules") return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) }) }) };
      if (table === "accounting_posting_failures") return { insert: failureInsert };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await autoPostJournalEntry(BASE);
    expect(result).toBeNull();
    expect(failureInsert).toHaveBeenCalledWith(expect.objectContaining({ trigger_event: "charge_posted_dialysis" }));
  });

  it("creates a balanced debit/credit journal entry when a rule matches", async () => {
    const rule = {
      debit_account_id: "acc-d", credit_account_id: "acc-c",
      debit_account: { id: "acc-d", code: "5060", name: "Misc Expense" },
      credit_account: { id: "acc-c", code: "1001", name: "Cash" },
    };
    mockRpc.mockResolvedValue({ data: 42 });
    const lineInsert = vi.fn().mockResolvedValue({ data: null });
    const billUpdateEq = vi.fn().mockResolvedValue({});

    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
          update: () => ({ eq: billUpdateEq }),
        };
      }
      if (table === "auto_posting_rules") return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: rule }) }) }) }) }) }) };
      if (table === "journal_entries") return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "je-1" }, error: null }) }) }) };
      if (table === "journal_line_items") return { insert: lineInsert };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await autoPostJournalEntry(BASE);
    expect(result).toEqual({ id: "je-1" });
    expect(lineInsert).toHaveBeenCalledWith([
      expect.objectContaining({ account_id: "acc-d", debit_amount: 2000, credit_amount: 0 }),
      expect.objectContaining({ account_id: "acc-c", debit_amount: 0, credit_amount: 2000 }),
    ]);
    expect(billUpdateEq).toHaveBeenCalledWith("id", "bill-1");
  });

  it("skips posting when next_seq indicates the DB trigger already handled it", async () => {
    const rule = { debit_account_id: "d", credit_account_id: "c", debit_account: {}, credit_account: {} };
    mockRpc.mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "bills") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) };
      if (table === "auto_posting_rules") return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: rule }) }) }) }) }) }) };
      throw new Error(`unexpected table ${table}`);
    });

    expect(await autoPostJournalEntry(BASE)).toBeNull();
  });
});

describe("postManualExpenseJournal", () => {
  const BASE = {
    hospitalId: "h1", postedBy: "u1", amount: 5000, description: "Office rent",
    expenseCategory: "rent", paymentMode: "bank_transfer", sourceId: "exp-1",
  };

  it("returns null when either account code cannot be resolved in chart_of_accounts", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) }) });
    expect(await postManualExpenseJournal(BASE)).toBeNull();
  });

  it("posts a balanced entry using the resolved debit/credit accounts for the category and payment mode", async () => {
    mockRpc.mockResolvedValue({ data: 7 });
    const lineInsert = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "chart_of_accounts") {
        return {
          select: () => ({
            eq: () => ({
              eq: (col: string, code: string) => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: code === "5020" ? { id: "acc-rent", code: "5020", name: "Rent" } : { id: "acc-bank", code: "1002", name: "Bank" },
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "journal_entries") return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "je-1" }, error: null }) }) }) };
      if (table === "journal_line_items") return { insert: lineInsert };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await postManualExpenseJournal(BASE);
    expect(result).toEqual({ id: "je-1" });
    expect(lineInsert).toHaveBeenCalledWith([
      expect.objectContaining({ account_id: "acc-rent", debit_amount: 5000 }),
      expect.objectContaining({ account_id: "acc-bank", credit_amount: 5000 }),
    ]);
  });
});

describe("postMultiLineJournal", () => {
  const LINES = [
    { accountCode: "1500", debit: 1000, description: "Goods" },
    { accountCode: "1600", debit: 180, description: "GST input credit" },
    { accountCode: "2001", credit: 1180, description: "Accounts payable" },
  ];
  const BASE = { hospitalId: "h1", postedBy: "u1", sourceModule: "grn", sourceId: "grn-1", description: "GRN posting", lines: LINES };

  it("logs a failure and returns null when the lines don't balance", async () => {
    const failureInsert = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "chart_of_accounts") return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: LINES.map((l) => ({ id: l.accountCode, code: l.accountCode, name: l.accountCode })) }) }) }) };
      if (table === "accounting_posting_failures") return { insert: failureInsert };
      throw new Error(`unexpected table ${table}`);
    });

    const unbalanced = { ...BASE, lines: [{ accountCode: "1500", debit: 1000 }, { accountCode: "2001", credit: 900 }] };
    expect(await postMultiLineJournal(unbalanced)).toBeNull();
    expect(failureInsert).toHaveBeenCalled();
  });

  it("logs a failure and returns null when an account code cannot be resolved", async () => {
    const failureInsert = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "chart_of_accounts") return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: [] }) }) }) }; // none resolved
      if (table === "accounting_posting_failures") return { insert: failureInsert };
      throw new Error(`unexpected table ${table}`);
    });

    expect(await postMultiLineJournal(BASE)).toBeNull();
    expect(failureInsert).toHaveBeenCalled();
  });

  it("posts a balanced multi-line entry when every account resolves and debits equal credits", async () => {
    mockRpc.mockResolvedValue({ data: 3 });
    const lineInsert = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "chart_of_accounts") {
        return { select: () => ({ eq: () => ({ in: () => Promise.resolve({ data: LINES.map((l) => ({ id: `id-${l.accountCode}`, code: l.accountCode, name: `Account ${l.accountCode}` })) }) }) }) };
      }
      if (table === "journal_entries") return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "je-multi" }, error: null }) }) }) };
      if (table === "journal_line_items") return { insert: lineInsert };
      throw new Error(`unexpected table ${table}`);
    });

    const result = await postMultiLineJournal(BASE);
    expect(result).toEqual({ id: "je-multi" });
    expect(lineInsert).toHaveBeenCalledWith([
      expect.objectContaining({ account_id: "id-1500", debit_amount: 1000, credit_amount: 0 }),
      expect.objectContaining({ account_id: "id-1600", debit_amount: 180, credit_amount: 0 }),
      expect.objectContaining({ account_id: "id-2001", debit_amount: 0, credit_amount: 1180 }),
    ]);
  });
});
