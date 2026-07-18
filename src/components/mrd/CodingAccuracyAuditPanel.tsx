import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { useAIFeature } from "@/hooks/useAIFeature";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bot, Loader2, AlertTriangle, TrendingUp, TrendingDown, CheckCircle2 } from "lucide-react";

interface AuditFlag {
  episode_ref: string;
  issue_type: "undercoded" | "overcoded" | "missing_procedure" | "incorrect_primary";
  current_code: string;
  suggested_code?: string;
  description: string;
  revenue_impact: "high" | "medium" | "low" | "none";
  estimated_impact_inr?: number;
  recommendation: string;
}

interface Props {
  hospitalId: string;
}

const ISSUE_STYLE: Record<string, string> = {
  undercoded: "bg-red-50 border-red-200 text-red-900",
  missing_procedure: "bg-orange-50 border-orange-200 text-orange-900",
  overcoded: "bg-amber-50 border-amber-200 text-amber-900",
  incorrect_primary: "bg-yellow-50 border-yellow-200 text-yellow-900",
};

const ISSUE_BADGE: Record<string, string> = {
  undercoded: "border-red-400 text-red-700",
  missing_procedure: "border-orange-400 text-orange-700",
  overcoded: "border-amber-400 text-amber-700",
  incorrect_primary: "border-yellow-400 text-yellow-700",
};

const IMPACT_ICON: Record<string, React.ReactNode> = {
  high: <TrendingUp className="h-3.5 w-3.5 text-red-500" />,
  medium: <TrendingUp className="h-3.5 w-3.5 text-amber-500" />,
  low: <TrendingDown className="h-3.5 w-3.5 text-muted-foreground" />,
  none: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />,
};

const inr = (n?: number) =>
  n != null ? `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}` : "";

const CodingAccuracyAuditPanel: React.FC<Props> = ({ hospitalId }) => {
  const __aiOn = useAIFeature("coding_accuracy_auditor");
  const [loading, setLoading] = useState(false);
  const [flags, setFlags] = useState<AuditFlag[] | null>(null);
  const [rawText, setRawText] = useState<string | null>(null);
  const [episodesScanned, setEpisodesScanned] = useState(0);

  const runAudit = async () => {
    if (!hospitalId) return;
    setLoading(true);
    setFlags(null);
    setRawText(null);

    try {
      // Fetch up to 20 recently coded/validated episodes
      const { data: episodes } = await (supabase as any)
        .from("icd_codings")
        .select("id, visit_type, visit_id, primary_icd_code, primary_icd_desc, pcs_code, ai_suggestion, ai_confidence, status, created_at")
        .eq("hospital_id", hospitalId)
        .in("status", ["coded", "validated", "mrd_locked"])
        .order("created_at", { ascending: false })
        .limit(20);

      if (!episodes || episodes.length === 0) {
        setRawText("No coded or validated episodes found. ICD coding must be completed first.");
        setLoading(false);
        return;
      }

      setEpisodesScanned(episodes.length);

      // Enrich each episode with discharge diagnosis if available
      const enriched = await Promise.all(
        episodes.slice(0, 15).map(async (ep: any) => {
          let diagnosisText = "";
          if (ep.visit_type === "ipd" && ep.visit_id) {
            const { data: adm } = await (supabase as any)
              .from("admissions")
              .select("admitting_diagnosis, final_diagnosis")
              .eq("id", ep.visit_id)
              .maybeSingle();
            diagnosisText = adm?.final_diagnosis || adm?.admitting_diagnosis || "";
          } else if (ep.visit_type === "opd" && ep.visit_id) {
            const { data: enc } = await (supabase as any)
              .from("opd_encounters")
              .select("chief_complaint, provisional_diagnosis")
              .eq("id", ep.visit_id)
              .maybeSingle();
            diagnosisText = enc?.provisional_diagnosis || enc?.chief_complaint || "";
          }
          return { ...ep, diagnosisText };
        })
      );

      const episodeSummary = enriched
        .map((ep: any, i: number) => {
          return `${i + 1}. Visit: ${ep.visit_type?.toUpperCase()} | Coded: ${ep.primary_icd_code || "NONE"} (${ep.primary_icd_desc || ""}) | PCS: ${ep.pcs_code || "none"} | AI suggested: ${ep.ai_suggestion || "—"} (${ep.ai_confidence ? Math.round(ep.ai_confidence * 100) + "%" : "—"}) | Documented diagnosis: "${(ep.diagnosisText || "").slice(0, 120)}"`;
        })
        .join("\n");

      const prompt = `You are a clinical coding accuracy auditor for an Indian hospital. Review these recently coded inpatient and outpatient episodes for coding quality issues.

CODED EPISODES:
${episodeSummary}

Identify episodes with:
- Undercoding: less specific code than diagnosis warrants (revenue loss)
- Missing procedure codes: PCS procedure missing for surgical episodes
- Overcoding: code more severe than documented
- Incorrect primary: wrong principal diagnosis selection

Return a JSON array of audit flags. Each flag:
{
  "episode_ref": "Visit type + number (e.g. IPD-1 or OPD-3)",
  "issue_type": "undercoded" | "overcoded" | "missing_procedure" | "incorrect_primary",
  "current_code": "the code currently assigned",
  "suggested_code": "better alternative if applicable",
  "description": "specific problem identified (1-2 sentences)",
  "revenue_impact": "high" | "medium" | "low" | "none",
  "estimated_impact_inr": optional number in INR (omit if unknown),
  "recommendation": "specific action for the coder to take"
}

If all episodes are coded correctly, return [].
Respond ONLY with valid JSON — no markdown, no text outside the array.`;

      const result = await callAI({
        featureKey: "coding_accuracy_auditor",
        hospitalId,
        prompt,
        maxTokens: 1200,
      });

      if (result.error || !result.text) {
        setRawText("AI service unavailable. Check Settings → API Hub.");
        setLoading(false);
        return;
      }

      try {
        const clean = result.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        setFlags(Array.isArray(parsed) ? parsed : []);
      } catch {
        setRawText(result.text);
      }
    } catch (err: any) {
      setRawText(`Audit failed: ${err.message}`);
    }
    setLoading(false);
  };

  const highImpact = flags?.filter((f) => f.revenue_impact === "high") ?? [];
  const totalEstimated = flags?.reduce((s, f) => s + (f.estimated_impact_inr || 0), 0) ?? 0;

  if (!__aiOn) return null;
  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="p-4 border-b flex items-center justify-between shrink-0">
        <div>
          <p className="text-[14px] font-bold flex items-center gap-2">
            <Bot className="h-4 w-4 text-primary" /> Coding Accuracy Auditor
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            AI review of coded episodes for under/over coding and missing procedure codes
          </p>
        </div>
        <Button size="sm" className="h-8 text-[12px] gap-1.5" onClick={runAudit} disabled={loading || !hospitalId}>
          {loading
            ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Auditing {episodesScanned > 0 ? `${episodesScanned} episodes...` : "..."}</>
            : <><Bot className="h-3.5 w-3.5" />Run Coding Audit</>}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {flags === null && !rawText && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground gap-2 py-12">
            <Bot className="h-12 w-12 opacity-20" />
            <p className="text-sm">Click "Run Coding Audit" to scan recently coded episodes</p>
            <p className="text-[11px]">Analyses up to 20 recent coded/validated/locked episodes for revenue accuracy</p>
          </div>
        )}

        {flags !== null && (
          <>
            {/* Summary row */}
            <div className="flex items-center gap-4 text-[12px] bg-muted/50 rounded-lg px-4 py-2.5">
              <span><strong>{episodesScanned}</strong> episodes scanned</span>
              <span><strong>{flags.length}</strong> issue{flags.length !== 1 ? "s" : ""} found</span>
              {highImpact.length > 0 && (
                <span className="text-red-600 font-semibold flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {highImpact.length} high-impact
                </span>
              )}
              {totalEstimated > 0 && (
                <span className="text-amber-700 font-semibold ml-auto">
                  Potential revenue recovery: {inr(totalEstimated)}
                </span>
              )}
            </div>

            {flags.length === 0 && (
              <div className="flex items-center gap-2 text-[13px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
                All scanned episodes appear to be coded accurately. No significant issues detected.
              </div>
            )}

            {flags.map((f, i) => (
              <div key={i} className={`rounded-lg border px-4 py-3 ${ISSUE_STYLE[f.issue_type] ?? ISSUE_STYLE.undercoded}`}>
                <div className="flex items-start justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-bold">{f.episode_ref}</span>
                    <Badge variant="outline" className={`text-[10px] px-1.5 ${ISSUE_BADGE[f.issue_type] ?? ""}`}>
                      {f.issue_type.replace(/_/g, " ").toUpperCase()}
                    </Badge>
                    <span className="flex items-center gap-0.5 text-[11px] font-medium">
                      {IMPACT_ICON[f.revenue_impact]}
                      {f.revenue_impact.toUpperCase()} impact
                      {f.estimated_impact_inr ? ` · ${inr(f.estimated_impact_inr)}` : ""}
                    </span>
                  </div>
                </div>
                <p className="text-[12px] font-mono text-muted-foreground mb-1">
                  Current: <strong>{f.current_code}</strong>
                  {f.suggested_code && <> → Suggested: <strong>{f.suggested_code}</strong></>}
                </p>
                <p className="text-[12px]">{f.description}</p>
                <p className="text-[11px] font-semibold mt-1.5 flex items-center gap-1">
                  → {f.recommendation}
                </p>
              </div>
            ))}

            <p className="text-[10px] text-muted-foreground italic text-center pb-2">
              AI analysis only. MRD officer and physician review required before re-coding.
            </p>
          </>
        )}

        {rawText && (
          <pre className="text-[11px] text-muted-foreground whitespace-pre-wrap rounded-lg border p-3 max-h-96 overflow-auto leading-relaxed">
            {rawText}
          </pre>
        )}
      </div>
    </div>
  );
};

export default CodingAccuracyAuditPanel;
