import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ClipboardList, Trash2, BedDouble, CalendarDays, BarChart3, Plus, Clock } from "lucide-react";
import HousekeepingTasksTab from "@/components/housekeeping/TasksTab";
import BMWLogTab from "@/components/housekeeping/BMWLogTab";
import LinenTab from "@/components/housekeeping/LinenTab";
import SchedulesTab from "@/components/housekeeping/SchedulesTab";
import HousekeepingReportsTab from "@/components/housekeeping/ReportsTab";
import NewTaskModal from "@/components/housekeeping/NewTaskModal";
import BMWEntryModal from "@/components/housekeeping/BMWEntryModal";

const HousekeepingPage: React.FC = () => {
  const [tab, setTab] = useState("tasks");
  const [showNewTask, setShowNewTask] = useState(false);
  const [showBMW, setShowBMW] = useState(false);
  const [kpis, setKpis] = useState({ pending: 0, inProgress: 0, bedsCleaning: 0, avgTat: 0 });
  const [hospitalId, setHospitalId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const { data: u } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
      const hid = u?.hospital_id;
      if (!hid) return;
      setHospitalId(hid);

      const today = new Date().toISOString().split("T")[0];

      const [pending, inProg, beds, tatRes] = await Promise.all([
        supabase.from("housekeeping_tasks").select("id", { count: "exact", head: true }).eq("hospital_id", hid).eq("status", "pending"),
        supabase.from("housekeeping_tasks").select("id", { count: "exact", head: true }).eq("hospital_id", hid).eq("status", "in_progress"),
        supabase.from("beds").select("id", { count: "exact", head: true }).eq("hospital_id", hid).eq("status", "cleaning" as any),
        supabase.from("housekeeping_tasks").select("tat_minutes").eq("hospital_id", hid).eq("status", "completed").gte("completed_at", today),
      ]);

      const tatArr = (tatRes.data || []).filter((r: any) => r.tat_minutes).map((r: any) => r.tat_minutes);
      const avgTat = tatArr.length > 0 ? Math.round(tatArr.reduce((a: number, b: number) => a + b, 0) / tatArr.length) : 0;

      setKpis({
        pending: pending.count || 0,
        inProgress: inProg.count || 0,
        bedsCleaning: beds.count || 0,
        avgTat,
      });
    };
    load();
  }, [tab]);

  const kpiCards = [
    { label: "Pending Tasks", value: kpis.pending, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "In Progress", value: kpis.inProgress, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Beds Cleaning", value: kpis.bedsCleaning, color: "text-amber-600", bg: "bg-amber-50" },
    { label: "Avg TAT Today", value: kpis.avgTat ? `${kpis.avgTat} min` : "—", color: "text-emerald-600", bg: "bg-emerald-50" },
  ];

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card" style={{ height: 52 }}>
        <h1 className="text-base font-bold text-foreground">🧹 Housekeeping & Facility</h1>
        <div className="flex gap-2">
          <Button size="sm" className="h-8 text-xs" onClick={() => setShowNewTask(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Task
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setShowBMW(true)}>
            <ClipboardList className="h-3.5 w-3.5 mr-1" /> BMW Entry
          </Button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-4 gap-3 px-4 py-2" style={{ height: 72 }}>
        {kpiCards.map((k) => (
          <div key={k.label} className={`${k.bg} rounded-lg p-3 flex flex-col justify-center`}>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">{k.label}</p>
            <p className={`text-xl font-bold ${k.color} font-mono`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={setTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="mx-4 mb-0 w-fit" style={{ height: 44 }}>
          <TabsTrigger value="tasks" className="text-xs gap-1"><ClipboardList className="h-3.5 w-3.5" /> Tasks</TabsTrigger>
          <TabsTrigger value="bmw" className="text-xs gap-1"><Trash2 className="h-3.5 w-3.5" /> BMW Log</TabsTrigger>
          <TabsTrigger value="linen" className="text-xs gap-1"><BedDouble className="h-3.5 w-3.5" /> Linen</TabsTrigger>
          <TabsTrigger value="schedules" className="text-xs gap-1"><CalendarDays className="h-3.5 w-3.5" /> Schedules</TabsTrigger>
          <TabsTrigger value="reports" className="text-xs gap-1"><BarChart3 className="h-3.5 w-3.5" /> Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="tasks" className="flex-1 min-h-0 overflow-hidden m-0 px-4 py-2">
          <HousekeepingTasksTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="bmw" className="flex-1 min-h-0 overflow-hidden m-0 px-4 py-2">
          <BMWLogTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="linen" className="flex-1 min-h-0 overflow-hidden m-0 px-4 py-2">
          <LinenTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="schedules" className="flex-1 min-h-0 overflow-hidden m-0 px-4 py-2">
          <SchedulesTab hospitalId={hospitalId} />
        </TabsContent>
        <TabsContent value="reports" className="flex-1 min-h-0 overflow-hidden m-0 px-4 py-2">
          <HousekeepingReportsTab hospitalId={hospitalId} />
        </TabsContent>
      </Tabs>

      {showNewTask && hospitalId && <NewTaskModal hospitalId={hospitalId} onClose={() => setShowNewTask(false)} />}
      {showBMW && hospitalId && <BMWEntryModal hospitalId={hospitalId} onClose={() => setShowBMW(false)} />}
    </div>
  );
};

export default HousekeepingPage;
