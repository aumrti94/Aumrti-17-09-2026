import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { CredentialAlertContext, useCredentialAlert } from "./useCredentialAlert";

describe("useCredentialAlert", () => {
  it("returns the safe default context when used outside a Provider", () => {
    const { result } = renderHook(() => useCredentialAlert());
    expect(result.current).toEqual({ expiringCount: 0, credentials: [], loading: false, refresh: expect.any(Function) });
  });

  it("returns the value supplied by a CredentialAlertContext.Provider", () => {
    const value = {
      expiringCount: 3,
      credentials: [{ id: "c1", user_id: "u1", staff_name: "Dr Rao", credential_type: "Medical License", name: null, expiry_date: "2026-09-01", days_left: 5 }],
      loading: false,
      refresh: () => {},
    };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(CredentialAlertContext.Provider, { value }, children);

    const { result } = renderHook(() => useCredentialAlert(), { wrapper });
    expect(result.current.expiringCount).toBe(3);
    expect(result.current.credentials).toHaveLength(1);
  });
});
