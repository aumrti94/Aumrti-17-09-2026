import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { cn } from "@/lib/utils";
import { Home, Calendar, Activity } from "lucide-react";
import HomeCareActivePlansTab from "@/components/home-care/HomeCareActivePlansTab";
import HomeCareVisitTab from "@/components/home-care/HomeCareVisitTab";
import HomeTeleMonitoringTab from "@/components/home-care/HomeTeleMonitoringTab";

const navTabs = [
  { id: "plans", label: "Active Plans", icon: Home },
  { id: "visits", label: "Visit Schedule", icon: Calendar },
  { id: "tele", label: "Tele-Monitoring", icon: Activity },
];

const HomeCarePage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [activeTab, setActiveTab] = useState("plans");
  const [kpis, setKpis] = useState({ activePlans: 0, visitsToday: 0, overdue: 0, alerts: 0 });

  useEffect(() => {
    const load = async () => {
      if (!hospitalId) return;
      const today = new Date().toISOString().split("T")[0];
      const [planRes, visitTodayRes, overdueRes, alertRes] = await Promise.all([
        (supabase as any).from("home_care_plans").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("status", "active").eq("is_deleted", false),
        (supabase as any).from("home_care_visits").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("scheduled_date", today).eq("is_deleted", false),
        (supabase as any).from("home_care_visits").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).lt("scheduled_date", today).eq("status", "scheduled").eq("is_deleted", false),
        (supabase as any).from("home_tele_monitoring").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId).eq("alert_sent", false).eq("is_deleted", false).gte("reported_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
      ]);
      setKpis({ activePlans: planRes.count || 0, visitsToday: visitTodayRes.count || 0, overdue: overdueRes.count || 0, alerts: alertRes.count || 0 });
    };
    load();
  }, [hospitalId, activeTab]);

  const renderContent = () => {
    switch (activeTab) {
      case "plans": return <HomeCareActivePlansTab />;
      case "visits": return <HomeCareVisitTab />;
      case "tele": return <HomeTeleMonitoringTab />;
      default: return null;
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center gap-4 px-5">
        <span className="text-base font-bold text-foreground">🏠 Home Care</span>
        <div className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <span><span className="font-semibold text-foreground">{kpis.activePlans}</span> active plans</span>
          <span><span className="font-semibold text-foreground">{kpis.visitsToday}</span> visits today</span>
          {kpis.overdue > 0 && <span className="text-red-600 font-semibold">{kpis.overdue} overdue</span>}
          {kpis.alerts > 0 && <span className="text-amber-600 font-semibold">⚠️ {kpis.alerts} alerts</span>}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
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

export default HomeCarePage;
