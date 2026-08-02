import { createContext, useContext } from "react";

/**
 * App shell sidebar state. Split out of SidebarContext.tsx so that file exports
 * only the Provider component — a file mixing component and non-component
 * exports silently disables Fast Refresh for it.
 *
 * NOTE: shadcn's src/components/ui/sidebar.tsx exports an unrelated hook of the
 * same name for its own primitive. They are not interchangeable.
 */
export interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}

export const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
});

export const useSidebar = () => useContext(SidebarContext);
