/**
 * Insurance plan tier context, consumed by child tabs instead of each reloading
 * settings. Lifted out of InsurancePage.tsx so that file exports only its
 * component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it.
 */
import { createContext, useContext } from "react";

export interface InsurancePlanCtx {
  planTier:   string;
  hospitalId: string | null;
}

export const InsurancePlanContext = createContext<InsurancePlanCtx>({
  planTier: "manual", hospitalId: null,
});

export const useInsurancePlan = () => useContext(InsurancePlanContext);
