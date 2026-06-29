import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { CalendarDays, AlertTriangle } from "lucide-react";

const RISK_LEVELS = [
  { value: "low", label: "Low Risk", color: "bg-emerald-100 text-emerald-700" },
  { value: "moderate", label: "Moderate Risk", color: "bg-amber-100 text-amber-700" },
  { value: "high", label: "High Risk", color: "bg-orange-100 text-orange-700" },
  { value: "crisis", label: "Crisis", color: "bg-red-100 text-red-700" },
];

const MSE_FIELDS = [
  { key: "appearance", label: "Appearance" },
  { key: "behaviour", label: "Behaviour" },
  { key: "speech", label: "Speech" },
  { key: "mood", label: "Mood" },
  { key: "affect", label: "Affect" },
  { key: "thought_form", label: "Thought Form" },
  { key: "thought_content", label: "Thought Content" },
  { key: "perception", label: "Perception" },
  { key: "cognition", label: "Cognition" },
  { key: "insight", label: "Insight & Judgement" },
];

interface Props {
  patientId: string;
  hospitalId: string;
  onEncounterCreated?: (encounterId: string) => void;
}

const MHConsultationTab: React.FC<Props> = ({ patientId, hospitalId, onEncounterCreated }) => {
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [mse, setMse] = useState<Record<string, string>>({});
  const [diagnosis, setDiagnosis] = useState("");
  const [icd10Code, setIcd10Code] = useState("");
  const [riskLevel, setRiskLevel] = useState<string>("low");
  const [treatmentPlan, setTreatmentPlan] = useState("");
  const [nextAppointment, setNextAppointment] = useState("");
  const [saving, setSaving] = useState(false);
  const [encounters, setEncounters] = useState<any[]>([]);
  const [selectedEncounter, setSelectedEncounter] = useState<any | null>(null);

  useEffect(() => { fetchEncounters(); }, [patientId]);

  const fetchEncounters = async () => {
    const { data } = await (supabase as any)
      .from("mental_health_encounters")
      .select("id, encounter_date, diagnosis, risk_level, status, chief_complaint")
      .eq("patient_id", patientId)
      .order("encounter_date", { ascending: false })
      .limit(20);
    setEncounters(data || []);
  };

  const handleSave = async () => {
    if (!chiefComplaint.trim()) { toast.error("Chief complaint is required"); return; }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await (supabase as any).from("users").select("id").eq("auth_user_id", user?.id).maybeSingle();

    const payload = {
      hospital_id: hospitalId,
      patient_id: patientId,
      doctor_id: userData?.id || null,
      encounter_date: new Date().toISOString().split("T")[0],
      chief_complaint: chiefComplaint,
      mental_status_exam: mse,
      diagnosis,
      icd10_code: icd10Code || null,
      risk_level: riskLevel,
      treatment_plan: treatmentPlan,
      next_appointment: nextAppointment || null,
      status: "active",
    };

    const { data: encounter, error } = await (supabase as any).from("mental_health_encounters").insert(payload).select().maybeSingle();
    if (error) { toast.error(error.message); setSaving(false); return; }

    if (riskLevel === "crisis" || riskLevel === "high") {
      await (supabase as any).from("clinical_alerts").insert({
        hospital_id: hospitalId,
        alert_type: "mental_health_risk",
        severity: riskLevel === "crisis" ? "critical" : "high",
        alert_message: `${riskLevel.toUpperCase()} mental health risk — Patient consultation completed. Immediate review required.`,
        patient_id: patientId,
      });
    }

    toast.success("Consultation saved");
    if (encounter) onEncounterCreated?.(encounter.id);
    setChiefComplaint(""); setMse({}); setDiagnosis(""); setIcd10Code(""); setTreatmentPlan(""); setNextAppointment("");
    setRiskLevel("low");
    setSaving(false);
    fetchEncounters();
  };

  const loadEncounter = (enc: any) => {
    setSelectedEncounter(enc);
    setChiefComplaint(enc.chief_complaint || "");
    setDiagnosis(enc.diagnosis || "");
    setIcd10Code(enc.icd10_code || "");
    setRiskLevel(enc.risk_level || "low");
    setTreatmentPlan(enc.treatment_plan || "");
    setMse(enc.mental_status_exam || {});
    setNextAppointment(enc.next_appointment || "");
  };

  return (
    <div className="flex gap-3 h-full">
      {/* Left: history */}
      <div className="w-[200px] flex flex-col">
        <div className="border rounded-lg bg-card overflow-hidden flex flex-col flex-1">
          <div className="px-3 py-2 border-b bg-muted/30">
            <p className="text-xs font-semibold">Encounter History</p>
          </div>
          <ScrollArea className="flex-1">
            {encounters.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-6">No previous encounters</p>
            ) : encounters.map(enc => (
              <button
                key={enc.id}
                onClick={() => loadEncounter(enc)}
                className={cn("w-full text-left px-3 py-2 border-b hover:bg-muted/50 transition-colors text-xs",
                  selectedEncounter?.id === enc.id && "bg-muted")}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{new Date(enc.encounter_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
                  {enc.risk_level && (
                    <Badge variant="secondary" className={cn("text-[9px] px-1",
                      enc.risk_level === "crisis" ? "bg-red-100 text-red-700" :
                      enc.risk_level === "high" ? "bg-orange-100 text-orange-700" :
                      enc.risk_level === "moderate" ? "bg-amber-100 text-amber-700" :
                      "bg-emerald-100 text-emerald-700"
                    )}>
                      {enc.risk_level}
                    </Badge>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{enc.diagnosis || enc.chief_complaint}</p>
              </button>
            ))}
          </ScrollArea>
          <div className="p-2 border-t">
            <Button size="sm" variant="outline" className="w-full h-7 text-xs" onClick={() => { setSelectedEncounter(null); setChiefComplaint(""); setMse({}); setDiagnosis(""); setRiskLevel("low"); setTreatmentPlan(""); setNextAppointment(""); }}>
              + New Consultation
            </Button>
          </div>
        </div>
      </div>

      {/* Right: form */}
      <div className="flex-1 border rounded-lg bg-card overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Psychiatric Consultation</h3>
          <span className="text-xs text-muted-foreground">{new Date().toLocaleDateString("en-IN")}</span>
        </div>

        <ScrollArea className="flex-1 px-4 py-3">
          <div className="space-y-4">
            {/* Chief Complaint */}
            <div>
              <Label className="text-xs">Chief Complaint *</Label>
              <Textarea value={chiefComplaint} onChange={e => setChiefComplaint(e.target.value)} rows={2} className="mt-1 text-sm resize-none" placeholder="Patient's presenting complaint..." />
            </div>

            {/* Mental Status Exam */}
            <div>
              <Label className="text-xs font-semibold">Mental Status Examination</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {MSE_FIELDS.map(f => (
                  <div key={f.key}>
                    <Label className="text-[10px] text-muted-foreground">{f.label}</Label>
                    <Input
                      value={mse[f.key] || ""}
                      onChange={e => setMse(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="h-7 text-xs mt-0.5"
                      placeholder={f.label}
                    />
                  </div>
                ))}
              </div>
            </div>

            {/* Diagnosis */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Diagnosis</Label>
                <Input value={diagnosis} onChange={e => setDiagnosis(e.target.value)} className="mt-1 text-sm" placeholder="e.g. Major Depressive Disorder" />
              </div>
              <div>
                <Label className="text-xs">ICD-10 Code</Label>
                <Input value={icd10Code} onChange={e => setIcd10Code(e.target.value)} className="mt-1 text-sm" placeholder="e.g. F32.1" />
              </div>
            </div>

            {/* Risk Level */}
            <div>
              <Label className="text-xs">Risk Level</Label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {RISK_LEVELS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setRiskLevel(r.value)}
                    className={cn("px-3 py-1.5 rounded-full text-xs font-medium border transition-colors",
                      riskLevel === r.value ? r.color + " border-transparent" : "border-border hover:bg-muted")}
                  >
                    {r.value === "crisis" && <AlertTriangle className="h-3 w-3 inline mr-1" />}
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Treatment Plan */}
            <div>
              <Label className="text-xs">Treatment Plan</Label>
              <Textarea value={treatmentPlan} onChange={e => setTreatmentPlan(e.target.value)} rows={3} className="mt-1 text-sm resize-none" placeholder="Medications, therapy, follow-up plan..." />
            </div>

            {/* Next Appointment */}
            <div>
              <Label className="text-xs">Next Appointment</Label>
              <Input type="date" value={nextAppointment} onChange={e => setNextAppointment(e.target.value)} className="mt-1 w-48 text-sm" />
            </div>
          </div>
        </ScrollArea>

        <div className="px-4 py-3 border-t">
          <Button onClick={handleSave} disabled={saving} className="w-full">
            {saving ? "Saving..." : "Save Consultation"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MHConsultationTab;
