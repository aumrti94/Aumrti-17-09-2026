import { createContext, useContext } from "react";

/**
 * Split out of HospitalContext.tsx so that file exports only the Provider
 * component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it.
 */
export interface HospitalContextValue {
  hospitalId: string | null;
  userId: string | null;
  role: string | null;
  permissions: Record<string, any> | null;
  fullName: string | null;
  loading: boolean;
}

export const HospitalContext = createContext<HospitalContextValue>({
  hospitalId: null,
  userId: null,
  role: null,
  permissions: null,
  fullName: null,
  loading: true,
});

export const useHospitalContext = (): HospitalContextValue => {
  return useContext(HospitalContext);
};
