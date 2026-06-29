import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { cn } from "@/lib/utils";
import { Ambulance, ClipboardCheck, Activity, Truck } from "lucide-react";
import DispatchTab from "@/components/ambulance/DispatchTab";
import EquipmentCheckTab from "@/components/ambulance/EquipmentCheckTab";
import TransitLogTab from "@/components/ambulance/TransitLogTab";
import FleetTab from "@/components/ambulance/FleetTab";

const navTabs = [
  { id: "dispatch", label: "Dispatch Board", icon: Ambulance },
  { id: "equipment", label: "Equipment Check", icon: ClipboardCheck },
  { id: "transit", label: "Transit Log", icon: Activity },
  { id: "fleet", label: "Fleet", icon: Truck },
];

const AmbulancePage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [activeTab, setActiveTab] = useState("dispatch");
  const [kpis, setKpis] = useState({ active: 0, vehicles: 0, checksToday: 0 });

  useEffect(() => {
    const load = async () => {
      if (!hospitalId) return;
      const today = new Date().toISOString().split("T")[0];
      const [activeRes, vehRes, checkRes] = await Promise.all([
        (supabase as any).from("ambulance_dispatches").select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId).eq("is_deleted", false)
          .in("status", ["dispatched", "en_route", "at_scene", "transporting"]),
        (supabase as any).from("ambulance_vehicles").select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId).eq("is_active", true).eq("is_deleted", false),
        (supabase as any).from("ambulance_equipment_checks").select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId).eq("check_date", today).eq("is_deleted", false),
      ]);
      setKpis({ active: activeRes.count || 0, vehicles: vehRes.count || 0, checksToday: checkRes.count || 0 });
    };
    load();
  }, [hospitalId, activeTab]);

  const renderContent = () => {
    switch (activeTab) {
      case "dispatch": return <DispatchTab />;
      case "equipment": return <EquipmentCheckTab />;
      case "transit": return <TransitLogTab />;
      case "fleet": return <FleetTab />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center gap-4 px-5">
        <span className="text-base font-bold text-foreground">🚑 Ambulance Service</span>
        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span><span className="font-semibold text-foreground">{kpis.active}</span> active calls</span>
          <span><span className="font-semibold text-foreground">{kpis.vehicles}</span> vehicles</span>
          <span><span className="font-semibold text-foreground">{kpis.checksToday}</span> checks today</span>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[200px] bg-card border-r border-border flex flex-col">
          {navTabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "h-11 flex items-center gap-3 px-4 text-sm transition-colors text-left",
                  activeTab === tab.id
                    ? "bg-primary/10 text-primary font-semibold border-r-2 border-primary"
                    : "text-muted-foreground hover:bg-muted/50"
                )}>
                <Icon className="h-4 w-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex-1 flex flex-col overflow-hidden">
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

export default AmbulancePage;
