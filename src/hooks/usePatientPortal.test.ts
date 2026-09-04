import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { PatientPortalContext, usePatientPortal } from "./usePatientPortal";

describe("usePatientPortal", () => {
  it("returns the safe loading default outside a Provider", () => {
    const { result } = renderHook(() => usePatientPortal());
    expect(result.current.patientId).toBeNull();
    expect(result.current.hospitalId).toBeNull();
    expect(result.current.patient).toBeNull();
    expect(result.current.hospital).toBeNull();
    expect(result.current.loading).toBe(true);
  });

  it("default activate()/logout() are safe no-ops", async () => {
    const { result } = renderHook(() => usePatientPortal());
    expect(() => result.current.activate({} as any, {} as any)).not.toThrow();
    await expect(result.current.logout()).resolves.toBeUndefined();
  });

  it("returns the value supplied by a PatientPortalContext.Provider", () => {
    const value = {
      patientId: "p1",
      hospitalId: "h1",
      patient: { id: "p1", fullName: "Jane Doe", uhid: "U1", phone: null, email: null, dob: null, gender: null, bloodGroup: null, hospitalId: "h1" },
      hospital: { id: "h1", name: "Aumrti General", logoUrl: null },
      loading: false,
      activate: () => {},
      logout: async () => {},
    };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(PatientPortalContext.Provider, { value }, children);

    const { result } = renderHook(() => usePatientPortal(), { wrapper });
    expect(result.current.patient?.fullName).toBe("Jane Doe");
    expect(result.current.loading).toBe(false);
  });
});
