import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import React from "react";

const { mockGetSession, mockFrom, mockSignOut } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockFrom: vi.fn(),
  mockSignOut: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mockGetSession, signOut: mockSignOut }, from: mockFrom },
}));

import { PatientPortalProvider } from "./PatientPortalContext";
import { usePatientPortal } from "@/hooks/usePatientPortal";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "maybeSingle"]) p[m] = self;
  return p;
}

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(PatientPortalProvider, null, children);

const patient = { id: "p1", fullName: "Jane Doe", uhid: "U1", phone: null, email: null, dob: null, gender: null, bloodGroup: null, hospitalId: "h1" };
const hospital = { id: "h1", name: "Aumrti General", logoUrl: null };

beforeEach(() => {
  mockGetSession.mockReset();
  mockFrom.mockReset();
  mockSignOut.mockReset();
  sessionStorage.clear();
});

describe("PatientPortalProvider", () => {
  it("finishes loading with no patient when there is no active session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => usePatientPortal(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.patient).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("restores a cached patient after confirming they still exist", async () => {
    sessionStorage.setItem("ppc_state_v1", JSON.stringify({ patient, hospital }));
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockFrom.mockReturnValue(makeChain({ data: { id: "p1" } }));

    const { result } = renderHook(() => usePatientPortal(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.patient?.fullName).toBe("Jane Doe");
    expect(result.current.patientId).toBe("p1");
  });

  it("discards a cached patient that no longer exists (liveness check fails)", async () => {
    sessionStorage.setItem("ppc_state_v1", JSON.stringify({ patient, hospital }));
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockFrom.mockReturnValue(makeChain({ data: null }));

    const { result } = renderHook(() => usePatientPortal(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.patient).toBeNull();
    expect(sessionStorage.getItem("ppc_state_v1")).toBeNull();
  });

  it("activate() sets the patient/hospital and persists them to sessionStorage", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => usePatientPortal(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.activate(patient, hospital));

    expect(result.current.patientId).toBe("p1");
    expect(result.current.hospitalId).toBe("h1");
    expect(JSON.parse(sessionStorage.getItem("ppc_state_v1")!).patient.fullName).toBe("Jane Doe");
  });

  it("logout() signs out, clears the persisted state, and resets patient/hospital to null", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockSignOut.mockResolvedValue({ error: null });
    const { result } = renderHook(() => usePatientPortal(), { wrapper });
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.activate(patient, hospital));

    await act(async () => {
      await result.current.logout();
    });

    expect(mockSignOut).toHaveBeenCalled();
    expect(result.current.patient).toBeNull();
    expect(sessionStorage.getItem("ppc_state_v1")).toBeNull();
  });
});
