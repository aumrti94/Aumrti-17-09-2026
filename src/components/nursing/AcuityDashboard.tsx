import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { computeWardAcuity } from "@/lib/acuityStaffing";
import { getNEWS2BadgeClasses } from "@/lib/news2";
import { AlertTriangle, RefreshCw, Activity } from "lucide-react";
import NurseWorkloadOptimizerPanel from "./NurseWorkloadOptimizerPanel";

interface Ward { id: string; name: string; }
interface Snapshot {
  ward_id: string; ward_name?: string;
  patient_count: number; high_acuity: number; medium_acuity: number; low_acuity: number;
  avg_news2: number | null; nurses_on_duty: number; required_nurses: number; ratio_met: boolean;
  snapshot_at: string;
}
interface Alert {
  id: string; ward_id: string; message: string; severity: string; notified_at: string; resolved_at: string | null;
}

const AcuityDashboard: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [wards, setWards] = useState<Ward[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState<string | null>(null);
  const [nurseInputs, setNurseInputs] = useState<Record<string, string>>({});

  const loadData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [wardRes, snapRes, alertRes] = await Promise.all([
      supabase.from("wards").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).order("name"),
      (supabase as any).from("ward_acuity_snapshots").select("*")
        .eq("hospital_id", hospitalId)
        .order("snapshot_at", { ascending: false }).limit(50),
      (supabase as any).from("staffing_alerts").select("*")
        .eq("hospital_id", hospitalId).is("resolved_at", null)
        .eq("is_deleted", false).order("notified_at", { ascending: false }),
    ]);
    setWards(wardRes.data || []);

    // Latest snapshot per ward
    const seen = new Set<string>();
    const latestSnaps: Snapshot[] = [];
    for (const s of (snapRes.data || [])) {
      if (!seen.has(s.ward_id)) { seen.add(s.ward_id); latestSnaps.push(s); }
    }
    setSnapshots(latestSnaps);
    setAlerts(alertRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { loadData(); }, [loadData]);

  const recalculate = async (ward: Ward) => {
    if (!hospitalId) return;
    const nurses = Number(nurseInputs[ward.id] || 0);
    setComputing(ward.id);
    try {
      await computeWardAcuity(hospitalId, ward.id, ward.name, nurses);
      toast({ title: `Acuity recalculated for ${ward.name}` });
      loadData();
    } catch {
      toast({ title: "Recalculation failed", variant: "destructive" });
    }
    setComputing(null);
  };

  const resolveAlert = async (alertId: string) => {
    await (supabase as any).from("staffing_alerts").update({ resolved_at: new Date().toISOString() }).eq("id", alertId);
    loadData();
  };

  const getSnap = (wardId: string) => snapshots.find(s => s.ward_id === wardId);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 p-3 border-b">
        <Activity className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Ward Acuity & Staffing Board</span>
        <span className="text-xs text-muted-foreground ml-1">— NABH COP.6</span>
      </div>

      {alerts.length > 0 && (
        <div className="p-3 bg-red-50 border-b border-red-200 space-y-1">
          {alerts.map(a => (
            <div key={a.id} className="flex items-center gap-2 text-xs text-red-800">
              <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
              <span className="flex-1">{a.message}</span>
              <button className="text-red-600 hover:underline" onClick={() => resolveAlert(a.id)}>Resolve</button>
            </div>
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto p-3">
        {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {wards.map(ward => {
              const snap = getSnap(ward.id);
              const ratioOk = snap ? snap.ratio_met : true;
              return (
                <div key={ward.id} className={cn("border rounded-xl p-4 bg-card", !ratioOk && "border-red-400 bg-red-50")}>
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-sm font-semibold">{ward.name}</p>
                    {snap && (
                      <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium",
                        ratioOk ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800")}>
                        {ratioOk ? "Ratio OK" : "⚠ Ratio Breach"}
                      </span>
                    )}
                  </div>

                  {snap ? (
                    <>
                      <div className="grid grid-cols-4 gap-2 mb-3 text-center">
                        <div><p className="text-lg font-bold">{snap.patient_count}</p><p className="text-[10px] text-muted-foreground">Patients</p></div>
                        <div><p className="text-lg font-bold text-red-600">{snap.high_acuity}</p><p className="text-[10px] text-muted-foreground">High</p></div>
                        <div><p className="text-lg font-bold text-amber-600">{snap.medium_acuity}</p><p className="text-[10px] text-muted-foreground">Medium</p></div>
                        <div><p className="text-lg font-bold text-green-600">{snap.low_acuity}</p><p className="text-[10px] text-muted-foreground">Low</p></div>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                        {snap.avg_news2 != null && (
                          <span className={cn("px-2 py-0.5 rounded-full text-xs font-medium", getNEWS2BadgeClasses(snap.avg_news2))}>
                            NEWS2 avg: {snap.avg_news2.toFixed(1)}
                          </span>
                        )}
                        <span>On duty: <strong>{snap.nurses_on_duty}</strong> | Required: <strong>{snap.required_nurses}</strong></span>
                      </div>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground mb-3">No snapshot yet.</p>
                  )}

                  <div className="flex items-center gap-2">
                    <Input type="number" placeholder="Nurses on duty"
                      className="h-7 text-xs flex-1"
                      value={nurseInputs[ward.id] || ""}
                      onChange={e => setNurseInputs(prev => ({ ...prev, [ward.id]: e.target.value }))} />
                    <Button size="sm" variant="outline" className="h-7 text-xs px-2"
                      disabled={computing === ward.id}
                      onClick={() => recalculate(ward)}>
                      <RefreshCw className={cn("h-3 w-3", computing === ward.id && "animate-spin")} />
                    </Button>
                  </div>
                </div>
              );
            })}
            {wards.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-full">No active wards configured.</p>
            )}
          </div>
        )}
      </div>

      {/* Nurse Workload Optimizer — AI rebalancing suggestions */}
      {snapshots.length > 0 && hospitalId && (
        <div className="px-4 pb-4">
          <NurseWorkloadOptimizerPanel snapshots={snapshots} hospitalId={hospitalId} />
        </div>
      )}
    </div>
  );
};

export default AcuityDashboard;
