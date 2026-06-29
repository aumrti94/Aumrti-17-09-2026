import React, { useState, useEffect } from "react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Monitor, CalendarDays, Users, ClipboardList, BarChart3, Plus } from "lucide-react";
import MachineBoardTab from "@/components/dialysis/MachineBoardTab";
import DialysisScheduleTab from "@/components/dialysis/DialysisScheduleTab";
import DialysisPatientsTab from "@/components/dialysis/DialysisPatientsTab";
import DialysisSessionsTab from "@/components/dialysis/DialysisSessionsTab";
import DialysisReportsTab from "@/components/dialysis/DialysisReportsTab";

interface KPIs {
  activePatients: number;
  todaySessions: number;
  missedThisWeek: number;
  lowKtv: number;
}

const DialysisPage: React.FC = () => {
  const [tab, setTab] = useState("machines");
  const [kpis, setKpis] = useState<KPIs>({ activePatients: 0, todaySessions: 0, missedThisWeek: 0, lowKtv: 0 });
  const [showRegister, setShowRegister] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);

  const fetchKpis = async () => {
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];

    const [pRes, sRes, mRes, kRes] = await Promise.all([
      (supabase as any).from("dialysis_patients").select("id", { count: "exact" }).eq("is_active", true),
      (supabase as any).from("dialysis_sessions").select("id", { count: "exact" }).eq("session_date", today),
      (supabase as any).from("dialysis_sessions").select("id", { count: "exact" }).eq("status", "missed").gte("session_date", weekAgo),
      (supabase as any).from("dialysis_sessions").select("id", { count: "exact" }).eq("status", "completed").lt("kt_v", 1.2).not("kt_v", "is", null),
    ]);

    setKpis({
      activePatients: pRes.count || 0,
      todaySessions: sRes.count || 0,
      missedThisWeek: mRes.count || 0,
      lowKtv: kRes.count || 0,
    });
  };

  useEffect(() => { fetchKpis(); }, []);

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      <div className="h-[52px] bg-background border-b border-border px-5 flex items-center justify-between shrink-0">
        <span className="text-base font-bold text-foreground">🫀 Dialysis Unit</span>
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/20">
            👤 {kpis.activePatients} Active Patients
          </span>
          <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-blue-100 text-blue-700 border-blue-200">
            🔵 {kpis.todaySessions} Sessions Today
          </span>
          {kpis.missedThisWeek > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200">
              ⚠️ {kpis.missedThisWeek} Missed This Week
            </span>
          )}
          {kpis.lowKtv > 0 && (
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full border bg-red-100 text-red-700 border-red-200">
              🩺 {kpis.lowKtv} Low Kt/V
            </span>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => { setShowRegister(true); setTab("patients"); }}>
            <Plus className="w-4 h-4 mr-1" /> Register Patient
          </Button>
          <Button size="sm" onClick={() => { setShowSchedule(true); setTab("schedule"); }}>
            <CalendarDays className="w-4 h-4 mr-1" /> Schedule Session
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="h-11 w-full justify-start rounded-none border-b border-border bg-muted/30 px-4 shrink-0">
          <TabsTrigger value="machines" className="gap-1.5"><Monitor className="w-4 h-4" /> Machine Board</TabsTrigger>
          <TabsTrigger value="schedule" className="gap-1.5"><CalendarDays className="w-4 h-4" /> Schedule</TabsTrigger>
          <TabsTrigger value="patients" className="gap-1.5"><Users className="w-4 h-4" /> Patients</TabsTrigger>
          <TabsTrigger value="sessions" className="gap-1.5"><ClipboardList className="w-4 h-4" /> Sessions</TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5"><BarChart3 className="w-4 h-4" /> Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="machines" className="flex-1 overflow-hidden m-0">
          <MachineBoardTab onRefresh={fetchKpis} />
        </TabsContent>
        <TabsContent value="schedule" className="flex-1 overflow-hidden m-0">
          <DialysisScheduleTab showSchedule={showSchedule} onCloseSchedule={() => setShowSchedule(false)} onRefresh={fetchKpis} />
        </TabsContent>
        <TabsContent value="patients" className="flex-1 overflow-hidden m-0">
          <DialysisPatientsTab showRegister={showRegister} onCloseRegister={() => setShowRegister(false)} onRefresh={fetchKpis} />
        </TabsContent>
        <TabsContent value="sessions" className="flex-1 overflow-hidden m-0">
          <DialysisSessionsTab />
        </TabsContent>
        <TabsContent value="reports" className="flex-1 overflow-hidden m-0">
          <DialysisReportsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default DialysisPage;
