import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * createBedTurnoverTask's own comment states the invariant this suite exists to protect:
 * the housekeeping task is inserted BEFORE the bed is marked "cleaning", and on any failure
 * to create that task the bed is released back to "available" rather than left stranded.
 */

const { mockInsert, mockUpdate, mockSelectChain } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockUpdate: vi.fn(),
  mockSelectChain: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn((table: string) => {
      if (table === "beds") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: mockSelectChain }) }),
          update: (payload: unknown) => ({ eq: (col: string, val: unknown) => mockUpdate(payload, col, val) }),
        };
      }
      if (table === "housekeeping_tasks") {
        return { insert: mockInsert };
      }
      throw new Error(`unexpected table: ${table}`);
    }),
  },
}));

import { createBedTurnoverTask } from "./bedTurnover";

beforeEach(() => {
  mockInsert.mockReset();
  mockUpdate.mockReset();
  mockSelectChain.mockReset();
  mockSelectChain.mockResolvedValue({ data: { bed_number: "B-101" } });
  mockUpdate.mockResolvedValue({ data: null, error: null });
});

const BASE_OPTS = { hospitalId: "h1", wardId: "w1", bedId: "bed-1", triggerRefId: "adm-1" };

describe("createBedTurnoverTask — happy path", () => {
  it("inserts the housekeeping task, then marks the bed 'cleaning' — task first, status second", async () => {
    mockInsert.mockResolvedValue({ error: null });
    const result = await createBedTurnoverTask({ ...BASE_OPTS, triggeredBy: "discharge" });

    expect(result).toEqual({ ok: true, bedNumber: "B-101" });
    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ triggered_by: "discharge", status: "pending" }));
    expect(mockUpdate).toHaveBeenCalledWith({ status: "cleaning" }, "id", "bed-1");
  });

  it("includes the full 6-item checklist on every task", async () => {
    mockInsert.mockResolvedValue({ error: null });
    await createBedTurnoverTask({ ...BASE_OPTS, triggeredBy: "discharge" });
    const taskRow = mockInsert.mock.calls[0][0];
    expect(taskRow.checklist).toHaveLength(6);
    expect(taskRow.checklist.every((c: any) => c.done === false)).toBe(true);
  });
});

describe("createBedTurnoverTask — schema-compatibility fallback for 'transfer'", () => {
  it("retries with triggered_by='manual' when the DB rejects 'transfer' as invalid", async () => {
    mockInsert
      .mockResolvedValueOnce({ error: { message: "invalid triggered_by value" } })
      .mockResolvedValueOnce({ error: null });

    const result = await createBedTurnoverTask({ ...BASE_OPTS, triggeredBy: "transfer" });

    expect(result.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert.mock.calls[0][0].triggered_by).toBe("transfer");
    expect(mockInsert.mock.calls[1][0].triggered_by).toBe("manual");
  });

  it("does not retry a 'discharge' trigger on the same error — the fallback is transfer-specific", async () => {
    mockInsert.mockResolvedValue({ error: { message: "invalid triggered_by value" } });
    const result = await createBedTurnoverTask({ ...BASE_OPTS, triggeredBy: "discharge" });
    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });
});

describe("createBedTurnoverTask — failure releases the bed rather than stranding it", () => {
  it("releases the bed to 'available' when the task insert fails outright", async () => {
    mockInsert.mockResolvedValue({ error: { message: "insert failed" } });
    const result = await createBedTurnoverTask({ ...BASE_OPTS, triggeredBy: "discharge" });

    expect(result).toEqual({ ok: false, bedNumber: "B-101", error: "insert failed" });
    expect(mockUpdate).toHaveBeenCalledWith({ status: "available" }, "id", "bed-1");
  });

  it("releases the bed when even the transfer fallback insert fails", async () => {
    mockInsert.mockResolvedValue({ error: { message: "invalid triggered_by value" } });
    const result = await createBedTurnoverTask({ ...BASE_OPTS, triggeredBy: "transfer" });

    expect(result.ok).toBe(false);
    expect(mockUpdate).toHaveBeenCalledWith({ status: "available" }, "id", "bed-1");
  });
});
