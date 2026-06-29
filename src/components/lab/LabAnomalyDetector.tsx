import React, { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, AlertTriangle, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface Anomaly {
  test: string;
  finding: string;
  clinical_significance: string;
  action: string;
  severity: "critical" | "high" | "moderate" | "informational";
}

interface Props {
  patientId: string;
  hospitalId: string;
  currentResults: Array<{
    test_name: string;
    result_value: string | null;
    result_numeric: number | null;
    result_flag: string | null;
    unit: string | null;
    normal_min: number | null;
    normal_max: number | null;
    reference_range: string | null;
  }>;
  orderId: string;
  autoRun?: boolean;
}

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-red-50 border-red-200 text-red-800 dark:bg-red-950/20 dark:border-red-800",
  high: "bg-orange-50 border-orange-200 text-orange-800 dark:bg-orange-950/20 dark:border-orange-800",
  moderate: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/20 dark:border-amber-800",
  informational: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/20 dark:border-blue-800",
};

const LabAnomalyDetector: React.FC<Props> = ({ patientId, hospitalId, currentResults, orderId, autoRun = false }) => {
  const [loading, setLoading] = useState(false);
  const [anomalies, setAnomalies] = useState<Anomaly[] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const hasAutoRun = useRef(false);

  const runDetection = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      // Fetch last 6 months of results for trend analysis
      const { data: history } = await (supabase as any)
        .from("lab_order_items")
        .select("test_name: lab_test_master(test_name), result_numeric, result_value, result_flag, lab_orders!inner(order_date, patient_id)")
        .eq("lab_orders.patient_id", patientId)
        .eq("lab_orders.hospital_id", hospitalId)
        .in("status", ["reported", "validated"])
        .order("lab_orders.order_date", { ascending: false })
        .limit(50);

      const trendMap: Record<string, number[]> = {};
      (history || []).forEach((row: any) => {
        const name = row.test_name?.test_name || row.test_name;
        if (!name || row.result_numeric == null) return;
        if (!trendMap[name]) trendMap[name] = [];
        trendMap[name].push(row.result_numeric);
      });

      const resultsText = currentResults
        .filter((r) => r.result_value)
        .map((r) => {
          const trend = trendMap[r.test_name];
          const trendStr = trend && trend.length >= 2
            ? ` [Trend: ${trend.slice(0, 3).join(" → ")}]`
            : "";
          return `${r.test_name}: ${r.result_value} ${r.unit || ""} (Range: ${r.reference_range || `${r.normal_min ?? "?"}-${r.normal_max ?? "?"}`}) Flag: ${r.result_flag || "normal"}${trendStr}`;
        }).join("\n") || "No results entered";

      const response = await callAI({
        featureKey: "lab_anomaly",
        hospitalId,
        prompt: `You are a clinical pathologist AI for an Indian hospital. Analyse these lab results for anomalies, concerning patterns, and trajectory trends.

Lab Results:
${resultsText}

Identify:
1. Critical/panic values requiring immediate action
2. Values approaching critical range or showing worsening trend
3. Patterns suggesting a specific diagnosis (e.g., anaemia panel pattern, renal failure pattern, liver disease pattern)
4. Unexpected combinations (e.g., low Hb with high WBC suggests malignancy)

Return ONLY JSON array (empty array if all normal):
[{"test":"Haemoglobin","finding":"Severe anaemia 6.2 g/dL with downward trend","clinical_significance":"Risk of cardiac decompensation. Trend suggests ongoing blood loss or haemolysis.","action":"Transfuse if symptomatic. Peripheral smear, reticulocyte count, Coombs test.","severity":"critical"}]

Provide max 4 anomalies, most critical first. Focus on actionable clinical insights.`,
        maxTokens: 500,
      });

      if (response.error) {
        setErrorMsg(response.error);
        setLoading(false);
        return;
      }

      if (!response.text) {
        setErrorMsg("AI returned an empty response. Please try again.");
        setLoading(false);
        return;
      }

      try {
        const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        const parsed = JSON.parse(clean);
        const result = Array.isArray(parsed) ? parsed : [];
        setAnomalies(result);

        await (supabase as any).from("ai_feature_logs").insert({
          hospital_id: hospitalId,
          module: "lab",
          feature_key: "lab_anomaly",
          patient_id: patientId,
          input_summary: `${currentResults.filter(r => r.result_value).length} results, ${Object.keys(trendMap).length} with history`,
          output_summary: `${result.length} anomalies`,
          success: true,
        });
      } catch {
        setErrorMsg("AI response could not be parsed. Please try again.");
      }
    } catch (e) {
      console.error("Lab anomaly detection error:", e);
      setErrorMsg(e instanceof Error ? e.message : "Unexpected error during analysis.");
    }
    setLoading(false);
  };

  // Auto-trigger once when autoRun=true and results are present
  useEffect(() => {
    if (autoRun && !hasAutoRun.current && currentResults.some(r => r.result_value) && !loading && anomalies === null) {
      hasAutoRun.current = true;
      runDetection();
    }
  }, [autoRun, currentResults]);

  const validResults = currentResults.filter((r) => r.result_value);
  if (validResults.length === 0) return null;

  if (errorMsg) {
    return (
      <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <AlertTriangle size={13} className="text-red-500 shrink-0" />
          <span className="text-xs text-red-700 truncate">{errorMsg}</span>
        </div>
        <Button size="sm" variant="outline" className="h-7 text-xs gap-1 ml-2 shrink-0" onClick={runDetection} disabled={loading}>
          {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          Retry
        </Button>
      </div>
    );
  }

  if (anomalies === null) {
    return (
      <div className="flex items-center justify-between bg-primary/5 border border-primary/20 rounded-lg px-3 py-2.5">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-primary" />
          <span className="text-xs font-semibold text-foreground">AI Anomaly Detection</span>
          <span className="text-[10px] text-muted-foreground">Trend + pattern analysis</span>
        </div>
        <Button size="sm" className="h-7 text-xs gap-1" onClick={runDetection} disabled={loading}>
          {loading ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
          {loading ? "Analysing..." : "Run Analysis"}
        </Button>
      </div>
    );
  }

  if (anomalies.length === 0) {
    return (
      <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
        <div className="flex items-center gap-2">
          <Sparkles size={12} /> AI analysis complete — no significant anomalies detected
        </div>
        <button onClick={() => setAnomalies(null)} className="text-[10px] opacity-60 hover:opacity-100">Re-run</button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Sparkles size={12} className="text-primary" />
        AI Anomaly Analysis — {anomalies.length} finding{anomalies.length > 1 ? "s" : ""}
      </div>
      {anomalies.map((a, i) => (
        <div key={i} className={cn("rounded-lg border p-2.5 text-xs space-y-1", SEVERITY_STYLE[a.severity])}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-start gap-1.5 font-bold">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              {a.test}: {a.finding}
            </div>
            <Badge variant="outline" className={cn("text-[9px] capitalize flex-shrink-0", SEVERITY_STYLE[a.severity])}>
              {a.severity}
            </Badge>
          </div>
          <p className="opacity-80 pl-4">{a.clinical_significance}</p>
          <p className="font-medium pl-4">Action: {a.action}</p>
        </div>
      ))}
      <button onClick={() => setAnomalies(null)} className="text-[10px] text-muted-foreground hover:text-foreground">
        Re-run analysis
      </button>
    </div>
  );
};

export default LabAnomalyDetector;
