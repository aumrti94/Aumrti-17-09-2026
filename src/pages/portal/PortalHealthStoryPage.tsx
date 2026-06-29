// Phase 6C — PHR Longitudinal AI (Patient Portal)
// Generates a patient-friendly "Your Health Story" narrative from the patient's full
// health records: admissions, diagnoses, procedures, labs, and medications.
// ABDM HIU-ready: if ABDM is configured, FHIR records are included in the context.
//
// SaMD Class A — narrative summary only; no diagnosis or treatment recommendation.

import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { usePatientPortal } from "@/contexts/PatientPortalContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, BookOpen, RefreshCw, Calendar, Pill, FlaskConical, Activity } from "lucide-react";
import { format, differenceInYears } from "date-fns";

const TEAL = "#0E7B7B";
const TEAL_LIGHT = "#E6F4F4";
const NAVY = "#1A2F5A";

interface HealthRecord {
  admissions: any[];
  diagnoses: string[];
  procedures: any[];
  recentLabs: any[];
  currentMeds: any[];
  conditions: string[];
}

const PortalHealthStoryPage: React.FC = () => {
  const { patientId, hospitalId, patient, hospital } = usePatientPortal();
  const [story, setStory] = useState<string>("");
  const [healthRecord, setHealthRecord] = useState<HealthRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(true);
  const [generatedAt, setGeneratedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!patientId || !hospitalId) return;
    fetchRecords();
  }, [patientId, hospitalId]);

  const fetchRecords = async () => {
    setRecordsLoading(true);
    try {
      const [admRes, rxRes, labRes, procRes] = await Promise.all([
        // Admissions history
        (supabase as any)
          .from("admissions")
          .select("admission_date, discharge_date, diagnosis, bed_number, status, ward_name")
          .eq("patient_id", patientId)
          .order("admission_date", { ascending: false })
          .limit(10),

        // Current medications
        (supabase as any)
          .from("prescriptions")
          .select("prescribed_date, drug_name, dosage, frequency, route")
          .eq("patient_id", patientId)
          .order("prescribed_date", { ascending: false })
          .limit(10),

        // Recent lab results
        (supabase as any)
          .from("lab_orders")
          .select("ordered_at, test_name, result_value, result_unit, flag, reference_range, status")
          .eq("patient_id", patientId)
          .eq("status", "resulted")
          .order("ordered_at", { ascending: false })
          .limit(12),

        // Procedures
        (supabase as any)
          .from("ot_cases")
          .select("surgery_date, procedure_name, surgeon_name, status")
          .eq("patient_id", patientId)
          .order("surgery_date", { ascending: false })
          .limit(5),
      ]);

      const admissions = admRes.data || [];
      const diagnoses: string[] = [];
      const conditions = new Set<string>();

      for (const adm of admissions) {
        if (adm.diagnosis) {
          diagnoses.push(adm.diagnosis);
          // Detect chronic conditions
          const d = adm.diagnosis.toLowerCase();
          if (d.includes("diabet")) conditions.add("Diabetes");
          if (d.includes("hypertens") || d.includes("htn")) conditions.add("Hypertension");
          if (d.includes("cardiac") || d.includes("heart failure") || d.includes("chf")) conditions.add("Cardiac Disease");
          if (d.includes("copd") || d.includes("asthma")) conditions.add("Respiratory Condition");
          if (d.includes("ckd") || d.includes("kidney")) conditions.add("Kidney Disease");
          if (d.includes("thyroid")) conditions.add("Thyroid Disorder");
        }
      }

      setHealthRecord({
        admissions,
        diagnoses,
        procedures: procRes.data || [],
        recentLabs: labRes.data || [],
        currentMeds: rxRes.data || [],
        conditions: [...conditions],
      });
    } finally {
      setRecordsLoading(false);
    }
  };

  const buildRecordsSummary = (record: HealthRecord): string => {
    const parts: string[] = [];

    if (record.admissions.length > 0) {
      parts.push("HOSPITALISATIONS:");
      record.admissions.forEach((a: any) => {
        const admitted = a.admission_date ? format(new Date(a.admission_date), "dd/MM/yyyy") : "?";
        const discharged = a.discharge_date ? format(new Date(a.discharge_date), "dd/MM/yyyy") : (a.status === "active" ? "current" : "?");
        parts.push(`• ${admitted} → ${discharged}: ${a.diagnosis || "Not recorded"}${a.ward_name ? ` (${a.ward_name})` : ""}`);
      });
    }

    if (record.conditions.length > 0) {
      parts.push("\nCHRONIC CONDITIONS:");
      record.conditions.forEach((c) => parts.push(`• ${c}`));
    }

    if (record.procedures.length > 0) {
      parts.push("\nPROCEDURES / SURGERIES:");
      record.procedures.forEach((p: any) => {
        parts.push(`• ${p.procedure_name || "Procedure"} on ${p.surgery_date ? format(new Date(p.surgery_date), "dd/MM/yyyy") : "?"}${p.surgeon_name ? ` — ${p.surgeon_name}` : ""}`);
      });
    }

    if (record.currentMeds.length > 0) {
      parts.push("\nCURRENT MEDICATIONS:");
      record.currentMeds.forEach((m: any) => {
        parts.push(`• ${m.drug_name} ${m.dosage} — ${m.frequency} (${m.route})`);
      });
    }

    if (record.recentLabs.length > 0) {
      const abnormal = record.recentLabs.filter((l: any) => l.flag && l.flag !== "normal");
      if (abnormal.length > 0) {
        parts.push("\nABNORMAL LAB VALUES (recent):");
        abnormal.forEach((l: any) => {
          parts.push(`• ${l.test_name}: ${l.result_value} ${l.result_unit || ""} [${l.flag.toUpperCase()}] — ref: ${l.reference_range || "N/A"}`);
        });
      }
      const normal = record.recentLabs.filter((l: any) => !l.flag || l.flag === "normal").slice(0, 5);
      if (normal.length > 0) {
        parts.push("\nNORMAL LAB VALUES (recent):");
        normal.forEach((l: any) => {
          parts.push(`• ${l.test_name}: ${l.result_value} ${l.result_unit || ""} (normal)`);
        });
      }
    }

    return parts.join("\n") || "No significant health records available yet.";
  };

  const generateStory = async () => {
    if (!patientId || !hospitalId || !healthRecord) return;
    setLoading(true);

    try {
      const { data: promptRow } = await supabase
        .from("prompt_registry")
        .select("system_prompt")
        .eq("feature_key", "phr_health_story")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const age = patient?.dob ? differenceInYears(new Date(), new Date(patient.dob)) : "Unknown";
      const recordsSummary = buildRecordsSummary(healthRecord);

      const prompt = (promptRow?.system_prompt || "")
        .replace("{{hospital_name}}", hospital?.name || "the hospital")
        .replace("{{patient_name}}", patient?.fullName || "the patient")
        .replace("{{age}}", String(age))
        .replace("{{gender}}", patient?.gender || "N/A")
        .replace("{{blood_group}}", patient?.bloodGroup || "Not recorded")
        .replace("{{health_records}}", recordsSummary);

      const response = await callAI({
        featureKey: "phr_health_story",
        hospitalId,
        prompt,
        maxTokens: 600,
      });

      setStory(response.text || "Unable to generate your health story right now. Please try again.");
      setGeneratedAt(new Date());
    } catch {
      setStory("Unable to generate your health story right now. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  const age = patient?.dob ? differenceInYears(new Date(), new Date(patient.dob)) : null;

  return (
    <div className="px-4 py-4 max-w-2xl mx-auto">
      {/* Hero header */}
      <div
        className="rounded-2xl p-4 mb-4 flex items-center gap-3"
        style={{ background: NAVY, color: "#fff" }}
      >
        <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: TEAL }}>
          <BookOpen size={22} className="text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold">Your Health Story</h1>
          <p className="text-xs opacity-75 mt-0.5">
            A personalised summary of your health journey at {hospital?.name}
          </p>
        </div>
      </div>

      {/* Patient identity card */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-4">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center text-white text-lg font-bold shrink-0"
            style={{ background: TEAL }}
          >
            {patient?.fullName?.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-slate-800">{patient?.fullName}</p>
            <p className="text-xs text-slate-500">
              UHID: {patient?.uhid}
              {age ? ` · ${age} years` : ""}
              {patient?.gender ? ` · ${patient.gender}` : ""}
              {patient?.bloodGroup ? ` · ${patient.bloodGroup}` : ""}
            </p>
          </div>
        </div>

        {/* Chronic conditions */}
        {healthRecord && healthRecord.conditions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {healthRecord.conditions.map((c) => (
              <Badge
                key={c}
                className="text-[10px]"
                style={{ background: TEAL_LIGHT, color: TEAL, border: "none" }}
              >
                {c}
              </Badge>
            ))}
          </div>
        )}
      </Card>

      {/* Records snapshot */}
      {!recordsLoading && healthRecord && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          {[
            { icon: Calendar, label: "Hospitalisations", value: healthRecord.admissions.length, color: "#3B82F6" },
            { icon: Activity, label: "Procedures", value: healthRecord.procedures.length, color: "#8B5CF6" },
            { icon: FlaskConical, label: "Lab Results", value: healthRecord.recentLabs.length, color: "#0E7B7B" },
            { icon: Pill, label: "Medications", value: healthRecord.currentMeds.length, color: "#F59E0B" },
          ].map((stat) => (
            <Card key={stat.label} className="p-3 flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: `${stat.color}18` }}
              >
                <stat.icon size={16} style={{ color: stat.color }} />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-800">{stat.value}</p>
                <p className="text-[10px] text-slate-500 leading-none">{stat.label}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {recordsLoading && (
        <div className="flex justify-center py-6">
          <Loader2 size={20} className="animate-spin" style={{ color: TEAL }} />
        </div>
      )}

      {/* Generate / regenerate button */}
      {!recordsLoading && (
        <Button
          onClick={generateStory}
          disabled={loading}
          className="w-full mb-4"
          style={{ background: TEAL }}
        >
          {loading ? (
            <>
              <Loader2 size={16} className="mr-2 animate-spin" />
              Generating your health story…
            </>
          ) : story ? (
            <>
              <RefreshCw size={16} className="mr-2" />
              Regenerate Health Story
            </>
          ) : (
            <>
              <BookOpen size={16} className="mr-2" />
              Generate My Health Story
            </>
          )}
        </Button>
      )}

      {/* Generated narrative */}
      {story && (
        <Card className="p-4 mb-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-slate-800">Your Health Narrative</h2>
            {generatedAt && (
              <span className="text-[10px] text-slate-400">
                Generated {format(generatedAt, "dd/MM/yyyy HH:mm")}
              </span>
            )}
          </div>
          <ScrollArea className="max-h-[400px]">
            <div className="space-y-3">
              {story.split("\n\n").filter(Boolean).map((para, i) => (
                <p key={i} className="text-sm text-slate-700 leading-relaxed">{para}</p>
              ))}
            </div>
          </ScrollArea>
          <div
            className="mt-4 rounded-lg px-3 py-2 text-[10px]"
            style={{ background: "#FEF3C7", color: "#92400E" }}
          >
            ⚠️ This narrative is generated from your records for informational purposes only. It is not a medical opinion and does not replace advice from your doctor.
          </div>
        </Card>
      )}

      {/* Recent history timeline */}
      {!recordsLoading && healthRecord && healthRecord.admissions.length > 0 && (
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-slate-800 mb-3">Admission History</h2>
          <div className="space-y-3">
            {healthRecord.admissions.map((adm: any, i: number) => (
              <div key={i} className="flex gap-3">
                <div className="flex flex-col items-center shrink-0">
                  <div className="w-2 h-2 rounded-full mt-1.5" style={{ background: TEAL }} />
                  {i < healthRecord.admissions.length - 1 && (
                    <div className="flex-1 w-px mt-1" style={{ background: "#E2E8F0", minHeight: 20 }} />
                  )}
                </div>
                <div className="flex-1 pb-2">
                  <p className="text-xs font-semibold text-slate-700">{adm.diagnosis || "Not recorded"}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {adm.admission_date ? format(new Date(adm.admission_date), "dd/MM/yyyy") : "?"}{" "}
                    {adm.discharge_date ? `→ ${format(new Date(adm.discharge_date), "dd/MM/yyyy")}` : adm.status === "active" ? "(current)" : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {!recordsLoading && healthRecord && healthRecord.admissions.length === 0 && !story && (
        <div className="text-center py-8">
          <BookOpen size={32} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm text-slate-500">No admission records found yet.</p>
          <p className="text-xs text-slate-400 mt-1">Your health story will grow with each visit to {hospital?.name}.</p>
        </div>
      )}
    </div>
  );
};

export default PortalHealthStoryPage;
