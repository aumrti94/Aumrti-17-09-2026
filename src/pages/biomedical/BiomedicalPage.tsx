import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Plus, AlertTriangle, Loader2 } from "lucide-react";
import EquipmentTab from "@/components/biomedical/EquipmentTab";
import MaintenanceTab from "@/components/biomedical/MaintenanceTab";
import CalibrationTab from "@/components/biomedical/CalibrationTab";
import BreakdownTab from "@/components/biomedical/BreakdownTab";
import AlertsTab from "@/components/biomedical/AlertsTab";
import ReportsTab from "@/components/biomedical/ReportsTab";
import PredictiveMaintenanceSection from "@/components/biomedical/PredictiveMaintenanceSection";
import AddEquipmentModal from "@/components/biomedical/AddEquipmentModal";
import ReportBreakdownModal from "@/components/biomedical/ReportBreakdownModal";

const BiomedicalPage: React.FC = () => {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const [tab, setTab] = useState("equipment");
  const [showAddEquipment, setShowAddEquipment] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);
  const [kpis, setKpis] = useState({ total: 0, operational: 0, maintenance: 0, pmOverdue: 0, amcExpiring: 0 });
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    if (!hospitalId) return;
    const load = async () => {
      const [eqRes, pmRes, amcRes] = await Promise.all([
        supabase.from("equipment_master").select("id, status", { count: "exact" }).eq("hospital_id", hospitalId).eq("is_active", true),
        supabase.from("pm_schedules").select("id", { count: "exact" }).eq("hospital_id", hospitalId).eq("status", "overdue"),
        supabase.from("amc_contracts").select("id", { count: "exact" }).eq("hospital_id", hospitalId).eq("is_active", true).lte("end_date", new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0]),
      ]);
      const eqData = eqRes.data || [];
      setKpis({
        total: eqData.length,
        operational: eqData.filter((e: any) => e.status === "operational").length,
        maintenance: eqData.filter((e: any) => ["under_maintenance", "breakdown"].includes(e.status)).length,
        pmOverdue: pmRes.count || 0,
        amcExpiring: amcRes.count || 0,
      });
    };
    load();
  }, [refreshKey, hospitalId]);

  const kpiCards = [
    { label: "Total Equipment", value: kpis.total, color: "text-foreground" },
    { label: "Operational", value: kpis.operational, color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "Under Maintenance", value: kpis.maintenance, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "PM Overdue", value: kpis.pmOverdue, color: "text-red-600", bg: "bg-red-50" },
    { label: "AMC Expiring (30d)", value: kpis.amcExpiring, color: "text-amber-600", bg: "bg-amber-50" },
  ];

  if (hospitalLoading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border shrink-0" style={{ height: 52 }}>
        <h1 className="text-base font-bold text-foreground">🔧 Biomedical Engineering</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowAddEquipment(true)}>
            <Plus size={14} className="mr-1" /> Add Equipment
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setShowBreakdown(true)}>
            <AlertTriangle size={14} className="mr-1" /> Report Breakdown
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-5 gap-3 px-5 py-3 shrink-0" style={{ height: 72 }}>
        {kpiCards.map((k) => (
          <div key={k.label} className={`rounded-lg border border-border px-3 py-2 ${k.bg || "bg-muted/30"}`}>
            <p className="text-[11px] text-muted-foreground">{k.label}</p>
            <p className={`text-lg font-bold font-mono ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 mx-5 w-fit">
          <TabsTrigger value="equipment">🖥 Equipment</TabsTrigger>
          <TabsTrigger value="maintenance">📅 Maintenance</TabsTrigger>
          <TabsTrigger value="calibration">🔬 Calibration</TabsTrigger>
          <TabsTrigger value="breakdowns">📋 Breakdowns</TabsTrigger>
          <TabsTrigger value="alerts">
            ⚠️ Alerts
            {(kpis.pmOverdue + kpis.amcExpiring) > 0 && (
              <Badge variant="destructive" className="ml-1 text-[10px] px-1.5 py-0">{kpis.pmOverdue + kpis.amcExpiring}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="predictive">🤖 AI Predictive</TabsTrigger>
          <TabsTrigger value="reports">📊 Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="equipment" className="flex-1 overflow-hidden m-0 px-5 pt-3">
          <EquipmentTab key={refreshKey} onRefresh={refresh} />
        </TabsContent>
        <TabsContent value="maintenance" className="flex-1 overflow-hidden m-0 px-5 pt-3">
          <MaintenanceTab key={refreshKey} onRefresh={refresh} />
        </TabsContent>
        <TabsContent value="calibration" className="flex-1 overflow-hidden m-0 px-5 pt-3">
          <CalibrationTab key={refreshKey} onRefresh={refresh} />
        </TabsContent>
        <TabsContent value="breakdowns" className="flex-1 overflow-hidden m-0 px-5 pt-3">
          <BreakdownTab key={refreshKey} onRefresh={refresh} />
        </TabsContent>
        <TabsContent value="alerts" className="flex-1 overflow-hidden m-0 px-5 pt-3">
          <AlertsTab key={refreshKey} onNavigate={setTab} />
        </TabsContent>
        <TabsContent value="predictive" className="flex-1 overflow-auto m-0 px-5 pt-3">
          <PredictiveMaintenanceSection />
        </TabsContent>
        <TabsContent value="reports" className="flex-1 overflow-hidden m-0 px-5 pt-3">
          <ReportsTab key={refreshKey} />
        </TabsContent>
      </Tabs>

      {showAddEquipment && (
        <AddEquipmentModal open={showAddEquipment} onClose={() => setShowAddEquipment(false)} onSaved={refresh} />
      )}
      {showBreakdown && (
        <ReportBreakdownModal open={showBreakdown} onClose={() => setShowBreakdown(false)} onSaved={() => { refresh(); setTab("breakdowns"); }} />
      )}
    </div>
  );
};

export default BiomedicalPage;
