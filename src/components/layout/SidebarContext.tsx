import React, { createContext, useContext, useState, useEffect, useCallback } from "react";

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
  toggle: () => void;
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
  toggle: () => {},
  mobileOpen: false,
  setMobileOpen: () => {},
});

export const useSidebar = () => useContext(SidebarContext);

const STORAGE_KEY = "aumrti_sidebar_collapsed";

function readStorage(): boolean {
  try { return localStorage.getItem(STORAGE_KEY) === "true"; } catch { return false; }
}
function writeStorage(v: boolean) {
  try { localStorage.setItem(STORAGE_KEY, String(v)); } catch { /* ignore */ }
}

export const SidebarProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [collapsed, setCollapsedState] = useState<boolean>(readStorage);
  const [mobileOpen, setMobileOpen] = useState(false);

  const setCollapsed = useCallback((v: boolean) => {
    setCollapsedState(v);
    writeStorage(v);
  }, []);

  const toggle = useCallback(() => {
    setCollapsedState((prev) => {
      const next = !prev;
      writeStorage(next);
      return next;
    });
  }, []);

  // Auto-collapse on small/medium screens; restore preference on wide screens
  useEffect(() => {
    const handleResize = () => {
      const wide = window.innerWidth >= 1280;
      if (!wide) {
        setCollapsedState(true); // force collapsed but DON'T write to storage
      } else {
        setCollapsedState(readStorage()); // restore user's saved preference
      }
    };

    handleResize(); // run once on mount
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle, mobileOpen, setMobileOpen }}>
      {children}
    </SidebarContext.Provider>
  );
};
