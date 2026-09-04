import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

const { mockRpc, mockUseHospitalId } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockUseHospitalId: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mockRpc } }));
vi.mock("@/hooks/useHospitalId", () => ({ useHospitalId: mockUseHospitalId }));

import { useCapacityCheck } from "./useCapacityCheck";

beforeEach(() => {
  mockRpc.mockReset();
  mockUseHospitalId.mockReset();
  mockUseHospitalId.mockReturnValue({ hospitalId: "h1" });
});

describe("useCapacityCheck", () => {
  it("checkBedCapacity allows unconditionally without an RPC call when there is no hospital id", async () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: null });
    const { result } = renderHook(() => useCapacityCheck());
    const check = await result.current.checkBedCapacity(5);
    expect(check).toEqual({ allowed: true, current: 0, max: null, plan_slug: null });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("checkBedCapacity accounts for the batch size, not just the current count", async () => {
    mockRpc.mockResolvedValue({ data: { allowed: false, current: 8, max: 10, plan_slug: "starter" } });
    const { result } = renderHook(() => useCapacityCheck());
    await result.current.checkBedCapacity(15);
    expect(mockRpc).toHaveBeenCalledWith("check_bed_capacity", { p_hospital_id: "h1", p_adding: 15 });
  });

  it("checkBedCapacity floors the batch size at 1 even if passed 0", async () => {
    mockRpc.mockResolvedValue({ data: { allowed: true, current: 0, max: 10, plan_slug: "starter" } });
    const { result } = renderHook(() => useCapacityCheck());
    await result.current.checkBedCapacity(0);
    expect(mockRpc).toHaveBeenCalledWith("check_bed_capacity", { p_hospital_id: "h1", p_adding: 1 });
  });

  it("checkBedCapacity defaults to allowed when the RPC returns no data", async () => {
    mockRpc.mockResolvedValue({ data: null });
    const { result } = renderHook(() => useCapacityCheck());
    const check = await result.current.checkBedCapacity();
    expect(check.allowed).toBe(true);
  });

  it("checkStaffCapacity calls the staff RPC with the hospital id", async () => {
    mockRpc.mockResolvedValue({ data: { allowed: true, current: 5, max: 20, plan_slug: "pro" } });
    const { result } = renderHook(() => useCapacityCheck());
    const check = await result.current.checkStaffCapacity();
    expect(mockRpc).toHaveBeenCalledWith("check_staff_capacity", { p_hospital_id: "h1" });
    expect(check.max).toBe(20);
  });
});
