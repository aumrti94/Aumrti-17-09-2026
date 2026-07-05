import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

const HR_ROLES = ["hr_manager", "super_admin", "hospital_admin"];

export interface ExpiringCredential {
  id: string;
  user_id: string;
  staff_name: string;
  credential_type: string;
  name: string | null;
  expiry_date: string;
  days_left: number;
}

interface ContextValue {
  expiringCount: number;
  credentials: ExpiringCredential[];
  loading: boolean;
  refresh: () => void;
}

const CredentialAlertContext = createContext<ContextValue>({
  expiringCount: 0,
  credentials: [],
  loading: false,
  refresh: () => {},
});

export const CredentialAlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { hospitalId, role } = useHospitalId();
  const [credentials, setCredentials] = useState<ExpiringCredential[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchCredentials = useCallback(async () => {
    if (!hospitalId || !role || !HR_ROLES.includes(role)) {
      setCredentials([]);
      return;
    }
    setLoading(true);
    const today = new Date();
    const todayMs = today.getTime();
    const in60 = new Date(todayMs + 60 * 86400000).toISOString().split("T")[0];

    // Pull expiring items from all three stores: staff_credentials (canonical),
    // the Document Vault, and the legacy license field on staff_profiles.
    const [credRes, docRes, licRes] = await Promise.all([
      (supabase as any)
        .from("staff_credentials")
        .select("id, user_id, credential_type, name, expiry_date, u:users!staff_credentials_user_id_fkey(full_name)")
        .eq("hospital_id", hospitalId).not("expiry_date", "is", null).lte("expiry_date", in60),
      (supabase as any)
        .from("staff_documents")
        .select("id, user_id, doc_type, file_name, expiry_date, u:users!staff_documents_user_id_fkey(full_name)")
        .eq("hospital_id", hospitalId).not("expiry_date", "is", null).lte("expiry_date", in60),
      (supabase as any)
        .from("staff_profiles")
        .select("id, user_id, registration_body, license_expiry_date, u:users!staff_profiles_user_id_fkey(full_name)")
        .eq("hospital_id", hospitalId).not("license_expiry_date", "is", null).lte("license_expiry_date", in60),
    ]);

    const daysLeft = (d: string) => Math.ceil((new Date(d).getTime() - todayMs) / 86400000);

    const mapped: ExpiringCredential[] = [
      ...(credRes.data || []).map((r: any) => ({
        id: r.id, user_id: r.user_id, staff_name: r.u?.full_name || "Unknown Staff",
        credential_type: r.credential_type, name: r.name, expiry_date: r.expiry_date, days_left: daysLeft(r.expiry_date),
      })),
      ...(docRes.data || []).map((r: any) => ({
        id: `doc-${r.id}`, user_id: r.user_id, staff_name: r.u?.full_name || "Unknown Staff",
        credential_type: `Document: ${String(r.doc_type || "").replace(/_/g, " ")}`, name: r.file_name, expiry_date: r.expiry_date, days_left: daysLeft(r.expiry_date),
      })),
      ...(licRes.data || []).map((r: any) => ({
        id: `lic-${r.id}`, user_id: r.user_id, staff_name: r.u?.full_name || "Unknown Staff",
        credential_type: "License", name: r.registration_body, expiry_date: r.license_expiry_date, days_left: daysLeft(r.license_expiry_date),
      })),
    ].sort((a, b) => a.days_left - b.days_left);

    setCredentials(mapped);
    setLoading(false);
  }, [hospitalId, role]);

  useEffect(() => { fetchCredentials(); }, [fetchCredentials]);

  return (
    <CredentialAlertContext.Provider
      value={{ expiringCount: credentials.length, credentials, loading, refresh: fetchCredentials }}
    >
      {children}
    </CredentialAlertContext.Provider>
  );
};

export const useCredentialAlert = () => useContext(CredentialAlertContext);
