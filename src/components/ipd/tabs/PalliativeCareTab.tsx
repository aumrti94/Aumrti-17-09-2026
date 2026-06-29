import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Heart, Save, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface PalliativePlan {
  id: string;
  care_goal: string;
  dnacpr: boolean;
  dnacpr_date: string | null;
  dnacpr_reason: string | null;
  advance_directive_present: boolean;
  advance_directive_url: string | null;
  pain_score_current: number | null;
  pain_score_target: number | null;
  pain_regimen: string | null;
  dyspnoea_management: string | null;
  nausea_management: string | null;
  bowel_management: string | null;
  spiritual_needs: string | null;
  family_counselled: boolean;
  counselling_notes: string | null;
  social_worker_assigned: boolean;
  goals_of_care_discussed: boolean;
  last_reviewed_at: string | null;
  next_review_date: string | null;
  status: string;
  updated_at: string;
}

const CARE_GOALS = [
  { value: "comfort",   label: "Comfort / Palliative Only",   color: "bg-purple-100 text-purple-700 border-purple-200" },
  { value: "mixed",     label: "Mixed (Curative + Comfort)",   color: "bg-amber-100 text-amber-700 border-amber-200" },
  { value: "curative",  label: "Curative / Life-prolonging",   color: "bg-blue-100 text-blue-700 border-blue-200" },
];

const PAIN_SCALE = Array.from({ length: 11 }, (_, i) => i);

const FL: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <label className="text-[11px] font-medium text-muted-foreground block mb-1">{children}</label>
);

interface Props {
  admissionId: string;
  patientId: string | undefined;
  hospitalId: string | null;
  userId: string | null;
}

const PalliativeCareTab: React.FC<Props> = ({ admissionId, patientId, hospitalId, userId }) => {
  const { toast } = useToast();
  const [plan, setPlan] = useState<PalliativePlan | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [staff, setStaff] = useState<{ id: string; full_name: string; role: string }[]>([]);

  const [form, setForm] = useState({
    care_goal: "comfort",
    dnacpr: false, dnacpr_date: "", dnacpr_reason: "",
    advance_directive_present: false, advance_directive_url: "",
    pain_score_current: "", pain_score_target: "",
    pain_regimen: "", dyspnoea_management: "", nausea_management: "", bowel_management: "",
    spiritual_needs: "", family_counselled: false, counselling_notes: "",
    social_worker_assigned: false, goals_of_care_discussed: false,
    next_review_date: "", status: "active",
    palliative_physician_id: "", key_nurse_id: "",
  });

  const load = useCallback(async () => {
    if (!hospitalId || !patientId) { setLoading(false); return; }
    setLoading(true);
    const [planRes, staffRes] = await Promise.all([
      (supabase as any).from("palliative_care_plans")
        .select("*")
        .eq("hospital_id", hospitalId)
        .eq("admission_id", admissionId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("users").select("id, full_name, role").eq("hospital_id", hospitalId).eq("is_active", true).order("full_name"),
    ]);
    setStaff(staffRes.data || []);
    if (planRes.data) {
      const p = planRes.data;
      setPlan(p);
      setForm({
        care_goal: p.care_goal || "comfort",
        dnacpr: p.dnacpr || false,
        dnacpr_date: p.dnacpr_date || "",
        dnacpr_reason: p.dnacpr_reason || "",
        advance_directive_present: p.advance_directive_present || false,
        advance_directive_url: p.advance_directive_url || "",
        pain_score_current: p.pain_score_current !== null ? String(p.pain_score_current) : "",
        pain_score_target: p.pain_score_target !== null ? String(p.pain_score_target) : "",
        pain_regimen: p.pain_regimen || "",
        dyspnoea_management: p.dyspnoea_management || "",
        nausea_management: p.nausea_management || "",
        bowel_management: p.bowel_management || "",
        spiritual_needs: p.spiritual_needs || "",
        family_counselled: p.family_counselled || false,
        counselling_notes: p.counselling_notes || "",
        social_worker_assigned: p.social_worker_assigned || false,
        goals_of_care_discussed: p.goals_of_care_discussed || false,
        next_review_date: p.next_review_date || "",
        status: p.status || "active",
        palliative_physician_id: p.palliative_physician_id || "",
        key_nurse_id: p.key_nurse_id || "",
      });
    }
    setLoading(false);
  }, [hospitalId, patientId, admissionId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!hospitalId || !patientId) return;
    setSaving(true);
    const payload = {
      hospital_id: hospitalId,
      admission_id: admissionId,
      patient_id: patientId,
      care_goal: form.care_goal,
      dnacpr: form.dnacpr,
      dnacpr_date: form.dnacpr && form.dnacpr_date ? form.dnacpr_date : null,
      dnacpr_reason: form.dnacpr && form.dnacpr_reason ? form.dnacpr_reason : null,
      advance_directive_present: form.advance_directive_present,
      advance_directive_url: form.advance_directive_present && form.advance_directive_url ? form.advance_directive_url : null,
      pain_score_current: form.pain_score_current !== "" ? parseInt(form.pain_score_current) : null,
      pain_score_target: form.pain_score_target !== "" ? parseInt(form.pain_score_target) : null,
      pain_regimen: form.pain_regimen || null,
      dyspnoea_management: form.dyspnoea_management || null,
      nausea_management: form.nausea_management || null,
      bowel_management: form.bowel_management || null,
      spiritual_needs: form.spiritual_needs || null,
      family_counselled: form.family_counselled,
      counselling_notes: form.counselling_notes || null,
      social_worker_assigned: form.social_worker_assigned,
      goals_of_care_discussed: form.goals_of_care_discussed,
      next_review_date: form.next_review_date || null,
      status: form.status,
      last_reviewed_at: new Date().toISOString(),
      palliative_physician_id: form.palliative_physician_id || null,
      key_nurse_id: form.key_nurse_id || null,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (plan?.id) {
      ({ error } = await (supabase as any).from("palliative_care_plans").update(payload).eq("id", plan.id));
    } else {
      ({ error } = await (supabase as any).from("palliative_care_plans").insert(payload));
    }

    if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    else { toast({ title: "Palliative care plan saved" }); load(); }
    setSaving(false);
  };

  const careGoalInfo = CARE_GOALS.find(g => g.value === form.care_goal);

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground p-6"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="p-4 space-y-5 max-w-3xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-rose-500" />
            <span className="text-sm font-semibold">Palliative Care Plan</span>
            <Badge variant="outline" className="text-[10px]">COP — NABH</Badge>
            {plan && (
              <Badge className="text-[10px] bg-muted text-muted-foreground">
                Last reviewed: {format(new Date(plan.last_reviewed_at || plan.updated_at), "dd MMM yyyy")}
              </Badge>
            )}
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving} className="h-7 text-xs gap-1">
            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
            Save Plan
          </Button>
        </div>

        {/* Goals of care */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Goals of Care</h3>
          <div className="grid grid-cols-3 gap-2">
            {CARE_GOALS.map(g => (
              <button key={g.value} onClick={() => setForm(f => ({ ...f, care_goal: g.value }))}
                className={cn("rounded-lg border-2 px-3 py-2 text-xs font-medium text-left transition-all",
                  form.care_goal === g.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/50"
                )}>
                <span className={cn("inline-block rounded px-1.5 py-0.5 text-[10px] font-bold mb-1", g.color)}>{g.value.toUpperCase()}</span>
                <p className="leading-tight">{g.label}</p>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-6 pt-1">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="goc" checked={form.goals_of_care_discussed}
                onChange={e => setForm(f => ({ ...f, goals_of_care_discussed: e.target.checked }))} className="h-4 w-4" />
              <label htmlFor="goc" className="text-xs font-medium">Goals of care discussed with patient & family</label>
            </div>
          </div>
        </div>

        {/* DNACPR */}
        <div className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center gap-3">
            <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">DNACPR / Advance Directive</h3>
            {form.dnacpr && (
              <Badge className="bg-red-100 text-red-700 border-red-200 text-[10px] font-bold">
                DNACPR ORDER ACTIVE
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="dnacpr" checked={form.dnacpr}
                onChange={e => setForm(f => ({ ...f, dnacpr: e.target.checked }))} className="h-4 w-4 accent-red-600" />
              <label htmlFor="dnacpr" className="text-xs font-medium text-red-700">Do Not Attempt CPR (DNACPR) order in place</label>
            </div>
          </div>
          {form.dnacpr && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <FL>DNACPR Date</FL>
                <Input type="date" value={form.dnacpr_date} onChange={e => setForm(f => ({ ...f, dnacpr_date: e.target.value }))} className="h-8 text-sm" />
              </div>
              <div>
                <FL>Reason / Clinical Basis</FL>
                <Input value={form.dnacpr_reason} onChange={e => setForm(f => ({ ...f, dnacpr_reason: e.target.value }))} placeholder="e.g. End-stage malignancy, irreversible…" className="h-8 text-sm" />
              </div>
            </div>
          )}
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="adv_dir" checked={form.advance_directive_present}
                onChange={e => setForm(f => ({ ...f, advance_directive_present: e.target.checked }))} className="h-4 w-4" />
              <label htmlFor="adv_dir" className="text-xs">Advance Directive / Living Will present</label>
            </div>
          </div>
          {form.advance_directive_present && (
            <div>
              <FL>Directive Document URL</FL>
              <Input value={form.advance_directive_url} onChange={e => setForm(f => ({ ...f, advance_directive_url: e.target.value }))} placeholder="https://…" className="h-8 text-sm" />
            </div>
          )}
        </div>

        {/* Symptom management */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Symptom Management</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FL>Current Pain Score (0–10)</FL>
              <div className="flex gap-1 flex-wrap mt-1">
                {PAIN_SCALE.map(n => (
                  <button key={n} onClick={() => setForm(f => ({ ...f, pain_score_current: String(n) }))}
                    className={cn("w-7 h-7 rounded text-[11px] font-bold border transition-all",
                      form.pain_score_current === String(n)
                        ? n >= 7 ? "bg-red-500 text-white border-red-500"
                          : n >= 4 ? "bg-amber-500 text-white border-amber-500"
                          : "bg-emerald-500 text-white border-emerald-500"
                        : "border-border hover:bg-muted"
                    )}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <FL>Target Pain Score (0–10)</FL>
              <div className="flex gap-1 flex-wrap mt-1">
                {PAIN_SCALE.map(n => (
                  <button key={n} onClick={() => setForm(f => ({ ...f, pain_score_target: String(n) }))}
                    className={cn("w-7 h-7 rounded text-[11px] font-bold border transition-all",
                      form.pain_score_target === String(n) ? "bg-blue-500 text-white border-blue-500" : "border-border hover:bg-muted"
                    )}>
                    {n}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <FL>Pain Regimen</FL>
              <Textarea rows={2} value={form.pain_regimen} onChange={e => setForm(f => ({ ...f, pain_regimen: e.target.value }))} placeholder="Analgesic plan, dosing, PRN medications…" className="text-xs resize-none" />
            </div>
            <div>
              <FL>Dyspnoea Management</FL>
              <Textarea rows={2} value={form.dyspnoea_management} onChange={e => setForm(f => ({ ...f, dyspnoea_management: e.target.value }))} placeholder="Opioids, anxiolytics, oxygen, fan therapy…" className="text-xs resize-none" />
            </div>
            <div>
              <FL>Nausea / Vomiting Management</FL>
              <Textarea rows={2} value={form.nausea_management} onChange={e => setForm(f => ({ ...f, nausea_management: e.target.value }))} placeholder="Anti-emetics, dietary adjustments…" className="text-xs resize-none" />
            </div>
            <div>
              <FL>Bowel Management</FL>
              <Textarea rows={2} value={form.bowel_management} onChange={e => setForm(f => ({ ...f, bowel_management: e.target.value }))} placeholder="Laxatives, aperients, constipation protocol…" className="text-xs resize-none" />
            </div>
          </div>
        </div>

        {/* Psychosocial & spiritual */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Psychosocial & Spiritual Care</h3>
          <div>
            <FL>Spiritual / Religious Needs</FL>
            <Textarea rows={2} value={form.spiritual_needs} onChange={e => setForm(f => ({ ...f, spiritual_needs: e.target.value }))} placeholder="Religious preferences, chaplaincy, cultural requirements…" className="text-xs resize-none" />
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="fam_counsel" checked={form.family_counselled}
                onChange={e => setForm(f => ({ ...f, family_counselled: e.target.checked }))} className="h-4 w-4" />
              <label htmlFor="fam_counsel" className="text-xs font-medium">Family counselled about prognosis & care goals</label>
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="sw" checked={form.social_worker_assigned}
                onChange={e => setForm(f => ({ ...f, social_worker_assigned: e.target.checked }))} className="h-4 w-4" />
              <label htmlFor="sw" className="text-xs">Social worker assigned</label>
            </div>
          </div>
          {form.family_counselled && (
            <div>
              <FL>Counselling Notes</FL>
              <Textarea rows={2} value={form.counselling_notes} onChange={e => setForm(f => ({ ...f, counselling_notes: e.target.value }))} placeholder="Key points discussed with family…" className="text-xs resize-none" />
            </div>
          )}
        </div>

        {/* Care team & review */}
        <div className="border rounded-lg p-4 space-y-3">
          <h3 className="text-xs font-semibold text-foreground uppercase tracking-wide">Care Team & Review</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <FL>Palliative Care Physician</FL>
              <select value={form.palliative_physician_id} onChange={e => setForm(f => ({ ...f, palliative_physician_id: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select…</option>
                {staff.filter(s => ["doctor", "consultant"].includes(s.role)).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div>
              <FL>Key Nurse</FL>
              <select value={form.key_nurse_id} onChange={e => setForm(f => ({ ...f, key_nurse_id: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select…</option>
                {staff.filter(s => ["nurse", "staff_nurse", "nursing_head"].includes(s.role)).map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
              </select>
            </div>
            <div>
              <FL>Next Review Date</FL>
              <Input type="date" value={form.next_review_date} onChange={e => setForm(f => ({ ...f, next_review_date: e.target.value }))} className="h-8 text-sm" />
            </div>
            <div>
              <FL>Plan Status</FL>
              <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="w-full h-8 text-sm border border-input rounded px-2 bg-background">
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
                <option value="discharged">Discharged</option>
                <option value="deceased">Deceased</option>
              </select>
            </div>
          </div>
        </div>

        <Button className="w-full" size="sm" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
          Save Palliative Care Plan
        </Button>
      </div>
    </div>
  );
};

export default PalliativeCareTab;
