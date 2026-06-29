import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, User, RefreshCw, Plus, CheckCircle2, AlertTriangle, Clock, Activity } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
  patients?: { full_name: string; uhid: string; dob: string | null };
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
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [plans, setPlans] = useState<CarePlan[]>([]);
  const [tasks, setTasks] = useState<CareTask[]>([]);
  const [selectedPlan, setSelectedPlan] = useState<CarePlan | null>(null);
  const [searchPatient, setSearchPatient] = useState("");
  const [patientResults, setPatientResults] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [loading, setLoading] = useState(false);

  // New plan form
  const [condition, setCondition] = useState(CONDITIONS[0]);
  const [icd10, setIcd10] = useState("");
  const [planType, setPlanType] = useState("standard");
  const [reviewDate, setReviewDate] = useState("");
  const [goals, setGoals] = useState("");

  // New task form
  const [taskType, setTaskType] = useState<typeof TASK_TYPES[number]>("lab_test");
  const [taskDesc, setTaskDesc] = useState("");
  const [taskDue, setTaskDue] = useState("");
  const [showTaskForm, setShowTaskForm] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any).from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }: any) => { if (data?.hospital_id) setHospitalId(data.hospital_id); });
    });
  }, []);

  const fetchPlans = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("care_plans")
      .select("*, patients(full_name, uhid, dob)")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(200);
    setPlans(data || []);
    setLoading(false);
  }, [hospitalId]);

  const fetchTasks = useCallback(async (planId: string) => {
    const { data } = await (supabase as any)
      .from("care_plan_tasks")
      .select("*")
      .eq("care_plan_id", planId)
      .order("due_date", { ascending: true });
    setTasks(data || []);
  }, []);

  useEffect(() => { if (hospitalId) fetchPlans(); }, [hospitalId, fetchPlans]);

  const handlePatientSearch = async () => {
    if (!hospitalId || searchPatient.trim().length < 2) return;
    const { data } = await (supabase as any)
      .from("patients")
      .select("id, full_name, uhid, dob")
      .eq("hospital_id", hospitalId)
      .or(`full_name.ilike.%${searchPatient}%,uhid.ilike.%${searchPatient}%`)
      .limit(10);
    setPatientResults(data || []);
  };

  const createPlan = async () => {
    if (!selectedPatient || !hospitalId) { toast.error("Select a patient first"); return; }
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await (supabase as any).from("users").select("id").eq("auth_user_id", user?.id).maybeSingle();

    const { data: plan, error } = await (supabase as any).from("care_plans").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.id,
      condition,
      icd10_code: icd10 || null,
      plan_type: planType,
      review_date: reviewDate || null,
      goals: goals ? Object.fromEntries(goals.split("\n").filter(Boolean).map((g, i) => [`goal_${i + 1}`, g])) : {},
      assigned_doctor_id: userData?.id || null,
      status: "active",
    }).select().maybeSingle();

    if (error) { toast.error(error.message); return; }
    toast.success(`Care plan created for ${selectedPatient.full_name}`);
    setGoals(""); setIcd10(""); setSearchPatient(""); setPatientResults([]); setSelectedPatient(null);
    fetchPlans();
    if (plan) { setSelectedPlan(plan); setActiveTab("plans"); }
  };

  const addTask = async () => {
    if (!selectedPlan || !hospitalId) return;
    await (supabase as any).from("care_plan_tasks").insert({
      hospital_id: hospitalId,
      care_plan_id: selectedPlan.id,
      patient_id: selectedPlan.patient_id,
      task_type: taskType,
      task_description: taskDesc || null,
      due_date: taskDue || null,
      status: "pending",
    });
    toast.success("Task added");
    setTaskDesc(""); setTaskDue(""); setShowTaskForm(false);
    fetchTasks(selectedPlan.id);
  };

  const updateTaskStatus = async (taskId: string, status: "completed" | "cancelled") => {
    await (supabase as any).from("care_plan_tasks").update({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
    }).eq("id", taskId);
    if (selectedPlan) fetchTasks(selectedPlan.id);
  };

  // Dashboard aggregates
  const conditionCounts = plans.reduce((acc, p) => {
    acc[p.condition] = (acc[p.condition] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  const activePlans = plans.filter(p => p.status === "active").length;

  const tasksDueToday = tasks.filter(t => t.due_date === new Date().toISOString().split("T")[0] && t.status === "pending").length;
  const overdueTasks = tasks.filter(t => t.due_date && t.due_date < new Date().toISOString().split("T")[0] && t.status === "pending").length;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-[52px] shrink-0 bg-background border-b px-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="font-bold">Chronic Disease Management</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={fetchPlans} disabled={loading}>
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="shrink-0 w-full justify-start rounded-none border-b bg-card h-10 px-5">
          <TabsTrigger value="dashboard" className="text-xs">Cohort Dashboard</TabsTrigger>
          <TabsTrigger value="plans" className="text-xs">Care Plans</TabsTrigger>
          <TabsTrigger value="new" className="text-xs">New Care Plan</TabsTrigger>
        </TabsList>

        {/* DASHBOARD TAB */}
        <TabsContent value="dashboard" className="flex-1 overflow-y-auto p-5 mt-0">
          <div className="grid grid-cols-3 gap-4 mb-6">
            <div className="border rounded-lg p-4 bg-card text-center">
              <p className="text-2xl font-bold text-primary">{activePlans}</p>
              <p className="text-xs text-muted-foreground mt-1">Active Care Plans</p>
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
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-sm">{selectedPlan.condition} — {selectedPlan.patients?.full_name}</h3>
                      <p className="text-xs text-muted-foreground">{selectedPlan.patients?.uhid} · Started {new Date(selectedPlan.start_date).toLocaleDateString("en-IN")}</p>
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setShowTaskForm(v => !v)}>
                      <Plus className="h-3 w-3 mr-1" /> Add Task
                    </Button>
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

            <Button onClick={createPlan} disabled={!selectedPatient} className="w-full">
              Create Care Plan
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ChronicDiseasePage;
