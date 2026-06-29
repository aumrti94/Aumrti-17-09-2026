import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Loader2, AlertTriangle, FlaskConical } from "lucide-react";

interface ADRFlag {
  drug: string;
  suspected_adr: string;
  severity: "mild" | "moderate" | "severe";
  evidence: string;
  action: string;
}

interface Props {
  admissionId: string;
  hospitalId: string | null;
}

const SEVERITY_STYLE: Record<string, string> = {
  mild: "bg-amber-50 border-amber-200 text-amber-900",
  moderate: "bg-orange-50 border-orange-200 text-orange-900",
  severe: "bg-red-50 border-red-200 text-red-900",
};

const SEVERITY_BADGE: Record<string, string> = {
  mild: "border-amber-400 text-amber-700",
  moderate: "border-orange-400 text-orange-700",
  severe: "border-red-400 text-red-700",
};

const ADRDetectorPanel: React.FC<Props> = ({ admissionId, hospitalId }) => {
  const [loading, setLoading] = useState(false);
  const [flags, setFlags] = useState<ADRFlag[] | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);

  const scan = async () => {
    if (!hospitalId) return;
    setLoading(true);
    setFlags(null);
    setRawText(null);

    try {
      const [{ data: meds }, { data: vitals }] = await Promise.all([
        supabase
          .from("ipd_medications")
          .select("drug_name, dose, route, frequency, notes")
          .eq("admission_id", admissionId)
          .eq("is_active", true),
        supabase
          .from("ipd_vitals")
          .select("bp_systolic, bp_diastolic, pulse, temperature, spo2, rr, news2_score, recorded_at")
          .eq("admission_id", admissionId)
          .order("recorded_at", { ascending: false })
          .limit(1),
      ]);

      if (!meds || meds.length === 0) {
        setRawText("No active medications found for this admission.");
        setLoading(false);
        return;
      }

      const vitalsLine = vitals?.[0]
        ? `BP: ${vitals[0].bp_systolic}/${vitals[0].bp_diastolic} | Pulse: ${vitals[0].pulse} bpm | Temp: ${vitals[0].temperature}°F | SpO2: ${vitals[0].spo2}% | RR: ${vitals[0].rr} | NEWS2: ${vitals[0].news2_score}`
        : "Not available";

      const prompt = `Analyze the following active medications and recent vitals for an inpatient in an Indian hospital. Identify potential adverse drug reactions (ADRs), drug-drug interactions, or drug-disease interactions.

ACTIVE MEDICATIONS:
${meds.map((m, i) => `${i + 1}. ${m.drug_name}${m.dose ? " " + m.dose : ""}${m.route ? " " + m.route : ""}${m.frequency ? " " + m.frequency : ""}${m.notes ? " (Notes: " + m.notes + ")" : ""}`).join("\n")}

RECENT VITALS: ${vitalsLine}

Return a JSON array. Each element: { "drug": string, "suspected_adr": string, "severity": "mild"|"moderate"|"severe", "evidence": string, "action": string }.
If no ADRs detected, return []. Respond ONLY with valid JSON — no markdown, no text outside the JSON array.`;

      const result = await callAI({
        featureKey: "adr_detector",
        hospitalId,
        prompt,
        maxTokens: 900,
      });

      try {
        const clean = result.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        setFlags(Array.isArray(parsed) ? parsed : []);
      } catch {
        setRawText(result);
      }
    } catch (err: any) {
      setRawText(`Scan failed: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="border border-border rounded-xl p-4 bg-card mt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <FlaskConical className="h-4 w-4 text-orange-500" />
          <div>
            <p className="text-[13px] font-bold">ADR Detector</p>
            <p className="text-[11px] text-muted-foreground">AI adverse drug reaction screening</p>
          </div>
          <Badge variant="outline" className="text-[9px] text-rose-600 border-rose-300 ml-1">
            SaMD Class C
          </Badge>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={scan} disabled={loading}>
          {loading
            ? <><Loader2 className="h-3 w-3 animate-spin mr-1" />Scanning...</>
            : <><Bot className="h-3 w-3 mr-1" />Scan ADRs</>}
        </Button>
      </div>

      {flags !== null && flags.length === 0 && (
        <p className="text-[12px] text-emerald-700 flex items-center gap-1.5 mt-1">
          <span className="text-emerald-500">✓</span> No significant ADR signals detected.
        </p>
      )}

      {flags !== null && flags.length > 0 && (
        <div className="space-y-2 mt-2">
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3 text-amber-500" />
            {flags.length} ADR signal{flags.length > 1 ? "s" : ""} detected — physician review required
          </p>
          {flags.map((f, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 ${SEVERITY_STYLE[f.severity] ?? SEVERITY_STYLE.mild}`}
            >
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-[12px] font-bold">{f.drug}</span>
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1.5 ${SEVERITY_BADGE[f.severity] ?? SEVERITY_BADGE.mild}`}
                >
                  {f.severity.toUpperCase()}
                </Badge>
              </div>
              <p className="text-[12px] font-semibold">{f.suspected_adr}</p>
              <p className="text-[11px] opacity-80 mt-0.5">{f.evidence}</p>
              <p className="text-[11px] font-medium mt-1">→ {f.action}</p>
            </div>
          ))}
          <p className="text-[10px] text-muted-foreground italic">
            AI screening only. Requires pharmacist and physician validation before clinical action.
          </p>
        </div>
      )}

      {rawText && (
        <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap mt-2 max-h-40 overflow-auto leading-relaxed">
          {rawText}
        </pre>
      )}
    </div>
  );
};

export default ADRDetectorPanel;
