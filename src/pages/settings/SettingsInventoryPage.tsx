import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import StoreLocationsSettings from "@/components/inventory/StoreLocationsSettings";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";

const SettingsInventoryPage: React.FC = () => {
  const navigate = useNavigate();
  const [hospitalId, setHospitalId] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc("get_user_hospital_id").then(({ data }) => { if (data) setHospitalId(data); });
  }, []);

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 flex items-center gap-3 px-6 border-b border-border bg-card">
        <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="text-sm font-bold text-foreground">Inventory Settings</h1>
          <p className="text-[11px] text-muted-foreground">Store locations and sub-store configuration</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {hospitalId ? (
          <StoreLocationsSettings hospitalId={hospitalId} />
        ) : (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsInventoryPage;
