import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface RiskData {
  level: "low" | "medium" | "high";
  score: number;
  factors: string[];
  recommendations: string[];
  assessed_at: string;
}

interface Props {
  admissionId: string;
  patientId: string | undefined;
  hospitalId: string | null;
}

const RISK_CONFIG = {
  low:    { label: "Low Risk",    color: "bg-emerald-100 text-emerald-700 border-emerald-200", bar: "bg-emerald-500", icon: CheckCircle2 },
  medium: { label: "Medium Risk", color: "bg-amber-100 text-amber-700 border-amber-200",   bar: "bg-amber-500",   icon: AlertTriangle },
  high:   { label: "High Risk",   color: "bg-red-100 text-red-700 border-red-200",         bar: "bg-red-500",     icon: ShieldAlert },
};

const ReadmissionRiskPanel: React.FC<Props> = ({ admissionId, patientId, hospitalId }) => {
  const { toast } = useToast();
  const [risk, setRisk] = useState<RiskData | null>(null);
  const [loading, setLoading] = useState(true);
  const [assessing, setAssessing] = useState(false);

  const load = useCallback(async () => {
    if (!admissionId) { setLoading(false); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from("admissions")
      .select("readmission_risk_level, readmission_risk_score, readmission_risk_factors, readmission_risk_assessed_at")
      .eq("id", admissionId)
      .maybeSingle();

    if (data?.readmission_risk_level) {
      setRisk({
        level: data.readmission_risk_level,
        score: data.readmission_risk_score || 0,
        factors: Array.isArray(data.readmission_risk_factors) ? data.readmission_risk_factors : [],
        recommendations: [],
        assessed_at: data.readmission_risk_assessed_at,
      });
    }
    setLoading(false);
  }, [admissionId]);

  useEffect(() => { load(); }, [load]);

  const assess = async () => {
    if (!hospitalId || !admissionId || !patientId) return;
    setAssessing(true);

    try {
      const [admRes, vitalsRes, medsRes, prevAdmRes] = await Promise.all([
        (supabase as any).from("admissions")
          .select("admitting_diagnosis, admission_type, admitted_at, insurance_type, must_score, must_risk_level")
          .eq("id", admissionId).maybeSingle(),
        (supabase as any).from("nursing_vitals")
          .select("systolic_bp, diastolic_bp, heart_rate, spo2, temperature, news2_score")
          .eq("admission_id", admissionId)
          .order("recorded_at", { ascending: false }).limit(5),
        (supabase as any).from("ipd_medications")
          .select("drug_name, is_high_alert").eq("admission_id", admissionId).eq("is_active", true).limit(20),
        (supabase as any).from("admissions")
          .select("id, admitted_at, discharged_at, admitting_diagnosis")
          .eq("patient_id", patientId)
          .eq("status", "discharged")
          .neq("id", admissionId)
          .order("admitted_at", { ascending: false }).limit(3),
      ]);

      const adm = admRes.data;
      const vitals = vitalsRes.data || [];
      const meds = medsRes.data || [];
      const prevAdm = prevAdmRes.data || [];

      const latestVitals = vitals[0] || {};
      const highAlertMeds = meds.filter((m: any) => m.is_high_alert).length;
      const priorAdmissions = prevAdm.length;
      const los = adm?.admitted_at
        ? Math.round((Date.now() - new Date(adm.admitted_at).getTime()) / 86400000)
        : null;

      const prompt = `You are a clinical AI assessing 30-day hospital readmission risk for a patient.

PATIENT CLINICAL DATA:
- Current diagnosis: ${adm?.admitting_diagnosis || "Not specified"}
- Admission type: ${adm?.admission_type || "Not specified"}
- Current LOS: ${los ? `${los} days` : "Unknown"}
- Insurance/payer: ${adm?.insurance_type || "Unknown"}
- MUST nutritional score: ${adm?.must_score ?? "Not assessed"}
- Prior admissions (last 3): ${priorAdmissions} admission(s)
${priorAdmissions > 0 ? `- Last admission diagnosis: ${prevAdm[0]?.admitting_diagnosis || "Unknown"}` : ""}
- Latest NEWS2 score: ${latestVitals.news2_score ?? "Not recorded"}
- Latest vitals: BP ${latestVitals.systolic_bp ?? "?"}/${latestVitals.diastolic_bp ?? "?"}, HR ${latestVitals.heart_rate ?? "?"}, SpO2 ${latestVitals.spo2 ?? "?"}%, Temp ${latestVitals.temperature ?? "?"}
- Active medications: ${meds.length} drugs (${highAlertMeds} high-alert)

Assess 30-day readmission risk. Respond ONLY with valid JSON:
{
  "level": "low" | "medium" | "high",
  "score": 0-100,
  "factors": ["up to 5 specific risk factors found in the data"],
  "recommendations": ["up to 4 specific discharge planning actions to reduce readmission risk"]
}

Be specific to the data. "low" = score <35, "medium" = 35-65, "high" = >65.`;

      const response = await callAI({
        featureKey: "readmission_predictor",
        hospitalId,
        prompt,
        maxTokens: 600,
      });

      if (response.error || !response.text) throw new Error(response.error || "No AI response");

      const match = response.text.match(/\{[\s\S]*?\}/);
      if (!match) throw new Error("Invalid AI response format");
      const parsed = JSON.parse(match[0]);

      const level = ["low", "medium", "high"].includes(parsed.level) ? parsed.level : "medium";
      const score = Math.min(100, Math.max(0, parseInt(parsed.score) || 50));
      const factors = Array.isArray(parsed.factors) ? parsed.factors.slice(0, 5) : [];
      const recommendations = Array.isArray(parsed.recommendations) ? parsed.recommendations.slice(0, 4) : [];

      await (supabase as any).from("admissions").update({
        readmission_risk_level: level,
        readmission_risk_score: score,
        readmission_risk_factors: factors,
        readmission_risk_assessed_at: new Date().toISOString(),
      }).eq("id", admissionId);

      setRisk({ level, score, factors, recommendations, assessed_at: new Date().toISOString() });
      toast({ title: `Readmission risk assessed: ${level.toUpperCase()}` });
    } catch (err: any) {
      toast({ title: "Assessment failed", description: err.message, variant: "destructive" });
    }
    setAssessing(false);
  };

  if (loading) {
    return <div className="flex items-center gap-2 text-muted-foreground p-4 text-sm"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading risk data…</div>;
  }

  const cfg = risk ? RISK_CONFIG[risk.level] : null;
  const Icon = cfg?.icon || TrendingUp;

  return (
    <div className="border border-border rounded-xl bg-card p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-semibold">30-Day Readmission Risk</span>
          <Badge variant="outline" className="text-[10px]">E1 — NABH Excellence</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={assess} disabled={assessing}
          className="h-7 text-xs gap-1.5">
          {assessing
            ? <Loader2 className="h-3 w-3 animate-spin" />
            : <RefreshCw className="h-3 w-3" />}
          {risk ? "Re-assess" : "Assess Risk (AI)"}
        </Button>
      </div>

      {!risk && !assessing && (
        <div className="text-center py-6 space-y-2">
          <TrendingUp className="h-8 w-8 text-muted-foreground/30 mx-auto" />
          <p className="text-xs text-muted-foreground">No readmission risk assessment yet.</p>
          <p className="text-[11px] text-muted-foreground">Run AI assessment before discharge planning to identify high-risk patients.</p>
        </div>
      )}

      {assessing && (
        <div className="text-center py-6 flex items-center justify-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Analysing clinical data…</span>
        </div>
      )}

      {risk && !assessing && cfg && (
        <div className="space-y-3">
          {/* Risk badge + score bar */}
          <div className="flex items-center gap-3">
            <Badge className={cn("text-sm px-3 py-1 gap-1.5 font-bold", cfg.color)}>
              <Icon className="h-4 w-4" />
              {cfg.label}
            </Badge>
            <div className="flex-1 space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="text-muted-foreground">Risk score</span>
                <span className="font-bold">{risk.score}/100</span>
              </div>
              <div className="h-2 bg-muted rounded-full overflow-hidden">
                <div className={cn("h-full rounded-full transition-all", cfg.bar)}
                  style={{ width: `${risk.score}%` }} />
              </div>
            </div>
          </div>

          {/* Risk factors */}
          {risk.factors.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-foreground mb-1.5">Risk Factors Identified</p>
              <ul className="space-y-1">
                {risk.factors.map((f, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                    <span className="mt-0.5 text-amber-500 shrink-0">•</span>{f}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Recommendations */}
          {risk.recommendations.length > 0 && (
            <div className="border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-950/20 rounded-lg p-3">
              <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300 mb-1.5">Discharge Planning Recommendations</p>
              <ul className="space-y-1">
                {risk.recommendations.map((r, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-emerald-700 dark:text-emerald-400">
                    <CheckCircle2 className="h-3 w-3 mt-0.5 shrink-0" />{r}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground">
            Assessed {format(new Date(risk.assessed_at), "dd MMM yyyy, HH:mm")} · AI-generated, requires clinician review
          </p>
        </div>
      )}
    </div>
  );
};

export default ReadmissionRiskPanel;
