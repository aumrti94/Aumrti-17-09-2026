import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { ProductModeContext, useProductMode } from "./useProductMode";

describe("useProductMode", () => {
  it("defaults to hospital mode, not loading, outside a Provider", () => {
    const { result } = renderHook(() => useProductMode());
    expect(result.current.productMode).toBe("hospital");
    expect(result.current.loadingMode).toBe(false);
    expect(() => result.current.refreshMode()).not.toThrow();
  });

  it("returns the value supplied by a ProductModeContext.Provider", () => {
    const refreshMode = () => {};
    const value = { productMode: "platform", loadingMode: true, refreshMode };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(ProductModeContext.Provider, { value }, children);

    const { result } = renderHook(() => useProductMode(), { wrapper });
    expect(result.current).toEqual(value);
  });
});
