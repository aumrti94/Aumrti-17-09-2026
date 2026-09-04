import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";

const { mockUseHospitalId, mockFrom } = vi.hoisted(() => ({
  mockUseHospitalId: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/hooks/useHospitalId", () => ({ useHospitalId: mockUseHospitalId }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { CredentialAlertProvider } from "./CredentialAlertContext";
import { useCredentialAlert } from "@/hooks/useCredentialAlert";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "not", "lte"]) p[m] = self;
  return p;
}

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(CredentialAlertProvider, null, children);

beforeEach(() => {
  mockUseHospitalId.mockReset();
  mockFrom.mockReset();
});

describe("CredentialAlertProvider", () => {
  it("does not fetch and reports zero credentials for a role outside HR/admin", async () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: "h1", role: "nurse" });
    const { result } = renderHook(() => useCredentialAlert(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.credentials).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("merges staff_credentials, staff_documents, and staff_profiles licenses, sorted by soonest expiry", async () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: "h1", role: "hr_manager" });
    const today = new Date();
    const in10 = new Date(today.getTime() + 10 * 86400000).toISOString().split("T")[0];
    const in5 = new Date(today.getTime() + 5 * 86400000).toISOString().split("T")[0];
    const in20 = new Date(today.getTime() + 20 * 86400000).toISOString().split("T")[0];

    mockFrom.mockImplementation((table: string) => {
      if (table === "staff_credentials") {
        return makeChain({ data: [{ id: "c1", user_id: "u1", credential_type: "Medical License", name: "MCI Reg", expiry_date: in10, u: { full_name: "Dr Rao" } }] });
      }
      if (table === "staff_documents") {
        return makeChain({ data: [{ id: "d1", user_id: "u2", doc_type: "fire_safety_cert", file_name: "cert.pdf", expiry_date: in5, u: { full_name: "Fire Officer" } }] });
      }
      if (table === "staff_profiles") {
        return makeChain({ data: [{ id: "p1", user_id: "u3", registration_body: "MCI", license_expiry_date: in20, u: null }] });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useCredentialAlert(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.expiringCount).toBe(3);
    expect(result.current.credentials.map((c) => c.id)).toEqual(["doc-d1", "c1", "lic-p1"]);
    expect(result.current.credentials[0].credential_type).toBe("Document: fire safety cert");
    expect(result.current.credentials.find((c) => c.id === "lic-p1")!.staff_name).toBe("Unknown Staff");
  });

  it("refresh() re-runs the fetch on demand", async () => {
    mockUseHospitalId.mockReturnValue({ hospitalId: "h1", role: "super_admin" });
    mockFrom.mockReturnValue(makeChain({ data: [] }));

    const { result } = renderHook(() => useCredentialAlert(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    const callsBefore = mockFrom.mock.calls.length;
    await act(async () => {
      await result.current.refresh();
    });
    expect(mockFrom.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
