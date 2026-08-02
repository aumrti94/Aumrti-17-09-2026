import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { CheckCircle2, AlertTriangle, Plus, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  admissionId: string;
  patientId: string;
  hospitalId: string;
  userId: string;
}

const DIET_TYPES = [
  "Regular","Soft","Liquid","Semi-liquid","High protein","Diabetic","Renal","Low sodium",
  "Low fat","High fibre","Cardiac","NGT feed","TPN","Clear liquids","NPO (Nil by mouth)",
];

const NRS_FIELDS = [
  {
    id: "nrs_bmi_score", label: "Nutritional Status (BMI / Weight Loss)",
    options: [
      { v: "0", l: "0 — Normal nutritional status" },
      { v: "1", l: "1 — Weight loss >5% in 3 months OR BMI 18.5–20.5 + impaired general condition" },
      { v: "2", l: "2 — Weight loss >5% in 2 months OR BMI 18.5–20.5 + impaired condition" },
      { v: "3", l: "3 — Weight loss >5% in 1 month OR BMI <18.5 + impaired condition" },
    ],
  },
  {
    id: "nrs_intake_score", label: "Food Intake Reduction",
    options: [
      { v: "0", l: "0 — Normal intake" },
      { v: "1", l: "1 — Intake 50–75% of normal in past week" },
      { v: "2", l: "2 — Intake 25–50% of normal" },
      { v: "3", l: "3 — Intake <25% of normal" },
    ],
  },
  {
    id: "nrs_disease_score", label: "Disease Severity",
    options: [
      { v: "0", l: "0 — Normal requirements" },
      { v: "1", l: "1 — Hip fracture, COPD, chronic dialysis, diabetes, oncology" },
      { v: "2", l: "2 — Major abdominal surgery, stroke, severe pneumonia, haematologic cancer" },
      { v: "3", l: "3 — Head injury, ICU (APACHE II >10), bone marrow transplant" },
    ],
  },
  {
    id: "nrs_age_score", label: "Age",
    options: [{ v: "0", l: "0 — Age < 70 years" }, { v: "1", l: "1 — Age ≥ 70 years" }],
  },
];

export default function NutritionDieteticsTab({ admissionId, patientId, hospitalId, userId }: Props) {
  const { toast } = useToast();
  const [screening, setScreening] = useState<any | null>(null);
  const [dietOrders, setDietOrders] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // NRS-2002 form
  const [nrsForm, setNrsForm] = useState({
    nrs_bmi_score: "0", nrs_intake_score: "0", nrs_disease_score: "0", nrs_age_score: "0",
    calorie_target: "", protein_target: "",
  });

  // Diet order form
  const [dietForm, setDietForm] = useState({
    diet_type: "Regular", calorie_target: "", protein_target: "", texture_modification: "",
    fluid_restriction_ml: "", notes: "",
  });
  const [showDietForm, setShowDietForm] = useState(false);

  // Dietitian note form
  const [noteForm, setNoteForm] = useState({ assessment: "", plan: "", goals: "", calorie_actual: "", protein_actual: "" });
  const [showNoteForm, setShowNoteForm] = useState(false);

  const fetch = useCallback(async () => {
    setLoading(true);
    const [scrRes, dietRes, noteRes] = await Promise.all([
      (supabase as any).from("nutrition_screenings").select("*")
        .eq("admission_id", admissionId).eq("hospital_id", hospitalId)
        .eq("screening_tool", "nrs_2002").maybeSingle(),
      (supabase as any).from("diet_orders").select("*")
        .eq("admission_id", admissionId).eq("hospital_id", hospitalId)
        .order("created_at", { ascending: false }),
      (supabase as any).from("dietitian_notes").select("*")
        .eq("admission_id", admissionId).eq("hospital_id", hospitalId)
        .order("note_date", { ascending: false }),
    ]);
    setScreening(scrRes.data);
    setDietOrders(dietRes.data || []);
    setNotes(noteRes.data || []);
    setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { fetch(); }, [fetch]);

  const nrsTotal = parseInt(nrsForm.nrs_bmi_score) + parseInt(nrsForm.nrs_intake_score) +
    parseInt(nrsForm.nrs_disease_score) + parseInt(nrsForm.nrs_age_score);
  const nrsRisk = nrsTotal >= 3 ? "At Risk — nutritional support required"
    : nrsTotal >= 2 ? "Moderate Risk — weekly re-screen"
    : "Low Risk — weekly re-screen";
  const nrsRiskColor = nrsTotal >= 3 ? "text-red-600" : nrsTotal >= 2 ? "text-amber-600" : "text-green-600";

  const saveScreening = async () => {
    setSaving(true);
    await (supabase as any).from("nutrition_screenings").upsert({
      hospital_id: hospitalId, admission_id: admissionId, patient_id: patientId,
      screening_tool: "nrs_2002",
      nrs_bmi_score: parseInt(nrsForm.nrs_bmi_score),
      nrs_weight_loss_score: 0,
      nrs_intake_score: parseInt(nrsForm.nrs_intake_score),
      nrs_disease_score: parseInt(nrsForm.nrs_disease_score),
      nrs_age_score: parseInt(nrsForm.nrs_age_score),
      risk_category: nrsTotal >= 3 ? "at_risk" : nrsTotal >= 2 ? "moderate" : "low",
      calorie_target: nrsForm.calorie_target ? parseInt(nrsForm.calorie_target) : null,
      protein_target: nrsForm.protein_target ? parseFloat(nrsForm.protein_target) : null,
      screened_by: userId,
    }, { onConflict: "admission_id,screening_tool" });

    await logNABHEvidence(hospitalId, "COP.1",
      `NRS-2002 nutritional screening completed — Score: ${nrsTotal} — ${nrsRisk}`,
      nrsTotal >= 3 ? "partially_compliant" : "compliant");

    setSaving(false);
    fetch();
    toast({ title: `NRS-2002 saved — Score ${nrsTotal}: ${nrsTotal >= 3 ? "At Risk" : nrsTotal >= 2 ? "Moderate Risk" : "Low Risk"}` });
  };

  const saveDietOrder = async () => {
    setSaving(true);
    await (supabase as any).from("diet_orders").insert({
      hospital_id: hospitalId, admission_id: admissionId, patient_id: patientId,
      diet_type: dietForm.diet_type, status: "active", order_date: new Date().toISOString(),
      ordered_by: userId,
      calorie_target: dietForm.calorie_target ? parseInt(dietForm.calorie_target) : null,
      protein_target: dietForm.protein_target ? parseFloat(dietForm.protein_target) : null,
      texture_modification: dietForm.texture_modification || null,
      fluid_restriction_ml: dietForm.fluid_restriction_ml ? parseInt(dietForm.fluid_restriction_ml) : null,
      notes: dietForm.notes || null,
    });
    setSaving(false);
    setShowDietForm(false);
    setDietForm({ diet_type: "Regular", calorie_target: "", protein_target: "", texture_modification: "", fluid_restriction_ml: "", notes: "" });
    fetch();
    toast({ title: "Diet order placed" });
  };

  const saveDietitianNote = async () => {
    setSaving(true);
    await (supabase as any).from("dietitian_notes").insert({
      hospital_id: hospitalId, admission_id: admissionId, note_date: format(new Date(), "yyyy-MM-dd"),
      assessment: noteForm.assessment, plan: noteForm.plan, goals: noteForm.goals,
      calorie_actual: noteForm.calorie_actual ? parseInt(noteForm.calorie_actual) : null,
      protein_actual: noteForm.protein_actual ? parseFloat(noteForm.protein_actual) : null,
      noted_by: userId,
    });
    setSaving(false);
    setShowNoteForm(false);
    setNoteForm({ assessment: "", plan: "", goals: "", calorie_actual: "", protein_actual: "" });
    fetch();
    toast({ title: "Dietitian note saved" });
  };

  return (
    <div className="h-full overflow-auto p-4">
      {loading ? (
        <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
      ) : (
        <Tabs defaultValue="screening" className="space-y-4">
          <TabsList className="h-9">
            <TabsTrigger value="screening" className="text-[12px]">
              NRS-2002 Screening
              {screening && <CheckCircle2 size={11} className="ml-1.5 text-green-500" />}
            </TabsTrigger>
            <TabsTrigger value="diet" className="text-[12px]">Diet Orders ({dietOrders.length})</TabsTrigger>
            <TabsTrigger value="notes" className="text-[12px]">Dietitian Notes ({notes.length})</TabsTrigger>
          </TabsList>

          {/* ── NRS-2002 ── */}
          <TabsContent value="screening" className="space-y-4 mt-3">
            {screening && (
              <div className={cn("border rounded-xl p-4 flex items-center gap-3", screening.risk_category === "at_risk" ? "bg-red-50 border-red-200" : screening.risk_category === "moderate" ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200")}>
                <div>
                  <p className="text-[13px] font-semibold">Last NRS-2002 Score: {screening.nrs_total_score}</p>
                  <p className={cn("text-[12px]", screening.risk_category === "at_risk" ? "text-red-700" : screening.risk_category === "moderate" ? "text-amber-700" : "text-green-700")}>
                    {screening.risk_category === "at_risk" ? "⚠ At Risk — nutritional support required"
                      : screening.risk_category === "moderate" ? "Moderate Risk — weekly re-screen"
                      : "✓ Low Risk"}
                  </p>
                  {screening.calorie_target && <p className="text-[11px] text-muted-foreground">Target: {screening.calorie_target} kcal · {screening.protein_target}g protein/day</p>}
                </div>
              </div>
            )}

            <div className="space-y-3">
              {NRS_FIELDS.map(f => (
                <div key={f.id}>
                  <label className="text-[12px] font-medium text-foreground block mb-1.5">{f.label}</label>
                  <Select value={(nrsForm as any)[f.id]} onValueChange={v => setNrsForm(p => ({ ...p, [f.id]: v }))}>
                    <SelectTrigger className="h-10 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {f.options.map(o => <SelectItem key={o.v} value={o.v} className="text-[12px]">{o.l}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            {/* Score preview */}
            <div className={cn("border rounded-xl p-4 text-center", nrsTotal >= 3 ? "bg-red-50 border-red-200" : nrsTotal >= 2 ? "bg-amber-50 border-amber-200" : "bg-green-50 border-green-200")}>
              <p className="text-[28px] font-bold text-foreground">{nrsTotal} / 7</p>
              <p className={cn("text-[13px] font-semibold mt-1", nrsRiskColor)}>{nrsRisk}</p>
            </div>

            {nrsTotal >= 3 && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[12px] text-muted-foreground">Calorie Target (kcal/day)</label>
                  <Input type="number" value={nrsForm.calorie_target} onChange={e => setNrsForm(p => ({ ...p, calorie_target: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. 2000" />
                </div>
                <div>
                  <label className="text-[12px] text-muted-foreground">Protein Target (g/day)</label>
                  <Input type="number" value={nrsForm.protein_target} onChange={e => setNrsForm(p => ({ ...p, protein_target: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. 80" />
                </div>
              </div>
            )}

            <Button onClick={saveScreening} disabled={saving} className="w-full gap-2">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Save NRS-2002 Screening (NABH COP.1)
            </Button>
          </TabsContent>

          {/* ── Diet Orders ── */}
          <TabsContent value="diet" className="space-y-3 mt-3">
            <div className="flex justify-between items-center">
              <p className="text-[12px] text-muted-foreground">{dietOrders.length} diet order(s) on record</p>
              <Button size="sm" variant="outline" onClick={() => setShowDietForm(!showDietForm)} className="h-8 gap-1.5">
                <Plus size={12} /> New Diet Order
              </Button>
            </div>

            {showDietForm && (
              <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Diet Type *</label>
                    <Select value={dietForm.diet_type} onValueChange={v => setDietForm(p => ({ ...p, diet_type: v }))}>
                      <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                      <SelectContent>{DIET_TYPES.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Texture</label>
                    <Input value={dietForm.texture_modification} onChange={e => setDietForm(p => ({ ...p, texture_modification: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. Minced" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Calorie Target (kcal)</label>
                    <Input type="number" value={dietForm.calorie_target} onChange={e => setDietForm(p => ({ ...p, calorie_target: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Protein Target (g)</label>
                    <Input type="number" value={dietForm.protein_target} onChange={e => setDietForm(p => ({ ...p, protein_target: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Fluid Restriction (mL/day)</label>
                    <Input type="number" value={dietForm.fluid_restriction_ml} onChange={e => setDietForm(p => ({ ...p, fluid_restriction_ml: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Notes</label>
                    <Input value={dietForm.notes} onChange={e => setDietForm(p => ({ ...p, notes: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowDietForm(false)} className="h-8">Cancel</Button>
                  <Button size="sm" onClick={saveDietOrder} disabled={saving} className="h-8">
                    {saving ? <Loader2 size={12} className="animate-spin mr-1" /> : null}Place Order
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {dietOrders.map(d => (
                <div key={d.id} className="border border-border rounded-xl p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-[13px] font-semibold text-foreground">{d.diet_type}</p>
                    <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium", d.status === "active" ? "bg-green-50 text-green-700" : "bg-muted text-muted-foreground")}>{d.status}</span>
                  </div>
                  <div className="flex gap-4 mt-1 text-[11px] text-muted-foreground">
                    {d.calorie_target && <span>{d.calorie_target} kcal/day</span>}
                    {d.protein_target && <span>{d.protein_target}g protein/day</span>}
                    {d.fluid_restriction_ml && <span>Fluid: {d.fluid_restriction_ml} mL/day</span>}
                    {d.texture_modification && <span>Texture: {d.texture_modification}</span>}
                  </div>
                  {d.notes && <p className="text-[11px] text-muted-foreground mt-1">{d.notes}</p>}
                  <p className="text-[10px] text-muted-foreground mt-1">{format(new Date(d.order_date || d.created_at), "dd/MM/yyyy")}</p>
                </div>
              ))}
              {dietOrders.length === 0 && (
                <p className="text-[13px] text-muted-foreground text-center py-6">No diet orders placed yet.</p>
              )}
            </div>
          </TabsContent>

          {/* ── Dietitian Notes ── */}
          <TabsContent value="notes" className="space-y-3 mt-3">
            <div className="flex justify-between items-center">
              <p className="text-[12px] text-muted-foreground">Dietitian assessment and care plan notes</p>
              <Button size="sm" variant="outline" onClick={() => setShowNoteForm(!showNoteForm)} className="h-8 gap-1.5">
                <Plus size={12} /> Add Note
              </Button>
            </div>

            {showNoteForm && (
              <div className="border border-border rounded-xl p-4 bg-muted/30 space-y-3">
                <div>
                  <label className="text-[11px] text-muted-foreground">Assessment</label>
                  <Textarea value={noteForm.assessment} onChange={e => setNoteForm(p => ({ ...p, assessment: e.target.value }))} rows={3} className="mt-1 text-[12px]" placeholder="Nutritional assessment findings…" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Plan</label>
                  <Textarea value={noteForm.plan} onChange={e => setNoteForm(p => ({ ...p, plan: e.target.value }))} rows={3} className="mt-1 text-[12px]" placeholder="Dietary intervention plan…" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Goals</label>
                  <Input value={noteForm.goals} onChange={e => setNoteForm(p => ({ ...p, goals: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. Achieve 2000 kcal/day by day 3" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-muted-foreground">Actual Intake (kcal)</label>
                    <Input type="number" value={noteForm.calorie_actual} onChange={e => setNoteForm(p => ({ ...p, calorie_actual: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                  <div>
                    <label className="text-[11px] text-muted-foreground">Actual Protein (g)</label>
                    <Input type="number" value={noteForm.protein_actual} onChange={e => setNoteForm(p => ({ ...p, protein_actual: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button size="sm" variant="outline" onClick={() => setShowNoteForm(false)} className="h-8">Cancel</Button>
                  <Button size="sm" onClick={saveDietitianNote} disabled={saving} className="h-8">Save Note</Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {notes.map(n => (
                <div key={n.id} className="border border-border rounded-xl p-3">
                  <p className="text-[11px] text-muted-foreground mb-2">{format(new Date(n.note_date), "dd/MM/yyyy")}</p>
                  {n.assessment && <div><p className="text-[11px] font-medium text-muted-foreground">Assessment</p><p className="text-[12px]">{n.assessment}</p></div>}
                  {n.plan && <div className="mt-2"><p className="text-[11px] font-medium text-muted-foreground">Plan</p><p className="text-[12px]">{n.plan}</p></div>}
                  {n.goals && <div className="mt-2"><p className="text-[11px] font-medium text-muted-foreground">Goals</p><p className="text-[12px]">{n.goals}</p></div>}
                  {(n.calorie_actual || n.protein_actual) && (
                    <p className="text-[11px] text-muted-foreground mt-1.5">
                      Actual: {n.calorie_actual ? `${n.calorie_actual} kcal` : ""} {n.protein_actual ? `· ${n.protein_actual}g protein` : ""}
                    </p>
                  )}
                </div>
              ))}
              {notes.length === 0 && <p className="text-[13px] text-muted-foreground text-center py-6">No dietitian notes yet.</p>}
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
