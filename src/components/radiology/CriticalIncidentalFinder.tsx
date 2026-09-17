import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Bot, Loader2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAIFeature } from "@/hooks/useAIFeature";

interface Incidental {
  finding: string;
  anatomical_region: string;
  clinical_significance: "critical" | "significant" | "monitor";
  recommended_action: string;
}

interface Props {
  findings: string;
  impression: string;
  hospitalId: string;
  orderId: string;
  patientId: string;
  patientName: string;
  studyName: string;
}

const SEV_STYLE: Record<string, string> = {
  critical: "bg-red-50 border-red-200 text-red-900",
  significant: "bg-amber-50 border-amber-200 text-amber-900",
  monitor: "bg-blue-50 border-blue-200 text-blue-900",
};

const SEV_BADGE: Record<string, string> = {
  critical: "border-red-400 text-red-700",
  significant: "border-amber-400 text-amber-700",
  monitor: "border-blue-400 text-blue-700",
};

const CriticalIncidentalFinder: React.FC<Props> = ({
  findings, impression, hospitalId, orderId, patientId, patientName, studyName,
}) => {
  const __aiOn = useAIFeature("critical_incidental_finder");
  const [loading, setLoading] = useState(false);
  const [incidentals, setIncidentals] = useState<Incidental[] | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const alertFiredRef = useRef(false);

  useEffect(() => {
    // Auto-run once when component mounts (report just signed)
    runFinder();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const runFinder = async () => {
    setLoading(true);
    setIncidentals(null);
    setRawText(null);
    alertFiredRef.current = false;

    try {
      const response = await callAI({
        featureKey: "critical_incidental_finder",
        hospitalId,
        prompt: `You are a radiology quality AI for an Indian hospital. Scan this radiology report for INCIDENTAL findings — i.e., findings not directly related to the primary study indication that may have clinical significance.

Study: ${studyName}
Patient: ${patientName}

FINDINGS:
${findings}

IMPRESSION:
${impression}

Identify any incidental findings that warrant clinical attention. Do NOT flag findings that are clearly the primary study indication.

Return ONLY valid JSON array (empty [] if none found):
[{
  "finding": "Brief description of the incidental finding",
  "anatomical_region": "e.g. Right upper lobe, L4 vertebra",
  "clinical_significance": "critical|significant|monitor",
  "recommended_action": "Specific follow-up recommendation (1 sentence)"
}]

clinical_significance levels:
- critical: Requires immediate clinical action (e.g. pulmonary embolism, incidental mass)
- significant: Requires follow-up within days-weeks (e.g. lymphadenopathy, lytic lesion)
- monitor: Benign but document for follow-up (e.g. small cyst, degenerative changes)`,
        maxTokens: 600,
      });

      if (response.error || !response.text) {
        setRawText("AI service unavailable.");
        setLoading(false);
        return;
      }

      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed: Incidental[] = JSON.parse(clean);
        const filtered = Array.isArray(parsed) ? parsed : [];
        setIncidentals(filtered);

        // Fire clinical_alerts for critical/significant incidentals
        if (filtered.length > 0 && !alertFiredRef.current) {
          alertFiredRef.current = true;
          const critical = filtered.filter(f => f.clinical_significance === "critical");
          const significant = filtered.filter(f => f.clinical_significance === "significant");

          // Deduped per (order, finding) — "Re-scan" resets alertFiredRef and re-runs the AI
          // scan against the same report, which would otherwise re-raise every finding it
          // finds again (KNOWN-BUG-002). Keyed on the finding text, not just orderId, since a
          // single order can legitimately raise several distinct incidental findings.
          const alerts = [
            ...critical.map(f => ({
              hospital_id: hospitalId,
              alert_type: "critical_incidental",
              severity: "critical",
              alert_message: `Critical incidental: ${f.finding} (${f.anatomical_region}) on ${studyName} — Patient: ${patientName}. Action: ${f.recommended_action}`,
              patient_id: patientId,
              radiology_order_id: orderId,
              dedupe_key: `${orderId}:${f.finding}`,
            })),
            ...significant.map(f => ({
              hospital_id: hospitalId,
              alert_type: "critical_incidental",
              severity: "high",
              alert_message: `Incidental finding: ${f.finding} (${f.anatomical_region}) on ${studyName} — Patient: ${patientName}. Action: ${f.recommended_action}`,
              patient_id: patientId,
              radiology_order_id: orderId,
              dedupe_key: `${orderId}:${f.finding}`,
            })),
          ];

          if (alerts.length > 0) {
            supabase.from("clinical_alerts").upsert(alerts as any, {
              onConflict: "hospital_id,alert_type,dedupe_key", ignoreDuplicates: true,
            }).then(() => {}, () => {});
          }
        }
      } catch {
        setRawText(response.text);
      }
    } catch (err: any) {
      setRawText(`Scan failed: ${err.message}`);
    }
    setLoading(false);
  };

  const criticalCount = incidentals?.filter(f => f.clinical_significance === "critical").length ?? 0;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground py-2">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        AI scanning for critical incidentals…
      </div>
    );
  }

  if (!__aiOn) return null; // AI master or critical-incidental feature disabled

  return (
    <div className="space-y-2 mt-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5" /> Critical Incidental Finder
          <Badge variant="outline" className="text-[9px] px-1.5">SaMD Class B</Badge>
        </p>
        {incidentals !== null && (
          <Button size="sm" variant="ghost" className="h-5 text-[10px] px-1.5" onClick={runFinder}>
            Re-scan
          </Button>
        )}
      </div>

      {incidentals !== null && incidentals.length === 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-emerald-700">
          <CheckCircle2 className="h-3.5 w-3.5" /> No critical incidentals found
        </div>
      )}

      {criticalCount > 0 && (
        <div className="flex items-center gap-1.5 text-[11px] text-red-700 font-semibold">
          <AlertTriangle className="h-3.5 w-3.5" />
          {criticalCount} critical incidental(s) flagged — clinical alert sent
        </div>
      )}

      {incidentals?.map((f, i) => (
        <div key={i} className={cn("rounded border px-3 py-2 text-xs space-y-0.5", SEV_STYLE[f.clinical_significance])}>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-[9px] px-1.5", SEV_BADGE[f.clinical_significance])}>
              {f.clinical_significance.toUpperCase()}
            </Badge>
            <span className="font-semibold text-[11px]">{f.anatomical_region}</span>
          </div>
          <p>{f.finding}</p>
          <p className="font-medium opacity-90">→ {f.recommended_action}</p>
        </div>
      ))}

      {rawText && (
        <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap rounded border p-2 max-h-24 overflow-auto">
          {rawText}
        </pre>
      )}

      {incidentals !== null && (
        <p className="text-[10px] text-muted-foreground">
          AI incidental detection only. Radiologist review and clinical correlation required before follow-up.
        </p>
      )}
    </div>
  );
};

export default CriticalIncidentalFinder;
