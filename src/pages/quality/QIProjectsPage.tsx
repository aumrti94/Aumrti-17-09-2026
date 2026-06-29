import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Loader2, TrendingUp,
  Target, RefreshCw, CheckCircle2, XCircle, Clock, AlertCircle,
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QIProject {
  id: string;
  title: string;
  problem_statement: string;
  aim_statement: string;
  baseline_metric: string | null;
  baseline_value: number | null;
  target_metric: string | null;
  target_value: number | null;
  current_value: number | null;
  start_date: string | null;
  end_date: string | null;
  project_owner_id: string | null;
  status: string;
  notes: string | null;
  source_audit_id: string | null;
  created_at: string;
  users?: { full_name: string } | null;
  clinical_audits?: { title: string } | null;
}

interface QICycle {
  id: string;
  qi_project_id: string;
  cycle_label: string;
  plan: string | null;
  do_action: string | null;
  study: string | null;
  act: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_COLOUR: Record<string, string> = {
  active: "bg-blue-100 text-blue-700",
  completed: "bg-green-100 text-green-700",
  abandoned: "bg-gray-100 text-gray-500",
};

const STATUS_ICON: Record<string, React.ElementType> = {
  active: Clock,
  completed: CheckCircle2,
  abandoned: XCircle,
};

// ─── Create Project Dialog ────────────────────────────────────────────────────

interface CreateProjectProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hospitalId: string;
  userId: string | null;
  onCreated: (p: QIProject) => void;
}

const CreateProjectDialog: React.FC<CreateProjectProps> = ({
  open, onOpenChange, hospitalId, userId, onCreated,
}) => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    title: "", problem_statement: "", aim_statement: "",
    baseline_metric: "", baseline_value: "", target_metric: "",
    target_value: "", start_date: new Date().toISOString().split("T")[0], end_date: "",
  });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!f.title.trim() || !f.problem_statement.trim() || !f.aim_statement.trim()) {
      toast({ title: "Fill all required fields", variant: "destructive" }); return;
    }
    setSaving(true);
    const payload: any = {
      hospital_id: hospitalId,
      title: f.title.trim(),
      problem_statement: f.problem_statement.trim(),
      aim_statement: f.aim_statement.trim(),
      project_owner_id: userId,
    };
    if (f.baseline_metric) payload.baseline_metric = f.baseline_metric;
    if (f.baseline_value) payload.baseline_value = parseFloat(f.baseline_value);
    if (f.target_metric) payload.target_metric = f.target_metric;
    if (f.target_value) payload.target_value = parseFloat(f.target_value);
    if (f.start_date) payload.start_date = f.start_date;
    if (f.end_date) payload.end_date = f.end_date;

    const { data, error } = await (supabase as any)
      .from("qi_projects").insert(payload)
      .select("*, users:project_owner_id(full_name)").single();
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "QI Project created", description: data.title });
    onCreated(data);
    onOpenChange(false);
    setF({ title: "", problem_statement: "", aim_statement: "", baseline_metric: "", baseline_value: "", target_metric: "", target_value: "", start_date: new Date().toISOString().split("T")[0], end_date: "" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>New QI Project</DialogTitle></DialogHeader>
        <div className="space-y-3 mt-1">
          <div>
            <Label>Project Title *</Label>
            <Input className="h-8 text-sm mt-1" placeholder="e.g. Reduce Medication Errors in Ward 3"
              value={f.title} onChange={e => set("title", e.target.value)} />
          </div>
          <div>
            <Label>Problem Statement *</Label>
            <Textarea className="text-sm mt-1 h-20 resize-none"
              placeholder="Describe the current problem clearly and quantitatively, e.g. 45% of prescriptions are missing diagnosis documentation"
              value={f.problem_statement} onChange={e => set("problem_statement", e.target.value)} />
          </div>
          <div>
            <Label>Aim Statement * <span className="text-muted-foreground font-normal text-xs">(SMART)</span></Label>
            <Textarea className="text-sm mt-1 h-20 resize-none"
              placeholder="e.g. Improve prescription completeness from 45% to 80% in Ward 3 OPD within 3 months using PDSA cycles"
              value={f.aim_statement} onChange={e => set("aim_statement", e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Baseline Metric</Label>
              <Input className="h-8 text-sm mt-1" placeholder="e.g. Prescription compliance %"
                value={f.baseline_metric} onChange={e => set("baseline_metric", e.target.value)} />
            </div>
            <div>
              <Label>Baseline Value</Label>
              <Input className="h-8 text-sm mt-1" type="number" placeholder="e.g. 45"
                value={f.baseline_value} onChange={e => set("baseline_value", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Target Metric</Label>
              <Input className="h-8 text-sm mt-1" placeholder="e.g. Prescription compliance %"
                value={f.target_metric} onChange={e => set("target_metric", e.target.value)} />
            </div>
            <div>
              <Label>Target Value</Label>
              <Input className="h-8 text-sm mt-1" type="number" placeholder="e.g. 80"
                value={f.target_value} onChange={e => set("target_value", e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Start Date</Label>
              <Input type="date" className="h-8 text-sm mt-1" value={f.start_date} onChange={e => set("start_date", e.target.value)} />
            </div>
            <div>
              <Label>Target End Date</Label>
              <Input type="date" className="h-8 text-sm mt-1" value={f.end_date} onChange={e => set("end_date", e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Create Project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── PDSA Timeline Node ───────────────────────────────────────────────────────

const PDSA_FIELDS = [
  { key: "plan",      label: "Plan",  placeholder: "What change are you testing? What do you predict will happen?", colour: "border-blue-200   bg-blue-50/60"   },
  { key: "do_action", label: "Do",    placeholder: "Describe the test. What actually happened?",                    colour: "border-amber-200  bg-amber-50/60"  },
  { key: "study",     label: "Study", placeholder: "Analyse results. Did the prediction match?",                    colour: "border-purple-200 bg-purple-50/60" },
  { key: "act",       label: "Act",   placeholder: "What will you adopt, adapt, or abandon? Next steps?",           colour: "border-green-200  bg-green-50/60"  },
] as const;

interface CycleNodeProps {
  cycle: QICycle;
  index: number;
  isLast: boolean;
  expanded: boolean;
  editValues: { plan: string; do_action: string; study: string; act: string };
  saving: boolean;
  onExpand: () => void;
  onChange: (k: string, v: string) => void;
  onSave: () => void;
  onComplete: () => void;
}

const CycleTimelineNode: React.FC<CycleNodeProps> = ({
  cycle, index, isLast, expanded, editValues, saving, onExpand, onChange, onSave, onComplete,
}) => {
  const isComplete = !!cycle.completed_at;

  return (
    <div className="relative flex gap-3">
      {/* Dot + vertical connector */}
      <div className="flex flex-col items-center shrink-0">
        <button
          onClick={onExpand}
          title={expanded ? "Collapse" : "Click to edit"}
          className={cn(
            "h-8 w-8 rounded-full flex items-center justify-center text-xs font-black border-2 transition-all shrink-0",
            isComplete
              ? "bg-green-100 text-green-700 border-green-400"
              : expanded
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted text-muted-foreground border-border hover:border-primary/50 hover:text-primary"
          )}
        >
          {isComplete ? <CheckCircle2 className="h-4 w-4" /> : index + 1}
        </button>
        {!isLast && (
          <div className={cn("w-0.5 mt-1 flex-1 min-h-[32px]", isComplete ? "bg-green-300" : "bg-border")} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-4 min-w-0">
        {/* Clickable summary row */}
        <button className="w-full text-left mb-1" onClick={onExpand}>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold">{cycle.cycle_label}</span>
            <Badge className={cn("text-[10px] border-0", isComplete ? "bg-green-100 text-green-700" : "bg-blue-100 text-blue-700")}>
              {isComplete ? "Completed" : "Active"}
            </Badge>
            {cycle.started_at && (
              <span className="text-xs text-muted-foreground">{format(new Date(cycle.started_at), "dd MMM yy")}</span>
            )}
          </div>
          <p className={cn("text-xs mt-0.5 leading-snug", cycle.plan ? "text-muted-foreground" : "text-muted-foreground/40 italic")}>
            {cycle.plan
              ? (cycle.plan.length > 80 ? cycle.plan.slice(0, 80) + "…" : cycle.plan)
              : "No plan yet — click to add"}
          </p>
        </button>

        {/* Inline edit panel */}
        {expanded && (
          <div className="mt-2 rounded-lg border bg-card p-4 space-y-3 shadow-sm">
            {PDSA_FIELDS.map(({ key, label, placeholder, colour }) => (
              <div key={key} className={cn("rounded-md border p-3", colour)}>
                <div className="flex items-center gap-1.5 mb-1.5">
                  <div className="h-4 w-4 rounded-full bg-white/80 shadow-sm flex items-center justify-center">
                    <span className="text-[9px] font-black text-foreground">{label[0]}</span>
                  </div>
                  <span className="text-xs font-bold uppercase tracking-wider opacity-70">{label}</span>
                </div>
                <Textarea
                  className="text-sm h-20 resize-none bg-white/60"
                  placeholder={placeholder}
                  value={(editValues as any)[key]}
                  onChange={e => onChange(key, e.target.value)}
                />
              </div>
            ))}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div>
                {!isComplete ? (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onComplete}>
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Mark Complete
                  </Button>
                ) : (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Completed {cycle.completed_at ? format(new Date(cycle.completed_at), "dd MMM yy") : ""}
                  </span>
                )}
              </div>
              <Button size="sm" onClick={onSave} disabled={saving} className="h-7 text-xs">
                {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Main Page ────────────────────────────────────────────────────────────────

const QIProjectsPage: React.FC = () => {
  const { hospitalId, userId } = useHospitalId();
  const { toast } = useToast();

  const [projects, setProjects] = useState<QIProject[]>([]);
  const [selected, setSelected] = useState<QIProject | null>(null);
  const [cycles, setCycles] = useState<QICycle[]>([]);
  const [loading, setLoading] = useState(true);
  const [cyclesLoading, setCyclesLoading] = useState(false);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  // Edit notes local state
  const [notes, setNotes] = useState("");
  const [currentValue, setCurrentValue] = useState("");
  const [savingStatus, setSavingStatus] = useState(false);

  // Inline PDSA cycle editing
  const [expandedCycleId, setExpandedCycleId] = useState<string | null>(null);
  const [editingCycle, setEditingCycle] = useState({ plan: "", do_action: "", study: "", act: "" });
  const [savingCycle, setSavingCycle] = useState(false);
  const [addingCycle, setAddingCycle] = useState(false);

  // ── Loaders ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!hospitalId) return;
    loadProjects();
  }, [hospitalId]);

  const loadProjects = async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("qi_projects")
      .select("*, users:project_owner_id(full_name), clinical_audits:source_audit_id(title)")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(200);
    setProjects(data || []);
    setLoading(false);
  };

  const loadCycles = async (projectId: string) => {
    setCyclesLoading(true);
    const { data } = await (supabase as any)
      .from("qi_cycles").select("*")
      .eq("qi_project_id", projectId)
      .order("created_at", { ascending: true });
    setCycles(data || []);
    setCyclesLoading(false);
  };

  const selectProject = (p: QIProject) => {
    setSelected(p);
    setNotes(p.notes || "");
    setCurrentValue(p.current_value != null ? String(p.current_value) : "");
    setCycles([]);
    setExpandedCycleId(null);
    loadCycles(p.id);
  };

  // ── Status management ──────────────────────────────────────────────────────

  const updateStatus = async (status: string) => {
    if (!selected) return;
    setSavingStatus(true);
    await (supabase as any).from("qi_projects").update({ status }).eq("id", selected.id);
    const updated = { ...selected, status };
    setSelected(updated);
    setProjects(prev => prev.map(p => p.id === selected.id ? updated : p));
    setSavingStatus(false);
    toast({ title: "Status updated" });
  };

  const saveCurrentValue = async () => {
    if (!selected) return;
    const val = currentValue ? parseFloat(currentValue) : null;
    await (supabase as any).from("qi_projects").update({ current_value: val }).eq("id", selected.id);
    setSelected(s => s ? { ...s, current_value: val } : s);
    setProjects(prev => prev.map(p => p.id === selected.id ? { ...p, current_value: val } : p));
  };

  const saveNotes = async () => {
    if (!selected) return;
    await (supabase as any).from("qi_projects").update({ notes }).eq("id", selected.id);
    setSelected(s => s ? { ...s, notes } : s);
    setProjects(prev => prev.map(p => p.id === selected.id ? { ...p, notes } : p));
  };

  const completeCycle = async (cycleId: string) => {
    const now = new Date().toISOString();
    await (supabase as any).from("qi_cycles").update({ completed_at: now }).eq("id", cycleId);
    setCycles(prev => prev.map(c => c.id === cycleId ? { ...c, completed_at: now } : c));
    toast({ title: "Cycle marked complete" });
  };

  const addCycle = async () => {
    if (!selected || addingCycle) return;
    setAddingCycle(true);
    const label = `PDSA ${cycles.length + 1}`;
    const { data, error } = await (supabase as any).from("qi_cycles").insert({
      qi_project_id: selected.id,
      cycle_label: label,
      started_at: new Date().toISOString(),
    }).select().single();
    setAddingCycle(false);
    if (error) { toast({ title: "Failed to create cycle", description: error.message, variant: "destructive" }); return; }
    setCycles(prev => [...prev, data]);
    setExpandedCycleId(data.id);
    setEditingCycle({ plan: "", do_action: "", study: "", act: "" });
    toast({ title: `${label} created` });
  };

  const handleExpandCycle = (cycle: QICycle) => {
    if (expandedCycleId === cycle.id) {
      setExpandedCycleId(null);
      return;
    }
    setExpandedCycleId(cycle.id);
    setEditingCycle({
      plan: cycle.plan || "",
      do_action: cycle.do_action || "",
      study: cycle.study || "",
      act: cycle.act || "",
    });
  };

  const saveCycleFields = async () => {
    if (!expandedCycleId) return;
    setSavingCycle(true);
    await (supabase as any).from("qi_cycles").update({
      plan:      editingCycle.plan      || null,
      do_action: editingCycle.do_action || null,
      study:     editingCycle.study     || null,
      act:       editingCycle.act       || null,
    }).eq("id", expandedCycleId);
    setCycles(prev => prev.map(c => c.id === expandedCycleId
      ? { ...c, plan: editingCycle.plan || null, do_action: editingCycle.do_action || null,
               study: editingCycle.study || null, act: editingCycle.act || null }
      : c
    ));
    setSavingCycle(false);
    toast({ title: "Cycle saved" });
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const filtered = projects.filter(p => statusFilter === "all" || p.status === statusFilter);

  const progressPct = selected
    && selected.baseline_value != null && selected.target_value != null
    && selected.current_value != null
    && selected.target_value !== selected.baseline_value
    ? Math.min(100, Math.max(0, Math.round(
        ((selected.current_value - selected.baseline_value) / (selected.target_value - selected.baseline_value)) * 100
      )))
    : null;

  if (!hospitalId) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          <span className="text-base font-bold">QI Projects</span>
          <Badge variant="outline" className="text-xs ml-1">NABH QPS.8 — PDSA</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadProjects} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New QI Project
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ─────────────────────────────────────────────────── */}
        <div className="w-[310px] border-r border-border flex flex-col bg-card flex-shrink-0">
          {/* Status filter */}
          <div className="px-3 py-3 border-b border-border flex gap-1.5 flex-wrap">
            {["all", "active", "completed", "abandoned"].map(s => {
              const Icon = s !== "all" ? STATUS_ICON[s] : null;
              return (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={cn("flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors",
                    statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                  )}>
                  {Icon && <Icon className="h-3 w-3" />}
                  {s === "all" ? "All" : s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              );
            })}
          </div>

          {/* Project list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No projects found</div>
            ) : (
              filtered.map(p => {
                const Icon = STATUS_ICON[p.status] || AlertCircle;
                return (
                  <button key={p.id} onClick={() => selectProject(p)}
                    className={cn(
                      "w-full text-left px-3 py-3 border-b border-border/50 transition-colors",
                      selected?.id === p.id ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/40"
                    )}>
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <span className="text-sm font-medium leading-snug line-clamp-2">{p.title}</span>
                      <Badge className={cn("text-[10px] shrink-0 border-0 flex items-center gap-0.5", STATUS_COLOUR[p.status])}>
                        <Icon className="h-2.5 w-2.5" />
                        {p.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {p.users?.full_name && <span>{p.users.full_name} · </span>}
                      {p.start_date && <span>{format(new Date(p.start_date), "MMM yy")}</span>}
                    </div>
                    {p.baseline_value != null && p.target_value != null && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                          {p.current_value != null && (
                            <div className="h-full bg-primary rounded-full"
                              style={{ width: `${Math.min(100, Math.max(0, Math.round(((p.current_value - p.baseline_value) / (p.target_value - p.baseline_value)) * 100)))}%` }} />
                          )}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {p.current_value ?? p.baseline_value}→{p.target_value}
                        </span>
                      </div>
                    )}
                  </button>
                );
              })
            )}
          </div>
          <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
            {filtered.length} project{filtered.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto">
          {!selected ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
              <TrendingUp className="h-12 w-12 opacity-20" />
              <p className="text-sm">Select a QI project to view details</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Start First QI Project
              </Button>
            </div>
          ) : (
            <div className="p-5 max-w-3xl space-y-4">
              {/* Project header */}
              <div className="rounded-lg border bg-card p-4">
                {/* Baseline → Target progress bar */}
                {selected.baseline_value != null && selected.target_value != null && (
                  <div className="mb-4 pb-4 border-b border-border/60">
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-muted-foreground font-medium">
                        {selected.baseline_metric || "Metric"}: {selected.baseline_value} → {selected.target_value}
                      </span>
                      {progressPct != null ? (
                        <span className={cn("font-bold",
                          progressPct >= 100 ? "text-green-600" :
                          progressPct >= 70  ? "text-primary" :
                          progressPct >= 40  ? "text-amber-600" : "text-red-500"
                        )}>
                          {progressPct >= 100 ? "✓ Target reached" : `${progressPct}% to target`}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/60">Update current value to track progress</span>
                      )}
                    </div>
                    <div className="relative h-3 bg-muted rounded-full overflow-hidden">
                      {progressPct != null && (
                        <div
                          className={cn("h-full rounded-full transition-all duration-700",
                            progressPct >= 100 ? "bg-green-500" :
                            progressPct >= 70  ? "bg-primary" :
                            progressPct >= 40  ? "bg-amber-500" : "bg-red-400"
                          )}
                          style={{ width: `${Math.max(2, Math.min(100, progressPct))}%` }}
                        />
                      )}
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                      <span>Baseline: {selected.baseline_value}</span>
                      {selected.current_value != null && (
                        <span className="text-primary font-medium">Current: {selected.current_value}</span>
                      )}
                      <span>Target: {selected.target_value}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <h2 className="text-base font-bold">{selected.title}</h2>
                    {selected.users?.full_name && (
                      <p className="text-xs text-muted-foreground mt-0.5">Owner: {selected.users.full_name}</p>
                    )}
                    {selected.clinical_audits?.title && (
                      <p className="text-xs text-muted-foreground">Source audit: {selected.clinical_audits.title}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Select value={selected.status} onValueChange={updateStatus} disabled={savingStatus}>
                      <SelectTrigger className="h-7 text-xs w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="completed">Completed</SelectItem>
                        <SelectItem value="abandoned">Abandoned</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Problem Statement</p>
                    <p className="text-sm">{selected.problem_statement}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Aim Statement</p>
                    <p className="text-sm font-medium">{selected.aim_statement}</p>
                  </div>
                </div>
              </div>

              {/* Metrics */}
              {(selected.baseline_value != null || selected.target_value != null) && (
                <div className="rounded-lg border bg-card p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <Target className="h-4 w-4 text-primary" />
                    <p className="text-sm font-semibold">Metric Progress</p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center p-3 rounded bg-muted/30">
                      <p className="text-xs text-muted-foreground mb-1">Baseline</p>
                      <p className="text-xl font-bold">{selected.baseline_value ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{selected.baseline_metric || ""}</p>
                    </div>
                    <div className="text-center p-3 rounded bg-primary/5 border border-primary/20">
                      <p className="text-xs text-muted-foreground mb-1">Current</p>
                      <p className="text-xl font-bold text-primary">{selected.current_value ?? "—"}</p>
                      <div className="flex items-center gap-1 justify-center mt-1">
                        <Input
                          className="h-6 text-xs text-center w-16 border-primary/30"
                          type="number"
                          placeholder="Update"
                          value={currentValue}
                          onChange={e => setCurrentValue(e.target.value)}
                          onBlur={saveCurrentValue}
                        />
                      </div>
                    </div>
                    <div className="text-center p-3 rounded bg-green-50 border border-green-200">
                      <p className="text-xs text-muted-foreground mb-1">Target</p>
                      <p className="text-xl font-bold text-green-700">{selected.target_value ?? "—"}</p>
                      <p className="text-[10px] text-muted-foreground">{selected.target_metric || ""}</p>
                    </div>
                  </div>
                  {progressPct != null && (
                    <div>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">Progress to target</span>
                        <span className={cn("font-semibold", progressPct >= 100 ? "text-green-600" : progressPct >= 50 ? "text-primary" : "text-amber-600")}>
                          {progressPct}%
                        </span>
                      </div>
                      <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full transition-all", progressPct >= 100 ? "bg-green-500" : "bg-primary")}
                          style={{ width: `${Math.max(0, Math.min(100, progressPct))}%` }} />
                      </div>
                    </div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    {selected.start_date && <span>Started: {format(new Date(selected.start_date), "dd MMM yyyy")}</span>}
                    {selected.end_date && <span>Target completion: {format(new Date(selected.end_date), "dd MMM yyyy")}</span>}
                  </div>
                </div>
              )}

              {/* PDSA Cycles — Vertical Timeline */}
              <div className="rounded-lg border bg-card p-4">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {["P", "D", "S", "A"].map(l => (
                        <div key={l} className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center">
                          <span className="text-[9px] font-black text-primary">{l}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-sm font-semibold">PDSA Cycles</p>
                    <Badge variant="outline" className="text-xs">{cycles.length}</Badge>
                  </div>
                </div>

                {cyclesLoading ? (
                  <div className="flex items-center gap-2 py-4 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading cycles…
                  </div>
                ) : (
                  <div>
                    {/* Timeline nodes */}
                    {cycles.length === 0 && !cyclesLoading && (
                      <p className="text-sm text-muted-foreground text-center py-4">
                        No PDSA cycles yet — start one below.
                      </p>
                    )}
                    {cycles.map((c, i) => (
                      <CycleTimelineNode
                        key={c.id}
                        cycle={c}
                        index={i}
                        isLast={i === cycles.length - 1 && selected.status === "abandoned"}
                        expanded={expandedCycleId === c.id}
                        editValues={expandedCycleId === c.id ? editingCycle : {
                          plan: c.plan || "", do_action: c.do_action || "",
                          study: c.study || "", act: c.act || "",
                        }}
                        saving={savingCycle && expandedCycleId === c.id}
                        onExpand={() => handleExpandCycle(c)}
                        onChange={(k, v) => setEditingCycle(prev => ({ ...prev, [k]: v }))}
                        onSave={saveCycleFields}
                        onComplete={() => completeCycle(c.id)}
                      />
                    ))}

                    {/* + New PDSA Cycle — timeline tail node */}
                    {selected.status !== "abandoned" && (
                      <div className="flex items-center gap-3 mt-1">
                        <div className="shrink-0">
                          <button
                            onClick={addCycle}
                            disabled={addingCycle}
                            className={cn(
                              "h-8 w-8 rounded-full flex items-center justify-center border-2 border-dashed transition-colors",
                              addingCycle
                                ? "border-muted text-muted-foreground cursor-not-allowed"
                                : "border-primary/40 text-primary/60 hover:border-primary hover:text-primary hover:bg-primary/5"
                            )}
                          >
                            {addingCycle
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Plus className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                        <button
                          onClick={addCycle}
                          disabled={addingCycle}
                          className="text-sm text-primary/60 hover:text-primary transition-colors font-medium disabled:pointer-events-none"
                        >
                          + New PDSA Cycle
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Notes */}
              <div className="rounded-lg border bg-card p-4">
                <Label className="text-sm font-semibold">Project Notes</Label>
                <Textarea className="text-sm mt-2 h-24 resize-none"
                  placeholder="Meeting notes, committee decisions, obstacles, dependencies…"
                  value={notes} onChange={e => setNotes(e.target.value)}
                  onBlur={saveNotes} />
                <p className="text-xs text-muted-foreground mt-1">Auto-saves on blur</p>
              </div>
            </div>
          )}
        </div>
      </div>

      <CreateProjectDialog
        open={createOpen} onOpenChange={setCreateOpen}
        hospitalId={hospitalId} userId={userId}
        onCreated={p => { setProjects(prev => [p, ...prev]); selectProject(p); }}
      />
    </div>
  );
};

export default QIProjectsPage;
