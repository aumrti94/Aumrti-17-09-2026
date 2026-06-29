import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";

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

interface PatientPortalContextValue {
  patientId: string | null;
  hospitalId: string | null;
  patient: PatientSummary | null;
  hospital: PortalHospital | null;
  loading: boolean;
  activate: (patient: PatientSummary, hospital: PortalHospital) => void;
  logout: () => Promise<void>;
}

const PatientPortalContext = createContext<PatientPortalContextValue>({
  patientId: null,
  hospitalId: null,
  patient: null,
  hospital: null,
  loading: true,
  activate: () => {},
  logout: async () => {},
});

const STORAGE_KEY = "ppc_state_v1";

export const PatientPortalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [hospital, setHospital] = useState<PortalHospital | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as { patient: PatientSummary; hospital: PortalHospital };
          // Lightweight liveness check
          const { data } = await supabase
            .from("patients")
            .select("id")
            .eq("id", parsed.patient.id)
            .maybeSingle();
          if (data) {
            setPatient(parsed.patient);
            setHospital(parsed.hospital);
          } else {
            localStorage.removeItem(STORAGE_KEY);
          }
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const activate = (p: PatientSummary, h: PortalHospital) => {
    setPatient(p);
    setHospital(h);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: p, hospital: h }));
  };

  const logout = async () => {
    await supabase.auth.signOut();
    localStorage.removeItem(STORAGE_KEY);
    setPatient(null);
    setHospital(null);
  };

  return (
    <PatientPortalContext.Provider
      value={{
        patientId: patient?.id ?? null,
        hospitalId: hospital?.id ?? null,
        patient,
        hospital,
        loading,
        activate,
        logout,
      }}
    >
      {children}
    </PatientPortalContext.Provider>
  );
};

export const usePatientPortal = () => useContext(PatientPortalContext);
