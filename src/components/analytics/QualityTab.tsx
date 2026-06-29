import React from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import type { DateRange } from "@/hooks/useAnalyticsData";
import AnalyticsKPICard from "./AnalyticsKPICard";

async function getHospitalId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
  return data?.hospital_id || null;
}

function useQualityData(range: DateRange) {
  return useQuery({
    queryKey: ["analytics-quality", range],
    queryFn: async () => {
      const hospitalId = await getHospitalId();
      if (!hospitalId) return null;

      const [nabhRes, incidentRes, capaRes, qiRes, admRes] = await Promise.all([
        supabase.from("nabh_criteria").select("compliance_score, compliance_status").eq("hospital_id", hospitalId),
        supabase.from("incident_reports").select("id, severity, status").eq("hospital_id", hospitalId)
          .gte("incident_date", range.from).lte("incident_date", range.to),
        supabase.from("capa_records").select("id, status").eq("hospital_id", hospitalId)
          .in("status", ["open", "in_progress"]),
        supabase.from("quality_indicators").select("*").eq("hospital_id", hospitalId),
        supabase.from("admissions").select("id, admitted_at, discharged_at, status, patient_id")
          .eq("hospital_id", hospitalId).eq("status", "discharged")
          .gte("discharged_at", range.from).lte("discharged_at", range.to + "T23:59:59"),
      ]);

      const nabhData = nabhRes.data || [];
      const scores = nabhData.map(n => n.compliance_score).filter((s): s is number => s !== null);
      const avgNabh = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;

      const incidents = incidentRes.data || [];
      const sentinelCount = incidents.filter(i => i.severity === "sentinel").length;

      const qiData = qiRes.data || [];
      const haiIndicator = qiData.find(q => q.indicator_name?.toLowerCase().includes("hai"));
      const hhIndicator = qiData.find(q => q.indicator_name?.toLowerCase().includes("hand hygiene"));

      const discharges = admRes.data || [];
      let avgDischargeTat = 0;
      const tats = discharges
        .filter(a => a.admitted_at && a.discharged_at)
        .map(a => (new Date(a.discharged_at!).getTime() - new Date(a.admitted_at!).getTime()) / 3600000);
      if (tats.length > 0) avgDischargeTat = Math.round((tats.reduce((a, b) => a + b, 0) / tats.length) * 10) / 10;

      // Readmission rate (simplified: patients admitted again within 30 days)
      const patientIds = discharges.map(a => a.patient_id);
      const uniquePatients = new Set(patientIds);
      const readmitted = patientIds.length - uniquePatients.size;
      const readmissionRate = discharges.length > 0 ? Math.round((readmitted / discharges.length) * 1000) / 10 : 0;

      return {
        avgNabh,
        nabhTotal: nabhData.length,
        incidentCount: incidents.length,
        sentinelCount,
        capaOpen: capaRes.data?.length || 0,
        haiRate: haiIndicator?.value ?? null,
        handHygiene: hhIndicator?.value ?? null,
        avgDischargeTat,
        readmissionRate,
        indicators: qiData,
      };
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

function getNabhColor(score: number) {
  if (score >= 80) return "text-emerald-600";
  if (score >= 60) return "text-amber-500";
  return "text-destructive";
}

function getStatusPill(value: number | null, target: number | null) {
  if (value === null || target === null) return { label: "N/A", className: "bg-muted text-muted-foreground" };
  const ratio = value / target;
  if (ratio >= 1) return { label: "✅ Met", className: "bg-emerald-100 text-emerald-700" };
  if (ratio >= 0.9) return { label: "⚠️ Near", className: "bg-amber-100 text-amber-700" };
  return { label: "❌ Below", className: "bg-red-100 text-destructive" };
}

const QualityTab: React.FC<{ range: DateRange }> = ({ range }) => {
  const { data, isLoading } = useQualityData(range);

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Loading quality data…</div>;
  if (!data) return <div className="p-6 text-muted-foreground text-sm">No data available.</div>;

  return (
    <div className="p-5 space-y-4">
      {/* KPI Cards Row */}
      <div className="grid grid-cols-5 gap-3">
        {/* NABH Compliance */}
        <div className="bg-card border border-border rounded-xl p-4">
          <p className="text-[11px] text-muted-foreground mb-2">NABH Compliance Score</p>
          <div className="flex items-center gap-3">
            <div className="relative w-16 h-16">
              <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                <circle cx="18" cy="18" r="14" fill="none" stroke="hsl(var(--muted))" strokeWidth="3" />
                <circle cx="18" cy="18" r="14" fill="none"
                  stroke={data.avgNabh >= 80 ? "hsl(142, 71%, 45%)" : data.avgNabh >= 60 ? "hsl(45, 93%, 47%)" : "hsl(0, 84%, 60%)"}
                  strokeWidth="3" strokeDasharray={`${data.avgNabh * 0.88} 88`} strokeLinecap="round" />
              </svg>
              <span className={cn("absolute inset-0 flex items-center justify-center text-sm font-bold", getNabhColor(data.avgNabh))}>
                {data.avgNabh}%
              </span>
            </div>
            <div>
              <p className="text-[11px] text-muted-foreground">Target: 80%</p>
              <p className="text-[11px] text-muted-foreground">{data.nabhTotal} criteria</p>
            </div>
          </div>
        </div>

        <AnalyticsKPICard icon="🛡️" iconBg="bg-red-50" label="Patient Safety"
          value={`${data.incidentCount} incidents`}
          subtitle={`Sentinel: ${data.sentinelCount} · CAPA open: ${data.capaOpen}`}
          subtitleColor={data.sentinelCount > 0 ? "text-destructive" : undefined}
        />
        <AnalyticsKPICard icon="🦠" iconBg="bg-orange-50" label="Infection Control"
          value={data.haiRate !== null ? `${data.haiRate}%` : "N/A"}
          subtitle={`Hand Hygiene: ${data.handHygiene !== null ? `${data.handHygiene}%` : "N/A"}`}
        />
        <AnalyticsKPICard icon="📋" iconBg="bg-blue-50" label="Clinical Quality"
          value={`${data.avgDischargeTat}h TAT`}
          subtitle={`Readmission: ${data.readmissionRate}%`}
        />
        <AnalyticsKPICard icon="⭐" iconBg="bg-yellow-50" label="Patient Satisfaction"
          value="N/A"
          subtitle="No survey data yet"
        />
      </div>

      {/* Indicator Grid */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-[13px] font-bold text-foreground mb-3">Quality Indicators</h3>
        {data.indicators.length === 0 ? (
          <p className="text-sm text-muted-foreground">No quality indicators configured.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {data.indicators.map(qi => {
              const status = getStatusPill(qi.value, qi.target);
              return (
                <div key={qi.id} className="border border-border rounded-lg p-3 flex flex-col gap-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] font-medium text-foreground truncate">{qi.indicator_name}</span>
                    <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full font-medium", status.className)}>{status.label}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-lg font-bold text-foreground">
                      {qi.value !== null ? qi.value : "—"}{qi.unit ? ` ${qi.unit}` : ""}
                    </span>
                    <span className="text-[11px] text-muted-foreground">target: {qi.target ?? "—"}{qi.unit ? ` ${qi.unit}` : ""}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground capitalize">{qi.category || "general"} · {qi.period || "—"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default QualityTab;
