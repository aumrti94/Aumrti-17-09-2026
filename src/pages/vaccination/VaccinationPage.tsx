import React, { useState, useEffect, useCallback } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GatedTabsTrigger, GatedAction } from "@/components/access/GatedTabsTrigger";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { toast } from "sonner";
import PatientCardTab from "@/components/vaccination/PatientCardTab";
import DueListTab from "@/components/vaccination/DueListTab";
import RecordVaccineTab from "@/components/vaccination/RecordVaccineTab";
import ColdChainTab from "@/components/vaccination/ColdChainTab";
import CampsTab from "@/components/vaccination/CampsTab";
import StockTab from "@/components/vaccination/StockTab";
import AdultImmunizationTab from "@/components/vaccination/AdultImmunizationTab";
import VaccineCatalogueTab from "@/components/vaccination/VaccineCatalogueTab";
import { Syringe, AlertTriangle, CalendarClock, Thermometer, Loader2 } from "lucide-react";

const VaccinationPage: React.FC = () => {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const [tab, setTab] = useState("patient-card");
  const [givenToday, setGivenToday] = useState(0);
  const [overdueCount, setOverdueCount] = useState(0);
  const [dueWeek, setDueWeek] = useState(0);
  const [coldChainStatus, setColdChainStatus] = useState<{ temp: number | null; ok: boolean }>({ temp: null, ok: true });
  const [showRecordModal, setShowRecordModal] = useState(false);
  const [showCampModal, setShowCampModal] = useState(false);


  const loadKPIs = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];
    const weekLater = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

    const [givenRes, overdueRes, weekRes, coldRes] = await Promise.all([
      supabase.from("vaccination_records").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).gte("administered_at", today).lte("administered_at", today),
      supabase.from("vaccination_due").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).in("status", ["overdue"]).lt("due_date", today),
      supabase.from("vaccination_due").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("status", "due").lte("due_date", weekLater),
      supabase.from("cold_chain_log").select("temperature_c, alert_triggered")
        .eq("hospital_id", hospitalId).order("recorded_at", { ascending: false }).limit(1),
    ]);

    setGivenToday(givenRes.count || 0);
    setOverdueCount(overdueRes.count || 0);
    setDueWeek(weekRes.count || 0);
    if (coldRes.data && coldRes.data.length > 0) {
      const t = Number(coldRes.data[0].temperature_c);
      setColdChainStatus({ temp: t, ok: t >= 2 && t <= 8 });
    }
  }, [hospitalId]);

  useEffect(() => {
    loadKPIs();
  }, [loadKPIs]);

  if (hospitalLoading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-[52px] border-b bg-background shrink-0">
        <h1 className="text-base font-bold flex items-center gap-2">
          <span>💉</span> Vaccination & Immunization
        </h1>
        <div className="flex items-center gap-2">
          <GatedAction module="vaccination" action="record_vaccine">
            <Button size="sm" onClick={() => { setTab("record"); setShowRecordModal(true); }}>
              <Syringe className="h-4 w-4 mr-1" /> Record Vaccine
            </Button>
          </GatedAction>
          <GatedAction module="vaccination" action="plan_camp">
            <Button size="sm" variant="outline" onClick={() => { setTab("camps"); setShowCampModal(true); }}>
              + Plan Camp
            </Button>
          </GatedAction>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-3 shrink-0">
        <Card className="p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
            <Syringe className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Given Today</p>
            <p className="text-xl font-bold font-mono">{givenToday}</p>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p className="text-xl font-bold font-mono text-destructive">{overdueCount}</p>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <CalendarClock className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Due This Week</p>
            <p className="text-xl font-bold font-mono text-amber-600">{dueWeek}</p>
          </div>
        </Card>
        <Card className="p-3 flex items-center gap-3">
          <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${coldChainStatus.ok ? "bg-emerald-500/10" : "bg-destructive/10"}`}>
            <Thermometer className={`h-5 w-5 ${coldChainStatus.ok ? "text-emerald-600" : "text-destructive"}`} />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cold Chain</p>
            {coldChainStatus.temp !== null ? (
              <p className={`text-xl font-bold font-mono ${coldChainStatus.ok ? "text-emerald-600" : "text-destructive"}`}>
                {coldChainStatus.temp}°C
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </div>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden px-4">
        <TabsList className="w-fit shrink-0 mb-2">
          <GatedTabsTrigger module="vaccination" value="patient-card">👤 Patient Card</GatedTabsTrigger>
          <GatedTabsTrigger module="vaccination" value="due-list">📅 Due List</GatedTabsTrigger>
          <GatedTabsTrigger module="vaccination" value="record">💉 Record Vaccine</GatedTabsTrigger>
          <GatedTabsTrigger module="vaccination" value="cold-chain">🧊 Cold Chain</GatedTabsTrigger>
          <GatedTabsTrigger module="vaccination" value="camps">🏕️ Camps</GatedTabsTrigger>
          <GatedTabsTrigger module="vaccination" value="stock">📦 Stock</GatedTabsTrigger>
          <GatedTabsTrigger module="vaccination" value="adult-schedule">🧑 Adult Schedule</GatedTabsTrigger>
          <GatedTabsTrigger module="vaccination" value="catalogue">➕ Add Vaccine</GatedTabsTrigger>
        </TabsList>

        <TabsContent value="patient-card" className="flex-1 overflow-auto mt-0">
          <PatientCardTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="due-list" className="flex-1 overflow-auto mt-0">
          <DueListTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="record" className="flex-1 overflow-auto mt-0">
          <RecordVaccineTab hospitalId={hospitalId} onRecorded={loadKPIs} />
        </TabsContent>
        <TabsContent value="cold-chain" className="flex-1 overflow-auto mt-0">
          <ColdChainTab hospitalId={hospitalId} onLogged={loadKPIs} />
        </TabsContent>
        <TabsContent value="camps" className="flex-1 overflow-auto mt-0">
          <CampsTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="stock" className="flex-1 overflow-auto mt-0">
          <StockTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="adult-schedule" className="flex-1 overflow-auto mt-0">
          <AdultImmunizationTab />
        </TabsContent>
        <TabsContent value="catalogue" className="flex-1 overflow-auto mt-0">
          <VaccineCatalogueTab hospitalId={hospitalId} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default VaccinationPage;
