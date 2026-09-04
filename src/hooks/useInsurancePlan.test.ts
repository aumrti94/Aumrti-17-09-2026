import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { InsurancePlanContext, useInsurancePlan } from "./useInsurancePlan";

describe("useInsurancePlan", () => {
  it("defaults to the manual plan tier with no hospital id outside a Provider", () => {
    const { result } = renderHook(() => useInsurancePlan());
    expect(result.current).toEqual({ planTier: "manual", hospitalId: null });
  });

  it("returns the value supplied by an InsurancePlanContext.Provider", () => {
    const value = { planTier: "tpa_integrated", hospitalId: "h1" };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(InsurancePlanContext.Provider, { value }, children);

    const { result } = renderHook(() => useInsurancePlan(), { wrapper });
    expect(result.current).toEqual(value);
  });
});
