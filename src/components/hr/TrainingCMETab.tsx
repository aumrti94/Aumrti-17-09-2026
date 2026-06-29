import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { GraduationCap, Plus, Loader2, X, ExternalLink, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { format, parseISO, differenceInMonths } from "date-fns";

interface Props {
  hospitalId: string;
}

interface TrainingRecord {
  id: string;
  user_id: string;
  training_title: string;
  training_type: string | null;
  provider: string | null;
  start_date: string | null;
  end_date: string | null;
  hours: number | null;
  certificate_url: string | null;
  assessment_score: number | null;
  completed: boolean;
  user_name?: string;
}

const TRAINING_TYPES = [
  "Orientation",
  "Induction",
  "Fire Safety",
  "BLS",
  "ALS",
  "NABH",
  "Infection Control",
  "Waste Management",
  "POSH",
  "CPR",
  "Patient Safety",
  "Skill Lab",
  "CME / Conference",
  "Other",
];

const MANDATORY_TYPES = ["BLS", "ALS", "Fire Safety", "NABH", "Infection Control", "Waste Management"];
const BLS_ALS_VALIDITY_MONTHS = 24;

const scoreStyle = (score: number | null) => {
  if (score === null) return "bg-muted text-muted-foreground border-border";
  if (score >= 80) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (score >= 60) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-red-100 text-red-700 border-red-200";
};

const EMPTY_FORM = {
  user_id: "",
  training_title: "",
  training_type: "Orientation",
  provider: "",
  start_date: "",
  end_date: "",
  hours: "",
  certificate_url: "",
  assessment_score: "",
  completed: true,
};

const TrainingCMETab: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [records, setRecords] = useState<TrainingRecord[]>([]);
  const [staff, setStaff] = useState<{ id: string; full_name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    const [recRes, staffRes] = await Promise.all([
      (supabase as any)
        .from("staff_training_records")
        .select("*, u:users!staff_training_records_user_id_fkey(full_name)")
        .eq("hospital_id", hospitalId)
        .order("end_date", { ascending: false, nullsFirst: false }),
      supabase.from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("is_active", true),
    ]);
    setStaff(staffRes.data || []);
    setRecords(
      (recRes.data || []).map((r: any) => ({ ...r, user_name: r.u?.full_name }))
    );
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.user_id || !form.training_title) return;
    setSaving(true);
    const { error } = await (supabase as any).from("staff_training_records").insert({
      hospital_id: hospitalId,
      user_id: form.user_id,
      training_title: form.training_title,
      training_type: form.training_type || null,
      provider: form.provider || null,
      start_date: form.start_date || null,
      end_date: form.end_date || null,
      hours: form.hours ? parseFloat(form.hours) : null,
      certificate_url: form.certificate_url || null,
      assessment_score: form.assessment_score ? parseFloat(form.assessment_score) : null,
      completed: form.completed,
    });
    if (error) {
      toast({ title: "Failed to save record", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Training record saved" });
      setShowAdd(false);
      setForm(EMPTY_FORM);
      load();
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    await (supabase as any).from("staff_training_records").delete().eq("id", id);
    toast({ title: "Record removed" });
    load();
  };

  const thisYear = new Date().getFullYear();
  const completedThisYear = records.filter(r => r.completed && r.end_date?.startsWith(String(thisYear)));

  const expiredMandatory = records.filter(r => {
    if (!r.end_date) return false;
    if (!MANDATORY_TYPES.includes(r.training_type || "")) return false;
    const monthsAgo = differenceInMonths(new Date(), parseISO(r.end_date));
    return monthsAgo >= BLS_ALS_VALIDITY_MONTHS;
  });

  const filtered = records.filter(r => {
    if (filterType !== "all" && r.training_type !== filterType) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        (r.user_name || "").toLowerCase().includes(q) ||
        (r.training_title || "").toLowerCase().includes(q) ||
        (r.provider || "").toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b flex items-center justify-between gap-3 shrink-0 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <GraduationCap className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">Training & CME</span>
          <Badge className="bg-primary/10 text-primary border-primary/20">{completedThisYear.length} Completed {thisYear}</Badge>
          {expiredMandatory.length > 0 && (
            <Badge className="bg-red-100 text-red-700 border-red-200">
              <AlertTriangle className="h-2.5 w-2.5 mr-1" />
              {expiredMandatory.length} Mandatory Overdue
            </Badge>
          )}
        </div>
        <Button size="sm" onClick={() => setShowAdd(!showAdd)} className="h-7 text-xs gap-1 shrink-0">
          <Plus className="h-3 w-3" /> Add Training
        </Button>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="border-b p-4 bg-muted/40 space-y-3 shrink-0">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Staff Member *</label>
              <select value={form.user_id} onChange={e => setForm(f => ({ ...f, user_id: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select staff…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Training Type</label>
              <select value={form.training_type} onChange={e => setForm(f => ({ ...f, training_type: e.target.value }))}
                className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="col-span-2">
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Training Title *</label>
              <Input value={form.training_title} onChange={e => setForm(f => ({ ...f, training_title: e.target.value }))}
                placeholder="e.g. Basic Life Support Refresher 2026" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Provider / Organiser</label>
              <Input value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                placeholder="e.g. AHA, internal, hospital name" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Hours</label>
              <Input type="number" value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))}
                placeholder="e.g. 4" className="h-8 text-sm" min="0" step="0.5" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Start Date</label>
              <Input type="date" value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">End / Completion Date</label>
              <Input type="date" value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Assessment Score (%)</label>
              <Input type="number" value={form.assessment_score} onChange={e => setForm(f => ({ ...f, assessment_score: e.target.value }))}
                placeholder="e.g. 85" className="h-8 text-sm" min="0" max="100" />
            </div>
            <div>
              <label className="text-[11px] font-medium text-muted-foreground block mb-1">Certificate URL</label>
              <Input value={form.certificate_url} onChange={e => setForm(f => ({ ...f, certificate_url: e.target.value }))}
                placeholder="https://drive.google.com/…" className="h-8 text-sm" />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs cursor-pointer">
              <input type="checkbox" checked={form.completed} onChange={e => setForm(f => ({ ...f, completed: e.target.checked }))} className="h-3.5 w-3.5" />
              Completed
            </label>
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving || !form.user_id || !form.training_title} className="h-7 text-xs flex-1">
              {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />} Save Record
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)} className="h-7 text-xs">Cancel</Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="px-4 py-2 border-b flex items-center gap-2 shrink-0">
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search staff, training…"
          className="h-7 text-xs max-w-[200px]" />
        <select value={filterType} onChange={e => setFilterType(e.target.value)}
          className="h-7 text-xs border border-input rounded px-2 bg-background">
          <option value="all">All Types</option>
          {TRAINING_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="text-xs text-muted-foreground ml-auto">{filtered.length} records</span>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-4">
        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground py-8">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="text-sm">Loading training records…</span>
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground py-4">
            {records.length === 0
              ? "No training records yet. Log orientation, BLS/ALS, fire safety, and CME for NABH HRM.4 compliance."
              : "No records match your filter."}
          </p>
        ) : (
          <div className="space-y-2">
            {filtered.map(r => {
              const isOverdue = r.training_type && MANDATORY_TYPES.includes(r.training_type) && r.end_date
                && differenceInMonths(new Date(), parseISO(r.end_date)) >= BLS_ALS_VALIDITY_MONTHS;
              return (
                <div
                  key={r.id}
                  className={cn(
                    "border rounded-lg px-3 py-2.5 flex items-start justify-between gap-3",
                    isOverdue ? "border-red-200 bg-red-50/50 dark:bg-red-950/20" :
                    !r.completed ? "border-border bg-muted/30 opacity-70" :
                    "border-border bg-card"
                  )}
                >
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{r.user_name || "—"}</span>
                      {r.training_type && (
                        <span className={cn(
                          "text-[10px] px-1.5 py-px rounded border font-medium",
                          MANDATORY_TYPES.includes(r.training_type)
                            ? "bg-primary/10 text-primary border-primary/20"
                            : "bg-muted text-muted-foreground border-border"
                        )}>
                          {r.training_type}
                        </span>
                      )}
                      {!r.completed && <Badge className="text-[10px] h-4">Incomplete</Badge>}
                      {isOverdue && (
                        <span className="text-[10px] px-1.5 py-px rounded border font-medium flex items-center gap-1 bg-red-100 text-red-700 border-red-200">
                          <AlertTriangle className="h-2.5 w-2.5" /> Overdue retraining
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-foreground font-medium">{r.training_title}</p>
                    <div className="flex items-center gap-3 flex-wrap">
                      {r.provider && <span className="text-[11px] text-muted-foreground">{r.provider}</span>}
                      {r.end_date && (
                        <span className="text-[11px] text-muted-foreground">
                          {r.start_date && r.start_date !== r.end_date
                            ? `${format(parseISO(r.start_date), "dd MMM")} – `
                            : ""}
                          {format(parseISO(r.end_date), "dd MMM yyyy")}
                        </span>
                      )}
                      {r.hours && <span className="text-[11px] text-muted-foreground">{r.hours}h</span>}
                      {r.assessment_score !== null && (
                        <span className={cn("text-[10px] px-1.5 py-px rounded border font-medium", scoreStyle(r.assessment_score))}>
                          Score: {r.assessment_score}%
                        </span>
                      )}
                      {r.certificate_url && (
                        <a href={r.certificate_url} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline">
                          <ExternalLink className="h-2.5 w-2.5" /> Certificate
                        </a>
                      )}
                    </div>
                  </div>
                  <button onClick={() => handleDelete(r.id)} className="p-1 text-muted-foreground hover:text-destructive transition-colors shrink-0 mt-0.5">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default TrainingCMETab;
