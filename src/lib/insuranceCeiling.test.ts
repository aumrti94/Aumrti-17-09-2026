import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { fetchPreAuthCeiling } from "./insuranceCeiling";

function preAuthChain(data: unknown) {
  return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data }) }) }) }) }) }) }) };
}

beforeEach(() => mockFrom.mockReset());

describe("fetchPreAuthCeiling", () => {
  it("returns the most-recent approved pre-auth ceiling", async () => {
    mockFrom.mockReturnValue(
      preAuthChain({ id: "pa1", approved_amount: 150000, pre_auth_number: "PA-2026-001", tpa_name: "Star Health" }),
    );
    const result = await fetchPreAuthCeiling("adm-1", "h1");
    expect(result).toEqual({ ceiling: 150000, preAuthId: "pa1", preAuthNumber: "PA-2026-001", tpaName: "Star Health" });
  });

  it("returns null when there is no approved pre-auth — a non-insurance/self-pay bill", async () => {
    mockFrom.mockReturnValue(preAuthChain(null));
    expect(await fetchPreAuthCeiling("adm-1", "h1")).toBeNull();
  });

  it("returns null when the approved row has no approved_amount recorded", async () => {
    mockFrom.mockReturnValue(preAuthChain({ id: "pa1", approved_amount: null, pre_auth_number: null, tpa_name: null }));
    expect(await fetchPreAuthCeiling("adm-1", "h1")).toBeNull();
  });

  it("defaults an unnamed TPA / missing pre-auth number to null rather than undefined", async () => {
    mockFrom.mockReturnValue(preAuthChain({ id: "pa1", approved_amount: 50000 }));
    const result = await fetchPreAuthCeiling("adm-1", "h1");
    expect(result).toEqual({ ceiling: 50000, preAuthId: "pa1", preAuthNumber: null, tpaName: null });
  });
});
