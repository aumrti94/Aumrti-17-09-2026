import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { mockFrom, mockUseRealtimeRefetch } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockUseRealtimeRefetch: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/hooks/useRealtimeRefetch", () => ({ useRealtimeRefetch: mockUseRealtimeRefetch }));

import { useUnreviewedResultCount } from "./useUnreviewedResultCount";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "is", "not", "in", "limit", "order"]) {
    p[m] = self;
  }
  return p;
}

function mockTables({ lab = [], rad = [], ext = [], path = [] }: Record<string, any[]>) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "lab_orders") return makeChain({ data: lab });
    if (table === "radiology_orders") return makeChain({ data: rad });
    if (table === "external_lab_referrals") return makeChain({ data: ext });
    if (table === "pathology_cases") return makeChain({ data: path });
    throw new Error(`unexpected table ${table}`);
  });
}

beforeEach(() => {
  mockFrom.mockReset();
  mockUseRealtimeRefetch.mockReset();
});

describe("useUnreviewedResultCount", () => {
  it("stays 0 without hitting the network when there is no patient id yet", async () => {
    mockTables({});
    const { result } = renderHook(() =>
      useUnreviewedResultCount({ hospitalId: "h1", patientId: null }),
    );
    expect(result.current).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("sums unreviewed lab, radiology, and external referral counts", async () => {
    mockTables({ lab: [{ id: "l1" }, { id: "l2" }], rad: [{ id: "r1" }], ext: [{ id: "e1" }], path: [] });
    const { result } = renderHook(() =>
      useUnreviewedResultCount({ hospitalId: "h1", patientId: "p1" }),
    );
    await waitFor(() => expect(result.current).toBe(4));
  });

  it("only queries pathology_cases when there are unreviewed lab order ids to scope by", async () => {
    mockTables({ lab: [], rad: [], ext: [], path: [{ id: "path1" }] });
    renderHook(() => useUnreviewedResultCount({ hospitalId: "h1", patientId: "p1" }));
    await waitFor(() => expect(mockFrom).toHaveBeenCalledWith("lab_orders"));
    expect(mockFrom).not.toHaveBeenCalledWith("pathology_cases");
  });

  it("adds signed-off pathology cases on top of their parent lab order count", async () => {
    mockTables({ lab: [{ id: "l1" }], rad: [], ext: [], path: [{ id: "path1" }] });
    const { result } = renderHook(() =>
      useUnreviewedResultCount({ hospitalId: "h1", patientId: "p1" }),
    );
    await waitFor(() => expect(result.current).toBe(2));
  });

  it("registers realtime refetch on the four result tables, scoped by hospital", () => {
    mockTables({});
    renderHook(() => useUnreviewedResultCount({ hospitalId: "h1", patientId: "p1" }));
    expect(mockUseRealtimeRefetch).toHaveBeenCalledWith(
      expect.objectContaining({
        tables: ["lab_orders", "radiology_reports", "pathology_cases", "external_lab_referrals"],
        hospitalId: "h1",
        enabled: true,
      }),
    );
  });
});
