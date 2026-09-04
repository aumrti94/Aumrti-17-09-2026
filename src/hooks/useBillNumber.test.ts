import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRpc } = vi.hoisted(() => ({ mockRpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: mockRpc } }));

import { generateBillNumber } from "./useBillNumber";

beforeEach(() => mockRpc.mockReset());

describe("generateBillNumber", () => {
  it("returns the RPC-generated bill number, defaulting the prefix to BILL", async () => {
    mockRpc.mockResolvedValue({ data: "BILL-20260824-0001", error: null });
    expect(await generateBillNumber("h1")).toBe("BILL-20260824-0001");
    expect(mockRpc).toHaveBeenCalledWith("generate_bill_number", { p_hospital_id: "h1", p_prefix: "BILL" });
  });

  it("passes through a custom prefix", async () => {
    mockRpc.mockResolvedValue({ data: "OPD-20260824-0007", error: null });
    await generateBillNumber("h1", "OPD");
    expect(mockRpc).toHaveBeenCalledWith("generate_bill_number", { p_hospital_id: "h1", p_prefix: "OPD" });
  });

  it("throws with the underlying error message rather than returning an undefined number", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "sequence exhausted" } });
    await expect(generateBillNumber("h1")).rejects.toThrow("sequence exhausted");
  });
});
