import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { BarChart2, Plus, Loader2, X, Star, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, parseISO } from "date-fns";

interface Appraisal {
  id: string;
  user_id: string;
  appraisal_period: string;
  period_start: string;
  period_end: string;
  appraisal_type: string;
  kra_clinical_score: number | null;
  kra_patient_safety_score: number | null;
  kra_teamwork_score: number | null;
  kra_attendance_score: number | null;
  kra_training_score: number | null;
  kra_quality_score: number | null;
  self_assessment_text: string | null;
  self_overall_score: number | null;
  manager_comments: string | null;
  manager_score: number | null;
  overall_rating: string | null;
  goals_next_period: string | null;
  status: string;
  submitted_at: string | null;
  reviewed_at: string | null;
  staff_name?: string;
  staff_role?: string;
}

const APPRAISAL_TYPES = [
  { value: "annual",    label: "Annual" },
  { value: "mid_year",  label: "Mid-Year" },
  { value: "probation", label: "Probation Review" },
  { value: "exit",      label: "Exit Appraisal" },
];

const RATINGS = [
  { value: "outstanding",       label: "Outstanding",         color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "exceeds",           label: "Exceeds Expectations", color: "bg-blue-100 text-blue-700 border-blue-200" },
  { value: "meets",             label: "Meets Expectations",   color: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  { value: "needs_improvement", label: "Needs Improvement",    color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "unsatisfactory",    label: "Unsatisfactory",       color: "bg-red-100 text-red-700 border-red-200" },
];

const STATUS_COLOURS: Record<string, string> = {
  draft:            "bg-muted text-muted-foreground",
  self_submitted:   "bg-blue-100 text-blue-700 border-blue-200",
  manager_reviewed: "bg-amber-100 text-amber-700 border-amber-200",
  hr_approved:      "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed:           "bg-slate-100 text-slate-600 border-slate-200",
};

const KRAs = [
  { key: "kra_clinical_score",       label: "Clinical Competence" },
  { key: "kra_patient_safety_score", label: "Patient Safety" },
  { key: "kra_teamwork_score",       label: "Teamwork & Communication" },
  { key: "kra_attendance_score",     label: "Attendance & Punctuality" },
  { key: "kra_training_score",       label: "Training & Development" },
  { key: "kra_quality_score",        label: "Quality & Compliance" },
];

const ScoreInput: React.FC<{ value: string; onChange: (v: string) => void; label: string }> = ({ value, onChange, label }) => (
  <div>
    <label className="text-[11px] font-medium text-muted-foreground block mb-1">{label} (0–5)</label>
    <Input type="number" min="0" max="5" step="0.5" value={value} onChange={e => onChange(e.target.value)} placeholder="0–5" className="h-8 text-sm" />
  </div>
);

const today = new Date().toISOString().split("T")[0];

const PerformanceAppraisalTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const { userId } = useHospitalId();
  const [appraisals, setAppraisals] = useState<Appraisal[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string; role: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({
    user_id: "", appraisal_period: "", period_start: "", period_end: "",
    appraisal_type: "annual",
    kra_clinical_score: "", kra_patient_safety_score: "", kra_teamwork_score: "",
    kra_attendance_score: "", kra_training_score: "", kra_quality_score: "",
    self_assessment_text: "", self_overall_score: "",
    manager_comments: "", manager_score: "", overall_rating: "meets",
    goals_next_period: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const [apprRes, staffRes] = await Promise.all([
      (supabase as any).from("performance_appraisals")
        .select("*, u:users!performance_appraisals_user_id_fkey(full_name, role)")
        .eq("hospital_id", hospitalId)
        .order("period_start", { ascending: false })
        .limit(200),
      supabase.from("users").select("id, full_name, role").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
    ]);
    setStaff(staffRes.data || []);
    setAppraisals((apprRes.data || []).map((a: any) => ({
      ...a,
      staff_name: a.u?.full_name,
      staff_role: a.u?.role,
    })));
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const avg = (...vals: string[]) => {
    const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n) && n >= 0);
    return nums.length ? (nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(1) : null;
  };

  const handleSave = async () => {
    if (!form.user_id || !form.appraisal_period || !form.period_start || !form.period_end) return;
    setSaving(true);
    const { error } = await (supabase as any).from("performance_appraisals").insert({
      hospital_id: hospitalId,
      user_id: form.user_id,
      appraisal_period: form.appraisal_period,
      period_start: form.period_start,
      period_end: form.period_end,
      appraisal_type: form.appraisal_type,
      kra_clinical_score:       form.kra_clinical_score       ? parseFloat(form.kra_clinical_score)       : null,
      kra_patient_safety_score: form.kra_patient_safety_score ? parseFloat(form.kra_patient_safety_score) : null,
      kra_teamwork_score:       form.kra_teamwork_score       ? parseFloat(form.kra_teamwork_score)       : null,
      kra_attendance_score:     form.kra_attendance_score     ? parseFloat(form.kra_attendance_score)     : null,
      kra_training_score:       form.kra_training_score       ? parseFloat(form.kra_training_score)       : null,
      kra_quality_score:        form.kra_quality_score        ? parseFloat(form.kra_quality_score)        : null,
      self_assessment_text: form.self_assessment_text || null,
      self_overall_score:   form.self_overall_score ? parseFloat(form.self_overall_score) : null,
      manager_id:      userId || null,
      manager_comments: form.manager_comments || null,
      manager_score:    form.manager_score ? parseFloat(form.manager_score) : null,
      overall_rating:   form.overall_rating || null,
      goals_next_period: form.goals_next_period || null,
      status: "manager_reviewed",
      reviewed_at: new Date().toISOString(),
    });
    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else {
      toast({ title: "Appraisal saved" });
      setShowAdd(false);
      load();
    }
    setSaving(false);
  };

  const avgKra = (a: Appraisal) => {
    const scores = [a.kra_clinical_score, a.kra_patient_safety_score, a.kra_teamwork_score, a.kra_attendance_score, a.kra_training_score, a.kra_quality_score].filter((s): s is number => s !== null);
    return scores.length ? (scores.reduce((sum, s) => sum + s, 0) / scores.length).toFixed(1) : null;
  };

  const ratingInfo = (r: string | null) => RATINGS.find(x => x.value === r);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart2 className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">Performance Appraisals</span>
          <Badge variant="outline" className="text-[10px]">HRM.12 — NABH</Badge>
        </div>
        <Button size="sm" onClick={() => setShowAdd(s => !s)} className="h-7 text-xs gap-1">
          <Plus className="h-3 w-3" /> New Appraisal
        </Button>
      </div>

      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-4 shrink-0 overflow-y-auto max-h-[60vh]">
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Staff Member *</label>
              <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name} ({s.role.replace(/_/g, " ")})</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Appraisal Period *</label>
              <Input value={form.appraisal_period} onChange={e => setForm(f => ({ ...f, appraisal_period: e.target.value }))} placeholder="e.g. 2025-26 Annual" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Type</label>
              <select value={form.appraisal_type} onChange={e => setForm(f => ({ ...f, appraisal_type: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {APPRAISAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Period From *</label>
              <Input type="date" value={form.period_start} onChange={e => setForm(f => ({ ...f, period_start: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Period To *</label>
              <Input type="date" value={form.period_end} onChange={e => setForm(f => ({ ...f, period_end: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Overall Rating</label>
              <select value={form.overall_rating} onChange={e => setForm(f => ({ ...f, overall_rating: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {RATINGS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          <p className="text-xs font-semibold text-foreground">KRA Scores (0 = Poor, 5 = Excellent)</p>
          <div className="grid grid-cols-3 gap-3">
            {KRAs.map(k => (
              <ScoreInput key={k.key} label={k.label}
                value={form[k.key as keyof typeof form] as string}
                onChange={v => setForm(f => ({ ...f, [k.key]: v }))} />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Self-Assessment Notes</label>
              <Textarea rows={3} value={form.self_assessment_text} onChange={e => setForm(f => ({ ...f, self_assessment_text: e.target.value }))} placeholder="Employee's own assessment…" className="text-xs resize-none" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Manager Comments</label>
              <Textarea rows={3} value={form.manager_comments} onChange={e => setForm(f => ({ ...f, manager_comments: e.target.value }))} placeholder="Manager's comments and feedback…" className="text-xs resize-none" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Goals for Next Period</label>
              <Textarea rows={2} value={form.goals_next_period} onChange={e => setForm(f => ({ ...f, goals_next_period: e.target.value }))} placeholder="Development goals and targets for next appraisal cycle…" className="text-xs resize-none" />
            </div>
          </div>

          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.user_id || !form.appraisal_period || !form.period_start} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Appraisal
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8"><Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span></div>
        ) : appraisals.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <BarChart2 className="h-8 w-8 text-muted-foreground/40 mx-auto" />
            <p className="text-sm text-muted-foreground">No performance appraisals recorded.</p>
            <p className="text-xs text-muted-foreground">NABH HRM requires annual performance appraisals for all clinical and non-clinical staff.</p>
          </div>
        ) : appraisals.map(a => {
          const kraAvg = avgKra(a);
          const rating = ratingInfo(a.overall_rating);
          const isOpen = expanded === a.id;
          return (
            <div key={a.id} className="border rounded-lg overflow-hidden border-border">
              <div className="px-3 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-muted/30 bg-card"
                onClick={() => setExpanded(isOpen ? null : a.id)}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium">{a.staff_name || "Unknown"}</span>
                    {a.staff_role && <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-px rounded">{a.staff_role.replace(/_/g, " ")}</span>}
                    <span className="text-[10px] text-muted-foreground">{a.appraisal_period}</span>
                    {rating && <Badge className={cn("text-[10px] px-1.5 py-0", rating.color)}>{rating.label}</Badge>}
                    <Badge className={cn("text-[10px] px-1.5 py-0", STATUS_COLOURS[a.status] || STATUS_COLOURS.draft)}>
                      {a.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4 text-[11px] text-muted-foreground mt-0.5">
                    <span>{format(parseISO(a.period_start), "MMM yyyy")} – {format(parseISO(a.period_end), "MMM yyyy")}</span>
                    {kraAvg && (
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 text-amber-500" />
                        Avg KRA: <span className="font-medium text-foreground">{kraAvg}/5</span>
                      </span>
                    )}
                    {a.manager_score && <span>Manager score: {a.manager_score}/5</span>}
                  </div>
                </div>
                {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
              </div>
              {isOpen && (
                <div className="border-t px-4 py-3 bg-muted/10 space-y-3 text-xs">
                  <div className="grid grid-cols-3 gap-x-6 gap-y-1.5">
                    {KRAs.map(k => {
                      const val = a[k.key as keyof Appraisal] as number | null;
                      return (
                        <div key={k.key} className="flex items-center justify-between">
                          <span className="text-muted-foreground">{k.label}:</span>
                          <span className={cn("font-semibold", val !== null && val >= 4 ? "text-emerald-600" : val !== null && val < 3 ? "text-red-600" : "text-foreground")}>
                            {val !== null ? `${val}/5` : "—"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                  {a.self_assessment_text && <p className="text-muted-foreground italic">Self: "{a.self_assessment_text}"</p>}
                  {a.manager_comments && <p><span className="font-medium">Manager:</span> {a.manager_comments}</p>}
                  {a.goals_next_period && <p><span className="font-medium">Goals:</span> {a.goals_next_period}</p>}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PerformanceAppraisalTab;
