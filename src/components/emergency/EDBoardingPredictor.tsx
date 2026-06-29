import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BedDouble, Loader2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EDVisit } from "@/pages/emergency/EmergencyPage";

interface BoardingRisk {
  patient_ref: string;
  patient_name: string;
  triage_category: string;
  time_in_ed_min: number;
  boarding_risk: "high" | "medium" | "low";
  predicted_disposition: "admit_icu" | "admit_ward" | "discharge" | "observation";
  estimated_wait_hours: number | null;
  risk_factors: string[];
  recommended_action: string;
}

interface Props {
  visits: EDVisit[];
  hospitalId: string | null;
}

const RISK_STYLES: Record<string, string> = {
  high: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800",
  medium: "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800",
  low: "bg-blue-50 border-blue-200 dark:bg-blue-950/20 dark:border-blue-800",
};

const RISK_TEXT: Record<string, string> = {
  high: "text-red-800 dark:text-red-300",
  medium: "text-amber-800 dark:text-amber-300",
  low: "text-blue-800 dark:text-blue-300",
};

const DISP_LABEL: Record<string, string> = {
  admit_icu: "ICU Admit",
  admit_ward: "Ward Admit",
  discharge: "Discharge",
  observation: "Observation",
};

const EDBoardingPredictor: React.FC<Props> = ({ visits, hospitalId }) => {
  const [loading, setLoading] = useState(false);
  const [predictions, setPredictions] = useState<BoardingRisk[] | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);

  const activeVisits = visits.filter(
    v => v.is_active && v.disposition !== "discharged" && v.disposition !== "admitted"
  );

  const runPredictor = async () => {
    if (!hospitalId || activeVisits.length === 0) return;
    setLoading(true);
    setPredictions(null);
    setRawText(null);

    try {
      // Check available ward and ICU beds
      const { data: beds } = await (supabase as any)
        .from("beds")
        .select("bed_type, status")
        .eq("hospital_id", hospitalId)
        .eq("status", "available");

      const wardBeds = (beds || []).filter((b: any) => b.bed_type !== "icu").length;
      const icuBeds = (beds || []).filter((b: any) => b.bed_type === "icu").length;

      const visitSummary = activeVisits.map((v, i) => {
        const vitals = v.vitals_snapshot || {};
        const vitalStr = [
          vitals.bp ? `BP ${vitals.bp}` : null,
          vitals.pulse ? `Pulse ${vitals.pulse}` : null,
          vitals.spo2 ? `SpO2 ${vitals.spo2}%` : null,
          vitals.temp ? `Temp ${vitals.temp}°F` : null,
          v.gcs_score ? `GCS ${v.gcs_score}` : null,
        ].filter(Boolean).join(", ");

        return `Patient ${i + 1}: ${v.patient_name} | Triage: ${v.triage_category} | In ED: ${v.minutes_ago} min | Complaint: ${v.chief_complaint || "unknown"} | Working Dx: ${v.working_diagnosis || "pending"} | Vitals: ${vitalStr || "not recorded"} | Current disposition: ${v.disposition}`;
      });

      const prompt = `You are an Emergency Department (ED) AI for an Indian hospital. Predict boarding risk for each active ED patient — i.e., which patients are likely to need inpatient admission but face a wait due to bed shortage.

CURRENT BED AVAILABILITY:
Ward beds available: ${wardBeds}
ICU beds available: ${icuBeds}

ACTIVE ED PATIENTS (not yet admitted/discharged):
${visitSummary.join("\n")}

For each patient, predict:
- boarding_risk: high (likely needs admit, beds scarce), medium (may need admit), low (likely discharge)
- predicted_disposition: "admit_icu" | "admit_ward" | "discharge" | "observation"
- estimated_wait_hours: hours until bed or discharge (null if unknown)
- risk_factors: specific clinical or logistical reasons (1-3 items)
- recommended_action: what the ED team should do RIGHT NOW

Return ONLY valid JSON array:
[{
  "patient_ref": "Patient 1",
  "patient_name": "...",
  "triage_category": "red",
  "time_in_ed_min": 120,
  "boarding_risk": "high",
  "predicted_disposition": "admit_icu",
  "estimated_wait_hours": 3,
  "risk_factors": ["ICU beds at 0", "GCS declining", "SpO2 <92%"],
  "recommended_action": "Escalate to senior — initiate ICU transfer protocol now"
}]`;

      const response = await callAI({
        featureKey: "ed_boarding_predictor",
        hospitalId,
        prompt,
        maxTokens: 1000,
      });

      if (response.error || !response.text) {
        setRawText("AI service unavailable. Check Settings → API Hub.");
        setLoading(false);
        return;
      }

      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        setPredictions(Array.isArray(parsed) ? parsed : []);
      } catch {
        setRawText(response.text);
      }
    } catch (err: any) {
      setRawText(`Prediction failed: ${err.message}`);
    }
    setLoading(false);
  };

  if (activeVisits.length === 0) return null;

  const highCount = predictions?.filter(p => p.boarding_risk === "high").length ?? 0;

  return (
    <div className="flex-shrink-0 border-b border-white/10 bg-slate-800 px-3 py-2">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BedDouble className="h-3.5 w-3.5 text-amber-400" />
          <span className="text-xs font-semibold text-white">ED Boarding Predictor</span>
          <Badge variant="outline" className="text-[10px] border-slate-600 text-slate-300">
            {activeVisits.length} active
          </Badge>
          {highCount > 0 && (
            <Badge className="bg-red-900/60 text-red-300 border-red-700 text-[10px]">
              <AlertTriangle className="h-3 w-3 mr-1" />{highCount} high-risk boarders
            </Badge>
          )}
        </div>
        {predictions === null && (
          <Button
            size="sm"
            variant="outline"
            className="h-6 text-[11px] border-slate-600 text-slate-300 hover:text-white hover:border-white/50 bg-transparent"
            onClick={runPredictor}
            disabled={loading}
          >
            {loading
              ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Predicting...</>
              : <><BedDouble className="h-3 w-3 mr-1" /> Predict Boarding</>}
          </Button>
        )}
        {predictions !== null && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 text-[11px] text-slate-400 hover:text-white"
            onClick={() => { setPredictions(null); setRawText(null); runPredictor(); }}
            disabled={loading}
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
          </Button>
        )}
      </div>

      {predictions !== null && predictions.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
          {predictions.map((p, i) => (
            <div
              key={i}
              className={cn(
                "rounded border p-2 text-xs min-w-[200px] max-w-[240px] shrink-0",
                RISK_STYLES[p.boarding_risk] ?? RISK_STYLES.low
              )}
            >
              <div className="flex items-center justify-between gap-1 mb-1">
                <span className={cn("font-semibold text-[11px] truncate", RISK_TEXT[p.boarding_risk])}>
                  {p.patient_name}
                </span>
                <Badge
                  variant="outline"
                  className={cn("text-[9px] px-1 py-0 shrink-0", p.boarding_risk === "high" ? "border-red-400 text-red-700" : p.boarding_risk === "medium" ? "border-amber-400 text-amber-700" : "border-blue-400 text-blue-700")}
                >
                  {p.boarding_risk.toUpperCase()}
                </Badge>
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-1">
                <span>Triage: <strong className="text-foreground">{p.triage_category}</strong></span>
                <span>{p.time_in_ed_min}min in ED</span>
              </div>
              <div className="text-[10px] font-medium text-foreground mb-1">
                → {DISP_LABEL[p.predicted_disposition] ?? p.predicted_disposition}
                {p.estimated_wait_hours != null && (
                  <span className="text-muted-foreground ml-1">~{p.estimated_wait_hours}h wait</span>
                )}
              </div>
              {p.risk_factors.length > 0 && (
                <ul className="space-y-0.5 mb-1">
                  {p.risk_factors.slice(0, 2).map((f, j) => (
                    <li key={j} className="text-[10px] text-muted-foreground">• {f}</li>
                  ))}
                </ul>
              )}
              <p className="text-[10px] font-semibold text-foreground leading-tight">
                {p.recommended_action}
              </p>
            </div>
          ))}
        </div>
      )}

      {predictions !== null && predictions.length === 0 && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-400 py-1">
          <CheckCircle2 className="h-3.5 w-3.5" /> No high-risk boarders predicted — patient flow looks clear
        </div>
      )}

      {rawText && (
        <pre className="text-[10px] text-slate-400 whitespace-pre-wrap rounded border border-slate-600 p-2 mt-1 max-h-20 overflow-auto">
          {rawText}
        </pre>
      )}
    </div>
  );
};

export default EDBoardingPredictor;
