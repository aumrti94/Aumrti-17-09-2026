/**
 * ReportEventModal — quick-capture form for any safety event / complaint.
 * Mounted globally in AppShell; triggered via custom browser event 'open-report-event'.
 * Also usable as a controlled component via open/onOpenChange props.
 */
import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, AlertTriangle, CheckCircle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Dept { id: string; name: string; }
interface NABHStd { id: string; standard_code: string; chapter_code: string; description: string; }

const EVENT_TYPES = [
  { value: "incident",     label: "Incident",      colour: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" },
  { value: "near_miss",    label: "Near Miss",     colour: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
  { value: "sentinel",     label: "Sentinel Event",colour: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  { value: "complaint",    label: "Complaint",     colour: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400" },
  { value: "grievance",    label: "Grievance",     colour: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" },
  { value: "legal_notice", label: "Legal Notice",  colour: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  { value: "claim",        label: "Claim",         colour: "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400" },
];

const CATEGORIES = [
  "fall", "medication_error", "surgery", "lab", "billing",
  "behaviour", "privacy", "equipment", "infection", "other",
];

const SEVERITIES = [
  { value: "no_harm",  label: "No Harm",  colour: "bg-green-100 text-green-700" },
  { value: "mild",     label: "Mild",     colour: "bg-blue-100 text-blue-700" },
  { value: "moderate", label: "Moderate", colour: "bg-amber-100 text-amber-700" },
  { value: "severe",   label: "Severe",   colour: "bg-orange-100 text-orange-700" },
  { value: "death",    label: "Death",    colour: "bg-red-100 text-red-700" },
];

const BLANK = {
  event_type: "",
  category: "",
  severity: "",
  department_id: "",
  location: "",
  description: "",
  immediate_action_taken: "",
  linked_nabh_standard_id: "",
};

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
  onFiled?: (eventId: string, eventNumber: string) => void;
}

const ReportEventModal: React.FC<Props> = ({ open: controlledOpen, onOpenChange, onFiled }) => {
  const { hospitalId, userId } = useHospitalId();
  const { toast } = useToast();

  const [open, setOpen] = useState(false);
  const [depts, setDepts] = useState<Dept[]>([]);
  const [standards, setStandards] = useState<NABHStd[]>([]);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<{ category: string; severity: string; rationale: string } | null>(null);

  // Listen for global trigger event
  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("open-report-event", handler);
    return () => window.removeEventListener("open-report-event", handler);
  }, []);

  const isOpen = controlledOpen !== undefined ? controlledOpen : open;
  const setIsOpen = useCallback((v: boolean) => {
    if (onOpenChange) onOpenChange(v);
    else setOpen(v);
  }, [onOpenChange]);

  // Load reference data when opening
  useEffect(() => {
    if (!isOpen || !hospitalId) return;
    Promise.all([
      (supabase as any).from("departments").select("id, name").eq("hospital_id", hospitalId).order("name"),
      (supabase as any).from("nabh_standards").select("id, standard_code, chapter_code, description").eq("is_active", true).order("chapter_code").order("standard_code"),
    ]).then(([dRes, sRes]) => {
      setDepts(dRes.data || []);
      setStandards(sRes.data || []);
    });
  }, [isOpen, hospitalId]);

  const set = (k: keyof typeof BLANK) => (v: string) => setForm(p => ({ ...p, [k]: v }));

  // ── AI: suggest category & severity ────────────────────────────────────────
  const suggestWithAI = async () => {
    if (!form.description.trim() || !hospitalId) return;
    setAiLoading(true);
    setAiSuggestion(null);
    const res = await callAI({
      featureKey: "triage_classifier",
      hospitalId,
      prompt: `You are a hospital patient safety officer. Classify the following safety event description:

"${form.description}"

Respond ONLY as valid JSON with exactly these keys:
{
  "category": one of [fall, medication_error, surgery, lab, billing, behaviour, privacy, equipment, infection, other],
  "severity": one of [no_harm, mild, moderate, severe, death],
  "rationale": "one sentence explanation"
}`,
      maxTokens: 200,
    });
    setAiLoading(false);
    if (res.error) {
      toast({ title: "AI unavailable", description: "Classify manually below.", variant: "destructive" });
      return;
    }
    try {
      const jsonMatch = res.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON");
      const parsed = JSON.parse(jsonMatch[0]);
      setAiSuggestion(parsed);
    } catch {
      toast({ title: "Could not parse AI response", variant: "destructive" });
    }
  };

  const applyAISuggestion = () => {
    if (!aiSuggestion) return;
    setForm(p => ({
      ...p,
      category: aiSuggestion.category || p.category,
      severity: aiSuggestion.severity || p.severity,
    }));
    setAiSuggestion(null);
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const save = async () => {
    if (!hospitalId) return;
    if (!form.event_type) { toast({ title: "Event type required", variant: "destructive" }); return; }
    if (!form.description.trim() || form.description.trim().length < 20) {
      toast({ title: "Description must be at least 20 characters", variant: "destructive" });
      return;
    }

    setSaving(true);

    // Generate event number
    const year = new Date().getFullYear();
    const { count } = await (supabase as any)
      .from("safety_events")
      .select("*", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .gte("reported_at", `${year}-01-01`);
    const eventNumber = `EV-${year}-${String((count || 0) + 1).padStart(4, "0")}`;

    const payload: Record<string, any> = {
      hospital_id: hospitalId,
      event_number: eventNumber,
      event_type: form.event_type,
      description: form.description.trim(),
      reported_by: userId ?? null,
    };
    if (form.category)                  payload.category = form.category;
    if (form.severity)                  payload.severity = form.severity;
    if (form.department_id)             payload.department_id = form.department_id;
    if (form.location.trim())           payload.location = form.location.trim();
    if (form.immediate_action_taken.trim()) payload.immediate_action_taken = form.immediate_action_taken.trim();
    if (form.linked_nabh_standard_id)   payload.linked_nabh_standard_id = form.linked_nabh_standard_id;

    const { data: eventData, error } = await (supabase as any)
      .from("safety_events")
      .insert(payload)
      .select()
      .single();

    if (error) {
      setSaving(false);
      toast({ title: "Failed to file event", description: error.message, variant: "destructive" });
      return;
    }

    // Auto-create NABH evidence if standard linked
    if (form.linked_nabh_standard_id && eventData) {
      const { data: compData } = await (supabase as any)
        .from("nabh_hospital_compliance")
        .upsert(
          { hospital_id: hospitalId, nabh_standard_id: form.linked_nabh_standard_id },
          { onConflict: "hospital_id,nabh_standard_id" },
        )
        .select("id")
        .single();

      if (compData?.id) {
        await (supabase as any).from("nabh_evidence_items").insert({
          hospital_id: hospitalId,
          nabh_compliance_id: compData.id,
          title: `Safety Event ${eventNumber} — ${form.event_type.replace(/_/g, " ")}`,
          evidence_type: "Record",
          module_reference: "Safety Events",
          uploaded_by: userId ?? null,
          notes: `Auto-linked from safety event ${eventNumber}`,
        });
      }
    }

    setSaving(false);
    toast({ title: `Event filed: ${eventNumber}`, description: "Visible in Safety Events workspace." });
    setIsOpen(false);
    setForm(BLANK);
    setAiSuggestion(null);
    onFiled?.(eventData.id, eventNumber);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Report Safety Event / Complaint
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Event type cards */}
          <div>
            <Label className="text-xs mb-2 block">Event Type <span className="text-destructive">*</span></Label>
            <div className="flex flex-wrap gap-1.5">
              {EVENT_TYPES.map(et => (
                <button
                  key={et.value}
                  type="button"
                  onClick={() => set("event_type")(et.value)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                    form.event_type === et.value
                      ? et.colour + " border-current ring-1 ring-current ring-offset-1"
                      : "border-border text-muted-foreground hover:border-current hover:text-foreground"
                  }`}
                >
                  {et.label}
                </button>
              ))}
            </div>
          </div>

          {/* Description + AI */}
          <div className="space-y-1.5">
            <Label className="text-xs">
              Description <span className="text-destructive">*</span>
              <span className="ml-1 text-muted-foreground font-normal">(min 20 chars)</span>
            </Label>
            <Textarea
              rows={3}
              value={form.description}
              onChange={e => set("description")(e.target.value)}
              placeholder="Describe what happened, when, and who was involved…"
              className="text-sm resize-none"
            />
            {form.description.trim().length >= 20 && (
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1.5"
                onClick={suggestWithAI}
                disabled={aiLoading}
              >
                {aiLoading
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Sparkles className="h-3 w-3 text-purple-500" />}
                {aiLoading ? "Analysing…" : "AI: Suggest category & severity"}
              </Button>
            )}
            {aiSuggestion && (
              <div className="rounded-lg border border-purple-200 bg-purple-50 dark:bg-purple-900/10 dark:border-purple-800 p-3 space-y-2">
                <p className="text-xs font-semibold text-purple-700 dark:text-purple-400 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> AI Suggestion
                </p>
                <div className="flex gap-2 flex-wrap text-xs">
                  <span>Category: <strong>{aiSuggestion.category}</strong></span>
                  <span>Severity: <strong>{aiSuggestion.severity}</strong></span>
                </div>
                <p className="text-xs text-muted-foreground italic">{aiSuggestion.rationale}</p>
                <div className="flex gap-2">
                  <Button size="sm" className="h-6 text-[11px]" onClick={applyAISuggestion}>
                    <CheckCircle className="h-3 w-3 mr-1" /> Apply
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 text-[11px]" onClick={() => setAiSuggestion(null)}>
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Category + Severity row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={form.category} onValueChange={set("category")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c} className="text-xs capitalize">
                      {c.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Severity</Label>
              <Select value={form.severity} onValueChange={set("severity")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map(s => (
                    <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Department + Location row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Department</Label>
              <Select value={form.department_id} onValueChange={set("department_id")}>
                <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {depts.map(d => (
                    <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Location</Label>
              <Input
                value={form.location}
                onChange={e => set("location")(e.target.value)}
                placeholder="Ward / OT / OPD…"
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Immediate action */}
          <div className="space-y-1.5">
            <Label className="text-xs">Immediate Action Taken</Label>
            <Textarea
              rows={2}
              value={form.immediate_action_taken}
              onChange={e => set("immediate_action_taken")(e.target.value)}
              placeholder="What was done immediately after the event?"
              className="text-xs resize-none"
            />
          </div>

          {/* NABH standard link */}
          <div className="space-y-1.5">
            <Label className="text-xs">Link to NABH Standard (optional)</Label>
            <Select value={form.linked_nabh_standard_id} onValueChange={set("linked_nabh_standard_id")}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Auto-creates evidence record…" />
              </SelectTrigger>
              <SelectContent className="max-h-60">
                <SelectItem value="" className="text-xs text-muted-foreground">— None —</SelectItem>
                {standards.map(s => (
                  <SelectItem key={s.id} value={s.id} className="text-xs">
                    <span className="font-mono font-semibold mr-1.5">{s.standard_code}</span>
                    <span className="text-muted-foreground">{s.description.slice(0, 55)}…</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form.linked_nabh_standard_id && (
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <CheckCircle className="h-3 w-3 text-green-500" />
                A NABH evidence record will be auto-created on save
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1 border-t border-border">
            <Button variant="outline" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>
              {saving ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />Filing…</> : "File Event"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReportEventModal;
