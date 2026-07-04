import React, { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

// Lab report TAT dashboard (lab plan Phase 8) — adapted from RadiologyTATPanel.
// Pending orders vs each order's target TAT (max of its tests' lab_test_master.tat_minutes),
// 7-day historical average, KPI cards + risk-colored list. Orders overdue by >2× the
// target raise a lab_tat_overdue clinical alert (whitelisted in Phase 1).

interface PendingOrder {
  id: string;
  accession: string | null;
  patient_name: string;
  priority: string;
  status: string;
  mins_pending: number;
  target_tat: number;
  risk: "overdue" | "at_risk" | "ok";
}

const PENDING_STATUSES = ["ordered", "sample_collected", "in_process", "partial_results", "result_entered", "pending_validation"];

interface Props { hospitalId: string; }

const LabTATPanel: React.FC<Props> = ({ hospitalId }) => {
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<PendingOrder[] | null>(null);
  const [avgTat, setAvgTat] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      const now = Date.now();

      const { data: orders } = await (supabase as any)
        .from("lab_orders")
        .select(`
          id, accession_number, priority, status, order_time, created_at,
          patients(full_name),
          lab_order_items(lab_test_master:lab_test_master!lab_order_items_test_id_fkey(tat_minutes))
        `)
        .eq("hospital_id", hospitalId)
        .in("status", PENDING_STATUSES)
        .order("order_time", { ascending: true })
        .limit(200);

      const list: PendingOrder[] = (orders || []).map((o: any) => {
        const startMs = new Date(o.order_time || o.created_at).getTime();
        const minsPending = Math.round((now - startMs) / 60000);
        const targetTat = Math.max(
          60,
          ...(o.lab_order_items || []).map((i: any) => i.lab_test_master?.tat_minutes || 60)
        );
        let risk: PendingOrder["risk"] = "ok";
        if (minsPending > targetTat * 2) risk = "overdue";
        else if (minsPending > targetTat * 0.8) risk = "at_risk";
        return {
          id: o.id,
          accession: o.accession_number,
          patient_name: o.patients?.full_name || "Unknown",
          priority: o.priority,
          status: o.status,
          mins_pending: minsPending,
          target_tat: targetTat,
          risk,
        };
      });
      // Overdue first
      list.sort((a, b) => (b.mins_pending / b.target_tat) - (a.mins_pending / a.target_tat));
      setPending(list);

      // 7-day historical average TAT (order_time → latest validated_at)
      const sevenDaysAgo = new Date(now - 7 * 86400000).toISOString();
      const { data: completed } = await (supabase as any)
        .from("lab_orders")
        .select("order_time, validated_at")
        .eq("hospital_id", hospitalId)
        .eq("status", "completed")
        .gte("order_time", sevenDaysAgo)
        .not("validated_at", "is", null)
        .limit(300);
      const tats = (completed || [])
        .map((o: any) => Math.round((new Date(o.validated_at).getTime() - new Date(o.order_time).getTime()) / 60000))
        .filter((m: number) => m > 0 && m < 20000);
      setAvgTat(tats.length ? Math.round(tats.reduce((s: number, m: number) => s + m, 0) / tats.length) : null);

      // Raise alerts for orders overdue by >2× target
      const overdue = list.filter(p => p.risk === "overdue");
      overdue.forEach(p => {
        (supabase as any).from("clinical_alerts").insert({
          hospital_id: hospitalId,
          alert_type: "lab_tat_overdue",
          severity: "high",
          alert_message: `Lab TAT overdue: ${p.accession || "order"} for ${p.patient_name} — ${Math.round(p.mins_pending / 60)}h pending (target ${Math.round(p.target_tat / 60)}h)`,
        }).catch(() => {});
      });
    } catch (err) {
      console.error("Lab TAT panel error:", err);
    }
    setLoading(false);
  }, [hospitalId]);

  const overdueCount = pending?.filter(p => p.risk === "overdue").length ?? 0;
  const atRiskCount = pending?.filter(p => p.risk === "at_risk").length ?? 0;

  const fmt = (m: number) => (m < 60 ? `${m}min` : `${(m / 60).toFixed(1)}h`);

  return (
    <div className="flex flex-col h-full overflow-hidden p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /> Lab Report TAT Dashboard</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">Pending orders vs target turnaround time</p>
        </div>
        <Button size="sm" className="h-8 text-xs gap-1.5" onClick={load} disabled={loading}>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {pending === null ? "Load Dashboard" : "Refresh"}
        </Button>
      </div>

      {pending === null && !loading && (
        <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
          Click "Load Dashboard" to view pending order TAT
        </div>
      )}

      {pending !== null && (
        <>
          <div className="grid grid-cols-4 gap-3">
            <Kpi value={pending.length} label="Pending" />
            <Kpi value={overdueCount} label="Overdue >2× target" danger={overdueCount > 0} />
            <Kpi value={atRiskCount} label="At Risk" warn={atRiskCount > 0} />
            <Kpi value={avgTat != null ? fmt(avgTat) : "—"} label="Avg TAT (7d)" />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5">
            <p className="text-[11px] font-semibold text-muted-foreground">Pending Orders</p>
            {pending.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-6">No pending orders — all reports are up to date</p>
            )}
            {pending.map(p => (
              <div key={p.id} className={cn(
                "rounded-lg border px-3 py-2 text-xs space-y-0.5",
                p.risk === "overdue" ? "bg-red-50 border-red-200" : p.risk === "at_risk" ? "bg-amber-50 border-amber-200" : "bg-card"
              )}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold truncate">{p.patient_name}</span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {p.priority !== "routine" && (
                      <Badge variant="outline" className={cn("text-[9px] px-1", p.priority === "stat" ? "border-red-400 text-red-700" : "border-amber-400 text-amber-700")}>
                        {p.priority.toUpperCase()}
                      </Badge>
                    )}
                    {p.risk === "overdue" && (
                      <Badge variant="outline" className="text-[9px] border-red-400 text-red-700 px-1">
                        <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> OVERDUE
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground text-[10px]">
                  <span className="font-mono">{p.accession || "—"}</span>
                  <span className="capitalize">{p.status.replace(/_/g, " ")}</span>
                  <span>Pending: {fmt(p.mins_pending)}</span>
                  <span>Target: {fmt(p.target_tat)}</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const Kpi: React.FC<{ value: React.ReactNode; label: string; danger?: boolean; warn?: boolean }> = ({ value, label, danger, warn }) => (
  <div className={cn("rounded-lg border px-3 py-2 text-center", danger ? "bg-red-50 border-red-200" : warn ? "bg-amber-50 border-amber-200" : "bg-card")}>
    <p className={cn("text-xl font-black", danger ? "text-red-700" : warn ? "text-amber-700" : "text-foreground")}>{value}</p>
    <p className="text-[10px] text-muted-foreground">{label}</p>
  </div>
);

export default LabTATPanel;
