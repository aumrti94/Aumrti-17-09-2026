import React, { useState, useEffect, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  PatientPortalContext,
  type PatientSummary,
  type PortalHospital,
} from "@/hooks/usePatientPortal";

// Type-only re-export: existing importers keep working, and a type export does
// not trip react-refresh/only-export-components the way a value export does.
export type { PatientSummary, PortalHospital };

const STORAGE_KEY = "ppc_state_v1";

export const PatientPortalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [hospital, setHospital] = useState<PortalHospital | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setLoading(false); return; }

      const stored = sessionStorage.getItem(STORAGE_KEY);
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
            sessionStorage.removeItem(STORAGE_KEY);
          }
        } catch {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      }
      setLoading(false);
    })();
  }, []);

  const activate = (p: PatientSummary, h: PortalHospital) => {
    setPatient(p);
    setHospital(h);
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ patient: p, hospital: h }));
  };

  const logout = async () => {
    await supabase.auth.signOut();
    sessionStorage.removeItem(STORAGE_KEY);
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

