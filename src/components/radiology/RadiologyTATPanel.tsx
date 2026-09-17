import React, { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { callAI } from "@/lib/aiProvider";
import { useAIFeature } from "@/hooks/useAIFeature";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle, Loader2, RefreshCw, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface PendingStudy {
  id: string;
  study_name: string;
  modality_type: string;
  status: string;
  images_acquired_at: string | null;
  order_date: string;
  order_time: string;
  patient_name: string;
  mins_pending: number;
  predicted_report_mins: number | null;
  risk: "overdue" | "at_risk" | "ok";
}

interface ModalityTAT {
  modality: string;
  avg_tat_mins: number;
  count: number;
}

interface Props {
  hospitalId: string;
}

const RadiologyTATPanel: React.FC<Props> = ({ hospitalId }) => {
  const __aiOn = useAIFeature("radiology_tat_predictor");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingStudy[] | null>(null);
  const [modalityTAT, setModalityTAT] = useState<ModalityTAT[]>([]);
  const [aiInsight, setAiInsight] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    try {
      const now = new Date();

      // Fetch pending studies (images acquired but not yet reported)
      const { data: pendingOrders } = await (supabase as any)
        .from("radiology_orders")
        .select("id, study_name, modality_type, status, order_date, order_time, created_at, patient:patients(full_name)")
        .eq("hospital_id", hospitalId)
        .in("status", ["images_acquired", "in_progress"])
        .order("created_at", { ascending: true })
        .limit(30);

      // Fetch last 7 days completed orders for TAT calculation
      const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString();
      const { data: completedOrders } = await (supabase as any)
        .from("radiology_orders")
        .select("modality_type, created_at, radiology_reports(created_at)")
        .eq("hospital_id", hospitalId)
        .in("status", ["reported", "validated"])
        .gte("created_at", sevenDaysAgo)
        .limit(100);

      // Calculate historical TAT per modality
      const modalityData: Record<string, { total: number; count: number }> = {};
      (completedOrders || []).forEach((o: any) => {
        const report = (o.radiology_reports || [])[0];
        if (!report) return;
        const orderTime = new Date(o.created_at).getTime();
        const reportTime = new Date(report.created_at).getTime();
        const tatMins = Math.round((reportTime - orderTime) / 60000);
        if (tatMins > 0 && tatMins < 10000) {
          if (!modalityData[o.modality_type]) modalityData[o.modality_type] = { total: 0, count: 0 };
          modalityData[o.modality_type].total += tatMins;
          modalityData[o.modality_type].count += 1;
        }
      });

      const tatByModality: Record<string, number> = {};
      const modalityTATList: ModalityTAT[] = Object.entries(modalityData).map(([mod, d]) => {
        const avg = Math.round(d.total / d.count);
        tatByModality[mod] = avg;
        return { modality: mod, avg_tat_mins: avg, count: d.count };
      });
      setModalityTAT(modalityTATList);

      // Build pending study list with risk classification
      const pendingList: PendingStudy[] = (pendingOrders || []).map((o: any) => {
        const createdAt = new Date(o.created_at);
        const minsPending = Math.round((now.getTime() - createdAt.getTime()) / 60000);
        const avgTAT = tatByModality[o.modality_type] || 120;
        const predicted = avgTAT - minsPending;

        let risk: "overdue" | "at_risk" | "ok" = "ok";
        if (minsPending > 1440) risk = "overdue";  // >24h
        else if (minsPending > avgTAT * 0.8) risk = "at_risk";

        return {
          id: o.id,
          study_name: o.study_name,
          modality_type: o.modality_type,
          status: o.status,
          images_acquired_at: null,
          order_date: o.order_date,
          order_time: o.order_time,
          patient_name: o.patient?.full_name || "Unknown",
          mins_pending: minsPending,
          predicted_report_mins: predicted > 0 ? predicted : null,
          risk,
        };
      });

      setPending(pendingList);

      // Fire clinical_alerts for critically overdue studies (>24h) — deduped on the study
      // itself (same shape as LabTATPanel / KNOWN-BUG-002), so page load and the manual
      // refresh button don't create a second alert for a study still overdue from before.
      const criticallyOverdue = pendingList.filter(p => p.mins_pending > 1440);
      if (criticallyOverdue.length > 0) {
        criticallyOverdue.forEach(p => {
          (supabase as any).from("clinical_alerts").upsert({
            hospital_id: hospitalId,
            alert_type: "radiology_report_overdue",
            severity: "high",
            alert_message: `Radiology report overdue >24h: ${p.study_name} for ${p.patient_name} (${Math.round(p.mins_pending / 60)}h pending)`,
            radiology_order_id: p.id,
            dedupe_key: p.id,
          }, { onConflict: "hospital_id,alert_type,dedupe_key", ignoreDuplicates: true }).then(() => {}, () => {});
        });
      }

      // AI insight on TAT bottlenecks
      if (pendingList.length > 0) {
        const pendingSummary = pendingList.slice(0, 10).map(p =>
          `${p.study_name} (${p.modality_type}): ${p.mins_pending}min pending, status: ${p.status}, risk: ${p.risk}`
        ).join("\n");

        const tatSummary = modalityTATList.map(m =>
          `${m.modality}: avg ${m.avg_tat_mins}min (${m.count} studies)`
        ).join(", ");

        const resp = await callAI({
          featureKey: "radiology_tat_predictor",
          hospitalId,
          prompt: `Radiology TAT analysis for an Indian hospital. Identify bottlenecks and give 2-3 actionable recommendations.

Historical TAT by modality (last 7 days): ${tatSummary || "No data yet"}

Pending studies:
${pendingSummary}

Give a 2-3 sentence analysis identifying the main TAT bottleneck and specific actions to speed up reporting. Be concise and specific.`,
          maxTokens: 250,
        });

        if (!resp.error && resp.text) {
          setAiInsight(resp.text.trim());
        }
      }
    } catch (err: any) {
      console.error("TAT panel error:", err);
    }
    setLoading(false);
  }, [hospitalId]);

  const overdueCount = pending?.filter(p => p.risk === "overdue").length ?? 0;
  const atRiskCount = pending?.filter(p => p.risk === "at_risk").length ?? 0;

  if (!__aiOn) return null;
  return (
    <div className="flex flex-col h-full overflow-hidden p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" /> Report TAT Dashboard
          </p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Monitors pending studies and predicts report turnaround time
          </p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {pending === null ? "Load Dashboard" : "Refresh"}
        </Button>
      </div>

      {pending === null && !loading && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Click "Load Dashboard" to view pending study TAT
        </div>
      )}

      {pending !== null && (
        <>
          {/* KPI row */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border bg-card px-3 py-2 text-center">
              <p className="text-xl font-black text-foreground">{pending.length}</p>
              <p className="text-[10px] text-muted-foreground">Pending</p>
            </div>
            <div className={cn("rounded-lg border px-3 py-2 text-center", overdueCount > 0 ? "bg-red-50 border-red-200" : "bg-card")}>
              <p className={cn("text-xl font-black", overdueCount > 0 ? "text-red-700" : "text-foreground")}>{overdueCount}</p>
              <p className="text-[10px] text-muted-foreground">Overdue &gt;24h</p>
            </div>
            <div className={cn("rounded-lg border px-3 py-2 text-center", atRiskCount > 0 ? "bg-amber-50 border-amber-200" : "bg-card")}>
              <p className={cn("text-xl font-black", atRiskCount > 0 ? "text-amber-700" : "text-foreground")}>{atRiskCount}</p>
              <p className="text-[10px] text-muted-foreground">At Risk</p>
            </div>
          </div>

          {/* AI Insight */}
          {aiInsight && (
            <div className="rounded-lg border bg-blue-50 border-blue-200 px-3 py-2 text-[12px] text-blue-900 flex gap-2">
              <Bot className="h-3.5 w-3.5 shrink-0 mt-0.5 text-blue-600" />
              <span>{aiInsight}</span>
            </div>
          )}

          {/* Historical TAT */}
          {modalityTAT.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">Historical TAT (7 days)</p>
              <div className="flex flex-wrap gap-2">
                {modalityTAT.map(m => (
                  <div key={m.modality} className="rounded border bg-muted/40 px-2 py-1 text-[10px]">
                    <strong>{m.modality}</strong>: {m.avg_tat_mins < 60 ? `${m.avg_tat_mins}min` : `${(m.avg_tat_mins / 60).toFixed(1)}h`} avg
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Pending studies */}
          <div className="flex-1 overflow-y-auto space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground">Pending Studies</p>
            {pending.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No pending studies — all reports are up to date</p>
            )}
            {pending.map(p => (
              <div
                key={p.id}
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs space-y-0.5",
                  p.risk === "overdue" ? "bg-red-50 border-red-200" :
                  p.risk === "at_risk" ? "bg-amber-50 border-amber-200" :
                  "bg-card"
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{p.study_name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="outline" className="text-[9px] px-1">{p.modality_type}</Badge>
                    {p.risk === "overdue" && (
                      <Badge variant="outline" className="text-[9px] border-red-400 text-red-700 px-1">
                        <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> OVERDUE
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground text-[10px]">
                  <span>{p.patient_name}</span>
                  <span>Pending: {p.mins_pending < 60 ? `${p.mins_pending}min` : `${(p.mins_pending / 60).toFixed(1)}h`}</span>
                  {p.predicted_report_mins != null && p.predicted_report_mins > 0 && (
                    <span className="text-emerald-600">Est. {p.predicted_report_mins < 60 ? `${p.predicted_report_mins}min` : `${(p.predicted_report_mins / 60).toFixed(1)}h`} remaining</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default RadiologyTATPanel;
