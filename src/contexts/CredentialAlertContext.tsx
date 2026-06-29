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
    const in60 = new Date(today.getTime() + 60 * 86400000).toISOString().split("T")[0];

    const { data } = await (supabase as any)
      .from("staff_credentials")
      .select("id, user_id, credential_type, name, expiry_date, u:users!staff_credentials_user_id_fkey(full_name)")
      .eq("hospital_id", hospitalId)
      .not("expiry_date", "is", null)
      .lte("expiry_date", in60)
      .order("expiry_date", { ascending: true });

    const todayMs = today.getTime();
    const mapped: ExpiringCredential[] = (data || []).map((r: any) => ({
      id: r.id,
      user_id: r.user_id,
      staff_name: r.u?.full_name || "Unknown Staff",
      credential_type: r.credential_type,
      name: r.name,
      expiry_date: r.expiry_date,
      days_left: Math.ceil((new Date(r.expiry_date).getTime() - todayMs) / 86400000),
    }));

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
