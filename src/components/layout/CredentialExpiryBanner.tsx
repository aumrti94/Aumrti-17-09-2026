import React, { useEffect, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useNavigate } from "react-router-dom";

interface ExpiredItem {
  id: string;
  name: string | null;
  credential_type: string;
  expiry_date: string;
}

const MEDICAL_ROLES = ["doctor", "nurse", "lab_technician", "lab_tech", "radiologist", "pharmacist"];

const CredentialExpiryBanner: React.FC = () => {
  const { userId, role } = useHospitalId();
  const navigate = useNavigate();
  const [items, setItems] = useState<ExpiredItem[]>([]);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!userId || !role || !MEDICAL_ROLES.includes(role)) return;

    const sessionKey = `cred_banner_dismissed_${userId}`;
    if (sessionStorage.getItem(sessionKey)) {
      setDismissed(true);
      return;
    }

    const check = async () => {
      const today = new Date().toISOString().split("T")[0];
      const { data } = await (supabase as any)
        .from("staff_credentials")
        .select("id, name, credential_type, expiry_date")
        .eq("user_id", userId)
        .not("expiry_date", "is", null)
        .lte("expiry_date", today)
        .limit(3);
      if (data && data.length > 0) setItems(data);
    };
    check();
  }, [userId, role]);

  if (dismissed || items.length === 0) return null;

  const handleDismiss = () => {
    const sessionKey = `cred_banner_dismissed_${userId}`;
    sessionStorage.setItem(sessionKey, "1");
    setDismissed(true);
  };

  const typeLabel = (type: string) => {
    const map: Record<string, string> = {
      mci_nmc: "MCI/NMC Registration",
      state_medical_council: "State Medical Council",
      nursing_council: "Nursing Council",
      super_specialty: "Super Specialty Degree",
      skill_competency: "Skill Competency",
      bls_acls: "BLS/ACLS",
    };
    return map[type] || type;
  };

  return (
    <div className="fixed top-14 left-0 right-0 z-40 pointer-events-none">
      <div className="pointer-events-auto mx-auto max-w-2xl mt-2 px-4">
        <div className="flex items-start gap-3 rounded-lg border border-red-300 bg-red-50 dark:bg-red-950/60 px-4 py-3 shadow-md backdrop-blur">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-red-800 dark:text-red-200">
              Your credential{items.length > 1 ? "s have" : " has"} expired — please update your records
            </p>
            <ul className="mt-0.5 space-y-px">
              {items.map(item => (
                <li key={item.id} className="text-[11px] text-red-700 dark:text-red-300">
                  {item.name ? `${item.name} (${typeLabel(item.credential_type)})` : typeLabel(item.credential_type)}
                  {" · "}Expired {new Date(item.expiry_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                </li>
              ))}
            </ul>
          </div>
          <button
            onClick={() => navigate("/hr")}
            className="shrink-0 text-[11px] font-medium text-red-700 dark:text-red-300 underline hover:no-underline"
          >
            Update
          </button>
          <button onClick={handleDismiss} className="shrink-0 text-red-500 hover:text-red-700 dark:text-red-400">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default CredentialExpiryBanner;
