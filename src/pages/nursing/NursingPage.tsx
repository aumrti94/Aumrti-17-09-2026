import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useHospitalContext } from "@/contexts/HospitalContext";
import { hasTabAccess } from "@/lib/tabPermissions";
import { Button } from "@/components/ui/button";
import { ClipboardPlus, ListChecks, ClipboardList, LayoutDashboard, Tv, X as XIcon, Droplets, ShieldAlert, Monitor, RefreshCw, AlertTriangle, Activity } from "lucide-react";
import { getNEWS2BadgeClasses, calculateNEWS2 } from "@/lib/news2";
import NursingTaskList from "@/components/nursing/NursingTaskList";
import NursingTaskExecution from "@/components/nursing/NursingTaskExecution";
import MARAdherenceMonitor from "@/components/nursing/MARAdherenceMonitor";
import UnacknowledgedAlertsPanel from "@/components/nursing/UnacknowledgedAlertsPanel";
import NursingProcedureModal from "@/components/nursing/NursingProcedureModal";
import CarePlansTab from "@/components/nursing/CarePlansTab";
import IOChartTab from "@/components/nursing/IOChartTab";
import RestraintRecordsTab from "@/components/nursing/RestraintRecordsTab";
import FallRiskAssessmentForm from "@/components/nursing/FallRiskAssessmentForm";
import { cn } from "@/lib/utils";
import { DndContext, DragEndEvent, closestCenter } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

const NURSING_TAB_DEFS: {
  key: "tasks" | "kanban" | "care_plans" | "io" | "restraints" | "icu_monitor" | "risk_assessments";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { key: "tasks", label: "Tasks", icon: ListChecks },
  { key: "kanban", label: "Kanban", icon: LayoutDashboard },
  { key: "care_plans", label: "Care Plans", icon: ClipboardList },
  { key: "io", label: "I&O Chart", icon: Droplets },
  { key: "restraints", label: "Restraints", icon: ShieldAlert },
  { key: "icu_monitor", label: "ICU Monitor", icon: Monitor },
  { key: "risk_assessments", label: "Risk Assess", icon: Activity },
];

export interface NursingTask {
  id: string;
  type: "medication" | "vitals" | "handover";
  patientName: string;
  patientId: string;
  admissionId: string;
  bedLabel: string;
  wardName: string;
  wardId: string;
  scheduledTime: string; // HH:MM
  scheduledDate: string;
  status: "overdue" | "due_now" | "upcoming" | "done";
  // medication-specific
  medicationId?: string;
  drugName?: string;
  dose?: string;
  route?: string;
  frequency?: string;
  instructions?: string;
  isNdps?: boolean;
  // vitals-specific
  diagnosis?: string;
  doctorName?: string;
  hospitalId?: string;
}

function getCurrentShift(): { label: string; type: string } {
  const h = new Date().getHours();
  if (h >= 6 && h < 14) return { label: "Morning Shift", type: "morning" };
  if (h >= 14 && h < 22) return { label: "Evening Shift", type: "evening" };
  return { label: "Night Shift", type: "night" };
}

function getNextShift(current: string): string {
  if (current === "morning") return "evening";
  if (current === "evening") return "night";
  return "morning";
}

function taskStatus(scheduledTime: string): "overdue" | "due_now" | "upcoming" {
  const now = new Date();
  const [h, m] = scheduledTime.split(":").map(Number);
  const sched = new Date();
  sched.setHours(h, m, 0, 0);
  const diffMin = (sched.getTime() - now.getTime()) / 60000;
  if (diffMin < -30) return "overdue";
  if (diffMin <= 60) return "due_now";
  return "upcoming";
}

// Vitals schedule by bed category (NABH standard monitoring frequencies)
function getVitalTimes(bedCategory?: string): string[] {
  switch (bedCategory) {
    case "icu":
    case "sicu":
    case "picu":
    case "nicu":
      // 1-hour intervals: 6 times across a shift visible window
      return ["06:00","07:00","08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00","20:00","21:00","22:00","23:00"];
    case "hdu":
      // 2-hour intervals
      return ["06:00","08:00","10:00","12:00","14:00","16:00","18:00","20:00","22:00"];
    case "isolation":
      // 4-hour intervals
      return ["06:00","10:00","14:00","18:00","22:00"];
    default:
      // General / semi_private / private — 6-hour intervals
      return ["06:00","12:00","18:00","00:00"];
  }
}

// Generate standard medication times from frequency
function getScheduledTimes(frequency: string): string[] {
  const map: Record<string, string[]> = {
    OD: ["08:00"],
    BD: ["08:00", "20:00"],
    TDS: ["08:00", "14:00", "20:00"],
    QID: ["06:00", "12:00", "18:00", "22:00"],
    HS: ["22:00"],
    STAT: ["08:00"],
    SOS: [],
    AC: ["07:30", "13:30", "19:30"],
    PC: ["08:30", "14:30", "20:30"],
  };
  return map[frequency?.toUpperCase()] || ["08:00"];
}

const TYPE_ICON: Record<string, string> = { medication: "💊", vitals: "🫀", handover: "🔄" };

const TV_STATUS_STYLE: Record<string, { bg: string; border: string; badge: string }> = {
  overdue:  { bg: "bg-red-950",   border: "border-red-600",   badge: "bg-red-600 text-white" },
  due_now:  { bg: "bg-amber-950", border: "border-amber-500", badge: "bg-amber-500 text-white" },
  upcoming: { bg: "bg-blue-950",  border: "border-blue-500",  badge: "bg-blue-500 text-white" },
  done:     { bg: "bg-green-950", border: "border-green-600", badge: "bg-green-600 text-white" },
};

const NursingTVMode: React.FC<{ tasks: NursingTask[]; shift: { label: string; type: string }; onClose: () => void }> = ({ tasks, shift, onClose }) => {
  const [clock, setClock] = React.useState(new Date());
  React.useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(t);
  }, []);

  const cols = [
    { status: "overdue",  label: "⚠ Overdue" },
    { status: "due_now",  label: "⏰ Due Now" },
    { status: "upcoming", label: "📋 Upcoming" },
    { status: "done",     label: "✓ Done" },
  ] as const;

  return (
    <div className="fixed inset-0 z-[500] bg-gray-950 flex flex-col text-white">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 bg-gray-900 border-b border-gray-800 shrink-0">
        <div className="flex items-center gap-4">
          <span className="text-2xl font-bold tracking-wide">🏥 Ward Nursing Board</span>
          <span className="text-lg text-gray-400 font-medium">{shift.label}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xl font-mono text-gray-300">
            {clock.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
          </span>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors">
            <XIcon className="h-6 w-6" />
          </button>
        </div>
      </div>

      {/* Kanban columns */}
      <div className="flex flex-1 gap-4 p-4 overflow-hidden">
        {cols.map((col) => {
          const colTasks = tasks.filter((t) => t.status === col.status);
          const style = TV_STATUS_STYLE[col.status];
          return (
            <div key={col.status} className={cn("flex flex-col flex-1 rounded-2xl border-2 overflow-hidden", style.border, style.bg)}>
              <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                <span className="text-lg font-bold">{col.label}</span>
                <span className={cn("text-sm font-bold px-3 py-0.5 rounded-full", style.badge)}>{colTasks.length}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {colTasks.length === 0 && (
                  <p className="text-gray-500 text-sm text-center py-6">No tasks</p>
                )}
                {colTasks.map((task) => (
                  <div key={task.id} className="bg-black/30 border border-white/10 rounded-xl p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xl">{TYPE_ICON[task.type] || "📋"}</span>
                      <span className="text-base font-bold truncate">{task.patientName}</span>
                    </div>
                    <p className="text-sm text-gray-400">{task.bedLabel}</p>
                    {task.drugName && <p className="text-sm text-gray-300 truncate">{task.drugName} {task.dose}</p>}
                    <p className="text-sm font-mono text-gray-400 mt-1">{task.scheduledTime}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer stats */}
      <div className="shrink-0 px-6 py-2 bg-gray-900 border-t border-gray-800 flex items-center gap-6 text-sm text-gray-400">
        <span>Total: <strong className="text-white">{tasks.length}</strong> tasks</span>
        <span>Overdue: <strong className="text-red-400">{tasks.filter(t => t.status === "overdue").length}</strong></span>
        <span>Due Now: <strong className="text-amber-400">{tasks.filter(t => t.status === "due_now").length}</strong></span>
        <span>Done: <strong className="text-green-400">{tasks.filter(t => t.status === "done").length}</strong></span>
        <span className="ml-auto text-xs">Auto-refreshes every 5 min · Press Esc to close</span>
      </div>
    </div>
  );
};

const KANBAN_COLS = [
  { status: "overdue",  label: "Overdue",  colBg: "bg-red-50",   headBg: "bg-red-100",   headText: "text-red-700",   dot: "bg-red-500" },
  { status: "due_now",  label: "Due Now",  colBg: "bg-amber-50", headBg: "bg-amber-100", headText: "text-amber-700", dot: "bg-amber-500" },
  { status: "upcoming", label: "Upcoming", colBg: "bg-blue-50",  headBg: "bg-blue-100",  headText: "text-blue-700",  dot: "bg-blue-400" },
  { status: "done",     label: "Done",     colBg: "bg-green-50", headBg: "bg-green-100", headText: "text-green-700", dot: "bg-green-500" },
] as const;

const SortableTaskCard: React.FC<{ task: NursingTask }> = ({ task }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      className={cn(
        "bg-background border border-border/60 rounded-lg p-2 shadow-sm cursor-grab active:cursor-grabbing select-none",
        isDragging && "opacity-50 ring-2 ring-primary"
      )}
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{TYPE_ICON[task.type] || "📋"}</span>
        <span className="text-xs font-semibold truncate">{task.patientName}</span>
      </div>
      <p className="text-[11px] text-muted-foreground">{task.bedLabel}</p>
      {task.drugName && <p className="text-[11px] text-muted-foreground truncate">{task.drugName} {task.dose}</p>}
      <p className="text-[10px] font-mono text-muted-foreground mt-1">{task.scheduledTime}</p>
    </div>
  );
};

const NursingKanbanView: React.FC<{ tasks: NursingTask[]; loading: boolean; onTaskDone: (task: NursingTask) => void }> = ({ tasks, loading, onTaskDone }) => {
  const [pendingTask, setPendingTask] = useState<NursingTask | null>(null);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const targetCol = over.id as string;
    if (targetCol !== "done") return;
    const task = tasks.find(t => t.id === active.id);
    if (!task || task.status === "done") return;
    setPendingTask(task);
  };

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Loading tasks…</div>
  );

  return (
    <>
      <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 h-full overflow-x-auto px-3 py-2">
          {KANBAN_COLS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.status);
            return (
              <SortableContext key={col.status} items={colTasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
                <div
                  id={col.status}
                  className={cn("flex flex-col min-w-[200px] flex-1 rounded-xl border overflow-hidden", col.colBg)}
                >
                  <div className={cn("flex items-center gap-2 px-3 py-2 border-b", col.headBg)}>
                    <span className={cn("h-2 w-2 rounded-full shrink-0", col.dot)} />
                    <span className={cn("text-xs font-bold", col.headText)}>{col.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground font-semibold">{colTasks.length}</span>
                  </div>
                  <div className="flex-1 overflow-y-auto p-2 space-y-2">
                    {colTasks.length === 0 && (
                      <p className="text-[11px] text-muted-foreground text-center py-4">
                        {col.status === "done" ? "Drag tasks here to mark done" : "No tasks"}
                      </p>
                    )}
                    {colTasks.map((task) => (
                      <SortableTaskCard key={task.id} task={task} />
                    ))}
                  </div>
                </div>
              </SortableContext>
            );
          })}
        </div>
      </DndContext>

      {/* Confirm dialog */}
      {pendingTask && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border border-border rounded-xl p-6 max-w-sm w-full shadow-xl">
            <h3 className="text-sm font-bold mb-2">Mark as Given?</h3>
            <p className="text-xs text-muted-foreground mb-1">
              <strong>{pendingTask.drugName || "Task"}</strong> for <strong>{pendingTask.patientName}</strong>
            </p>
            <p className="text-xs text-muted-foreground mb-4">Scheduled: {pendingTask.scheduledTime}</p>
            <div className="flex gap-2 justify-end">
              <Button size="sm" variant="outline" onClick={() => setPendingTask(null)}>Cancel</Button>
              <Button size="sm" onClick={() => { onTaskDone(pendingTask); setPendingTask(null); }}>Confirm — Mark Given</Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

// ── ICU Monitor ─────────────────────────────────────────────────────────────

interface ICUPatientRow {
  admissionId: string;
  patientName: string;
  bedLabel: string;
  wardName: string;
  bedCategory: string;
  vitals: {
    bp_systolic: number | null;
    bp_diastolic: number | null;
    pulse: number | null;
    respiratory_rate: number | null;
    spo2: number | null;
    temperature: number | null;
    gcs_total: number | null;
    news2_score: number | null;
    mews_score: number | null;
    on_supplemental_o2: boolean;
    recorded_at: string | null;
  } | null;
  qsofa: number;
}

function calcQSOFASimple(v: ICUPatientRow["vitals"]): number {
  if (!v) return 0;
  return (
    (v.gcs_total !== null && v.gcs_total < 15 ? 1 : 0) +
    (v.respiratory_rate !== null && v.respiratory_rate >= 22 ? 1 : 0) +
    (v.bp_systolic !== null && v.bp_systolic <= 100 ? 1 : 0)
  );
}

const ICUMonitor: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const [patients, setPatients] = React.useState<ICUPatientRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [lastRefresh, setLastRefresh] = React.useState(new Date());

  const ICU_BED_CATEGORIES = ["icu", "sicu", "picu", "nicu", "hdu"];

  const fetchICU = React.useCallback(async () => {
    setLoading(true);
    const { data: admissions } = await supabase
      .from("admissions")
      .select(`
        id, patient_id,
        patients!admissions_patient_id_fkey(full_name),
        beds!admissions_bed_id_fkey(bed_number, bed_category),
        wards!admissions_ward_id_fkey(name)
      `)
      .eq("status", "active")
      .in("beds.bed_category" as any, ICU_BED_CATEGORIES);

    if (!admissions || admissions.length === 0) { setPatients([]); setLoading(false); return; }

    const admIds = admissions.map((a: any) => a.id);

    const { data: vitalsData } = await (supabase as any)
      .from("nursing_vitals")
      .select("admission_id, bp_systolic, bp_diastolic, pulse, respiratory_rate, spo2, temperature, gcs_total, news2_score, mews_score, on_supplemental_o2, recorded_at")
      .in("admission_id", admIds)
      .order("recorded_at", { ascending: false });

    // Keep only latest vitals per admission
    const latestVitals: Record<string, any> = {};
    for (const v of (vitalsData || [])) {
      if (!latestVitals[v.admission_id]) latestVitals[v.admission_id] = v;
    }

    const rows: ICUPatientRow[] = (admissions as any[])
      .filter((a: any) => ICU_BED_CATEGORIES.includes(a.beds?.bed_category || ""))
      .map((a: any) => {
        const v = latestVitals[a.id] || null;
        return {
          admissionId: a.id,
          patientName: a.patients?.full_name || "Unknown",
          bedLabel: `${a.wards?.name || "—"}-${a.beds?.bed_number || "?"}`,
          wardName: a.wards?.name || "—",
          bedCategory: a.beds?.bed_category || "icu",
          vitals: v,
          qsofa: calcQSOFASimple(v),
        };
      })
      .sort((a, b) => {
        // Sort by alert level: qSOFA desc, then NEWS2 desc
        const aScore = (a.vitals?.news2_score ?? 0) + a.qsofa * 3;
        const bScore = (b.vitals?.news2_score ?? 0) + b.qsofa * 3;
        return bScore - aScore;
      });

    setPatients(rows);
    setLastRefresh(new Date());
    setLoading(false);
  }, [hospitalId]);

  React.useEffect(() => { fetchICU(); }, [fetchICU]);

  // Auto-refresh every 5 minutes
  React.useEffect(() => {
    const iv = setInterval(fetchICU, 5 * 60 * 1000);
    return () => clearInterval(iv);
  }, [fetchICU]);

  // Supabase realtime for nursing_vitals
  React.useEffect(() => {
    const ch = supabase.channel("icu-vitals-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "nursing_vitals" }, () => fetchICU())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchICU]);

  const alertLevel = (row: ICUPatientRow) => {
    const news2 = row.vitals?.news2_score ?? 0;
    if (row.qsofa >= 2 || news2 >= 7) return "critical";
    if (news2 >= 5) return "high";
    if (news2 >= 3) return "medium";
    return "low";
  };

  const ALERT_STYLES = {
    critical: "border-red-500 bg-red-50 dark:bg-red-950/20",
    high:     "border-orange-400 bg-orange-50 dark:bg-orange-950/20",
    medium:   "border-amber-300 bg-amber-50 dark:bg-amber-950/10",
    low:      "border-border bg-card",
  };
  const ALERT_HEADER = {
    critical: "bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-200",
    high:     "bg-orange-100 dark:bg-orange-950/40 text-orange-800 dark:text-orange-200",
    medium:   "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200",
    low:      "bg-muted/50 text-muted-foreground",
  };

  const fmtVital = (v: number | null, unit = "") => v !== null ? `${v}${unit}` : "—";

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card shrink-0">
        <div>
          <p className="text-sm font-bold">ICU Monitor</p>
          <p className="text-xs text-muted-foreground">
            {patients.length} patient{patients.length !== 1 ? "s" : ""} · Last refresh: {lastRefresh.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} · Auto-refreshes every 5 min
          </p>
        </div>
        <button
          onClick={fetchICU}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-1.5 border-b bg-muted/20 text-[10px] text-muted-foreground shrink-0">
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-200 border border-red-400 inline-block" /> Critical (qSOFA≥2 / NEWS2≥7)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-orange-200 border border-orange-400 inline-block" /> High (NEWS2 5–6)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-100 border border-amber-300 inline-block" /> Medium (NEWS2 3–4)</span>
        <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-card border border-border inline-block" /> Low</span>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <p className="text-center py-12 text-muted-foreground text-sm">Loading ICU patients…</p>
        ) : patients.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Monitor className="h-10 w-10 mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm font-medium">No ICU/HDU patients found</p>
            <p className="text-xs mt-1">Patients admitted to ICU, SICU, PICU, NICU, or HDU beds will appear here</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {patients.map(row => {
              const level = alertLevel(row);
              const v = row.vitals;
              const minsAgo = v?.recorded_at
                ? Math.round((Date.now() - new Date(v.recorded_at).getTime()) / 60000)
                : null;
              return (
                <div key={row.admissionId} className={cn("rounded-lg border-2 overflow-hidden", ALERT_STYLES[level])}>
                  {/* Card header */}
                  <div className={cn("px-3 py-2 flex items-start justify-between", ALERT_HEADER[level])}>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{row.patientName}</p>
                      <p className="text-[10px] font-medium">{row.bedLabel}</p>
                    </div>
                    <div className="flex gap-1 flex-shrink-0 ml-2">
                      {v?.news2_score !== null && v?.news2_score !== undefined && (
                        <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded", getNEWS2BadgeClasses(v.news2_score))}>
                          N2:{v.news2_score}
                        </span>
                      )}
                      {row.qsofa >= 2 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-600 text-white">
                          qSOFA {row.qsofa}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Vitals grid */}
                  {v ? (
                    <div className="px-3 py-2 grid grid-cols-3 gap-1 text-[11px]">
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase font-bold">BP</p>
                        <p className={cn("font-mono font-medium",
                          v.bp_systolic !== null && v.bp_systolic <= 100 ? "text-red-600" :
                          v.bp_systolic !== null && v.bp_systolic > 180 ? "text-amber-600" : "text-foreground")}>
                          {v.bp_systolic && v.bp_diastolic ? `${v.bp_systolic}/${v.bp_diastolic}` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase font-bold">HR</p>
                        <p className={cn("font-mono font-medium",
                          v.pulse !== null && (v.pulse < 40 || v.pulse > 130) ? "text-red-600" : "text-foreground")}>
                          {fmtVital(v.pulse)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase font-bold">SpO₂</p>
                        <p className={cn("font-mono font-medium",
                          v.spo2 !== null && v.spo2 < 90 ? "text-red-600 animate-pulse" :
                          v.spo2 !== null && v.spo2 < 95 ? "text-amber-600" : "text-foreground")}>
                          {v.spo2 != null ? `${v.spo2}%` : "—"}
                          {v.on_supplemental_o2 && <span className="text-[9px] text-blue-500 ml-0.5">O₂</span>}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase font-bold">RR</p>
                        <p className={cn("font-mono font-medium",
                          v.respiratory_rate !== null && v.respiratory_rate >= 22 ? "text-red-600" :
                          v.respiratory_rate !== null && v.respiratory_rate <= 8 ? "text-red-600" : "text-foreground")}>
                          {fmtVital(v.respiratory_rate)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase font-bold">Temp</p>
                        <p className={cn("font-mono font-medium",
                          v.temperature !== null && (v.temperature > 38.5 || v.temperature < 35) ? "text-red-600" : "text-foreground")}>
                          {v.temperature != null ? `${v.temperature}°` : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[9px] text-muted-foreground uppercase font-bold">GCS</p>
                        <p className={cn("font-mono font-medium",
                          v.gcs_total !== null && v.gcs_total < 9 ? "text-red-600" :
                          v.gcs_total !== null && v.gcs_total < 15 ? "text-amber-600" : "text-foreground")}>
                          {fmtVital(v.gcs_total, "/15")}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <p className="px-3 py-3 text-[11px] text-muted-foreground italic">No vitals recorded yet</p>
                  )}

                  {/* Footer: MEWS + time */}
                  <div className="px-3 pb-2 flex items-center justify-between">
                    {v?.mews_score != null && (
                      <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-bold",
                        v.mews_score >= 5 ? "bg-red-100 text-red-700" :
                        v.mews_score >= 3 ? "bg-amber-100 text-amber-700" : "bg-green-100 text-green-700")}>
                        MEWS {v.mews_score}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground ml-auto">
                      {minsAgo !== null ? (minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ago`) : "No vitals"}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── NursingPage ──────────────────────────────────────────────────────────────
const NursingPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const { permissions, role } = useHospitalContext();
  const [tasks, setTasks] = useState<NursingTask[]>([]);
  const [selectedTask, setSelectedTask] = useState<NursingTask | null>(null);
  const [loading, setLoading] = useState(true);
  const [wards, setWards] = useState<{ id: string; name: string }[]>([]);
  const [selectedWard, setSelectedWard] = useState<string>("all");
  const [filter, setFilter] = useState<string>("all");
  const [showProcedureModal, setShowProcedureModal] = useState(false);
  const [activeTab, setActiveTab] = useState<"tasks" | "kanban" | "care_plans" | "io" | "restraints" | "icu_monitor" | "risk_assessments">("tasks");

  // If a super_admin restricts the currently-active tab for this role, fall back to the first
  // tab still allowed rather than leaving the UI stuck on a tab whose trigger just disappeared.
  useEffect(() => {
    const allowed = NURSING_TAB_DEFS.filter((t) => hasTabAccess("nursing", t.key, permissions, role));
    if (allowed.length > 0 && !allowed.some((t) => t.key === activeTab)) {
      setActiveTab(allowed[0].key);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [permissions, role]);
  const [selectedRiskPatient, setSelectedRiskPatient] = useState<{ patientId: string; admissionId?: string; patientName: string } | null>(null);
  const [selectedIOAdmission, setSelectedIOAdmission] = useState<{ admissionId: string; patientName: string } | null>(null);
  const [selectedRestraintAdmission, setSelectedRestraintAdmission] = useState<{ admissionId: string; patientName: string } | null>(null);
  const [tvMode, setTvMode] = useState(false);
  const shift = getCurrentShift();

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    const today = new Date().toISOString().slice(0, 10);

    // Get active admissions with patient + bed + ward info
    let admQuery = supabase
      .from("admissions")
      .select(`
        id, patient_id, bed_id, ward_id, admitting_diagnosis, hospital_id,
        patients!admissions_patient_id_fkey(full_name),
        beds!admissions_bed_id_fkey(bed_number, bed_category),
        wards!admissions_ward_id_fkey(id, name),
        users!admissions_admitting_doctor_id_fkey(full_name)
      `)
      .eq("status", "active");

    if (selectedWard !== "all") {
      admQuery = admQuery.eq("ward_id", selectedWard);
    }

    const { data: admissions, error: admErr } = await admQuery;
    if (admErr) {
      toast({ title: "Error loading admissions", variant: "destructive" });
      setLoading(false);
      return;
    }

    if (!admissions || admissions.length === 0) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const admIds = admissions.map((a: any) => a.id);

    // Fetch active medications + existing MAR records + recent vitals in parallel
    const [medsRes, marRes, vitalsRes] = await Promise.all([
      supabase.from("ipd_medications").select("*").in("admission_id", admIds).eq("is_active", true),
      supabase.from("nursing_mar").select("medication_id, scheduled_time, outcome").in("admission_id", admIds).eq("scheduled_date", today),
      supabase.from("ipd_vitals").select("admission_id, recorded_at").in("admission_id", admIds).order("recorded_at", { ascending: false }).limit(admIds.length * 3),
    ]);

    const marDone = new Set(
      (marRes.data || [])
        .filter((m: any) => m.outcome !== "pending")
        .map((m: any) => `${m.medication_id}_${m.scheduled_time}`)
    );

    const lastVitals: Record<string, string> = {};
    (vitalsRes.data || []).forEach((v: any) => {
      if (!lastVitals[v.admission_id]) lastVitals[v.admission_id] = v.recorded_at;
    });

    const generatedTasks: NursingTask[] = [];

    for (const adm of admissions as any[]) {
      const patientName = adm.patients?.full_name || "Unknown";
      const bedNumber = adm.beds?.bed_number || "?";
      const wardName = adm.wards?.name || "?";
      const wardId = adm.wards?.id || adm.ward_id;
      const doctorName = adm.users?.full_name || "";

      // Medication tasks
      const admMeds = (medsRes.data || []).filter((m: any) => m.admission_id === adm.id);
      for (const med of admMeds) {
        const times = getScheduledTimes(med.frequency || "OD");
        for (const t of times) {
          const key = `${med.id}_${t}`;
          const done = marDone.has(key);
          generatedTasks.push({
            id: `med_${med.id}_${t}`,
            type: "medication",
            patientName,
            patientId: adm.patient_id,
            admissionId: adm.id,
            bedLabel: `${wardName}-${bedNumber}`,
            wardName,
            wardId,
            scheduledTime: t,
            scheduledDate: today,
            status: done ? "done" : taskStatus(t),
            medicationId: med.id,
            drugName: med.drug_name,
            dose: med.dose,
            route: med.route,
            frequency: med.frequency,
            isNdps: false,
            hospitalId: adm.hospital_id,
          });
        }
      }

      // Vitals tasks — frequency depends on bed category (ICU=1h, HDU=2h, isolation=4h, general=6h)
      const vitalTimes = getVitalTimes(adm.beds?.bed_category);
      const lastRecorded = lastVitals[adm.id];
      const hoursSinceVitals = lastRecorded
        ? (Date.now() - new Date(lastRecorded).getTime()) / 3600000
        : 999;

      for (const t of vitalTimes) {
        const [h] = t.split(":").map(Number);
        const now = new Date();
        const schedTime = new Date();
        schedTime.setHours(h, 0, 0, 0);
        // Only show vitals tasks for current shift range roughly
        const diffH = (schedTime.getTime() - now.getTime()) / 3600000;
        if (diffH < -4 || diffH > 8) continue;

        const done = hoursSinceVitals < 2 && taskStatus(t) !== "upcoming";
        generatedTasks.push({
          id: `vitals_${adm.id}_${t}`,
          type: "vitals",
          patientName,
          patientId: adm.patient_id,
          admissionId: adm.id,
          bedLabel: `${wardName}-${bedNumber}`,
          wardName,
          wardId,
          scheduledTime: t,
          scheduledDate: today,
          status: done ? "done" : taskStatus(t),
          diagnosis: adm.admitting_diagnosis,
          doctorName,
          hospitalId: adm.hospital_id,
        });
      }
    }

    // Handover task — 30 min before shift end
    const shiftEndHours: Record<string, number> = { morning: 14, evening: 22, night: 6 };
    const endH = shiftEndHours[shift.type];
    const now = new Date();
    const endTime = new Date();
    endTime.setHours(endH, 0, 0, 0);
    if (shift.type === "night" && now.getHours() >= 22) {
      endTime.setDate(endTime.getDate() + 1);
    }
    const minsToEnd = (endTime.getTime() - now.getTime()) / 60000;

    if (minsToEnd <= 60 && minsToEnd > -60) {
      const handoverTime = `${String(endH).padStart(2, "0")}:00`;
      generatedTasks.push({
        id: "handover_" + shift.type,
        type: "handover",
        patientName: "All Patients",
        patientId: "",
        admissionId: "",
        bedLabel: "",
        wardName: selectedWard === "all" ? "All Wards" : wards.find((w) => w.id === selectedWard)?.name || "",
        wardId: selectedWard,
        scheduledTime: handoverTime,
        scheduledDate: today,
        status: minsToEnd <= 0 ? "overdue" : "due_now",
        hospitalId: admissions[0]?.hospital_id,
      });
    }

    // Sort: overdue first, then due_now, then upcoming, then done
    const order = { overdue: 0, due_now: 1, upcoming: 2, done: 3 };
    generatedTasks.sort((a, b) => order[a.status] - order[b.status] || a.scheduledTime.localeCompare(b.scheduledTime));

    setTasks(generatedTasks);
    setLoading(false);
  }, [selectedWard, shift.type, toast, wards]);

  // Fetch wards
  useEffect(() => {
    supabase
      .from("wards")
      .select("id, name")
      .eq("is_active", true)
      .then(({ data }) => setWards(data || []));
  }, []);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleTaskComplete = () => {
    fetchTasks();
    // Auto-advance to next pending task
    const nextPending = tasks.find((t) => t.id !== selectedTask?.id && t.status !== "done");
    setSelectedTask(nextPending || null);
  };

  const handleKanbanTaskDone = async (task: NursingTask) => {
    if (!task.medicationId || !task.hospitalId) return;
    const today = new Date().toISOString().slice(0, 10);
    await supabase.from("nursing_mar").upsert({
      hospital_id: task.hospitalId,
      admission_id: task.admissionId,
      medication_id: task.medicationId,
      scheduled_date: today,
      scheduled_time: task.scheduledTime,
      outcome: "given",
      administered_at: new Date().toISOString(),
    } as any, { onConflict: "admission_id,medication_id,scheduled_date,scheduled_time" });
    toast({ title: `${task.drugName || "Medication"} marked as given for ${task.patientName}` });
    fetchTasks();
  };

  const filteredTasks = tasks.filter((t) => {
    if (filter === "all") return true;
    if (filter === "overdue") return t.status === "overdue";
    if (filter === "due_now") return t.status === "due_now";
    if (filter === "upcoming") return t.status === "upcoming";
    if (filter === "done") return t.status === "done";
    return true;
  });

  const stats = {
    overdue: tasks.filter((t) => t.status === "overdue").length,
    due_now: tasks.filter((t) => t.status === "due_now").length,
    upcoming: tasks.filter((t) => t.status === "upcoming").length,
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setTvMode(false); };
    if (tvMode) window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tvMode]);

  // NEWS2 / sepsis rapid-response push — listens to clinical_alerts INSERT
  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase
      .channel("clinical-alerts-nursing")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "clinical_alerts" }, (payload) => {
        const alert = payload.new as {
          hospital_id: string;
          alert_type: string;
          alert_message: string;
          severity: string;
          ward_name: string | null;
          bed_number: string | null;
          is_acknowledged: boolean;
        };
        if (alert.hospital_id !== hospitalId || alert.is_acknowledged) return;
        const isSepsis =
          alert.alert_type?.toLowerCase().includes("sepsis") ||
          alert.alert_type?.toLowerCase().includes("news2");
        toast({
          title: `🚨 ${isSepsis ? "SEPSIS RISK — Rapid Response Required" : "Clinical Alert"}${alert.ward_name ? ` · ${alert.ward_name}` : ""}${alert.bed_number ? ` Bed ${alert.bed_number}` : ""}`,
          description: alert.alert_message,
          variant: "destructive",
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [hospitalId, toast]);

  return (
    <div className="h-full flex flex-col overflow-hidden bg-background">
      {tvMode && <NursingTVMode tasks={tasks} shift={shift} onClose={() => setTvMode(false)} />}
      {/* Top tabs + Procedure button */}
      <div className="flex items-center px-4 py-1.5 border-b shrink-0 gap-1">
        {NURSING_TAB_DEFS.filter((t) => hasTabAccess("nursing", t.key, permissions, role)).map((t) => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              "h-8 px-3 rounded-md text-xs font-semibold flex items-center gap-1.5 transition-colors",
              activeTab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            <t.icon className="h-3.5 w-3.5" /> {t.label}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setTvMode(true)} title="Ward TV Display">
            <Tv className="h-4 w-4" />
          </Button>
          <Button size="sm" onClick={() => setShowProcedureModal(true)}>
            <ClipboardPlus className="h-4 w-4 mr-1" /> Log Procedure
          </Button>
        </div>
      </div>
      <UnacknowledgedAlertsPanel hospitalId={hospitalId} />
      {activeTab === "tasks" && (
        <MARAdherenceMonitor
          overdueTasks={tasks.filter((t) => t.status === "overdue" && t.type === "medication")}
          hospitalId={hospitalId}
        />
      )}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === "tasks" ? (
          <>
            <NursingTaskList
              tasks={filteredTasks}
              loading={loading}
              selectedTaskId={selectedTask?.id || null}
              onSelectTask={setSelectedTask}
              shift={shift}
              wards={wards}
              selectedWard={selectedWard}
              onWardChange={setSelectedWard}
              filter={filter}
              onFilterChange={setFilter}
              stats={stats}
            />
            <NursingTaskExecution
              task={selectedTask}
              shift={shift}
              wards={wards}
              onComplete={handleTaskComplete}
            />
          </>
        ) : activeTab === "kanban" ? (
          <NursingKanbanView tasks={tasks} loading={loading} onTaskDone={handleKanbanTaskDone} />
        ) : activeTab === "care_plans" ? (
          hospitalId && <CarePlansTab hospitalId={hospitalId} />
        ) : activeTab === "io" ? (
          <div className="flex flex-1 overflow-hidden">
            {/* Patient list */}
            <div className="w-52 border-r overflow-y-auto shrink-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase px-3 py-2 border-b">Select Patient</p>
              {(() => {
                const seen = new Set<string>();
                const unique = tasks.filter(t => t.admissionId && !seen.has(t.admissionId) && seen.add(t.admissionId));
                if (unique.length === 0) return <p className="text-xs text-muted-foreground px-3 py-4">No active admissions</p>;
                return unique.map(t => (
                  <button
                    key={t.admissionId}
                    onClick={() => setSelectedIOAdmission({ admissionId: t.admissionId, patientName: t.patientName })}
                    className={cn(
                      "w-full text-left px-3 py-2 border-b text-xs hover:bg-muted transition-colors",
                      selectedIOAdmission?.admissionId === t.admissionId && "bg-primary/10 font-semibold"
                    )}
                  >
                    <p className="truncate font-medium">{t.patientName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{t.bedLabel}</p>
                  </button>
                ));
              })()}
            </div>
            {/* I/O Chart */}
            <div className="flex-1 overflow-y-auto">
              {selectedIOAdmission && hospitalId ? (
                <IOChartTab admissionId={selectedIOAdmission.admissionId} hospitalId={hospitalId} />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Select a patient to view I&O chart
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "restraints" ? (
          <div className="flex flex-1 overflow-hidden">
            {/* Patient list */}
            <div className="w-52 border-r overflow-y-auto shrink-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase px-3 py-2 border-b">Select Patient</p>
              {(() => {
                const seen = new Set<string>();
                const unique = tasks.filter(t => t.admissionId && !seen.has(t.admissionId) && seen.add(t.admissionId));
                if (unique.length === 0) return <p className="text-xs text-muted-foreground px-3 py-4">No active admissions</p>;
                return unique.map(t => (
                  <button
                    key={t.admissionId}
                    onClick={() => setSelectedRestraintAdmission({ admissionId: t.admissionId, patientName: t.patientName })}
                    className={cn(
                      "w-full text-left px-3 py-2 border-b text-xs hover:bg-muted transition-colors",
                      selectedRestraintAdmission?.admissionId === t.admissionId && "bg-primary/10 font-semibold"
                    )}
                  >
                    <p className="truncate font-medium">{t.patientName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{t.bedLabel}</p>
                  </button>
                ));
              })()}
            </div>
            {/* Restraint records */}
            <div className="flex-1 overflow-y-auto">
              {selectedRestraintAdmission && hospitalId ? (
                <RestraintRecordsTab
                  admissionId={selectedRestraintAdmission.admissionId}
                  hospitalId={hospitalId}
                  patientName={selectedRestraintAdmission.patientName}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Select a patient to view restraint records
                </div>
              )}
            </div>
          </div>
        ) : activeTab === "icu_monitor" ? (
          hospitalId ? <ICUMonitor hospitalId={hospitalId} /> : (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Hospital context not available
            </div>
          )
        ) : activeTab === "risk_assessments" ? (
          <div className="flex flex-1 overflow-hidden">
            {/* Patient list */}
            <div className="w-52 border-r overflow-y-auto shrink-0">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase px-3 py-2 border-b">Select Patient</p>
              {(() => {
                const seen = new Set<string>();
                const unique = tasks.filter(t => t.patientId && !seen.has(t.patientId) && seen.add(t.patientId));
                if (unique.length === 0) return <p className="text-xs text-muted-foreground px-3 py-4">No active patients</p>;
                return unique.map(t => (
                  <button
                    key={t.patientId}
                    onClick={() => setSelectedRiskPatient({ patientId: t.patientId, admissionId: t.admissionId, patientName: t.patientName })}
                    className={cn(
                      "w-full text-left px-3 py-2 border-b text-xs hover:bg-muted transition-colors",
                      selectedRiskPatient?.patientId === t.patientId && "bg-primary/10 font-semibold"
                    )}
                  >
                    <p className="truncate font-medium">{t.patientName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{t.bedLabel}</p>
                  </button>
                ));
              })()}
            </div>
            {/* Risk Assessment Form */}
            <div className="flex-1 overflow-y-auto p-5">
              {selectedRiskPatient && hospitalId ? (
                <FallRiskAssessmentForm
                  patientId={selectedRiskPatient.patientId}
                  admissionId={selectedRiskPatient.admissionId}
                  hospitalId={hospitalId}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
                  Select a patient to assess fall risk (Morse Fall Scale)
                </div>
              )}
            </div>
          </div>
        ) : null}
      </div>
      {showProcedureModal && hospitalId && (
        <NursingProcedureModal
          open={showProcedureModal}
          onClose={() => setShowProcedureModal(false)}
          hospitalId={hospitalId}
        />
      )}
    </div>
  );
};

export default NursingPage;
