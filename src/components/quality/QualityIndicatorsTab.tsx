import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { useToast } from "@/hooks/use-toast";
import { Activity, BedDouble, Clock, ShieldAlert, TrendingUp, TrendingDown } from "lucide-react";
import { useHospitalId } from "@/hooks/useHospitalId";

interface Indicator {
  id: string;
  indicator_name: string;
  category: string;
  value: number;
  unit: string;
  target: number | null;
  auto_calculated: boolean;
  data_source: string | null;
}

interface AutoIndicator {
  label: string;
  value: number | null;
  unit: string;
  icon: React.ReactNode;
  target: number;
  lowerBetter: boolean;
  loading: boolean;
  prevValue?: number | null;
}

const categoryColors: Record<string, string> = {
  clinical: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  operational: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  patient_safety: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  infection_control: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  nabh: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  financial: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
};

const lowerIsBetter = new Set(["Medication Error Rate (per 1000 doses)", "Patient Fall Rate (per 1000 patient days)", "Hospital Acquired Infection Rate", "Readmission Rate within 30 days", "OT Cancellation Rate"]);

const QualityIndicatorsTab: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [indicators, setIndicators] = useState<Indicator[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editModal, setEditModal] = useState<Indicator | null>(null);
  const [editValue, setEditValue] = useState("");

  // Auto-calculated indicators
  const [autoIndicators, setAutoIndicators] = useState<AutoIndicator[]>([
    { label: "Surgical Site Infection Rate", value: null, unit: "%", icon: <ShieldAlert size={18} />, target: 2, lowerBetter: true, loading: true },
    { label: "Avg Length of Stay", value: null, unit: "days", icon: <BedDouble size={18} />, target: 5, lowerBetter: true, loading: true },
    { label: "Bed Occupancy Rate", value: null, unit: "%", icon: <Activity size={18} />, target: 80, lowerBetter: false, loading: true },
    { label: "OPD Avg Wait Time", value: null, unit: "min", icon: <Clock size={18} />, target: 30, lowerBetter: true, loading: true },
  ]);

  useEffect(() => {
    loadIndicators();
  }, []);

  useEffect(() => {
    if (hospitalId) loadAutoIndicators();
  }, [hospitalId]);

  const loadAutoIndicators = async () => {
    if (!hospitalId) return;
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();

    const results = await Promise.allSettled([
      // SSI Rate: infections / completed surgeries * 100
      (async () => {
        const [{ count: infections }, { count: surgeries }] = await Promise.all([
          (supabase as any).from("clinical_alerts").select("id", { count: "exact", head: true })
            .eq("hospital_id", hospitalId).eq("alert_type", "infection").gte("created_at", monthStart),
          (supabase as any).from("ot_schedules").select("id", { count: "exact", head: true })
            .eq("hospital_id", hospitalId).eq("status", "completed").gte("actual_end_time", monthStart),
        ]);
        return surgeries && surgeries > 0 ? ((infections || 0) / surgeries) * 100 : 0;
      })(),
      // ALOS
      (async () => {
        const { data } = await (supabase as any).from("admissions").select("admitted_at, discharged_at")
          .eq("hospital_id", hospitalId).eq("status", "discharged").gte("discharged_at", monthStart);
        if (!data || data.length === 0) return null;
        const totalDays = data.reduce((sum: number, a: any) => {
          const days = (new Date(a.discharged_at).getTime() - new Date(a.admitted_at).getTime()) / (1000 * 60 * 60 * 24);
          return sum + days;
        }, 0);
        return Math.round((totalDays / data.length) * 10) / 10;
      })(),
      // Bed Occupancy
      (async () => {
        const [{ count: occupied }, { count: totalBeds }] = await Promise.all([
          (supabase as any).from("admissions").select("id", { count: "exact", head: true })
            .eq("hospital_id", hospitalId).eq("status", "admitted"),
          (supabase as any).from("beds").select("id", { count: "exact", head: true })
            .eq("hospital_id", hospitalId).eq("is_active", true),
        ]);
        return totalBeds && totalBeds > 0 ? Math.round(((occupied || 0) / totalBeds) * 100) : 0;
      })(),
      // OPD Wait Time
      (async () => {
        const { data } = await (supabase as any).from("opd_tokens").select("created_at, consultation_start_at")
          .eq("hospital_id", hospitalId).eq("status", "completed").gte("visit_date", monthStart.slice(0, 10))
          .not("consultation_start_at", "is", null).limit(200);
        if (!data || data.length === 0) return null;
        const totalMin = data.reduce((sum: number, t: any) => {
          const diff = (new Date(t.consultation_start_at).getTime() - new Date(t.created_at).getTime()) / (1000 * 60);
          return sum + Math.max(0, diff);
        }, 0);
        return Math.round(totalMin / data.length);
      })(),
    ]);

    setAutoIndicators(prev => prev.map((ind, i) => ({
      ...ind,
      value: results[i].status === "fulfilled" ? results[i].value : null,
      loading: false,
    })));
  };

  const loadIndicators = async () => {
    const { data, error: queryError } = await supabase.from("quality_indicators").select("*").order("category");
    if (queryError) {
      setError(queryError.message);
      toast({ title: "Failed to load indicators", description: queryError.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    setIndicators((data as any) || []);
    setError(null);
    setLoading(false);
  };

  const getValueColor = (ind: Indicator) => {
    if (!ind.target) return "text-foreground";
    const isLower = lowerIsBetter.has(ind.indicator_name);
    const diff = isLower ? ind.target - ind.value : ind.value - ind.target;
    const pctDiff = (diff / ind.target) * 100;
    if (isLower) {
      if (ind.value <= ind.target) return "text-green-600 dark:text-green-400";
      if (pctDiff >= -20) return "text-amber-600 dark:text-amber-400";
      return "text-red-600 dark:text-red-400";
    }
    if (ind.value >= ind.target) return "text-green-600 dark:text-green-400";
    if (pctDiff >= -20) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  };

  const getAutoColor = (ind: AutoIndicator) => {
    if (ind.value === null) return "text-muted-foreground";
    if (ind.lowerBetter) {
      return ind.value <= ind.target ? "text-green-600 dark:text-green-400" : ind.value <= ind.target * 1.5 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
    }
    return ind.value >= ind.target ? "text-green-600 dark:text-green-400" : ind.value >= ind.target * 0.7 ? "text-amber-600 dark:text-amber-400" : "text-red-600 dark:text-red-400";
  };

  const handleUpdate = async () => {
    if (!editModal) return;
    const val = parseFloat(editValue);
    if (isNaN(val)) return;
    await supabase.from("quality_indicators").update({ value: val }).eq("id", editModal.id);
    toast({ title: "Indicator updated" });
    setEditModal(null);
    loadIndicators();
  };

  const grouped = indicators.reduce<Record<string, Indicator[]>>((acc, ind) => {
    (acc[ind.category] = acc[ind.category] || []).push(ind);
    return acc;
  }, {});

  const sparkData = Array.from({ length: 6 }, (_, i) => ({ v: Math.random() * 50 + 30 }));

  if (loading) return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;

  if (error) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
        <div className="text-destructive text-sm font-medium">Failed to load quality indicators</div>
        <p className="text-xs text-muted-foreground text-center max-w-sm">{error}</p>
        <Button size="sm" variant="outline" onClick={() => { setLoading(true); loadIndicators(); }}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4">
      {/* Auto-Calculated NABH Indicators */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
          Auto-Calculated (Current Month)
        </h3>
        <div className="grid grid-cols-4 gap-3">
          {autoIndicators.map((ind) => (
            <Card key={ind.label} className="border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2 text-muted-foreground">
                  {ind.icon}
                  <p className="text-[12px] font-semibold text-foreground leading-tight">{ind.label}</p>
                </div>
                {ind.loading ? (
                  <div className="h-8 flex items-center"><span className="text-xs text-muted-foreground">Calculating…</span></div>
                ) : (
                  <div>
                    <span className={`text-2xl font-bold ${getAutoColor(ind)}`}>
                      {ind.value !== null ? (ind.unit === "%" || ind.unit === "min" ? Math.round(ind.value) : ind.value) : "—"}
                    </span>
                    <span className="text-sm text-muted-foreground ml-1">{ind.unit}</span>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      Target: {ind.lowerBetter ? "≤" : "≥"} {ind.target}{ind.unit}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {indicators.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 p-8">
          <div className="text-2xl">📊</div>
          <p className="text-sm font-medium text-foreground">No additional quality indicators configured</p>
          <p className="text-xs text-muted-foreground text-center max-w-sm">
            Auto-calculated indicators above show live data. Additional manual indicators can be configured by admin.
          </p>
        </div>
      ) : (
        Object.entries(grouped).map(([cat, inds]) => (
          <div key={cat} className="mb-6">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              {cat.replace("_", " ")}
            </h3>
            <div className="grid grid-cols-2 gap-3">
              {inds.map((ind) => (
                <Card key={ind.id} className="border">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-foreground truncate">{ind.indicator_name}</p>
                        <Badge variant="secondary" className={`text-[9px] mt-1 ${categoryColors[ind.category] || ""}`}>
                          {ind.category.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                    <div className="flex items-end justify-between">
                      <div>
                        <span className={`text-2xl font-bold ${getValueColor(ind)}`}>
                          {Number(ind.value).toFixed(ind.unit === "%" ? 0 : 1)}
                        </span>
                        <span className="text-sm text-muted-foreground ml-0.5">{ind.unit}</span>
                        {ind.target && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            Target: {Number(ind.target).toFixed(ind.unit === "%" ? 0 : 1)}{ind.unit}
                          </p>
                        )}
                      </div>
                      <div className="w-[80px] h-[40px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={sparkData}>
                            <Line type="monotone" dataKey="v" stroke="hsl(var(--primary))" strokeWidth={1.5} dot={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                    {!ind.auto_calculated && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs mt-2 w-full"
                        onClick={() => { setEditModal(ind); setEditValue(String(ind.value)); }}
                      >
                        Update Value
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}

      <Dialog open={!!editModal} onOpenChange={() => setEditModal(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Update: {editModal?.indicator_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Value ({editModal?.unit})</Label>
              <Input
                type="number"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button onClick={handleUpdate} className="w-full" size="sm">Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QualityIndicatorsTab;
