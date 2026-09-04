import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { HospitalContext, useHospitalContext } from "./useHospitalContext";

describe("useHospitalContext", () => {
  it("returns the safe loading default when used outside a Provider", () => {
    const { result } = renderHook(() => useHospitalContext());
    expect(result.current).toEqual({
      hospitalId: null,
      userId: null,
      role: null,
      permissions: null,
      fullName: null,
      loading: true,
    });
  });

  it("returns the value supplied by a HospitalContext.Provider", () => {
    const value = {
      hospitalId: "h1",
      userId: "u1",
      role: "doctor",
      permissions: { billing: true },
      fullName: "Dr Rao",
      loading: false,
    };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(HospitalContext.Provider, { value }, children);

    const { result } = renderHook(() => useHospitalContext(), { wrapper });
    expect(result.current).toEqual(value);
  });
});
