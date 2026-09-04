import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import React from "react";
import { SidebarContext, useSidebar } from "./useSidebar";

describe("useSidebar", () => {
  it("returns the default (collapsed:false) context when used outside a Provider", () => {
    const { result } = renderHook(() => useSidebar());
    expect(result.current.collapsed).toBe(false);
    expect(result.current.mobileOpen).toBe(false);
  });

  it("returns the value supplied by a SidebarContext.Provider", () => {
    const value = { collapsed: true, setCollapsed: () => {}, toggle: () => {}, mobileOpen: true, setMobileOpen: () => {} };
    const wrapper = ({ children }: { children: React.ReactNode }) =>
      React.createElement(SidebarContext.Provider, { value }, children);

    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.collapsed).toBe(true);
    expect(result.current.mobileOpen).toBe(true);
  });
});
