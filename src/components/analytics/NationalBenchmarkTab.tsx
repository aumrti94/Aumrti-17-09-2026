import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Trophy, AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

// ── NABH / NHM Published National Benchmarks (6th Edition, 2023 Annual Report) ─
const BENCHMARKS = [
  {
    category: "Patient Flow & Throughput",
    indicators: [
      { code: "ALOS",       name: "Average Length of Stay (days)",         unit: "days",    nabh: 4.2,  direction: "lower",  source: "NABH Annual Benchmark 2023" },
      { code: "BOR",        name: "Bed Occupancy Rate",                    unit: "%",       nabh: 65,   direction: "higher", source: "NHM Quality Standards 2023" },
      { code: "DTR",        name: "Discharge Turn-Around Time (hrs)",      unit: "hrs",     nabh: 4.0,  direction: "lower",  source: "NABH COP Standard" },
      { code: "ERTOS",      name: "Emergency to OT Time — Trauma (mins)", unit: "mins",    nabh: 60,   direction: "lower",  source: "NABH COP.3" },
    ],
  },
  {
    category: "Hospital Acquired Infections (HAI) — per 1000 device-days",
    indicators: [
      { code: "CLABSI",     name: "CLABSI Rate",          unit: "/1000 CL days",   nabh: 1.5,  direction: "lower",  source: "NABH HIC Benchmark 2023" },
      { code: "CAUTI",      name: "CAUTI Rate",            unit: "/1000 UC days",   nabh: 2.0,  direction: "lower",  source: "NABH HIC Benchmark 2023" },
      { code: "VAP",        name: "VAP Rate",              unit: "/1000 vent days", nabh: 2.5,  direction: "lower",  source: "NABH HIC Benchmark 2023" },
      { code: "SSI",        name: "SSI Rate",              unit: "/100 procedures", nabh: 2.0,  direction: "lower",  source: "NABH HIC Benchmark 2023" },
    ],
  },
  {
    category: "Medication Safety",
    indicators: [
      // Expressed per 1000 doses to match how it is measured (0.10% == 1.0/1000).
      { code: "MER",        name: "Medication Error Rate",              unit: "/1000 doses", nabh: 1.0, direction: "lower",  source: "NABH MOM Standard" },
      { code: "ADR",        name: "Adverse Drug Reaction Reporting Rate", unit: "/1000 patients", nabh: 5.0, direction: "higher", source: "PvPI National Target" },
    ],
  },
  {
    category: "Patient Safety",
    indicators: [
      { code: "FALLS",      name: "Patient Fall Rate",                  unit: "/1000 patient-days", nabh: 0.5, direction: "lower",  source: "NABH QPS Standard" },
      { code: "PRESSURE",   name: "Pressure Injury (new) Rate",        unit: "/1000 patient-days", nabh: 1.0, direction: "lower",  source: "NABH COP Standard" },
      { code: "READMIT30",  name: "30-Day Readmission Rate",            unit: "%",     nabh: 5.0,  direction: "lower",  source: "NABH QPS Benchmark 2023" },
    ],
  },
  {
    category: "Quality Compliance",
    indicators: [
      { code: "HH",         name: "Hand Hygiene Compliance",            unit: "%",     nabh: 80,   direction: "higher", source: "WHO / NABH HIC.9" },
      { code: "CAPA_TAT",   name: "CAPA Closure within 30 Days",        unit: "%",     nabh: 80,   direction: "higher", source: "NABH QPS Standard" },
      { code: "INCIDENT_RR", name: "Incident Reporting Rate",           unit: "/100 beds/month", nabh: 5.0, direction: "higher", source: "NABH Safety Culture" },
    ],
  },
  {
    category: "Patient Experience",
    indicators: [
      { code: "PREM",       name: "Patient Satisfaction Score (PREM)",  unit: "%",     nabh: 80,   direction: "higher", source: "NABH PRE Standard" },
      { code: "COMPLAINT_RES", name: "Complaint Resolution within 7 Days", unit: "%", nabh: 90, direction: "higher", source: "NABH PRE Standard" },
    ],
  },
];

// Benchmark code -> the indicator that measures it. Every one of these is now
// computed server-side by public.run_quality_indicator_collection(), so this tab
// no longer recomputes eight metrics its own (differently wrong) way. ERTOS and
// SSI in particular used to be hardcoded null.
const BENCHMARK_TO_INDICATOR: Record<string, string> = {
  ALOS:          "aac.ip_alos_days",
  BOR:           "aac.bed_occupancy_pct",
  DTR:           "aac.discharge_tat_hrs",
  ERTOS:         "cop.ertos_trauma_min",
  CLABSI:        "hic.clabsi_per1000",
  CAUTI:         "hic.cauti_per1000",
  VAP:           "hic.vap_per1000",
  SSI:           "hic.ssi_pct",
  MER:           "mom.med_error_per1000",
  ADR:           "mom.adr_per1000",
  FALLS:         "qps.fall_per1000",
  PRESSURE:      "cop.pressure_injury_per1000",
  READMIT30:     "aac.readmit_30d_pct",
  HH:            "hic.hand_hygiene_pct",
  CAPA_TAT:      "qps.capa_ontime_closure_pct",
  INCIDENT_RR:   "qps.incident_report_per100beds",
  PREM:          "pre.prem_satisfaction_pct",
  COMPLAINT_RES: "pre.complaint_resolved_7d_pct",
};

// Fetch live hospital data — one read of the persisted indicator set, matched by
// stable indicator_code. The previous version matched on indicator_name
// substrings and read a `current_value` column that does not exist, so every
// quality-indicator-derived benchmark here was always null.
async function fetchHospitalMetrics(hospitalId: string) {
  const { data } = await (supabase as any)
    .from("quality_indicators_current")
    .select("indicator_code, value")
    .eq("hospital_id", hospitalId);

  const byCode = new Map<string, number | null>(
    ((data as any[]) || []).map((r) => [r.indicator_code, r.value === null ? null : Number(r.value)]),
  );

  return Object.fromEntries(
    Object.entries(BENCHMARK_TO_INDICATOR).map(([benchmark, code]) => [
      benchmark,
      byCode.get(code) ?? null,
    ]),
  ) as Record<string, number | null>;
}

const TrafficLight: React.FC<{ value: number | null; benchmark: number; direction: "lower" | "higher"; unit: string }> = ({
  value, benchmark, direction, unit,
}) => {
  if (value === null) return <span className="text-xs text-muted-foreground italic">No data</span>;

  const isBetter = direction === "lower" ? value <= benchmark : value >= benchmark;
  const isClose  = direction === "lower"
    ? value <= benchmark * 1.1 && value > benchmark
    : value >= benchmark * 0.9 && value < benchmark;

  const cls = isBetter ? "text-emerald-600" : isClose ? "text-amber-600" : "text-red-600";
  const Icon = isBetter ? CheckCircle2 : isClose ? Minus : AlertTriangle;
  const status = isBetter ? "Better" : isClose ? "Close" : "Below";

  return (
    <div className="flex items-center gap-2">
      <Icon className={cn("h-4 w-4 shrink-0", cls)} />
      <div>
        <span className={cn("text-sm font-bold", cls)}>{value} <span className="text-[10px] font-normal">{unit}</span></span>
        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <span>Benchmark: {benchmark} {unit}</span>
          <span className={cn("font-medium", cls)}>· {status}</span>
          {!isBetter && !isClose && (
            direction === "lower"
              ? <TrendingDown className="h-3 w-3 text-red-500" />
              : <TrendingUp className="h-3 w-3 text-red-500" />
          )}
        </div>
      </div>
    </div>
  );
};

const NationalBenchmarkTab: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const [metrics, setMetrics] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!hospitalId) return;
    setLoading(true);
    fetchHospitalMetrics(hospitalId).then(m => { setMetrics(m); setLoading(false); });
  }, [hospitalId]);

  const overallScore = useMemo(() => {
    let better = 0, total = 0;
    for (const cat of BENCHMARKS) {
      for (const ind of cat.indicators) {
        const val = metrics[ind.code];
        if (val == null) continue;
        total++;
        const isBetter = ind.direction === "lower" ? val <= ind.nabh : val >= ind.nabh;
        if (isBetter) better++;
      }
    }
    return total > 0 ? { better, total, pct: Math.round((better / total) * 100) } : null;
  }, [metrics]);

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-amber-500" />
          <h2 className="text-base font-bold">National Benchmark Comparison</h2>
          <Badge variant="outline" className="text-[10px]">E2 — NABH Excellence</Badge>
        </div>
        {overallScore && (
          <div className={cn("border rounded-xl px-4 py-2 text-center",
            overallScore.pct >= 80 ? "border-emerald-200 bg-emerald-50" :
            overallScore.pct >= 60 ? "border-amber-200 bg-amber-50" :
            "border-red-200 bg-red-50"
          )}>
            <p className={cn("text-2xl font-black",
              overallScore.pct >= 80 ? "text-emerald-700" :
              overallScore.pct >= 60 ? "text-amber-700" : "text-red-700"
            )}>{overallScore.pct}%</p>
            <p className="text-[10px] text-muted-foreground">{overallScore.better}/{overallScore.total} indicators at/above benchmark</p>
          </div>
        )}
      </div>

      <div className="border border-blue-200 bg-blue-50/50 dark:bg-blue-950/20 rounded-lg p-3 flex items-start gap-2">
        <Info className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
        <p className="text-xs text-blue-700 dark:text-blue-400">
          Benchmarks sourced from NABH Annual Quality Report 2023, NHM Quality Standards, and WHO India.
          Hospital values are computed from the last 30 days of live data. "No data" means the indicator
          has not been recorded — set up data entry in the relevant module.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-20 justify-center">
          <div className="h-5 w-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span>Loading live hospital metrics…</span>
        </div>
      ) : (
        BENCHMARKS.map(cat => (
          <div key={cat.category} className="border border-border rounded-xl bg-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border bg-muted/30">
              <p className="text-xs font-semibold text-foreground">{cat.category}</p>
            </div>
            <div className="divide-y divide-border/50">
              {cat.indicators.map(ind => {
                const val = metrics[ind.code] ?? null;
                const isBetter = val != null && (ind.direction === "lower" ? val <= ind.nabh : val >= ind.nabh);
                return (
                  <div key={ind.code} className={cn("px-4 py-3 flex items-center gap-4",
                    val != null && !isBetter ? "bg-red-50/30 dark:bg-red-950/10" : ""
                  )}>
                    <div className="w-16 shrink-0">
                      <span className="text-[10px] font-mono font-bold text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {ind.code}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-foreground">{ind.name}</p>
                      <p className="text-[10px] text-muted-foreground">{ind.source}</p>
                    </div>
                    <div className="shrink-0 min-w-[200px] text-right">
                      <TrafficLight
                        value={val}
                        benchmark={ind.nabh}
                        direction={ind.direction as "lower" | "higher"}
                        unit={ind.unit}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}

      <p className="text-[10px] text-muted-foreground text-center pb-2">
        NABH Excellence E2 Standard — National Benchmark Comparison.
        Data refreshes on page load. Some indicators require manual entry in respective modules.
      </p>
    </div>
  );
};

export default NationalBenchmarkTab;
