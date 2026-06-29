import React, { useState, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { AIRecommendationPanel } from "@/components/shared/AIRecommendationPanel";
import { AlertTriangle, Check, Sparkles, ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

// ── Bishop Score calculator ─────────────────────────────────────
function computeBishopScore(f: any): number {
  let score = 0;
  const dilation = Number(f.bishop_dilation) || 0;
  if (dilation >= 5) score += 3; else if (dilation >= 3) score += 2; else if (dilation >= 1) score += 1;
  const effacement = Number(f.bishop_effacement) || 0;
  if (effacement >= 80) score += 3; else if (effacement >= 60) score += 2; else if (effacement >= 40) score += 1;
  if (f.bishop_consistency === "Soft") score += 2; else if (f.bishop_consistency === "Medium") score += 1;
  if (f.bishop_position === "Anterior") score += 2; else if (f.bishop_position === "Mid") score += 1;
  const stationMap: Record<string, number> = { "-3": 0, "-2": 1, "-1": 2, "0": 2, "+1": 3, "+2": 3 };
  score += stationMap[f.bishop_station || "-3"] ?? 0;
  return score;
}

// ── Risk flag logic ───────────────────────────────────────────────
const computeRiskFlags = (f: any): string[] => {
  const flags: string[] = [];
  if (Number(f.systolic_bp) >= 140 || Number(f.diastolic_bp) >= 90) flags.push("Hypertension in pregnancy");
  if (Number(f.hemoglobin) > 0 && Number(f.hemoglobin) < 7) flags.push("Severe anaemia (Hb < 7 g/dL)");
  if (f.bleeding_per_vagina) flags.push("Antepartum haemorrhage");
  if (f.leaking_per_vagina) flags.push("Possible PROM");
  if (f.decreased_fetal_movements) flags.push("Reduced fetal movements");
  if (f.headache && f.blurring_of_vision && Number(f.systolic_bp) >= 140) flags.push("Preeclampsia suspected");
  if (Number(f.previous_cesarean_count) > 0 && f.abdominal_pain) flags.push("Scar tenderness – previous LSCS");
  if (f.rh_type === "Negative") flags.push("Rh-negative mother");
  if (f.urine_albumin && f.urine_albumin !== "Nil" && Number(f.systolic_bp) >= 140) flags.push("Proteinuria with hypertension — Pre-eclampsia");
  const bs = computeBishopScore(f);
  if (bs > 0 && bs < 6) flags.push(`Unfavorable cervix — Bishop Score ${bs}/13`);
  return flags;
};

const Section: React.FC<{ title: string; children: React.ReactNode; open?: boolean }> = ({ title, children, open: initOpen = false }) => {
  const [open, setOpen] = useState(initOpen);
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-3 bg-muted/40 hover:bg-muted/60 transition-colors">
        <span className="font-semibold text-sm">{title}</span>
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
      </button>
      {open && <div className="px-5 py-4 space-y-4">{children}</div>}
    </div>
  );
};

const Lbl: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="space-y-1">
    <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</label>
    {children}
  </div>
);

const Inp = ({ value, onChange, type = "text", className = "", ...p }: any) => (
  <input type={type} value={value} onChange={(e) => onChange(type === "number" ? (e.target.value === "" ? "" : Number(e.target.value)) : e.target.value)}
    className={cn("flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring", className)} {...p} />
);

const Sel = ({ value, onChange, options, className = "" }: { value: string; onChange: (v: string) => void; options: string[]; className?: string }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)}
    className={cn("flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm", className)}>
    {options.map((o) => <option key={o}>{o}</option>)}
  </select>
);

const Tog = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
  <label className="flex items-center gap-2 cursor-pointer select-none">
    <div onClick={() => onChange(!checked)} className={cn("w-9 h-5 rounded-full flex items-center px-0.5 transition-colors", checked ? "bg-emerald-500" : "bg-muted-foreground/30")}>
      <div className={cn("w-4 h-4 rounded-full bg-white shadow transition-transform", checked ? "translate-x-4" : "translate-x-0")} />
    </div>
    <span className="text-sm">{label}</span>
  </label>
);

const INIT = {
  visit_type: "Follow-up ANC", visit_date: new Date().toISOString().split("T")[0],
  lmp: "", edd: "", gestational_age_weeks: "" as any, booking_status: "Booked",
  gravida: "" as any, para: "" as any, living: "" as any, abortions: "" as any, previous_cesarean_count: "" as any,
  height_cm: "" as any, weight_kg: "" as any, systolic_bp: "" as any, diastolic_bp: "" as any, pulse: "" as any,
  pallor: false, oedema: false,
  fundal_height_cm: "" as any, presentation: "Cephalic", lie: "Longitudinal", fetal_heart_rate: "" as any, fetal_movements_present: true,
  bleeding_per_vagina: false, leaking_per_vagina: false, abdominal_pain: false, decreased_fetal_movements: false,
  headache: false, blurring_of_vision: false, swelling_feet: false,
  hemoglobin: "" as any, blood_group: "", rh_type: "Positive", hiv_test_result: "Not done", urine_albumin: "Nil", urine_sugar: "Nil",
  iron_prescribed: true, calcium_prescribed: true, folic_acid_prescribed: true, counselling_done: false, next_followup_date: "",
  bishop_dilation: "" as any, bishop_effacement: "" as any, bishop_consistency: "Firm", bishop_position: "Posterior", bishop_station: "-3",
  clinician_edited_note: "",
};

export default function ObstetricANCPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [form, setForm] = useState({ ...INIT });
  const [patientId, setPatientId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiRecs, setAiRecs] = useState<any[]>([]);
  const set = (k: string) => (v: any) => setForm((f) => ({ ...f, [k]: v }));
  const riskFlags = useMemo(() => computeRiskFlags(form), [form]);
  const bishopScore = useMemo(() => computeBishopScore(form), [form]);

  const { data: patients } = useQuery({
    queryKey: ["patients-list", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data } = await supabase.from("patients").select("id, full_name, uhid").eq("hospital_id", hospitalId).order("full_name").limit(100);
      return data ?? [];
    },
    enabled: !!hospitalId,
  });

  const save = useMutation({
    mutationFn: async (signoff: "draft" | "signed") => {
      if (!hospitalId || !patientId) throw new Error("Select a patient first");
        const { error } = await supabase.from("obstetric_records").insert({
          hospital_id: hospitalId,
          patient_id: patientId,
          high_risk_status: riskFlags.length > 0,
          risk_factors: riskFlags,
          signoff_status: signoff,
          anc_full_data: form,
          ...form,
        });
      if (error) throw error;
    },
    onSuccess: () => toast({ title: "ANC encounter saved ✓" }),
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const generateNote = async () => {
    setAiLoading(true);
    const summary = `G${form.gravida}P${form.para}L${form.living} at ${form.gestational_age_weeks}w. BP ${form.systolic_bp}/${form.diastolic_bp}, Hb ${form.hemoglobin}. FHR ${form.fetal_heart_rate}. Risks: ${riskFlags.join(", ") || "none"}.`;
    setForm((f) => ({ ...f, clinician_edited_note: `Subjective: ${form.visit_type}\n\nObjective: ${summary}\n\nAssessment: ${riskFlags.length > 0 ? "HIGH RISK — " + riskFlags.join("; ") : "Low risk pregnancy."}\n\nPlan: Iron=${form.iron_prescribed ? "Yes" : "No"}, Calcium=${form.calcium_prescribed ? "Yes" : "No"}. Next visit: ${form.next_followup_date || "TBD"}.` }));
    setAiRecs([{ id: "1", text: "AI SOAP note generated", reasoning: summary, confidenceScore: 0.81, isWarning: riskFlags.length > 0 }]);
    setAiLoading(false);
  };

  return (
    <div className="h-[calc(100vh-56px)] flex overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between bg-card">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="text-muted-foreground hover:text-foreground"><ArrowLeft size={18} /></button>
            <div>
              <h1 className="text-lg font-bold">Obstetric ANC Encounter</h1>
              <p className="text-xs text-muted-foreground">Antenatal Care — Specialty EMR</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {riskFlags.length > 0 && (
              <span className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-destructive/10 text-destructive text-xs font-bold animate-pulse">
                <AlertTriangle size={12} /> HIGH RISK
              </span>
            )}
            <button onClick={generateNote} disabled={aiLoading}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[hsl(222,55%,23%)] text-[hsl(222,55%,23%)] text-sm font-medium hover:bg-[hsl(222,55%,23%)]/10 disabled:opacity-50">
              <Sparkles size={14} /> {aiLoading ? "Generating…" : "AI Note"}
            </button>
            <button onClick={() => save.mutate("draft")} disabled={!patientId || save.isPending}
              className="px-3 py-2 rounded-lg border border-border text-sm hover:bg-muted disabled:opacity-40">Save Draft</button>
            <button onClick={() => save.mutate("signed")} disabled={!patientId || save.isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50">
              <Check size={14} /> Sign & Save
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
            <label className="text-[11px] font-semibold text-amber-700 uppercase tracking-wide mb-1 block">Patient *</label>
            <select value={patientId || ""} onChange={(e) => setPatientId(e.target.value || null)}
              className="w-full h-10 rounded-md border border-amber-300 bg-white px-3 text-sm">
              <option value="">— Choose patient —</option>
              {patients?.map((p) => <option key={p.id} value={p.id}>{p.full_name} · {p.uhid}</option>)}
            </select>
          </div>

          {riskFlags.length > 0 && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30">
              <p className="text-xs font-bold text-destructive mb-1.5">⚠ High-Risk Indicators</p>
              <div className="flex flex-wrap gap-1.5">
                {riskFlags.map((f) => <span key={f} className="text-[11px] px-2 py-0.5 bg-destructive/20 text-destructive rounded-full">{f}</span>)}
              </div>
            </div>
          )}

          <Section title="Encounter Details" open>
            <div className="grid grid-cols-3 gap-4">
              <Lbl label="Visit Type"><Sel value={form.visit_type} onChange={set("visit_type")} options={["First ANC", "Follow-up ANC", "Referred case", "High-risk review"]} /></Lbl>
              <Lbl label="Visit Date"><Inp type="date" value={form.visit_date} onChange={set("visit_date")} /></Lbl>
              <Lbl label="Booking Status"><Sel value={form.booking_status} onChange={set("booking_status")} options={["Booked", "Unbooked"]} /></Lbl>
              <Lbl label="LMP"><Inp type="date" value={form.lmp} onChange={set("lmp")} /></Lbl>
              <Lbl label="EDD"><Inp type="date" value={form.edd} onChange={set("edd")} /></Lbl>
              <Lbl label="GA (weeks)"><Inp type="number" value={form.gestational_age_weeks} onChange={set("gestational_age_weeks")} min={4} max={42} /></Lbl>
            </div>
          </Section>

          <Section title="Obstetric Score">
            <div className="grid grid-cols-5 gap-4">
              {[["Gravida", "gravida"], ["Para", "para"], ["Living", "living"], ["Abortions", "abortions"], ["Prev. LSCS", "previous_cesarean_count"]].map(([label, key]) => (
                <Lbl key={key} label={label}><Inp type="number" value={(form as any)[key]} onChange={set(key)} min={0} /></Lbl>
              ))}
            </div>
          </Section>

          <Section title="Symptoms / Complaints">
            <div className="grid grid-cols-2 gap-3">
              {[["bleeding_per_vagina", "Bleeding per vagina"], ["leaking_per_vagina", "Leaking per vagina (PROM)"], ["abdominal_pain", "Abdominal pain"], ["decreased_fetal_movements", "Decreased fetal movements"], ["headache", "Severe headache"], ["blurring_of_vision", "Blurring of vision"], ["swelling_feet", "Swelling of feet/face"]].map(([key, label]) => (
                <Tog key={key} checked={!!(form as any)[key]} onChange={set(key)} label={label} />
              ))}
            </div>
          </Section>

          <Section title="General Examination">
            <div className="grid grid-cols-4 gap-4">
              <Lbl label="Height (cm)"><Inp type="number" value={form.height_cm} onChange={set("height_cm")} /></Lbl>
              <Lbl label="Weight (kg)"><Inp type="number" value={form.weight_kg} onChange={set("weight_kg")} /></Lbl>
              <Lbl label="Systolic BP"><Inp type="number" value={form.systolic_bp} onChange={set("systolic_bp")} className={Number(form.systolic_bp) >= 140 ? "border-destructive bg-destructive/5" : ""} /></Lbl>
              <Lbl label="Diastolic BP"><Inp type="number" value={form.diastolic_bp} onChange={set("diastolic_bp")} className={Number(form.diastolic_bp) >= 90 ? "border-destructive bg-destructive/5" : ""} /></Lbl>
              <Lbl label="Pulse (bpm)"><Inp type="number" value={form.pulse} onChange={set("pulse")} /></Lbl>
            </div>
            <div className="flex gap-6 mt-2">
              <Tog checked={form.pallor} onChange={set("pallor")} label="Pallor" />
              <Tog checked={form.oedema} onChange={set("oedema")} label="Oedema" />
            </div>
          </Section>

          <Section title="Obstetric Examination">
            <div className="grid grid-cols-4 gap-4">
              <Lbl label="Fundal Height (cm)"><Inp type="number" value={form.fundal_height_cm} onChange={set("fundal_height_cm")} /></Lbl>
              <Lbl label="FHR (bpm)"><Inp type="number" value={form.fetal_heart_rate} onChange={set("fetal_heart_rate")} /></Lbl>
              <Lbl label="Lie"><Sel value={form.lie} onChange={set("lie")} options={["Longitudinal", "Transverse", "Oblique"]} /></Lbl>
              <Lbl label="Presentation"><Sel value={form.presentation} onChange={set("presentation")} options={["Cephalic", "Breech", "Shoulder", "Unknown"]} /></Lbl>
            </div>
            <Tog checked={form.fetal_movements_present} onChange={set("fetal_movements_present")} label="Fetal movements felt" />
          </Section>

          <Section title="Investigations">
            <div className="grid grid-cols-3 gap-4">
              <Lbl label="Haemoglobin (g/dL)"><Inp type="number" value={form.hemoglobin} onChange={set("hemoglobin")} className={Number(form.hemoglobin) > 0 && Number(form.hemoglobin) < 7 ? "border-destructive bg-destructive/5" : ""} /></Lbl>
              <Lbl label="Blood Group"><Inp value={form.blood_group} onChange={set("blood_group")} placeholder="A / B / AB / O" /></Lbl>
              <Lbl label="Rh Type"><Sel value={form.rh_type} onChange={set("rh_type")} options={["Positive", "Negative"]} className={form.rh_type === "Negative" ? "border-amber-400 bg-amber-50" : ""} /></Lbl>
              <Lbl label="HIV Status"><Sel value={form.hiv_test_result} onChange={set("hiv_test_result")} options={["Not done", "Negative", "Positive", "Inconclusive"]} /></Lbl>
              <Lbl label="Urine Albumin"><Sel value={form.urine_albumin} onChange={set("urine_albumin")} options={["Nil", "Trace", "+1", "+2", "+3"]} /></Lbl>
              <Lbl label="Urine Sugar"><Sel value={form.urine_sugar} onChange={set("urine_sugar")} options={["Nil", "Trace", "+1", "+2"]} /></Lbl>
            </div>
          </Section>

          <Section title="Treatment & Plan">
            <div className="grid grid-cols-2 gap-3">
              <Tog checked={form.iron_prescribed} onChange={set("iron_prescribed")} label="Iron + Folic Acid prescribed" />
              <Tog checked={form.calcium_prescribed} onChange={set("calcium_prescribed")} label="Calcium prescribed" />
              <Tog checked={form.folic_acid_prescribed} onChange={set("folic_acid_prescribed")} label="Folic Acid supplementation" />
              <Tog checked={form.counselling_done} onChange={set("counselling_done")} label="Danger signs counselling done" />
            </div>
            <Lbl label="Next Follow-up Date"><Inp type="date" value={form.next_followup_date} onChange={set("next_followup_date")} className="w-60" /></Lbl>
          </Section>

          <Section title="Cervical Assessment — Bishop Score">
            <div className="grid grid-cols-5 gap-4">
              <Lbl label="Dilation (cm)"><Inp type="number" value={form.bishop_dilation} onChange={set("bishop_dilation")} min={0} max={10} placeholder="0–10" /></Lbl>
              <Lbl label="Effacement (%)"><Inp type="number" value={form.bishop_effacement} onChange={set("bishop_effacement")} min={0} max={100} placeholder="0–100" /></Lbl>
              <Lbl label="Consistency"><Sel value={form.bishop_consistency} onChange={set("bishop_consistency")} options={["Firm", "Medium", "Soft"]} /></Lbl>
              <Lbl label="Position"><Sel value={form.bishop_position} onChange={set("bishop_position")} options={["Posterior", "Mid", "Anterior"]} /></Lbl>
              <Lbl label="Station"><Sel value={form.bishop_station} onChange={set("bishop_station")} options={["-3", "-2", "-1", "0", "+1", "+2"]} /></Lbl>
            </div>
            {(form.bishop_dilation !== "" || form.bishop_effacement !== "") && (
              <div className={`mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${bishopScore >= 6 ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                Bishop Score: {bishopScore}/13 — {bishopScore >= 9 ? "Favorable — induction likely successful" : bishopScore >= 6 ? "Moderate — cervix ripening adequate" : "Unfavorable — cervical ripening recommended"}
              </div>
            )}
          </Section>

          <Section title="Clinical Note & Sign-off" open>
            <textarea value={form.clinician_edited_note} onChange={(e) => set("clinician_edited_note")(e.target.value)}
              rows={7} placeholder="Type or use AI to generate a SOAP note…"
              className="w-full rounded-xl border border-input bg-background px-4 py-3 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring font-mono" />
          </Section>
        </div>
      </div>

      <div className="w-[300px] flex-shrink-0 border-l border-border p-4">
        <AIRecommendationPanel
          title="AI Clinical Insights"
          recommendations={aiRecs}
          onAccept={() => toast({ title: "AI suggestion accepted" })}
          onReject={(id) => setAiRecs((r) => r.filter((x) => x.id !== id))}
          isLoading={aiLoading}
        />
      </div>
    </div>
  );
}
