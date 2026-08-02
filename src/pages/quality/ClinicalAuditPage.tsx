import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import NABHAssistantPanel from "@/components/nabh/NABHAssistantPanel";
import { cn } from "@/lib/utils";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import {
  Plus, Search, Loader2, Brain, ChevronRight, CheckCircle2, XCircle,
  TrendingUp, ArrowRight, RefreshCw, ClipboardList, Trash2, AlertTriangle,
} from "lucide-react";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Audit {
  id: string;
  title: string;
  department_id: string | null;
  objective: string;
  standard_criteria: string;
  data_source: string | null;
  sample_method: string | null;
  sample_size: number | null;
  period_from: string | null;
  period_to: string | null;
  status: string;
  conclusion: string | null;
  ai_summary: string | null;
  created_at: string;
  departments?: { name: string } | null;
}

interface AuditSample {
  id: string;
  audit_id: string;
  reference_id: string | null;
  reference_module: string | null;
  is_compliant: boolean | null;
  remarks: string | null;
}

interface StagedRow {
  _key: string;
  reference_id: string;
  display_id: string;
  reference_module: string;
  record_date: string | null;
  patient_name: string | null;
  is_compliant: boolean | null;
  remarks: string;
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_STEPS = ["planning", "data_collection", "analysis", "action", "closed"] as const;

const STATUS_LABEL: Record<string, string> = {
  planning: "Planning",
  data_collection: "Data Collection",
  analysis: "Analysis",
  action: "Action",
  closed: "Closed",
};

const STATUS_COLOUR: Record<string, string> = {
  planning: "bg-blue-100 text-blue-700",
  data_collection: "bg-amber-100 text-amber-700",
  analysis: "bg-purple-100 text-purple-700",
  action: "bg-orange-100 text-orange-700",
  closed: "bg-green-100 text-green-700",
};

const NEXT_STATUS: Record<string, string> = {
  planning: "data_collection",
  data_collection: "analysis",
  analysis: "action",
  action: "closed",
};

const ADVANCE_LABEL: Record<string, string> = {
  planning: "Start Data Collection",
  data_collection: "Move to Analysis",
  analysis: "Move to Action Stage",
  action: "Close Audit",
};

// ─── Create Audit Wizard ──────────────────────────────────────────────────────

interface WizardProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hospitalId: string;
  userId: string | null;
  departments: { id: string; name: string }[];
  onCreated: (a: Audit) => void;
}

const CreateAuditWizard: React.FC<WizardProps> = ({
  open, onOpenChange, hospitalId, userId, departments, onCreated,
}) => {
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    title: "", department_id: "", objective: "",
    standard_criteria: "", data_source: "", sample_method: "consecutive",
    sample_size: "10", period_from: "", period_to: "",
  });
  const set = (k: string, v: string) => setF(p => ({ ...p, [k]: v }));

  const reset = () => { setStep(1); setF({ title: "", department_id: "", objective: "", standard_criteria: "", data_source: "", sample_method: "consecutive", sample_size: "10", period_from: "", period_to: "" }); };

  const save = async () => {
    setSaving(true);
    const payload: any = {
      hospital_id: hospitalId, created_by: userId,
      title: f.title.trim(), objective: f.objective.trim(),
      standard_criteria: f.standard_criteria.trim(),
    };
    if (f.department_id) payload.department_id = f.department_id;
    if (f.data_source) payload.data_source = f.data_source;
    if (f.sample_method) payload.sample_method = f.sample_method;
    if (f.sample_size) payload.sample_size = parseInt(f.sample_size) || null;
    if (f.period_from) payload.period_from = f.period_from;
    if (f.period_to) payload.period_to = f.period_to;

    const { data, error } = await (supabase as any)
      .from("clinical_audits").insert(payload).select("*, departments(name)").single();
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Audit created", description: data.title });
    onCreated(data);
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog open={open} onOpenChange={v => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>New Clinical Audit — Step {step} of 3</DialogTitle></DialogHeader>
        <div className="flex gap-1 mb-2">
          {[1, 2, 3].map(s => <div key={s} className={`h-1 flex-1 rounded-full ${s <= step ? "bg-primary" : "bg-muted"}`} />)}
        </div>

        {step === 1 && (
          <div className="space-y-3">
            <div>
              <Label>Audit Title *</Label>
              <Input className="h-8 text-sm mt-1" placeholder="e.g. Antibiotic Prescription Compliance Audit"
                value={f.title} onChange={e => set("title", e.target.value)} />
            </div>
            <div>
              <Label>Department</Label>
              <Select value={f.department_id} onValueChange={v => set("department_id", v)}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="All departments" /></SelectTrigger>
                <SelectContent>{departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Audit Objective *</Label>
              <Textarea className="text-sm mt-1 h-24 resize-none"
                placeholder="What are you measuring and why? e.g. Assess compliance with antibiotic prescription policy across all OPD consultations."
                value={f.objective} onChange={e => set("objective", e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button size="sm" disabled={!f.title.trim() || !f.objective.trim()} onClick={() => setStep(2)}>
                Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div>
              <Label>Audit Criteria / Standard *</Label>
              <Textarea className="text-sm mt-1 h-28 resize-none"
                placeholder="Define what constitutes compliance, e.g. 'Prescription includes diagnosis, generic name, dose, route, and duration'"
                value={f.standard_criteria} onChange={e => set("standard_criteria", e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Data Source</Label>
                <Input className="h-8 text-sm mt-1" placeholder="e.g. OPD Prescriptions"
                  value={f.data_source} onChange={e => set("data_source", e.target.value)} />
              </div>
              <div>
                <Label>Sample Method</Label>
                <Select value={f.sample_method} onValueChange={v => set("sample_method", v)}>
                  <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="consecutive">Consecutive</SelectItem>
                    <SelectItem value="random">Random</SelectItem>
                    <SelectItem value="all">All</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Target Sample Size</Label>
              <Input className="h-8 text-sm mt-1 w-28" type="number" min={5} max={500}
                value={f.sample_size} onChange={e => set("sample_size", e.target.value)} />
            </div>
            <div className="flex justify-between pt-1">
              <Button size="sm" variant="outline" onClick={() => setStep(1)}>Back</Button>
              <Button size="sm" disabled={!f.standard_criteria.trim()} onClick={() => setStep(3)}>
                Next <ChevronRight className="h-3.5 w-3.5 ml-1" />
              </Button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Period From</Label>
                <Input type="date" className="h-8 text-sm mt-1" value={f.period_from} onChange={e => set("period_from", e.target.value)} />
              </div>
              <div><Label>Period To</Label>
                <Input type="date" className="h-8 text-sm mt-1" value={f.period_to} onChange={e => set("period_to", e.target.value)} />
              </div>
            </div>
            <div className="rounded-md bg-muted/30 border p-3 text-xs space-y-1">
              <p className="font-semibold text-foreground">Summary</p>
              <p><span className="text-muted-foreground">Title:</span> {f.title}</p>
              <p><span className="text-muted-foreground">Objective:</span> {f.objective.slice(0, 100)}{f.objective.length > 100 ? "…" : ""}</p>
              <p><span className="text-muted-foreground">Sample:</span> {f.sample_size} {f.sample_method} records from {f.data_source || "manual entry"}</p>
            </div>
            <div className="flex justify-between pt-1">
              <Button size="sm" variant="outline" onClick={() => setStep(2)}>Back</Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Create Audit
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ─── Convert to QI Dialog ─────────────────────────────────────────────────────

interface ConvertQIProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  audit: Audit;
  compliancePct: number | null;
  hospitalId: string;
  userId: string | null;
  onCreated: () => void;
}

const ConvertToQIDialog: React.FC<ConvertQIProps> = ({
  open, onOpenChange, audit, compliancePct, hospitalId, userId, onCreated,
}) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [f, setF] = useState({
    title: audit.title,
    problem_statement: audit.conclusion || audit.objective,
    aim_statement: "",
    baseline_metric: audit.standard_criteria.slice(0, 80),
    baseline_value: compliancePct != null ? String(Math.round(compliancePct)) : "",
    target_value: "80",
    start_date: new Date().toISOString().split("T")[0],
  });

  // Read through a ref so this stays keyed on audit.id: it pre-fills the QI form
  // when a DIFFERENT audit is converted, and must not wipe what the user has typed
  // every time the audit object is refetched.
  const auditRef = useRef(audit);
  useEffect(() => { auditRef.current = audit; });

  useEffect(() => {
    const audit = auditRef.current;
    setF({
      title: audit.title,
      problem_statement: audit.conclusion || audit.objective,
      aim_statement: "",
      baseline_metric: audit.standard_criteria.slice(0, 80),
      baseline_value: compliancePct != null ? String(Math.round(compliancePct)) : "",
      target_value: "80",
      start_date: new Date().toISOString().split("T")[0],
    });
  }, [audit.id, compliancePct]);

  const save = async () => {
    if (!f.aim_statement.trim()) { toast({ title: "Aim statement required", variant: "destructive" }); return; }
    setSaving(true);
    const { data, error } = await (supabase as any).from("qi_projects").insert({
      hospital_id: hospitalId,
      title: f.title,
      problem_statement: f.problem_statement,
      aim_statement: f.aim_statement,
      baseline_metric: f.baseline_metric || null,
      baseline_value: f.baseline_value ? parseFloat(f.baseline_value) : null,
      target_metric: audit.standard_criteria.slice(0, 80),
      target_value: f.target_value ? parseFloat(f.target_value) : null,
      start_date: f.start_date || null,
      project_owner_id: userId,
      source_audit_id: audit.id,
    }).select("id").single();
    setSaving(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "QI Project created", description: "Navigating to QI Projects…" });
    onCreated();
    onOpenChange(false);
    navigate("/quality/qi-projects");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Convert to QI Project</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground -mt-2 mb-3">
          Audit finding ({compliancePct != null ? `${Math.round(compliancePct)}% compliance` : "incomplete"}) will drive a new PDSA cycle.
        </p>
        <div className="space-y-3">
          <div><Label>Project Title</Label>
            <Input className="h-8 text-sm mt-1" value={f.title} onChange={e => setF(p => ({ ...p, title: e.target.value }))} />
          </div>
          <div><Label>Problem Statement</Label>
            <Textarea className="text-sm mt-1 h-20 resize-none" value={f.problem_statement}
              onChange={e => setF(p => ({ ...p, problem_statement: e.target.value }))} />
          </div>
          <div><Label>Aim Statement * <span className="text-muted-foreground font-normal">(SMART goal)</span></Label>
            <Textarea className="text-sm mt-1 h-16 resize-none"
              placeholder="e.g. Improve antibiotic prescription compliance from 45% to 80% within 3 months"
              value={f.aim_statement} onChange={e => setF(p => ({ ...p, aim_statement: e.target.value }))} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Baseline %</Label>
              <Input className="h-8 text-sm mt-1" type="number" value={f.baseline_value}
                onChange={e => setF(p => ({ ...p, baseline_value: e.target.value }))} />
            </div>
            <div><Label>Target %</Label>
              <Input className="h-8 text-sm mt-1" type="number" value={f.target_value}
                onChange={e => setF(p => ({ ...p, target_value: e.target.value }))} />
            </div>
            <div><Label>Start Date</Label>
              <Input type="date" className="h-8 text-sm mt-1" value={f.start_date}
                onChange={e => setF(p => ({ ...p, start_date: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
              Create QI Project
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ─── Utility ──────────────────────────────────────────────────────────────────

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const ClinicalAuditPage: React.FC = () => {
  const { hospitalId, userId } = useHospitalId();
  const { toast } = useToast();

  const [audits, setAudits] = useState<Audit[]>([]);
  const [selected, setSelected] = useState<Audit | null>(null);
  const [samples, setSamples] = useState<AuditSample[]>([]);
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [samplesLoading, setSamplesLoading] = useState(false);
  const [detailTab, setDetailTab] = useState("overview");

  // Filters
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");

  // Modals
  const [createOpen, setCreateOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [summaryDialogOpen, setSummaryDialogOpen] = useState(false);

  // AI state
  const [aiCriteriaLoading, setAiCriteriaLoading] = useState(false);
  const [aiCriteriaText, setAiCriteriaText] = useState("");
  const [aiCriteriaConfirmed, setAiCriteriaConfirmed] = useState(false);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryText, setAiSummaryText] = useState("");
  const [aiSummaryConfirmed, setAiSummaryConfirmed] = useState(false);

  // Sample entry
  const [addSampleOpen, setAddSampleOpen] = useState(false);
  const [newSample, setNewSample] = useState({ reference_module: "OPD", is_compliant: "", remarks: "" });
  const [savingSample, setSavingSample] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [stagedSamples, setStagedSamples] = useState<StagedRow[]>([]);
  const [savingStaged, setSavingStaged] = useState(false);

  // Conclusion (local edit before save)
  const [conclusion, setConclusion] = useState("");

  // ── Loaders ────────────────────────────────────────────────────────────────


  const loadAudits = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data } = await (supabase as any)
      .from("clinical_audits").select("*, departments(name)")
      .eq("hospital_id", hospitalId).order("created_at", { ascending: false }).limit(200);
    setAudits(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    if (!hospitalId) return;
    (supabase as any).from("departments").select("id,name").eq("hospital_id", hospitalId).order("name")
      .then(({ data }: any) => setDepartments(data || []));
    loadAudits();
  }, [loadAudits, hospitalId]);

  const loadSamples = async (auditId: string) => {
    setSamplesLoading(true);
    const { data } = await (supabase as any)
      .from("clinical_audit_samples").select("*")
      .eq("audit_id", auditId).order("created_at", { ascending: true });
    setSamples(data || []);
    setSamplesLoading(false);
  };

  const selectAudit = (a: Audit) => {
    setSelected(a);
    setConclusion(a.conclusion || "");
    setAiCriteriaText("");
    setAiCriteriaConfirmed(false);
    setSamples([]);
    setStagedSamples([]);
    loadSamples(a.id);
    setDetailTab("overview");
  };

  // ── Status advancement ─────────────────────────────────────────────────────

  const advanceStatus = async () => {
    if (!selected || selected.status === "closed") return;
    const next = NEXT_STATUS[selected.status];
    const { error } = await (supabase as any)
      .from("clinical_audits").update({ status: next }).eq("id", selected.id);
    if (error) { toast({ title: "Update failed", description: error.message, variant: "destructive" }); return; }
    const updated = { ...selected, status: next };
    setSelected(updated);
    setAudits(prev => prev.map(a => a.id === selected.id ? updated : a));
    toast({ title: `Status updated to ${STATUS_LABEL[next]}` });
    if (next === "analysis") setDetailTab("analysis");
    if (next === "data_collection") setDetailTab("data");
  };

  // ── Sample management ──────────────────────────────────────────────────────

  const saveSample = async () => {
    if (!selected) return;
    setSavingSample(true);
    const { data, error } = await (supabase as any).from("clinical_audit_samples").insert({
      audit_id: selected.id,
      reference_module: newSample.reference_module || null,
      is_compliant: newSample.is_compliant === "true" ? true : newSample.is_compliant === "false" ? false : null,
      remarks: newSample.remarks || null,
    }).select().single();
    setSavingSample(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    setSamples(prev => [...prev, data]);
    setNewSample({ reference_module: "OPD", is_compliant: "", remarks: "" });
    setAddSampleOpen(false);
  };

  const toggleCompliant = async (sample: AuditSample, value: boolean | null) => {
    await (supabase as any).from("clinical_audit_samples").update({ is_compliant: value }).eq("id", sample.id);
    setSamples(prev => prev.map(s => s.id === sample.id ? { ...s, is_compliant: value } : s));
  };

  const deleteSample = async (id: string) => {
    await (supabase as any).from("clinical_audit_samples").delete().eq("id", id);
    setSamples(prev => prev.filter(s => s.id !== id));
  };

  const generateSamples = async () => {
    if (!selected || !hospitalId) return;
    setGenerating(true);

    const src = (selected.data_source || "").toLowerCase();
    const size = selected.sample_size || 10;
    const fetchLimit = Math.min(size * 5, 500);
    const from = selected.period_from;
    const to = selected.period_to || new Date().toISOString().split("T")[0];

    let staged: StagedRow[] = [];

    try {
      if (src.includes("opd") || src.includes("encounter") || src.includes("prescription")) {
        const q = (supabase as any)
          .from("opd_tokens")
          .select("id, token_number, created_at, patients(full_name)")
          .eq("hospital_id", hospitalId)
          .order("created_at", { ascending: false })
          .limit(fetchLimit);
        if (from) q.gte("created_at", from + "T00:00:00Z");
        q.lte("created_at", to + "T23:59:59Z");
        const { data, error } = await q;
        if (error) throw error;
        staged = shuffleArray(data || []).slice(0, size).map((r: any) => ({
          _key: `opd-${r.id}`,
          reference_id: r.id,
          display_id: r.token_number ? `T-${r.token_number}` : r.id.slice(0, 8),
          reference_module: "OPD",
          record_date: r.created_at ? r.created_at.split("T")[0] : null,
          patient_name: r.patients?.full_name || null,
          is_compliant: null,
          remarks: "",
        }));
      } else if (src.includes("ipd") || src.includes("admission")) {
        const q = (supabase as any)
          .from("admissions")
          .select("id, admission_date, patients(full_name, uhid)")
          .eq("hospital_id", hospitalId)
          .order("admission_date", { ascending: false })
          .limit(fetchLimit);
        if (from) q.gte("admission_date", from);
        if (to) q.lte("admission_date", to);
        const { data, error } = await q;
        if (error) throw error;
        staged = shuffleArray(data || []).slice(0, size).map((r: any) => ({
          _key: `ipd-${r.id}`,
          reference_id: r.id,
          display_id: r.patients?.uhid || r.id.slice(0, 8),
          reference_module: "IPD",
          record_date: r.admission_date || null,
          patient_name: r.patients?.full_name || null,
          is_compliant: null,
          remarks: "",
        }));
      } else if (src.includes("lab")) {
        const q = (supabase as any)
          .from("lab_orders")
          .select("id, created_at, patients(full_name)")
          .eq("hospital_id", hospitalId)
          .order("created_at", { ascending: false })
          .limit(fetchLimit);
        if (from) q.gte("created_at", from + "T00:00:00Z");
        q.lte("created_at", to + "T23:59:59Z");
        const { data, error } = await q;
        if (error) throw error;
        staged = shuffleArray(data || []).slice(0, size).map((r: any) => ({
          _key: `lab-${r.id}`,
          reference_id: r.id,
          display_id: r.id.slice(0, 8),
          reference_module: "Lab",
          record_date: r.created_at ? r.created_at.split("T")[0] : null,
          patient_name: r.patients?.full_name || null,
          is_compliant: null,
          remarks: "",
        }));
      } else if (src.includes("bill")) {
        const q = (supabase as any)
          .from("bills")
          .select("id, bill_date, created_at, patients(full_name)")
          .eq("hospital_id", hospitalId)
          .order("created_at", { ascending: false })
          .limit(fetchLimit);
        if (from) q.gte("created_at", from + "T00:00:00Z");
        q.lte("created_at", to + "T23:59:59Z");
        const { data, error } = await q;
        if (error) throw error;
        staged = shuffleArray(data || []).slice(0, size).map((r: any) => ({
          _key: `bill-${r.id}`,
          reference_id: r.id,
          display_id: r.id.slice(0, 8),
          reference_module: "Billing",
          record_date: r.bill_date || (r.created_at ? r.created_at.split("T")[0] : null),
          patient_name: r.patients?.full_name || null,
          is_compliant: null,
          remarks: "",
        }));
      } else {
        toast({
          title: "Auto-sampling unavailable",
          description: "Set Data Source to one of: 'OPD Encounters', 'Prescriptions', 'Lab Orders', 'IPD Admissions', or 'Bills'.",
        });
        setGenerating(false);
        return;
      }
    } catch (e: any) {
      toast({ title: "Failed to fetch records", description: e?.message || "Unknown error", variant: "destructive" });
      setGenerating(false);
      return;
    }

    if (!staged.length) {
      toast({ title: "No records found", description: "No matching records in the selected period." });
      setGenerating(false);
      return;
    }

    setStagedSamples(staged);
    setGenerating(false);
    toast({ title: `${staged.length} records ready for review`, description: "Mark compliance for each row, then click 'Save Sample'." });
  };

  const saveStagedSamples = async () => {
    if (!selected || !stagedSamples.length) return;
    setSavingStaged(true);
    const payload = stagedSamples.map(row => ({
      audit_id: selected.id,
      reference_id: row.reference_id,
      reference_module: row.reference_module,
      is_compliant: row.is_compliant,
      remarks: [
        row.patient_name,
        row.record_date ? format(new Date(row.record_date), "dd MMM yyyy") : null,
        row.remarks || null,
      ].filter(Boolean).join(" — ") || null,
    }));
    const { error } = await (supabase as any).from("clinical_audit_samples").insert(payload);
    setSavingStaged(false);
    if (error) {
      toast({ title: "Failed to save samples", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `${payload.length} samples saved` });
    setStagedSamples([]);
    loadSamples(selected.id);
  };

  // ── Conclusion save ────────────────────────────────────────────────────────

  const saveConclusion = async () => {
    if (!selected) return;
    await (supabase as any).from("clinical_audits").update({ conclusion }).eq("id", selected.id);
    setSelected(s => s ? { ...s, conclusion } : s);
    setAudits(prev => prev.map(a => a.id === selected.id ? { ...a, conclusion } : a));
  };

  // ── AI: Draft Criteria ─────────────────────────────────────────────────────

  const draftCriteria = async () => {
    if (!selected) return;
    setAiCriteriaLoading(true);
    setAiCriteriaText("");
    setAiCriteriaConfirmed(false);
    const prompt = `You are a clinical quality officer helping define measurable audit criteria for a NABH clinical audit.

Audit Title: ${selected.title}
Objective: ${selected.objective}
Data Source: ${selected.data_source || "Not specified"}
Current Criteria: ${selected.standard_criteria}

Draft clear, measurable audit criteria. Include:
1. Definition of "compliant" (specific, binary where possible)
2. Data elements to verify per sample record
3. Inclusion/exclusion criteria for the sample
4. Suggested minimum compliance benchmark (%)
5. NABH standard reference if applicable

Keep it concise and clinically specific.`;
    try {
      const result = await callAI({ featureKey: "nabh_criteria_mapper", hospitalId, prompt, maxTokens: 600 });
      if (result.error || !result.text) {
        setAiCriteriaText("AI unavailable. Please define criteria manually.");
        toast({ title: "AI unavailable", description: result.error, variant: "destructive" });
      } else {
        setAiCriteriaText(result.text);
      }
    } catch {
      setAiCriteriaText("AI unavailable. Please define criteria manually.");
    }
    setAiCriteriaLoading(false);
  };

  const applyCriteria = async () => {
    if (!selected || !aiCriteriaText.trim()) return;
    await (supabase as any).from("clinical_audits").update({ standard_criteria: aiCriteriaText }).eq("id", selected.id);
    const updated = { ...selected, standard_criteria: aiCriteriaText };
    setSelected(updated);
    setAudits(prev => prev.map(a => a.id === selected.id ? updated : a));
    setAiCriteriaText("");
    setAiCriteriaConfirmed(false);
    toast({ title: "Criteria updated" });
  };

  // ── AI: Summarise Findings ─────────────────────────────────────────────────

  const summariseFindings = async () => {
    if (!selected) return;
    setSummaryDialogOpen(true);
    setAiSummaryLoading(true);
    setAiSummaryText("");
    setAiSummaryConfirmed(false);

    const total = samples.length;
    const compliant = samples.filter(s => s.is_compliant === true).length;
    const nonCompliant = samples.filter(s => s.is_compliant === false).length;
    const pending = total - compliant - nonCompliant;
    const pct = total > 0 ? Math.round((compliant / total) * 100) : 0;

    const prompt = `You are a clinical quality officer preparing a formal audit report for a NABH Quality Committee.

Audit: ${selected.title}
Department: ${selected.departments?.name || "Not specified"}
Period: ${selected.period_from || "Not set"} to ${selected.period_to || "Not set"}
Objective: ${selected.objective}
Criteria: ${selected.standard_criteria}
Data Source: ${selected.data_source || "Manual"}
Sample Size: ${total} (${selected.sample_size || "—"} planned)

Results:
- Total reviewed: ${total}
- Compliant: ${compliant} (${pct}%)
- Non-compliant: ${nonCompliant}
- Pending review: ${pending}

${conclusion ? `Auditor notes: ${conclusion}` : ""}

Write a formal 3–4 paragraph audit narrative suitable for Quality Committee minutes. Cover: findings, analysis of gaps, areas of concern, and specific actionable recommendations. Use formal clinical language.`;

    try {
      const result = await callAI({ featureKey: "nabh_criteria_mapper", hospitalId, prompt, maxTokens: 600 });
      if (result.error || !result.text) {
        setAiSummaryText("AI unavailable. Please write the summary manually.");
        toast({ title: "AI unavailable", description: result.error, variant: "destructive" });
      } else {
        setAiSummaryText(result.text);
      }
    } catch {
      setAiSummaryText("AI unavailable. Please write the summary manually.");
    }
    setAiSummaryLoading(false);
  };

  const applySummary = async () => {
    if (!selected || !aiSummaryText.trim()) return;
    await (supabase as any).from("clinical_audits").update({ ai_summary: aiSummaryText }).eq("id", selected.id);
    setSelected(s => s ? { ...s, ai_summary: aiSummaryText } : s);
    setSummaryDialogOpen(false);
    toast({ title: "Summary saved to audit record" });
  };

  // ── Derived ────────────────────────────────────────────────────────────────

  const reviewedSamples = samples.filter(s => s.is_compliant !== null);
  const compliantCount = samples.filter(s => s.is_compliant === true).length;
  const nonCompliantCount = samples.filter(s => s.is_compliant === false).length;
  const compliancePct = reviewedSamples.length > 0
    ? Math.round((compliantCount / reviewedSamples.length) * 100) : null;

  const stagedReviewed = stagedSamples.filter(s => s.is_compliant !== null).length;
  const stagedCompliant = stagedSamples.filter(s => s.is_compliant === true).length;
  const stagedPct = stagedReviewed > 0 ? Math.round((stagedCompliant / stagedReviewed) * 100) : null;

  const chartData = [
    { name: "Compliant", value: compliantCount, fill: "#22c55e" },
    { name: "Non-Compliant", value: nonCompliantCount, fill: "#ef4444" },
    { name: "Pending", value: samples.length - reviewedSamples.length, fill: "#d1d5db" },
  ];

  const filtered = audits.filter(a => {
    if (statusFilter !== "all" && a.status !== statusFilter) return false;
    if (deptFilter !== "all" && a.department_id !== deptFilter) return false;
    if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  if (!hospitalId) return <div className="p-8 text-muted-foreground">Loading…</div>;

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="h-[52px] flex-shrink-0 bg-card border-b border-border flex items-center justify-between px-5">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-5 w-5 text-primary" />
          <span className="text-base font-bold">Clinical Audits</span>
          <Badge variant="outline" className="text-xs ml-1">NABH QPS.7</Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={loadAudits} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </Button>
          {hospitalId && (
            <NABHAssistantPanel
              hospitalId={hospitalId}
              contextType="audit"
              evidenceTitle="Clinical Audit Summary"
              moduleReference="ClinicalAuditPage"
            />
          )}
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-3.5 w-3.5 mr-1" /> New Audit
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* ── Left panel ─────────────────────────────────────────────────── */}
        <div className="w-[310px] border-r border-border flex flex-col bg-card flex-shrink-0">
          {/* Search */}
          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-muted-foreground" />
              <Input className="h-7 pl-8 text-sm bg-muted/40" placeholder="Search audits…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
          {/* Status filter */}
          <div className="px-3 py-2 border-b border-border flex flex-wrap gap-1">
            {["all", ...STATUS_STEPS].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)}
                className={cn("px-2 py-0.5 rounded-full text-xs font-medium transition-colors",
                  statusFilter === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"
                )}>
                {s === "all" ? "All" : STATUS_LABEL[s]}
              </button>
            ))}
          </div>
          {/* Dept filter */}
          {departments.length > 0 && (
            <div className="px-3 py-2 border-b border-border">
              <Select value={deptFilter} onValueChange={setDeptFilter}>
                <SelectTrigger className="h-7 text-xs"><SelectValue placeholder="All departments" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {departments.map(d => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          {/* Audit list */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-4 text-center text-sm text-muted-foreground">No audits found</div>
            ) : (
              filtered.map(a => (
                <button key={a.id} onClick={() => selectAudit(a)}
                  className={cn(
                    "w-full text-left px-3 py-3 border-b border-border/50 transition-colors",
                    selected?.id === a.id ? "bg-primary/8 border-l-2 border-l-primary" : "hover:bg-muted/40"
                  )}>
                  <div className="flex items-start justify-between gap-1 mb-1">
                    <span className="text-sm font-medium leading-snug line-clamp-2">{a.title}</span>
                    <Badge className={cn("text-[10px] shrink-0 border-0", STATUS_COLOUR[a.status])}>
                      {STATUS_LABEL[a.status]}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {a.departments?.name && <span>{a.departments.name}</span>}
                    <span>{format(new Date(a.created_at), "dd MMM yy")}</span>
                  </div>
                </button>
              ))
            )}
          </div>
          <div className="px-3 py-2 border-t border-border text-xs text-muted-foreground">
            {filtered.length} audit{filtered.length !== 1 ? "s" : ""}
          </div>
        </div>

        {/* ── Right panel ────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
              <ClipboardList className="h-12 w-12 opacity-20" />
              <p className="text-sm">Select an audit to view details</p>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Create First Audit
              </Button>
            </div>
          ) : (
            <>
              {/* Audit header */}
              <div className="flex-shrink-0 px-5 py-3 border-b border-border bg-card">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{selected.title}</h2>
                    <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                      {selected.departments?.name && <span>{selected.departments.name}</span>}
                      {selected.period_from && <span>· {format(new Date(selected.period_from), "dd MMM yy")} – {selected.period_to ? format(new Date(selected.period_to), "dd MMM yy") : "ongoing"}</span>}
                      {selected.data_source && <span>· {selected.data_source}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge className={cn("border-0 text-xs", STATUS_COLOUR[selected.status])}>
                      {STATUS_LABEL[selected.status]}
                    </Badge>
                    {selected.status !== "closed" && (
                      <Button size="sm" className="text-xs h-7" onClick={advanceStatus}>
                        {ADVANCE_LABEL[selected.status]} <ArrowRight className="h-3 w-3 ml-1" />
                      </Button>
                    )}
                  </div>
                </div>
                {/* Status stepper */}
                <div className="flex items-center gap-0 mt-3">
                  {STATUS_STEPS.map((s, i) => {
                    const si = STATUS_STEPS.indexOf(selected.status as any);
                    const done = i < si;
                    const active = i === si;
                    return (
                      <React.Fragment key={s}>
                        <div className={cn(
                          "h-1.5 flex-1 rounded-full transition-colors",
                          done ? "bg-primary" : active ? "bg-primary/50" : "bg-muted"
                        )} />
                        {i < STATUS_STEPS.length - 1 && <div className="w-0.5" />}
                      </React.Fragment>
                    );
                  })}
                </div>
                <div className="flex justify-between mt-1">
                  {STATUS_STEPS.map(s => (
                    <span key={s} className={cn("text-[9px]", selected.status === s ? "text-primary font-semibold" : "text-muted-foreground")}>
                      {STATUS_LABEL[s]}
                    </span>
                  ))}
                </div>
              </div>

              {/* Tabs */}
              <Tabs value={detailTab} onValueChange={setDetailTab} className="flex-1 overflow-hidden flex flex-col">
                <TabsList className="h-9 rounded-none border-b border-border bg-card px-4 justify-start flex-shrink-0">
                  {[
                    { v: "overview", l: "Overview" },
                    { v: "data", l: `Data Collection (${samples.length})` },
                    { v: "analysis", l: "Analysis" },
                  ].map(t => (
                    <TabsTrigger key={t.v} value={t.v}
                      className="text-[13px] rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:text-primary data-[state=active]:shadow-none data-[state=active]:bg-transparent px-4 h-full"
                    >{t.l}</TabsTrigger>
                  ))}
                </TabsList>

                {/* ── Overview ──────────────────────────────────────────── */}
                <TabsContent value="overview" className="flex-1 overflow-auto m-0 p-5">
                  <div className="max-w-2xl space-y-4">
                    <div className="rounded-lg border bg-card p-4 space-y-3">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Objective</p>
                        <p className="text-sm">{selected.objective}</p>
                      </div>
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Audit Criteria / Standard</p>
                        <p className="text-sm whitespace-pre-wrap">{selected.standard_criteria}</p>
                      </div>
                      <div className="grid grid-cols-3 gap-4 pt-1">
                        <div>
                          <p className="text-xs text-muted-foreground">Sample Method</p>
                          <p className="text-sm font-medium capitalize">{selected.sample_method || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Target Sample Size</p>
                          <p className="text-sm font-medium">{selected.sample_size || "—"}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Data Source</p>
                          <p className="text-sm font-medium">{selected.data_source || "Manual"}</p>
                        </div>
                      </div>
                    </div>

                    {/* AI Draft Criteria */}
                    <div className="rounded-lg border bg-card p-4">
                      <div className="flex items-center gap-2 mb-3">
                        <Brain className="h-4 w-4 text-primary" />
                        <p className="text-sm font-semibold">AI Criteria Assistant</p>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        Use AI to draft precise, measurable audit criteria based on your objective and NABH standards.
                      </p>
                      <Button size="sm" variant="outline" onClick={draftCriteria} disabled={aiCriteriaLoading}>
                        {aiCriteriaLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Brain className="h-3.5 w-3.5 mr-1" />}
                        {aiCriteriaLoading ? "Drafting…" : "Draft Criteria with AI"}
                      </Button>

                      {aiCriteriaText && (
                        <div className="mt-3 space-y-2">
                          <Textarea className="text-sm h-40 resize-none" value={aiCriteriaText}
                            onChange={e => setAiCriteriaText(e.target.value)} />
                          <div className={cn("rounded border p-2.5", aiCriteriaConfirmed ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50")}>
                            <div className="flex items-start gap-2">
                              <Checkbox id="criteria_confirm" checked={aiCriteriaConfirmed}
                                onCheckedChange={v => setAiCriteriaConfirmed(!!v)} className="mt-0.5" />
                              <Label htmlFor="criteria_confirm" className="text-xs cursor-pointer leading-snug">
                                I confirm this AI-drafted criteria is clinically appropriate and suitable for this audit.
                              </Label>
                            </div>
                          </div>
                          {aiCriteriaConfirmed && (
                            <Button size="sm" onClick={applyCriteria}>
                              <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Apply to Audit Criteria
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* ── Data Collection ────────────────────────────────────── */}
                <TabsContent value="data" className="flex-1 overflow-auto m-0 p-5">
                  <div className="max-w-3xl space-y-4">
                    {/* Summary */}
                    <div className="grid grid-cols-4 gap-3">
                      {[
                        { label: "Total", value: samples.length, colour: "bg-card" },
                        { label: "Compliant", value: compliantCount, colour: "bg-green-50 border-green-200" },
                        { label: "Non-Compliant", value: nonCompliantCount, colour: "bg-red-50 border-red-200" },
                        { label: "Pending", value: samples.length - reviewedSamples.length, colour: "bg-amber-50 border-amber-200" },
                      ].map(c => (
                        <div key={c.label} className={`rounded-lg border p-3 ${c.colour}`}>
                          <p className="text-xs text-muted-foreground">{c.label}</p>
                          <p className="text-2xl font-bold">{c.value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => setAddSampleOpen(true)}>
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add Sample
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={generateSamples}
                        disabled={generating || !selected.data_source || stagedSamples.length > 0}
                        title={stagedSamples.length > 0 ? "Save or discard the current preview first" : undefined}
                      >
                        {generating
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                          : <RefreshCw className="h-3.5 w-3.5 mr-1" />}
                        {generating ? "Fetching…" : "Generate Sample"}
                        {!selected.data_source && <span className="ml-1 text-muted-foreground">(set data source first)</span>}
                      </Button>
                    </div>

                    {/* Add sample dialog */}
                    <Dialog open={addSampleOpen} onOpenChange={setAddSampleOpen}>
                      <DialogContent className="max-w-sm">
                        <DialogHeader><DialogTitle>Add Sample Record</DialogTitle></DialogHeader>
                        <div className="space-y-3 mt-1">
                          <div>
                            <Label>Module / Source</Label>
                            <Select value={newSample.reference_module} onValueChange={v => setNewSample(p => ({ ...p, reference_module: v }))}>
                              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {["OPD", "IPD", "Lab", "OT", "Billing", "Pharmacy", "Other"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Compliance</Label>
                            <Select value={newSample.is_compliant} onValueChange={v => setNewSample(p => ({ ...p, is_compliant: v }))}>
                              <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Mark compliance" /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="true">Compliant ✓</SelectItem>
                                <SelectItem value="false">Non-Compliant ✗</SelectItem>
                                <SelectItem value="">Pending review</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div>
                            <Label>Remarks / Reference</Label>
                            <Textarea className="text-sm mt-1 h-16 resize-none"
                              placeholder="Patient name, record ID, or observation notes"
                              value={newSample.remarks} onChange={e => setNewSample(p => ({ ...p, remarks: e.target.value }))} />
                          </div>
                          <div className="flex justify-end gap-2">
                            <Button size="sm" variant="outline" onClick={() => setAddSampleOpen(false)}>Cancel</Button>
                            <Button size="sm" onClick={saveSample} disabled={savingSample}>
                              {savingSample && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />} Add
                            </Button>
                          </div>
                        </div>
                      </DialogContent>
                    </Dialog>

                    {/* Staged sample preview panel */}
                    {stagedSamples.length > 0 && (
                      <div className="rounded-lg border border-amber-200 overflow-hidden">
                        {/* Panel header */}
                        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border-b border-amber-200">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-amber-900">
                              Generated Preview — {stagedSamples.length} records from {selected.data_source}
                            </p>
                            <p className="text-xs text-amber-700 mt-0.5">
                              {stagedPct != null
                                ? `${stagedPct}% compliant (${stagedCompliant}/${stagedReviewed} reviewed)`
                                : "Mark compliance for each record, then save"}
                            </p>
                          </div>
                          {stagedPct != null && (
                            <div className={cn(
                              "px-3 py-1 rounded-full text-sm font-black shrink-0",
                              stagedPct >= 80 ? "bg-green-100 text-green-700" :
                              stagedPct >= 60 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                            )}>
                              {stagedPct}%
                            </div>
                          )}
                          <div className="flex gap-2 shrink-0">
                            <Button size="sm" onClick={saveStagedSamples} disabled={savingStaged} className="h-7 text-xs">
                              {savingStaged && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                              Save Sample
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setStagedSamples([])} className="h-7 text-xs">
                              Discard
                            </Button>
                          </div>
                        </div>
                        {/* Staged table */}
                        <div className="overflow-x-auto bg-amber-50/30">
                          <table className="w-full text-xs min-w-[640px]">
                            <thead className="bg-amber-50/80">
                              <tr>
                                {["#", "Reference ID", "Date", "Patient Name", "Compliant", "Remarks", ""].map(h => (
                                  <th key={h} className="px-3 py-2 text-left font-semibold text-amber-800 whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {stagedSamples.map((row, i) => (
                                <tr key={row._key} className="border-t border-amber-100 hover:bg-amber-50/70">
                                  <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                                  <td className="px-3 py-2 font-mono" title={row.reference_id}>
                                    {row.display_id}
                                  </td>
                                  <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">
                                    {row.record_date ? format(new Date(row.record_date), "dd MMM yy") : "—"}
                                  </td>
                                  <td className="px-3 py-2 max-w-[130px] truncate" title={row.patient_name || undefined}>
                                    {row.patient_name || <span className="text-muted-foreground">—</span>}
                                  </td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1.5">
                                      <button
                                        onClick={() => setStagedSamples(prev => prev.map(s =>
                                          s._key === row._key ? { ...s, is_compliant: s.is_compliant === true ? null : true } : s
                                        ))}
                                        className={cn(
                                          "h-6 w-6 rounded-full flex items-center justify-center transition-colors",
                                          row.is_compliant === true ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground hover:bg-green-50"
                                        )}
                                      >
                                        <CheckCircle2 className="h-3.5 w-3.5" />
                                      </button>
                                      <button
                                        onClick={() => setStagedSamples(prev => prev.map(s =>
                                          s._key === row._key ? { ...s, is_compliant: s.is_compliant === false ? null : false } : s
                                        ))}
                                        className={cn(
                                          "h-6 w-6 rounded-full flex items-center justify-center transition-colors",
                                          row.is_compliant === false ? "bg-red-100 text-red-600" : "bg-muted text-muted-foreground hover:bg-red-50"
                                        )}
                                      >
                                        <XCircle className="h-3.5 w-3.5" />
                                      </button>
                                      <span className={cn(
                                        "font-medium",
                                        row.is_compliant === true ? "text-green-600" :
                                        row.is_compliant === false ? "text-red-600" : "text-muted-foreground"
                                      )}>
                                        {row.is_compliant === true ? "Yes" : row.is_compliant === false ? "No" : "—"}
                                      </span>
                                    </div>
                                  </td>
                                  <td className="px-3 py-2">
                                    <input
                                      type="text"
                                      value={row.remarks}
                                      placeholder="Remarks…"
                                      onChange={e => {
                                        const val = e.target.value;
                                        setStagedSamples(prev => prev.map(s =>
                                          s._key === row._key ? { ...s, remarks: val } : s
                                        ));
                                      }}
                                      className="h-6 w-36 text-xs border border-input rounded px-2 bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                    />
                                  </td>
                                  <td className="px-3 py-2">
                                    <button
                                      onClick={() => setStagedSamples(prev => prev.filter(s => s._key !== row._key))}
                                      className="text-muted-foreground/40 hover:text-red-500 transition-colors"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Saved samples table */}
                    <div className="rounded-lg border bg-card overflow-hidden">
                      {samplesLoading ? (
                        <div className="flex items-center gap-2 p-4 text-muted-foreground text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
                      ) : samples.length === 0 ? (
                        <div className="p-6 text-center text-sm text-muted-foreground">No samples yet. Add manually or auto-generate from your data source.</div>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="bg-muted/40">
                            <tr>{["#", "Module", "Remarks / Reference", "Compliance", ""].map(h => (
                              <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">{h}</th>
                            ))}</tr>
                          </thead>
                          <tbody>
                            {samples.map((s, i) => (
                              <tr key={s.id} className="border-t border-border hover:bg-muted/20">
                                <td className="px-3 py-2 text-muted-foreground text-xs">{i + 1}</td>
                                <td className="px-3 py-2 text-xs">{s.reference_module || "—"}</td>
                                <td className="px-3 py-2 text-xs max-w-xs truncate">{s.remarks || "—"}</td>
                                <td className="px-3 py-2">
                                  <div className="flex items-center gap-1.5">
                                    <button onClick={() => toggleCompliant(s, s.is_compliant === true ? null : true)}
                                      className={cn("h-6 w-6 rounded-full flex items-center justify-center transition-colors",
                                        s.is_compliant === true ? "bg-green-100 text-green-600" : "bg-muted text-muted-foreground hover:bg-green-50")}>
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button onClick={() => toggleCompliant(s, s.is_compliant === false ? null : false)}
                                      className={cn("h-6 w-6 rounded-full flex items-center justify-center transition-colors",
                                        s.is_compliant === false ? "bg-red-100 text-red-600" : "bg-muted text-muted-foreground hover:bg-red-50")}>
                                      <XCircle className="h-3.5 w-3.5" />
                                    </button>
                                    <span className={cn("text-xs font-medium",
                                      s.is_compliant === true ? "text-green-600" : s.is_compliant === false ? "text-red-600" : "text-muted-foreground"
                                    )}>
                                      {s.is_compliant === true ? "Yes" : s.is_compliant === false ? "No" : "Pending"}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2">
                                  <button onClick={() => deleteSample(s.id)} className="text-muted-foreground/40 hover:text-red-500 transition-colors">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </TabsContent>

                {/* ── Analysis ──────────────────────────────────────────── */}
                <TabsContent value="analysis" className="flex-1 overflow-auto m-0 p-5">
                  <div className="max-w-2xl space-y-4">
                    {/* Compliance display */}
                    <div className="rounded-lg border bg-card p-5">
                      <div className="flex items-start gap-6">
                        <div className="text-center">
                          <p className={cn("text-5xl font-black",
                            compliancePct == null ? "text-muted-foreground" :
                            compliancePct >= 80 ? "text-green-600" :
                            compliancePct >= 60 ? "text-amber-500" : "text-red-600"
                          )}>
                            {compliancePct != null ? `${compliancePct}%` : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">Compliance Rate</p>
                          <p className="text-xs text-muted-foreground">({reviewedSamples.length}/{samples.length} reviewed)</p>
                        </div>
                        <div className="flex-1">
                          <ResponsiveContainer width="100%" height={120}>
                            <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: -20 }}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                              <YAxis tick={{ fontSize: 10 }} />
                              <Tooltip />
                              <Bar dataKey="value" name="Records" radius={[3, 3, 0, 0]}>
                                {chartData.map((entry, index) => <Cell key={index} fill={entry.fill} />)}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                      {compliancePct != null && compliancePct < 80 && (
                        <div className="mt-3 flex items-center gap-2 text-amber-600 text-xs font-medium bg-amber-50 rounded p-2">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Compliance below 80% NABH threshold — consider converting to a QI project
                        </div>
                      )}
                    </div>

                    {/* Conclusion */}
                    <div className="rounded-lg border bg-card p-4">
                      <Label className="text-sm font-semibold">Audit Conclusion / Committee Notes</Label>
                      <Textarea className="text-sm mt-2 h-28 resize-none"
                        placeholder="Document key findings, root causes identified, and recommendations discussed in committee…"
                        value={conclusion} onChange={e => setConclusion(e.target.value)}
                        onBlur={saveConclusion} />
                      <p className="text-xs text-muted-foreground mt-1">Auto-saves on blur</p>
                    </div>

                    {/* AI Summary */}
                    <div className="rounded-lg border bg-card p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Brain className="h-4 w-4 text-primary" />
                        <span className="text-sm font-semibold">AI Narrative Summary</span>
                      </div>
                      <p className="text-xs text-muted-foreground mb-3">
                        Generates a formal committee-ready narrative from audit data and your conclusion notes.
                      </p>
                      {selected.ai_summary && (
                        <div className="bg-muted/30 rounded border p-3 text-xs whitespace-pre-wrap leading-relaxed mb-3">
                          {selected.ai_summary}
                        </div>
                      )}
                      <Button size="sm" variant="outline" onClick={summariseFindings} disabled={samples.length === 0}>
                        <Brain className="h-3.5 w-3.5 mr-1" /> {selected.ai_summary ? "Regenerate" : "Generate"} Narrative
                      </Button>
                    </div>

                    {/* Convert to QI */}
                    {compliancePct != null && compliancePct < 80 && selected.status !== "closed" && (
                      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-orange-800">Convert to QI Project</p>
                            <p className="text-xs text-orange-700 mt-0.5">
                              Compliance of {compliancePct}% warrants a structured improvement initiative with PDSA cycles.
                            </p>
                          </div>
                          <Button size="sm" onClick={() => setConvertOpen(true)}
                            className="bg-orange-600 hover:bg-orange-700 text-white">
                            <TrendingUp className="h-3.5 w-3.5 mr-1" /> Start QI Project
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </div>
      </div>

      {/* Modals */}
      <CreateAuditWizard
        open={createOpen} onOpenChange={setCreateOpen}
        hospitalId={hospitalId} userId={userId} departments={departments}
        onCreated={a => { setAudits(prev => [a, ...prev]); selectAudit(a); }}
      />

      {selected && (
        <ConvertToQIDialog
          open={convertOpen} onOpenChange={setConvertOpen}
          audit={selected} compliancePct={compliancePct}
          hospitalId={hospitalId} userId={userId}
          onCreated={() => {}}
        />
      )}

      {/* AI Summary Dialog */}
      <Dialog open={summaryDialogOpen} onOpenChange={setSummaryDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>AI Audit Narrative Summary</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2 mb-3">
            Review and edit before saving. This narrative will be stored with the audit record.
          </p>
          {aiSummaryLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Generating narrative…
            </div>
          ) : (
            <div className="space-y-3">
              <Textarea className="text-sm h-56 resize-none" value={aiSummaryText}
                onChange={e => setAiSummaryText(e.target.value)} />
              <div className={cn("rounded border p-2.5", aiSummaryConfirmed ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50")}>
                <div className="flex items-start gap-2">
                  <Checkbox id="summary_confirm" checked={aiSummaryConfirmed}
                    onCheckedChange={v => setAiSummaryConfirmed(!!v)} className="mt-0.5" />
                  <Label htmlFor="summary_confirm" className="text-xs cursor-pointer leading-snug">
                    I confirm this narrative accurately reflects the audit findings and is suitable for Quality Committee minutes.
                  </Label>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setSummaryDialogOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={!aiSummaryConfirmed} onClick={applySummary}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Save Narrative
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ClinicalAuditPage;
