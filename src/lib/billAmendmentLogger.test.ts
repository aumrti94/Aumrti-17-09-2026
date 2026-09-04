import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import {
  logBillAmendment,
  logLineItemAdded,
  logLineItemRemoved,
  logInsuranceUpdate,
  logAdvanceApplied,
  fetchBillAmendments,
} from "./billAmendmentLogger";

function usersChain(id: string | null) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: id ? { id } : null } ) }) }) };
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("logBillAmendment", () => {
  it("resolves the acting user's public.users id and writes it as changed_by", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain("user-row-1");
      if (table === "bill_amendments") return { insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    await logBillAmendment({ billId: "b1", hospitalId: "h1", amendmentType: "rate_changed" });

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ changed_by: "user-row-1", bill_id: "b1" }));
  });

  it("writes changed_by as null when there is no authenticated user, rather than failing", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    await logBillAmendment({ billId: "b1", hospitalId: "h1", amendmentType: "cancelled" });
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ changed_by: null }));
  });

  it("never throws — an audit-logging failure must not break the billing workflow", async () => {
    mockGetUser.mockRejectedValue(new Error("auth unavailable"));
    await expect(
      logBillAmendment({ billId: "b1", hospitalId: "h1", amendmentType: "cancelled" }),
    ).resolves.toBeUndefined();
  });
});

describe("convenience loggers — each stamps the correct amendment_type and fields", () => {
  let insertSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });
  });

  it("logLineItemAdded stamps line_item_added with the new item as newValue", async () => {
    const item = { description: "ECG", unit_rate: 300, quantity: 1, total_amount: 300 };
    await logLineItemAdded("b1", "h1", item, "added at bedside");
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amendment_type: "line_item_added", new_value: item, reason: "added at bedside" }),
    );
  });

  it("logLineItemRemoved stamps line_item_removed with the item as oldValue", async () => {
    const item = { description: "ECG", unit_rate: 300, total_amount: 300 };
    await logLineItemRemoved("b1", "h1", item);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ amendment_type: "line_item_removed", old_value: item }),
    );
  });

  it("logInsuranceUpdate captures both the before and after amounts", async () => {
    await logInsuranceUpdate(
      "b1", "h1",
      { insurance_amount: 10000, patient_payable: 2000 },
      { insurance_amount: 8000, patient_payable: 4000 },
    );
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amendment_type: "insurance_updated",
        old_value: { insurance_amount: 10000, patient_payable: 2000 },
        new_value: { insurance_amount: 8000, patient_payable: 4000 },
      }),
    );
  });

  it("logAdvanceApplied records the applied amount and resulting balance", async () => {
    await logAdvanceApplied("b1", "h1", 5000, 1500);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        amendment_type: "advance_applied",
        new_value: { amount_applied: 5000, new_balance_due: 1500 },
      }),
    );
  });
});

describe("fetchBillAmendments", () => {
  it("returns the amendment history rows", async () => {
    const rows = [{ id: "a1", amendment_type: "rate_changed" }];
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: rows, error: null }) }) }) }),
    });
    expect(await fetchBillAmendments("b1")).toEqual(rows);
  });

  it("returns an empty array rather than throwing on a query error", async () => {
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ order: () => ({ limit: () => Promise.resolve({ data: null, error: { message: "boom" } }) }) }) }),
    });
    expect(await fetchBillAmendments("b1")).toEqual([]);
  });
});
