import React, { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Briefcase, UserPlus, ChevronLeft, ChevronRight, CheckCircle2, Loader2, UserCog } from "lucide-react";
import { cn } from "@/lib/utils";

const STAGES = ["applied", "screened", "interviewed", "offered", "hired", "rejected"] as const;
type Stage = typeof STAGES[number];

const STAGE_LABEL: Record<Stage, string> = {
  applied: "Applied", screened: "Screened", interviewed: "Interviewed",
  offered: "Offered", hired: "Hired", rejected: "Rejected",
};
const STAGE_COLOR: Record<Stage, string> = {
  applied: "bg-slate-100 text-slate-700", screened: "bg-blue-100 text-blue-700",
  interviewed: "bg-indigo-100 text-indigo-700", offered: "bg-amber-100 text-amber-700",
  hired: "bg-emerald-100 text-emerald-700", rejected: "bg-red-100 text-red-700",
};

const DEFAULT_ONBOARDING = [
  { label: "Collect signed offer letter & appointment order", category: "documents" },
  { label: "Verify ID proof, PAN, address proof", category: "documents" },
  { label: "Collect educational & professional certificates", category: "documents" },
  { label: "Verify medical council registration / license", category: "compliance" },
  { label: "Create staff record & assign role", category: "system" },
  { label: "Assign salary structure", category: "payroll" },
  { label: "Issue ID card & biometric enrolment", category: "facilities" },
  { label: "Department orientation & induction training", category: "training" },
];

interface Opening {
  id: string;
  title: string;
  department_id: string | null;
  department_name?: string;
  positions_count: number;
  employment_type: string;
  status: string;
}
interface Applicant {
  id: string;
  job_opening_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  stage: Stage;
  rating: number | null;
  notes: string | null;
  hired_user_id: string | null;
}

const RecruitmentTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const navigate = useNavigate();

  const [openings, setOpenings] = useState<Opening[]>([]);
  const [applicants, setApplicants] = useState<Applicant[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [selectedOpening, setSelectedOpening] = useState<string>("all");
  const [loading, setLoading] = useState(true);

  const [showOpening, setShowOpening] = useState(false);
  const [openingForm, setOpeningForm] = useState({ title: "", department_id: "", positions_count: 1, employment_type: "permanent", description: "" });

  const [showApplicant, setShowApplicant] = useState(false);
  const [applicantForm, setApplicantForm] = useState({ full_name: "", email: "", phone: "", job_opening_id: "" });

  const [onboardingFor, setOnboardingFor] = useState<Applicant | null>(null);
  const [tasks, setTasks] = useState<{ id: string; task_label: string; category: string; is_done: boolean }[]>([]);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [openRes, applRes, deptRes] = await Promise.all([
      (supabase as any).from("job_openings").select("*, departments(name)").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      (supabase as any).from("job_applicants").select("*").eq("hospital_id", hospitalId).order("applied_at", { ascending: false }),
      supabase.from("departments").select("id, name").eq("is_active", true).order("name"),
    ]);
    setOpenings((openRes.data || []).map((o: any) => ({ ...o, department_name: o.departments?.name })));
    setApplicants((applRes.data || []) as Applicant[]);
    setDepartments(deptRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const createOpening = async () => {
    if (!openingForm.title.trim()) { toast({ title: "Title required", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("job_openings").insert({
      hospital_id: hospitalId,
      title: openingForm.title.trim(),
      department_id: openingForm.department_id || null,
      positions_count: openingForm.positions_count,
      employment_type: openingForm.employment_type,
      description: openingForm.description || null,
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Job opening created" });
    setShowOpening(false);
    setOpeningForm({ title: "", department_id: "", positions_count: 1, employment_type: "permanent", description: "" });
    load();
  };

  const addApplicant = async () => {
    if (!applicantForm.full_name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    const { error } = await (supabase as any).from("job_applicants").insert({
      hospital_id: hospitalId,
      job_opening_id: applicantForm.job_opening_id || (selectedOpening !== "all" ? selectedOpening : null),
      full_name: applicantForm.full_name.trim(),
      email: applicantForm.email || null,
      phone: applicantForm.phone || null,
      stage: "applied",
    });
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Applicant added" });
    setShowApplicant(false);
    setApplicantForm({ full_name: "", email: "", phone: "", job_opening_id: "" });
    load();
  };

  const moveStage = async (appl: Applicant, dir: 1 | -1) => {
    const idx = STAGES.indexOf(appl.stage);
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= STAGES.length) return;
    const next = STAGES[nextIdx];
    await (supabase as any).from("job_applicants").update({ stage: next }).eq("id", appl.id);
    setApplicants((prev) => prev.map((a) => (a.id === appl.id ? { ...a, stage: next } : a)));
    if (next === "hired") await seedOnboarding(appl);
  };

  const setStage = async (appl: Applicant, stage: Stage) => {
    await (supabase as any).from("job_applicants").update({ stage }).eq("id", appl.id);
    setApplicants((prev) => prev.map((a) => (a.id === appl.id ? { ...a, stage } : a)));
    if (stage === "hired") await seedOnboarding(appl);
  };

  const seedOnboarding = async (appl: Applicant) => {
    const { data: existing } = await (supabase as any).from("onboarding_tasks").select("id").eq("applicant_id", appl.id).limit(1);
    if (existing && existing.length > 0) return;
    await (supabase as any).from("onboarding_tasks").insert(
      DEFAULT_ONBOARDING.map((t) => ({ hospital_id: hospitalId, applicant_id: appl.id, task_label: t.label, category: t.category }))
    );
  };

  const openOnboarding = async (appl: Applicant) => {
    await seedOnboarding(appl);
    const { data } = await (supabase as any).from("onboarding_tasks").select("*").eq("applicant_id", appl.id).order("created_at");
    setTasks(data || []);
    setOnboardingFor(appl);
  };

  const toggleTask = async (taskId: string, done: boolean) => {
    await (supabase as any).from("onboarding_tasks").update({ is_done: done, done_at: done ? new Date().toISOString() : null }).eq("id", taskId);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, is_done: done } : t)));
  };

  const filtered = selectedOpening === "all" ? applicants : applicants.filter((a) => a.job_opening_id === selectedOpening);

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>;
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="h-12 flex-shrink-0 border-b border-border flex items-center gap-3 px-5">
        <Briefcase className="h-4 w-4 text-primary" />
        <select className="h-8 text-xs border border-input rounded-md px-2 bg-background max-w-[280px]"
          value={selectedOpening} onChange={(e) => setSelectedOpening(e.target.value)}>
          <option value="all">All Openings ({applicants.length} applicants)</option>
          {openings.map((o) => <option key={o.id} value={o.id}>{o.title}{o.department_name ? ` · ${o.department_name}` : ""} ({o.status})</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => setShowOpening(true)}>
            <Plus className="h-3 w-3" /> New Opening
          </Button>
          <Button size="sm" className="text-xs gap-1.5" onClick={() => setShowApplicant(true)} disabled={openings.length === 0}>
            <UserPlus className="h-3 w-3" /> Add Applicant
          </Button>
        </div>
      </div>

      {/* Kanban */}
      <div className="flex-1 overflow-auto p-4">
        {openings.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            <Briefcase className="h-10 w-10 mx-auto mb-2 opacity-30" />
            No job openings yet. Create one to start tracking applicants.
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 min-w-[720px]">
            {STAGES.map((stage) => {
              const col = filtered.filter((a) => a.stage === stage);
              return (
                <div key={stage} className="flex flex-col">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{STAGE_LABEL[stage]}</span>
                    <Badge variant="secondary" className="text-[10px]">{col.length}</Badge>
                  </div>
                  <div className="space-y-2">
                    {col.map((a) => (
                      <div key={a.id} className="border border-border rounded-lg p-2.5 bg-card">
                        <p className="text-xs font-semibold text-foreground truncate">{a.full_name}</p>
                        {a.phone && <p className="text-[10px] text-muted-foreground">{a.phone}</p>}
                        {a.email && <p className="text-[10px] text-muted-foreground truncate">{a.email}</p>}
                        <div className="flex items-center gap-1 mt-1.5">
                          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={STAGES.indexOf(a.stage) === 0}
                            onClick={() => moveStage(a, -1)} title="Move back">
                            <ChevronLeft className="h-3 w-3" />
                          </Button>
                          <Badge className={cn("text-[9px] px-1.5 flex-1 justify-center", STAGE_COLOR[a.stage])}>{STAGE_LABEL[a.stage]}</Badge>
                          <Button size="icon" variant="ghost" className="h-6 w-6" disabled={a.stage === "hired" || a.stage === "rejected"}
                            onClick={() => moveStage(a, 1)} title="Advance">
                            <ChevronRight className="h-3 w-3" />
                          </Button>
                        </div>
                        {a.stage !== "hired" && a.stage !== "rejected" && (
                          <button className="text-[9px] text-red-600 hover:underline mt-1" onClick={() => setStage(a, "rejected")}>Reject</button>
                        )}
                        {a.stage === "hired" && (
                          <div className="flex flex-col gap-1 mt-1.5">
                            <Button size="sm" variant="outline" className="h-6 text-[10px] gap-1" onClick={() => openOnboarding(a)}>
                              <CheckCircle2 className="h-3 w-3" /> Onboarding
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-[10px] gap-1" onClick={() => navigate("/settings/staff")}>
                              <UserCog className="h-3 w-3" /> Create Staff
                            </Button>
                          </div>
                        )}
                      </div>
                    ))}
                    {col.length === 0 && <div className="text-[10px] text-muted-foreground/50 text-center py-3">—</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* New Opening dialog */}
      <Dialog open={showOpening} onOpenChange={setShowOpening}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">New Job Opening</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Title</Label>
              <Input className="h-8 text-xs mt-1" value={openingForm.title} onChange={(e) => setOpeningForm((f) => ({ ...f, title: e.target.value }))} placeholder="Staff Nurse — ICU" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Department</Label>
                <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background"
                  value={openingForm.department_id} onChange={(e) => setOpeningForm((f) => ({ ...f, department_id: e.target.value }))}>
                  <option value="">—</option>
                  {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </div>
              <div>
                <Label className="text-xs">Positions</Label>
                <Input type="number" className="h-8 text-xs mt-1" value={openingForm.positions_count} onChange={(e) => setOpeningForm((f) => ({ ...f, positions_count: Number(e.target.value) }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Employment Type</Label>
              <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background"
                value={openingForm.employment_type} onChange={(e) => setOpeningForm((f) => ({ ...f, employment_type: e.target.value }))}>
                <option value="permanent">Permanent</option>
                <option value="contract">Contract</option>
                <option value="locum">Locum</option>
                <option value="trainee">Trainee</option>
              </select>
            </div>
            <Textarea className="text-xs" placeholder="Description / requirements" value={openingForm.description} onChange={(e) => setOpeningForm((f) => ({ ...f, description: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowOpening(false)}>Cancel</Button>
            <Button size="sm" onClick={createOpening}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Applicant dialog */}
      <Dialog open={showApplicant} onOpenChange={setShowApplicant}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Add Applicant</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Opening</Label>
              <select className="w-full h-8 text-xs mt-1 border border-input rounded-md px-2 bg-background"
                value={applicantForm.job_opening_id || (selectedOpening !== "all" ? selectedOpening : "")}
                onChange={(e) => setApplicantForm((f) => ({ ...f, job_opening_id: e.target.value }))}>
                <option value="">Select opening…</option>
                {openings.map((o) => <option key={o.id} value={o.id}>{o.title}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Full Name</Label>
              <Input className="h-8 text-xs mt-1" value={applicantForm.full_name} onChange={(e) => setApplicantForm((f) => ({ ...f, full_name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Phone</Label>
                <Input className="h-8 text-xs mt-1" value={applicantForm.phone} onChange={(e) => setApplicantForm((f) => ({ ...f, phone: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Email</Label>
                <Input className="h-8 text-xs mt-1" value={applicantForm.email} onChange={(e) => setApplicantForm((f) => ({ ...f, email: e.target.value }))} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowApplicant(false)}>Cancel</Button>
            <Button size="sm" onClick={addApplicant}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Onboarding checklist dialog */}
      <Dialog open={!!onboardingFor} onOpenChange={(o) => !o && setOnboardingFor(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle className="text-sm">Onboarding — {onboardingFor?.full_name}</DialogTitle></DialogHeader>
          <div className="space-y-1.5 max-h-[50vh] overflow-y-auto">
            {tasks.map((t) => (
              <label key={t.id} className="flex items-center gap-2 text-xs p-2 rounded-md hover:bg-muted/40 cursor-pointer">
                <input type="checkbox" checked={t.is_done} onChange={(e) => toggleTask(t.id, e.target.checked)} />
                <span className={cn("flex-1", t.is_done && "line-through text-muted-foreground")}>{t.task_label}</span>
                <Badge variant="outline" className="text-[9px]">{t.category}</Badge>
              </label>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground">{tasks.filter((t) => t.is_done).length}/{tasks.length} complete</p>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => navigate("/settings/staff")}>Open Staff Setup</Button>
            <Button size="sm" onClick={() => setOnboardingFor(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RecruitmentTab;
