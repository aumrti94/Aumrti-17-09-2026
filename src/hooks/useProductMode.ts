import { createContext, useContext } from "react";

/**
 * Split out of ProductModeContext.tsx so that file exports only the Provider
 * component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it.
 */
export interface ProductModeContextValue {
  productMode: string;
  enabledModules: string[] | null; // null = all modules (no config saved yet)
  loadingMode: boolean;
  isModuleEnabled: (key: string) => boolean;
  refreshMode: () => void;
}

export const ProductModeContext = createContext<ProductModeContextValue>({
  productMode: "hospital",
  enabledModules: null,
  loadingMode: false,
  isModuleEnabled: () => true,
  refreshMode: () => undefined,
});

export const useProductMode = () => useContext(ProductModeContext);
