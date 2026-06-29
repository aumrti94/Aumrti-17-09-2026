import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { XCircle, Loader2, ShieldAlert, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateForQuery } from "@/pages/ot/OTPage";

interface CancellationRisk {
  case_ref: string;
  surgery_name: string;
  scheduled_time: string;
  cancellation_risk: "high" | "medium" | "low";
  risk_score: number;
  risk_factors: string[];
  recommendation: string;
}

interface Props {
  hospitalId: string | null;
  selectedDate: Date;
}

const RISK_STYLES: Record<string, string> = {
  high: "bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800",
  medium: "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800",
  low: "bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800",
};

const RISK_BADGE: Record<string, string> = {
  high: "border-red-400 text-red-700",
  medium: "border-amber-400 text-amber-700",
  low: "border-emerald-400 text-emerald-700",
};

const OTCancellationPredictor: React.FC<Props> = ({ hospitalId, selectedDate }) => {
  const [loading, setLoading] = useState(false);
  const [risks, setRisks] = useState<CancellationRisk[] | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  const runPredictor = async () => {
    if (!hospitalId) return;
    setLoading(true);
    setRisks(null);
    setRawText(null);

    try {
      const dateStr = formatDateForQuery(selectedDate);
      const tomorrow = new Date(selectedDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = formatDateForQuery(tomorrow);

      const { data: cases } = await (supabase as any)
        .from("ot_schedules")
        .select("id, surgery_name, surgery_category, scheduled_date, scheduled_start_time, estimated_duration_minutes, status, anaesthesia_type, pac_done, pac_cleared, anaesthetist_id, booking_notes, patient:patients(full_name, allergies, chronic_conditions), surgeon:users!ot_schedules_surgeon_id_fkey(full_name)")
        .eq("hospital_id", hospitalId)
        .in("status", ["scheduled", "confirmed"])
        .gte("scheduled_date", dateStr)
        .lte("scheduled_date", tomorrowStr)
        .order("scheduled_date")
        .order("scheduled_start_time");

      if (!cases || cases.length === 0) {
        setRawText("No upcoming scheduled cases found for today and tomorrow.");
        setLoading(false);
        return;
      }

      const caseSummary = (cases as any[]).map((c, i) => {
        const pac = c.pac_cleared === true
          ? "PAC cleared"
          : c.pac_done === true
          ? "PAC done, not yet cleared"
          : "PAC NOT done";
        const anaest = c.anaesthetist_id ? "Anaesthetist assigned" : "No anaesthetist assigned";
        const allergies = ((c.patient?.allergies as string) || "None").slice(0, 60);
        const conditions = ((c.patient?.chronic_conditions as string[]) || []).join(", ").slice(0, 60) || "None";
        return `Case ${i + 1}: ${c.surgery_name} (${c.surgery_category}) | ${c.scheduled_date} ${c.scheduled_start_time} | ${c.estimated_duration_minutes}min | Status: ${c.status} | Anaesthesia: ${c.anaesthesia_type} | ${pac} | ${anaest} | Patient allergies: ${allergies} | Chronic conditions: ${conditions} | Surgeon: ${c.surgeon?.full_name || "Not assigned"}`;
      });

      const prompt = `You are an OT coordinator AI for an Indian hospital. Predict cancellation risk for each upcoming surgery case.

UPCOMING CASES (next 48 hours):
${caseSummary.join("\n")}

Assess cancellation risk per case:
- PAC not done = high risk
- No anaesthetist assigned = high risk
- Status "scheduled" (not "confirmed") = medium risk
- Complex anaesthesia without PAC clearance = high risk
- Known allergies without allergy protocol noted = medium risk

Return ONLY valid JSON array:
[{
  "case_ref": "Case 1",
  "surgery_name": "Appendicectomy",
  "scheduled_time": "08:00",
  "cancellation_risk": "high",
  "risk_score": 80,
  "risk_factors": ["PAC not completed", "No anaesthetist assigned"],
  "recommendation": "Arrange emergency PAC and confirm anaesthetist by tonight"
}]

Return all cases. For safe cases use risk "low" with empty risk_factors.`;

      const response = await callAI({
        featureKey: "ot_cancellation_predictor",
        hospitalId,
        prompt,
        maxTokens: 800,
      });

      if (response.error || !response.text) {
        setRawText("AI service unavailable. Check Settings → API Hub.");
        setLoading(false);
        return;
      }

      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        setRisks(Array.isArray(parsed) ? parsed : []);
      } catch {
        setRawText(response.text);
      }
    } catch (err: any) {
      setRawText(`Prediction failed: ${err.message}`);
    }
    setLoading(false);
  };

  const highCount = risks?.filter(r => r.cancellation_risk === "high").length ?? 0;

  return (
    <div className="border-t border-border bg-background">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <XCircle className="h-3.5 w-3.5 text-destructive" />
          OT Cancellation Risk
          {highCount > 0 && (
            <span className="ml-1 text-[10px] bg-red-100 text-red-700 rounded-full px-1.5 py-0.5 font-bold">
              {highCount} high
            </span>
          )}
        </span>
        {collapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
      </button>

      {!collapsed && (
        <div className="px-3 pb-3 space-y-2">
          {risks === null && !rawText && (
            <Button
              size="sm"
              variant="outline"
              className="w-full text-xs h-7"
              onClick={runPredictor}
              disabled={loading || !hospitalId}
            >
              {loading ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1.5" /> Predicting risks...</>
              ) : (
                <><ShieldAlert className="h-3 w-3 mr-1.5 text-destructive" /> Predict Cancellation Risks</>
              )}
            </Button>
          )}

          {risks !== null && (
            <div className="space-y-1.5">
              {risks.length === 0 && (
                <div className="flex items-center gap-1.5 text-xs text-emerald-700 py-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> All upcoming cases look low-risk
                </div>
              )}
              {risks.map((r, i) => (
                <div key={i} className={cn("rounded border p-2 text-xs space-y-1", RISK_STYLES[r.cancellation_risk] ?? RISK_STYLES.low)}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold truncate">{r.surgery_name}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 shrink-0", RISK_BADGE[r.cancellation_risk] ?? RISK_BADGE.low)}>
                      {r.cancellation_risk.toUpperCase()} {r.risk_score}%
                    </Badge>
                  </div>
                  {r.risk_factors.length > 0 && (
                    <ul className="space-y-0.5">
                      {r.risk_factors.map((f, j) => (
                        <li key={j} className="text-[10px] opacity-80">• {f}</li>
                      ))}
                    </ul>
                  )}
                  <p className="text-[10px] font-medium opacity-90">→ {r.recommendation}</p>
                </div>
              ))}
              <Button
                size="sm"
                variant="ghost"
                className="w-full text-xs h-6"
                onClick={() => { setRisks(null); setRawText(null); runPredictor(); }}
                disabled={loading}
              >
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Re-predict"}
              </Button>
            </div>
          )}

          {rawText && (
            <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap rounded border p-2 max-h-40 overflow-auto">
              {rawText}
            </pre>
          )}
        </div>
      )}
    </div>
  );
};

export default OTCancellationPredictor;
