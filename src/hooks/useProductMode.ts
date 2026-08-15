import { createContext, useContext } from "react";

/**
 * Split out of ProductModeContext.tsx so that file exports only the Provider
 * component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it.
 *
 * Module ACCESS no longer lives here. The Platform console (plan features +
 * hospital_feature_overrides) is the single source of truth for which modules a
 * hospital may open, resolved by useSubscriptionConfig. This context now only
 * carries the deployment's product mode and keeps the entitlement caches in sync
 * with Platform changes in real time.
 */
export interface ProductModeContextValue {
  productMode: string;
  loadingMode: boolean;
  refreshMode: () => void;
}

export const ProductModeContext = createContext<ProductModeContextValue>({
  productMode: "hospital",
  loadingMode: false,
  refreshMode: () => undefined,
});

export const useProductMode = () => useContext(ProductModeContext);
