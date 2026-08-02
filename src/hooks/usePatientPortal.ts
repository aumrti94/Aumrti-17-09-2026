import { createContext, useContext } from "react";

/**
 * Split out of PatientPortalContext.tsx so that file exports only the Provider
 * component — a file mixing component and non-component exports silently
 * disables Fast Refresh for it.
 */
export interface PatientSummary {
  id: string;
  fullName: string;
  uhid: string;
  phone: string | null;
  email: string | null;
  dob: string | null;
  gender: string | null;
  bloodGroup: string | null;
  hospitalId: string;
}

export interface PortalHospital {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface PatientPortalContextValue {
  patientId: string | null;
  hospitalId: string | null;
  patient: PatientSummary | null;
  hospital: PortalHospital | null;
  loading: boolean;
  activate: (patient: PatientSummary, hospital: PortalHospital) => void;
  logout: () => Promise<void>;
}

export const PatientPortalContext = createContext<PatientPortalContextValue>({
  patientId: null,
  hospitalId: null,
  patient: null,
  hospital: null,
  loading: true,
  activate: () => {},
  logout: async () => {},
});

export const usePatientPortal = () => useContext(PatientPortalContext);
