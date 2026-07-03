import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { printDocument, printHeader } from "@/lib/printUtils";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { Bot, Loader2, Printer, Save, FileText } from "lucide-react";

interface Props {
  hospitalId: string;
  userId: string | null;
  edVisitId: string;
  patientName: string;
  onClose: () => void;
  onSaved?: () => void;
}

interface EDVisitRow {
  chief_complaint: string | null;
  working_diagnosis: string | null;
  vitals_snapshot: Record<string, any> | null;
  arrival_time: string;
  triage_category: string | null;
  mlc: boolean | null;
  discharge_summary: any;
}

interface PatientRow {
  full_name: string;
  uhid: string | null;
  dob: string | null;
  gender: string | null;
}

const ageFromDob = (dob: string | null): string => {
  if (!dob) return "—";
  const years = Math.floor((Date.now() - new Date(dob).getTime()) / 31557600000);
  return years >= 0 && years < 200 ? String(years) : "—";
};

/**
 * ED discharge summary / prescription / follow-up advice (Phase 2).
 * Structured, patient-facing document. Saves to ed_visits.discharge_summary and prints.
 * Optional AI draft fills follow-up + return precautions. Kept lightweight — no billing
 * gate or mandatory signature (ED discharge is fast); the existing discharge flow is unchanged.
 */
const EDDischargeSummaryModal: React.FC<Props> = ({ hospitalId, userId, edVisitId, patientName, onClose, onSaved }) => {
  const [visit, setVisit] = useState<EDVisitRow | null>(null);
  const [patient, setPatient] = useState<PatientRow | null>(null);
  const [hospitalName, setHospitalName] = useState("Hospital");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const [diagnosis, setDiagnosis] = useState("");
  const [treatment, setTreatment] = useState("");
  const [medications, setMedications] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [precautions, setPrecautions] = useState("");
  const [doctorName, setDoctorName] = useState("");

  const load = useCallback(async () => {
    const [{ data: v }, { data: hosp }, { data: { user } }] = await Promise.all([
      (supabase as any).from("ed_visits")
        .select("chief_complaint, working_diagnosis, vitals_snapshot, arrival_time, triage_category, mlc, discharge_summary, patient_id")
        .eq("id", edVisitId).maybeSingle(),
      (supabase as any).from("hospitals").select("name").eq("id", hospitalId).maybeSingle(),
      supabase.auth.getUser(),
    ]);
    setVisit(v as EDVisitRow);
    if (hosp?.name) setHospitalName(hosp.name);

    if (v?.patient_id) {
      const { data: p } = await (supabase as any).from("patients")
        .select("full_name, uhid, dob, gender").eq("id", v.patient_id).maybeSingle();
      setPatient(p as PatientRow);
    }

    // Prefill from an existing saved summary, else from the visit's clinical fields.
    const s = v?.discharge_summary || {};
    setDiagnosis(s.diagnosis ?? v?.working_diagnosis ?? "");
    setTreatment(s.treatment ?? "");
    setMedications(s.medications ?? "");
    setFollowUp(s.follow_up ?? "");
    setPrecautions(s.precautions ?? "");
    // Default the signing doctor to the current user's name.
    if (s.doctor_name) {
      setDoctorName(s.doctor_name);
    } else if (user) {
      const { data: ud } = await (supabase as any).from("users")
        .select("full_name").eq("auth_user_id", user.id).maybeSingle();
      if (ud?.full_name) setDoctorName(ud.full_name);
    }
    setLoading(false);
  }, [edVisitId, hospitalId]);

  useEffect(() => { load(); }, [load]);

  const aiDraft = async () => {
    if (!visit) return;
    setAiLoading(true);
    try {
      const vitals = visit.vitals_snapshot || {};
      const prompt = `You are an emergency physician writing patient discharge instructions for an Indian hospital ED.
Chief complaint: ${visit.chief_complaint || "—"}
Working diagnosis: ${diagnosis || visit.working_diagnosis || "—"}
Vitals: BP ${vitals.bp_s || "—"}/${vitals.bp_d || "—"}, Pulse ${vitals.pulse || "—"}, SpO2 ${vitals.spo2 || "—"}, GCS ${vitals.gcs || "—"}.

Write concise, plain-language content the patient can follow. Return ONLY valid JSON:
{
  "follow_up": "when and with whom to follow up, and any tests to repeat",
  "precautions": "warning signs that mean the patient must return to the ER immediately (as short bullet lines)"
}`;
      const res = await callAI({ featureKey: "ed_discharge_summary", hospitalId, prompt, maxTokens: 500 });
      if (res.error || !res.text) {
        toast({ title: "AI unavailable", description: "Write the advice manually.", variant: "destructive" });
        return;
      }
      try {
        const clean = res.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        if (parsed.follow_up) setFollowUp(parsed.follow_up);
        if (parsed.precautions) setPrecautions(parsed.precautions);
        toast({ title: "AI draft added", description: "Review before printing." });
      } catch {
        // Not JSON — drop the raw text into follow-up for the doctor to edit.
        setFollowUp(res.text.trim());
        toast({ title: "AI draft added", description: "Review before printing." });
      }
    } finally {
      setAiLoading(false);
    }
  };

  const buildSummary = () => ({
    diagnosis, treatment, medications, follow_up: followUp, precautions,
    doctor_name: doctorName, saved_by: userId, saved_at: new Date().toISOString(),
  });

  const save = async () => {
    setSaving(true);
    const { error } = await (supabase as any).from("ed_visits")
      .update({ discharge_summary: buildSummary() }).eq("id", edVisitId);
    setSaving(false);
    if (error) { toast({ title: "Could not save", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Discharge summary saved" });
    onSaved?.();
  };

  const printSummary = async () => {
    // Persist before printing so the printed copy matches the record.
    await (supabase as any).from("ed_visits").update({ discharge_summary: buildSummary() }).eq("id", edVisitId);
    const now = new Date();
    const linesToHtml = (t: string) =>
      t.split("\n").filter(Boolean).map(l => `<div>${l.replace(/^[-•]\s*/, "• ")}</div>`).join("") || "—";

    const body = `
      ${printHeader(hospitalName, "Emergency Department — Discharge Summary")}
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin:12px 0">
        <tr><td style="padding:5px;border:1px solid #ccc;width:25%;font-weight:bold">Patient</td><td style="padding:5px;border:1px solid #ccc">${patient?.full_name || patientName}</td>
            <td style="padding:5px;border:1px solid #ccc;width:20%;font-weight:bold">UHID</td><td style="padding:5px;border:1px solid #ccc">${patient?.uhid || "—"}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ccc;font-weight:bold">Age / Sex</td><td style="padding:5px;border:1px solid #ccc">${ageFromDob(patient?.dob ?? null)} / ${patient?.gender || "—"}</td>
            <td style="padding:5px;border:1px solid #ccc;font-weight:bold">Triage</td><td style="padding:5px;border:1px solid #ccc">${visit?.triage_category || "—"}${visit?.mlc ? " · MLC" : ""}</td></tr>
        <tr><td style="padding:5px;border:1px solid #ccc;font-weight:bold">Arrival</td><td style="padding:5px;border:1px solid #ccc">${visit?.arrival_time ? new Date(visit.arrival_time).toLocaleString("en-IN") : "—"}</td>
            <td style="padding:5px;border:1px solid #ccc;font-weight:bold">Discharge</td><td style="padding:5px;border:1px solid #ccc">${now.toLocaleString("en-IN")}</td></tr>
      </table>

      <div style="font-size:12px;line-height:1.7">
        <p><strong>Presenting Complaint:</strong> ${visit?.chief_complaint || "—"}</p>
        <p><strong>Diagnosis:</strong> ${diagnosis || "—"}</p>
        <p style="margin-top:10px"><strong>Treatment Given in ED:</strong></p>
        <div style="margin-left:8px">${linesToHtml(treatment)}</div>
        <p style="margin-top:10px"><strong>Medications Prescribed:</strong></p>
        <div style="margin-left:8px">${linesToHtml(medications)}</div>
        <p style="margin-top:10px"><strong>Follow-up Advice:</strong></p>
        <div style="margin-left:8px">${linesToHtml(followUp)}</div>
        <p style="margin-top:10px;color:#b91c1c"><strong>Return to the ER immediately if:</strong></p>
        <div style="margin-left:8px;color:#b91c1c">${linesToHtml(precautions)}</div>
      </div>

      <div style="margin-top:40px;display:flex;justify-content:flex-end;font-size:12px">
        <div style="text-align:center"><p>_________________________</p><p>${doctorName || "Attending Doctor"}</p><p style="color:#666">Emergency Physician</p></div>
      </div>
    `;
    printDocument(`ED Discharge Summary - ${patient?.full_name || patientName}`, body);
    toast({ title: "Discharge summary ready to print" });
    onSaved?.();
  };

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4" /> ED Discharge Summary — {patientName}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading…</p>
        ) : (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={aiDraft} disabled={aiLoading} className="h-8 text-xs">
                {aiLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Bot className="h-3.5 w-3.5 mr-1" />}
                AI draft advice
              </Button>
            </div>

            <Field label="Diagnosis">
              <Input value={diagnosis} onChange={e => setDiagnosis(e.target.value)} placeholder="Working / final diagnosis" />
            </Field>
            <Field label="Treatment given in ED">
              <Textarea value={treatment} onChange={e => setTreatment(e.target.value)} rows={3} placeholder="One item per line — e.g. IV fluids, Inj. Pantoprazole, wound dressing…" className="resize-none" />
            </Field>
            <Field label="Medications prescribed">
              <Textarea value={medications} onChange={e => setMedications(e.target.value)} rows={3} placeholder="One drug per line — name, dose, frequency, duration" className="resize-none" />
            </Field>
            <Field label="Follow-up advice">
              <Textarea value={followUp} onChange={e => setFollowUp(e.target.value)} rows={2} placeholder="When / with whom to follow up, tests to repeat…" className="resize-none" />
            </Field>
            <Field label="Return precautions (warning signs)">
              <Textarea value={precautions} onChange={e => setPrecautions(e.target.value)} rows={2} placeholder="One warning sign per line" className="resize-none" />
            </Field>
            <Field label="Signing doctor">
              <Input value={doctorName} onChange={e => setDoctorName(e.target.value)} placeholder="Dr. …" />
            </Field>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="outline" onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />} Save
          </Button>
          <Button onClick={printSummary} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700">
            <Printer className="h-4 w-4 mr-1" /> Save &amp; Print
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">{label}</label>
    <div className="mt-1">{children}</div>
  </div>
);

export default EDDischargeSummaryModal;
