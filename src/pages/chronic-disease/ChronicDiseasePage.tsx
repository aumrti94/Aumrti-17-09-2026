import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { GatedTabsTrigger } from "@/components/access/GatedTabsTrigger";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, RefreshCw, Plus, CheckCircle2, AlertTriangle, Clock, Activity, Link2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useHospitalId } from "@/hooks/useHospitalId";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { autoChargeService, MODULE_CHRONIC_CARE } from "@/lib/serviceBilling";
import MedicationAdherenceTab from "@/components/chronic/MedicationAdherenceTab";

const CONDITIONS = ["Type 2 Diabetes", "Hypertension", "COPD", "Chronic Kidney Disease", "Heart Failure", "Asthma", "Hypothyroidism", "Rheumatoid Arthritis", "Epilepsy", "Other"];
const TASK_TYPES = ["lab_test", "appointment", "medication_refill", "vitals_check", "education", "referral"] as const;

interface CarePlan {
  id: string;
  condition: string;
  icd10_code: string | null;
  plan_type: string;
  start_date: string;
  review_date: string | null;
  status: string;
  patient_id: string;
  program_id: string | null;
  patients?: { full_name: string; uhid: string; dob: string | null };
}

/**
 * A patient enrolled in a chronic programme via OPD Consultation
 * (chronic_disease_programs). Until now the /chronic-disease module had no
 * awareness of these at all — enrolment and care planning were two islands.
 */
interface EnrolledProgram {
  id: string;
  condition_label: string;
  next_followup: string | null;
  patient_id: string;
  is_active: boolean;
  patients?: { full_name: string; uhid: string } | null;
}

interface CareTask {
  id: string;
  task_type: string;
  task_description: string | null;
  due_date: string | null;
  status: string;
  notes: string | null;
}

interface Patient {
  id: string;
  full_name: string;
  uhid: string;
  dob: string | null;
}

function calcAge(dob: string | null): string {
  if (!dob) return "—";
  return `${Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000)}y`;
}

const ChronicDiseasePage: React.FC = () => {
  // Reads from HospitalContext — same source every other module uses, and it
  // also carries the app users.id needed for created_by / assigned_doctor_id.
  const { hospitalId, userId } = useHospitalId();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [programs, setPrograms] = useState<EnrolledProgram[]>([]);
  const [taskKpis, setTaskKpis] = useState({ dueToday: 0, overdue: 0 });
  const [selectedPlan, setSelectedPlan] = useState<CarePlan | null>(null);
  const [searchPatient, setSearchPatient] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  // New plan form
  const [condition, setCondition] = useState(CONDITIONS[0]);
  const [icd10, setIcd10] = useState("");
  const [planType, setPlanType] = useState("standard");
  const [reviewDate, setReviewDate] = useState("");
  const [goals, setGoals] = useState("");
  // Set when the plan originates from an existing OPD chronic enrolment
  const [linkedProgramId, setLinkedProgramId] = useState<string | null>(null);

  // New task form
  const [taskType, setTaskType] = useState<typeof TASK_TYPES[number]>("lab_test");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [showTaskForm, setShowTaskForm] = useState(false);

  const today = new Date().toISOString().split("T")[0];
  const deepLinkConsumed = useRef(false);

  const fetchPlans = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("care_plans")
      .select("*, patients(full_name, uhid, dob)")
      .eq("hospital_id", hospitalId)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(200);
    // Previously this error was discarded. When care_plans had no FK to
    // patients, PostgREST returned PGRST200 and the page silently showed zero
    // plans forever — the failure mode this module shipped with.
    if (error) toast.error(`Could not load care plans: ${error.message}`);
    setPlans(data || []);
    setLoading(false);
  }, [hospitalId]);

  /** Patients enrolled in a chronic programme from OPD — the bridge. */
  const fetchPrograms = useCallback(async () => {
    if (!hospitalId) return;
    const { data, error } = await (supabase as any)
      .from("chronic_disease_programs")
      .select("id, condition_label, next_followup, patient_id, is_active, patients(full_name, uhid)")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .order("next_followup", { ascending: true })
      .limit(300);
    if (error) toast.error(`Could not load enrolments: ${error.message}`);
    setPrograms(data || []);
  }, [hospitalId]);

  /**
   * Hospital-wide task counts. The dashboard previously derived these from
   * `tasks`, which only ever holds the selected plan's tasks — so the KPIs were
   * wrong even when data existed.
   */
  const fetchTaskKpis = useCallback(async () => {
    if (!hospitalId) return;
    const base = () => (supabase as any)
      .from("care_plan_tasks")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .eq("status", "pending");
    const [dueRes, overdueRes] = await Promise.all([
      base().eq("due_date", today),
      base().lt("due_date", today),
    ]);
    if (dueRes.error || overdueRes.error) {
      toast.error(`Could not load task counts: ${(dueRes.error || overdueRes.error).message}`);
    }
    setTaskKpis({ dueToday: dueRes.count || 0, overdue: overdueRes.count || 0 });
  }, [hospitalId, today]);

  const fetchTasks = useCallback(async (planId: string) => {
    const { data, error } = await (supabase as any)
      .from("care_plan_tasks")
      .select("*")
      .eq("care_plan_id", planId)
      .eq("is_deleted", false)
      .order("due_date", { ascending: true });
    if (error) toast.error(`Could not load tasks: ${error.message}`);
    setTasks(data || []);
  }, []);

  const refreshAll = useCallback(() => {
    fetchPlans(); fetchPrograms(); fetchTaskKpis();
  }, [fetchPlans, fetchPrograms, fetchTaskKpis]);

  useEffect(() => { if (hospitalId) refreshAll(); }, [hospitalId, refreshAll]);

  // Deep link from OPD Consultation: /chronic-disease?tab=new&program=<id>
  //
  // Consumed exactly once. Without the guard the effect would re-fire on every
  // programmes refresh — including the one after a plan is created — and
  // silently re-prefill the form the user has just submitted.
  useEffect(() => {
    if (deepLinkConsumed.current || programs.length === 0) return;
    const params = new URLSearchParams(window.location.search);
    const programId = params.get("program");
    if (!programId && params.get("tab") !== "new") return;

    deepLinkConsumed.current = true;
    if (params.get("tab") === "new") setActiveTab("new");
    const prog = programId ? programs.find(p => p.id === programId) : undefined;
    if (prog) startPlanFromProgram(prog);

    // Strip the params so a refresh or a later navigation does not replay this.
    window.history.replaceState({}, "", window.location.pathname);
  }, [programs]);

  const handlePatientSearch = async () => {
    if (!hospitalId || searchPatient.trim().length < 2) return;
    const { data, error } = await (supabase as any)
      .from("patients")
      .select("id, full_name, uhid, dob")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .or(`full_name.ilike.%${searchPatient}%,uhid.ilike.%${searchPatient}%`)
      .limit(10);
    if (error) toast.error(`Patient search failed: ${error.message}`);
    setPatientResults(data || []);
  };

  /** Prefill the New Care Plan form from an existing OPD enrolment. */
  const startPlanFromProgram = (prog: EnrolledProgram) => {
    setSelectedPatient({
      id: prog.patient_id,
      full_name: prog.patients?.full_name || "",
      uhid: prog.patients?.uhid || "",
      dob: null,
    });
    setSearchPatient(prog.patients?.full_name || "");
    setPatientResults([]);
    setLinkedProgramId(prog.id);
    // Match the enrolment's condition to a catalogue entry where possible;
    // otherwise keep the enrolment's own label rather than losing it.
    const match = CONDITIONS.find(
      c => c.toLowerCase() === (prog.condition_label || "").toLowerCase(),
    );
    setCondition(match || prog.condition_label || CONDITIONS[0]);
    if (prog.next_followup) setReviewDate(prog.next_followup);
    setActiveTab("new");
  };

  const createPlan = async () => {
    if (!selectedPatient || !hospitalId) { toast.error("Select a patient first"); return; }
    setCreating(true);

    const { data: plan, error } = await (supabase as any).from("care_plans").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.id,
      condition,
      icd10_code: icd10 || null,
      plan_type: planType,
      review_date: reviewDate || null,
      goals: goals ? Object.fromEntries(goals.split("\n").filter(Boolean).map((g, i) => [`goal_${i + 1}`, g])) : {},
      // users.id — carried by HospitalContext, no extra round-trip needed
      assigned_doctor_id: userId || null,
      created_by: userId || null,
      program_id: linkedProgramId,
      status: "active",
    }).select("*, patients(full_name, uhid, dob)").maybeSingle();

    setCreating(false);
    if (error) { toast.error(error.message); return; }
    if (!plan) { toast.error("Care plan was not created — please retry."); return; }

    await logNABHEvidence(
      hospitalId,
      "COP.10",
      `Chronic care plan created for ${selectedPatient.full_name}: ${condition} (${planType})`,
    );

    toast.success(
      linkedProgramId
        ? `Care plan created and linked to the OPD enrolment for ${selectedPatient.full_name}`
        : `Care plan created for ${selectedPatient.full_name}`,
    );
    setGoals(""); setIcd10(""); setReviewDate("");
    setSearchPatient(""); setPatientResults([]); setSelectedPatient(null);
    setLinkedProgramId(null);
    refreshAll();
    setSelectedPlan(plan);
    setTasks([]);
    setActiveTab("plans");
  };

  const addTask = async () => {
    if (!selectedPlan || !hospitalId) return;
    const { error } = await (supabase as any).from("care_plan_tasks").insert({
      hospital_id: hospitalId,
      care_plan_id: selectedPlan.id,
      patient_id: selectedPlan.patient_id,
      task_type: taskType,
      task_description: taskDesc || null,
      due_date: taskDue || null,
      assigned_to: userId || null,
      status: "pending",
    });
    // Previously unchecked — a failed insert still showed "Task added".
    if (error) { toast.error(error.message); return; }
    toast.success("Task added");
    setTaskDesc(""); setTaskDue(""); setShowTaskForm(false);
    fetchTasks(selectedPlan.id);
    fetchTaskKpis();
  };

  const updateTaskStatus = async (taskId: string, status: "completed" | "cancelled") => {
    const { error } = await (supabase as any).from("care_plan_tasks").update({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    }).eq("id", taskId);
    if (error) { toast.error(error.message); return; }
    if (selectedPlan) fetchTasks(selectedPlan.id);
    fetchTaskKpis();
  };

  /**
   * Complete a chronic review: close the plan's review cycle, log NABH evidence
   * and raise the charge. Chronic reviews were previously entirely unbilled.
   */
  const completeReview = async () => {
    if (!selectedPlan || !hospitalId) return;
    setCreating(true);
    const next = new Date();
    next.setMonth(next.getMonth() + 3); // standard 3-month chronic review cycle
    const nextReview = next.toISOString().split("T")[0];

    // The review — not the plan — is the billable, auditable event.
    const { data: review, error: reviewErr } = await (supabase as any)
      .from("care_plan_reviews")
      .insert({
        hospital_id:      hospitalId,
        care_plan_id:     selectedPlan.id,
        patient_id:       selectedPlan.patient_id,
        reviewed_by:      userId || null,
        review_date:      today,
        next_review_date: nextReview,
      })
      .select("id")
      .maybeSingle();

    if (reviewErr || !review?.id) {
      setCreating(false);
      toast.error(reviewErr?.message || "Review could not be recorded");
      return;
    }

    const { error } = await (supabase as any).from("care_plans").update({
      review_date: nextReview,
      updated_at: new Date().toISOString(),
    }).eq("id", selectedPlan.id);

    setCreating(false);
    if (error) { toast.error(error.message); return; }

    await logNABHEvidence(
      hospitalId,
      "COP.10",
      `Chronic care plan reviewed: ${selectedPlan.condition} — ${selectedPlan.patients?.full_name || ""}`,
    );

    // Rate comes from service_rates via the chronic_care_review code — never
    // hardcoded. Keyed on the review id, so each cycle bills exactly once.
    autoChargeService({
      hospitalId,
      patientId:     selectedPlan.patient_id,
      serviceName:   `Chronic Care Review — ${selectedPlan.condition}`,
      serviceModule: MODULE_CHRONIC_CARE,
      sourceTable:   "care_plan_reviews",
      sourceId:      review.id,
      serviceDate:   today,
      performedBy:   userId ?? undefined,
    }).catch(() => {});

    toast.success(`Review recorded — next review ${new Date(nextReview).toLocaleDateString("en-IN")}`);
    refreshAll();
    setSelectedPlan(p => (p ? { ...p, review_date: nextReview } : p));
  };

  // ── Dashboard aggregates ───────────────────────────────────────────────────
  // Condition breakdown spans BOTH models: care plans built in this module and
  // patients enrolled from OPD who have no plan yet.
  const conditionCounts = plans.reduce((acc, p) => {
    acc[p.condition] = (acc[p.condition] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const activePlans = plans.filter(p => p.status === "active").length;

  // Patients enrolled in a chronic programme via OPD with no care plan yet —
  // the gap between enrolment and care planning, now visible and actionable.
  const patientsWithPlans = new Set(
    plans.filter(p => p.status === "active").map(p => p.patient_id),
  );
  const unplannedPrograms = programs.filter(p => !patientsWithPlans.has(p.patient_id));

  const { dueToday: tasksDueToday, overdue: overdueTasks } = taskKpis;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-[52px] shrink-0 bg-background border-b px-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="font-bold">Chronic Disease Management</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={refreshAll} disabled={loading}>
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 w-full justify-start rounded-none border-b bg-card h-10 px-5">
          <GatedTabsTrigger module="chronic_disease" value="dashboard" className="text-xs">Cohort Dashboard</GatedTabsTrigger>
          <GatedTabsTrigger module="chronic_disease" value="plans" className="text-xs">Care Plans</GatedTabsTrigger>
          <GatedTabsTrigger module="chronic_disease" value="adherence" className="text-xs">Adherence</GatedTabsTrigger>
          <GatedTabsTrigger module="chronic_disease" value="new" className="text-xs">New Care Plan</GatedTabsTrigger>
        </TabsList>

        {/* DASHBOARD TAB */}
        <TabsContent value="dashboard" className="flex-1 overflow-y-auto p-5 mt-0">
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="border rounded-lg p-4 bg-card text-center">
              <p className="text-2xl font-bold text-primary">{activePlans}</p>
              <p className="text-xs text-muted-foreground mt-1">Active Care Plans</p>
            </div>
            <div className="border rounded-lg p-4 bg-card text-center">
              <p className="text-2xl font-bold text-sky-600">{programs.length}</p>
              <p className="text-xs text-muted-foreground mt-1">Enrolled in OPD</p>
            </div>
            <div className="border rounded-lg p-4 bg-card text-center">
              <p className="text-2xl font-bold text-amber-600">{tasksDueToday}</p>
              <p className="text-xs text-muted-foreground mt-1">Tasks Due Today</p>
            </div>
            <div className="border rounded-lg p-4 bg-card text-center">
              <p className="text-2xl font-bold text-red-600">{overdueTasks}</p>
              <p className="text-xs text-muted-foreground mt-1">Overdue Tasks</p>
            </div>
          </div>

          {/* The bridge: patients enrolled from OPD Consultation who have no
              care plan yet. Previously these two models never met. */}
          {unplannedPrograms.length > 0 && (
            <div className="border border-amber-200 bg-amber-50/50 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Link2 className="h-4 w-4 text-amber-600" />
                <h3 className="text-sm font-semibold">
                  {unplannedPrograms.length} patient{unplannedPrograms.length === 1 ? "" : "s"} enrolled in OPD without a care plan
                </h3>
              </div>
              <div className="space-y-1.5 max-h-64 overflow-y-auto">
                {unplannedPrograms.map(prog => (
                  <div key={prog.id} className="flex items-center gap-3 bg-card border rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{prog.patients?.full_name || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {prog.condition_label}
                        {prog.next_followup && ` · follow-up ${new Date(prog.next_followup).toLocaleDateString("en-IN")}`}
                      </p>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs shrink-0"
                      onClick={() => startPlanFromProgram(prog)}>
                      Create plan
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h3 className="text-sm font-semibold mb-3">Condition Breakdown</h3>
          <div className="grid grid-cols-2 gap-3">
            {Object.entries(conditionCounts).sort(([, a], [, b]) => b - a).map(([cond, count]) => (
              <div key={cond} className="border rounded-lg p-3 bg-card flex items-center justify-between">
                <span className="text-sm">{cond}</span>
                <Badge variant="secondary" className="text-xs">{count} patients</Badge>
              </div>
            ))}
            {Object.keys(conditionCounts).length === 0 && (
              <p className="text-sm text-muted-foreground col-span-2 text-center py-4">No care plans created yet</p>
            )}
          </div>
        </TabsContent>

        {/* PLANS TAB */}
        <TabsContent value="plans" className="flex-1 flex overflow-hidden mt-0">
          {/* Plan list */}
          <div className="w-[280px] border-r flex flex-col">
            <div className="p-2 border-b">
              <p className="text-xs text-muted-foreground px-1">{plans.length} plans</p>
            </div>
            <ScrollArea className="flex-1">
              {plans.map(p => (
                <button
                  key={p.id}
                  onClick={() => { setSelectedPlan(p); fetchTasks(p.id); }}
                  className={cn("w-full text-left px-3 py-2.5 border-b hover:bg-muted/50 transition-colors text-xs",
                    selectedPlan?.id === p.id && "bg-muted")}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold truncate">{p.patients?.full_name}</span>
                    <Badge variant="secondary" className={cn("text-[9px] shrink-0 ml-1",
                      p.status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                    )}>{p.status}</Badge>
                  </div>
                  <p className="text-[10px] text-muted-foreground">{p.condition}</p>
                  <p className="text-[10px] text-muted-foreground">{p.patients?.uhid}</p>
                </button>
              ))}
              {plans.length === 0 && <p className="text-xs text-muted-foreground text-center py-8">No care plans</p>}
            </ScrollArea>
          </div>

          {/* Plan detail */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {!selectedPlan ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                Select a care plan
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b bg-card">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-sm truncate">{selectedPlan.condition} — {selectedPlan.patients?.full_name}</h3>
                        {selectedPlan.program_id && (
                          <Badge variant="secondary" className="text-[9px] shrink-0 bg-sky-100 text-sky-700 gap-0.5">
                            <Link2 className="h-2.5 w-2.5" /> OPD enrolment
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {selectedPlan.patients?.uhid} · Started {new Date(selectedPlan.start_date).toLocaleDateString("en-IN")}
                        {selectedPlan.review_date && ` · Review due ${new Date(selectedPlan.review_date).toLocaleDateString("en-IN")}`}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={completeReview} disabled={creating}>
                        <CheckCircle2 className="h-3 w-3 mr-1" /> Complete Review
                      </Button>
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowTaskForm(v => !v)}>
                        <Plus className="h-3 w-3 mr-1" /> Add Task
                      </Button>
                    </div>
                  </div>
                </div>

                <ScrollArea className="flex-1 p-4 space-y-3">
                  {showTaskForm && (
                    <div className="border rounded-lg p-3 space-y-2 bg-blue-50/40 border-blue-200 mb-3">
                      <h4 className="text-xs font-semibold">New Task</h4>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <Label className="text-[10px]">Task Type</Label>
                          <select value={taskType} onChange={e => setTaskType(e.target.value as any)}
                            className="w-full mt-0.5 h-7 text-xs border border-border rounded-md px-2 bg-background">
                            {TASK_TYPES.map(t => <option key={t} value={t}>{t.replace(/_/g, " ")}</option>)}
                          </select>
                        </div>
                        <div>
                          <Label className="text-[10px]">Due Date</Label>
                          <Input type="date" value={taskDue} onChange={e => setTaskDue(e.target.value)} className="h-7 text-xs mt-0.5" />
                        </div>
                      </div>
                      <div>
                        <Label className="text-[10px]">Description</Label>
                        <Input value={taskDesc} onChange={e => setTaskDesc(e.target.value)} className="h-7 text-xs mt-0.5" placeholder="e.g. HbA1c test, Ophthalmology review..." />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" className="h-7 text-xs flex-1" onClick={addTask}>Add Task</Button>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowTaskForm(false)}>Cancel</Button>
                      </div>
                    </div>
                  )}

                  {tasks.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-6">No tasks yet — add tasks to track care activities</p>
                  ) : (
                    <div className="space-y-2">
                      {tasks.map(task => {
                        const isOverdue = task.due_date && task.due_date < new Date().toISOString().split("T")[0] && task.status === "pending";
                        return (
                          <div key={task.id} className={cn("border rounded-lg p-2.5 flex items-start gap-2 bg-card",
                            isOverdue && "border-red-200 bg-red-50/30",
                            task.status === "completed" && "opacity-60"
                          )}>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium capitalize">{task.task_type.replace(/_/g, " ")}</span>
                                {isOverdue && <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />}
                                <Badge variant="secondary" className={cn("text-[9px]",
                                  task.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                                  isOverdue ? "bg-red-100 text-red-700" :
                                  "bg-amber-100 text-amber-700"
                                )}>{task.status}</Badge>
                              </div>
                              {task.task_description && <p className="text-[11px] text-muted-foreground mt-0.5">{task.task_description}</p>}
                              {task.due_date && (
                                <p className="text-[10px] text-muted-foreground/60 mt-0.5">
                                  <Clock className="h-2.5 w-2.5 inline mr-0.5" />
                                  Due: {new Date(task.due_date).toLocaleDateString("en-IN")}
                                </p>
                              )}
                            </div>
                            {task.status === "pending" && (
                              <div className="flex gap-1 shrink-0">
                                <Button size="sm" variant="ghost" className="h-6 w-6 p-0 text-emerald-600" onClick={() => updateTaskStatus(task.id, "completed")}>
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </ScrollArea>
              </>
            )}
          </div>
        </TabsContent>

        {/* ADHERENCE TAB */}
        <TabsContent value="adherence" className="flex-1 flex overflow-hidden mt-0">
          {hospitalId && (
            <MedicationAdherenceTab
              hospitalId={hospitalId}
              carePlanId={selectedPlan?.id ?? null}
              patientId={selectedPlan?.patient_id ?? null}
              patientName={selectedPlan?.patients?.full_name}
            />
          )}
        </TabsContent>

        {/* NEW PLAN TAB */}
        <TabsContent value="new" className="flex-1 overflow-y-auto p-5 mt-0">
          <div className="max-w-xl space-y-4">
            <h2 className="text-sm font-semibold">Create Care Plan</h2>

            {/* Patient Search */}
            <div>
              <Label className="text-xs">Search Patient</Label>
              <div className="flex gap-2 mt-1">
                <Input
                  value={searchPatient}
                  onChange={e => setSearchPatient(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && handlePatientSearch()}
                  className="flex-1 text-sm"
                  placeholder="Name or UHID..."
                />
                <Button size="sm" onClick={handlePatientSearch} variant="outline">
                  <Search className="h-3.5 w-3.5" />
                </Button>
              </div>
              {patientResults.length > 0 && (
                <div className="border rounded-lg mt-1 divide-y">
                  {patientResults.map(p => (
                    <button key={p.id} onClick={() => { setSelectedPatient(p); setPatientResults([]); setSearchPatient(p.full_name); }}
                      className="w-full text-left px-3 py-2 hover:bg-muted/50 text-xs">
                      <span className="font-medium">{p.full_name}</span>
                      <span className="text-muted-foreground ml-2">{p.uhid} · {calcAge(p.dob)}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedPatient && (
                <div className="mt-1 flex items-center gap-2 text-xs text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Selected: <strong>{selectedPatient.full_name}</strong> ({selectedPatient.uhid})
                </div>
              )}
              {linkedProgramId && (
                <div className="mt-1 flex items-center gap-2 text-xs text-sky-700">
                  <Link2 className="h-3.5 w-3.5" />
                  Linked to this patient&rsquo;s OPD chronic enrolment
                  <button className="underline text-muted-foreground"
                    onClick={() => setLinkedProgramId(null)}>unlink</button>
                </div>
              )}
            </div>

            {/* Condition */}
            <div>
              <Label className="text-xs">Condition</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {CONDITIONS.map(c => (
                  <button key={c} onClick={() => setCondition(c)}
                    className={cn("px-2.5 py-1 rounded-full text-xs border transition-colors",
                      condition === c ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted")}>
                    {c}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">ICD-10 Code</Label>
                <Input value={icd10} onChange={e => setIcd10(e.target.value)} className="mt-1 text-sm" placeholder="e.g. E11" />
              </div>
              <div>
                <Label className="text-xs">Plan Type</Label>
                <select value={planType} onChange={e => setPlanType(e.target.value)}
                  className="w-full mt-1 h-9 text-sm border border-border rounded-md px-2 bg-background">
                  <option value="standard">Standard</option>
                  <option value="intensive">Intensive</option>
                  <option value="palliative">Palliative</option>
                </select>
              </div>
            </div>

            <div>
              <Label className="text-xs">Review Date</Label>
              <Input type="date" value={reviewDate} onChange={e => setReviewDate(e.target.value)} className="mt-1 w-48 text-sm" />
            </div>

            <div>
              <Label className="text-xs">Goals (one per line)</Label>
              <Textarea value={goals} onChange={e => setGoals(e.target.value)} rows={3} className="mt-1 text-sm resize-none" placeholder="HbA1c < 7%&#10;BP < 130/80 mmHg&#10;Annual eye review..." />
            </div>

            <Button onClick={createPlan} disabled={!selectedPatient || creating} className="w-full">
              {creating ? "Creating…" : "Create Care Plan"}
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ChronicDiseasePage;
