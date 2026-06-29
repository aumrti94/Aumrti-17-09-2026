import React from "react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import AnalyticsKPICard from "./AnalyticsKPICard";
import {
  useClinicalKPIs, useOPDTrend, useBedOccupancyBreakdown, useTopDiagnoses,
  useDischargeTAT,
  type DateRange,
} from "@/hooks/useAnalyticsData";
import { Skeleton } from "@/components/ui/skeleton";

const ClinicalTab: React.FC<{ range: DateRange }> = ({ range }) => {
  const { data: kpis, isLoading } = useClinicalKPIs(range);
  const { data: opdTrend } = useOPDTrend(range);
  const { data: bedData } = useBedOccupancyBreakdown();
  const { data: diagnoses } = useTopDiagnoses(range);
  const { data: tatData } = useDischargeTAT(range);

  if (isLoading) return <div className="p-5 space-y-4">{[1,2,3].map(i => <Skeleton key={i} className="h-28 w-full" />)}</div>;

  const k = kpis || { opdVisits: 0, opdDailyAvg: 0, admissions: 0, bedOccupancy: 0, occupiedBeds: 0, totalBeds: 0, labTests: 0, emergencyCases: 0, emergencyP1: 0 };
  const tat = tatData || { entries: [], avgHours: 0, distribution: [], totalDischarges: 0 };

  const occColor = k.bedOccupancy > 80 ? "text-emerald-500" : k.bedOccupancy >= 60 ? "text-amber-500" : "text-red-500";

  return (
    <div className="p-5 space-y-4 overflow-y-auto">
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <AnalyticsKPICard icon="🏥" iconBg="bg-blue-100" value={`${k.opdVisits} visits`} label="OPD Visits" subtitle={`Daily avg: ${k.opdDailyAvg}`} />
        <AnalyticsKPICard icon="🛏️" iconBg="bg-purple-100" value={`${k.admissions}`} label="IPD Admissions" />
        <AnalyticsKPICard icon="📊" iconBg="bg-teal-100" value={`${k.bedOccupancy}%`} valueColor={occColor} label="Bed Occupancy" subtitle={`Occupied: ${k.occupiedBeds} / ${k.totalBeds}`} />
        <AnalyticsKPICard icon="🔬" iconBg="bg-green-100" value={`${k.labTests} tests`} label="Lab Processed" />
        <AnalyticsKPICard icon="🚨" iconBg="bg-red-100" value={`${k.emergencyCases} cases`} label="Emergency" subtitle={`P1 Critical: ${k.emergencyP1}`} subtitleColor="text-red-500" />
        <AnalyticsKPICard icon="⏱️" iconBg="bg-orange-100" value={`${tat.avgHours}h`} label="Avg Discharge TAT" subtitle={`${tat.totalDischarges} discharges`} />
      </div>

      {/* OPD Trend + Bed Occupancy */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">OPD & Emergency Visits</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={opdTrend || []}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={d => d.slice(5)} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="opd" name="OPD" fill="hsl(217, 91%, 60%)" radius={[3, 3, 0, 0]} />
              <Bar dataKey="ed" name="Emergency" fill="hsl(0, 84%, 60%)" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-card border border-border rounded-xl p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">Bed Occupancy</h3>
          <div className="flex gap-4 items-center">
            <ResponsiveContainer width={140} height={140}>
              <PieChart>
                <Pie data={bedData?.segments || []} dataKey="value" cx="50%" cy="50%" innerRadius={35} outerRadius={55} paddingAngle={2}>
                  {(bedData?.segments || []).map((s, i) => <Cell key={i} fill={s.fill} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="flex-1 space-y-2">
              <div className={`text-2xl font-bold ${occColor}`}>{k.bedOccupancy}%</div>
              {(bedData?.wards || []).map(w => (
                <div key={w.name} className="flex justify-between text-[11px]">
                  <span className="text-muted-foreground">{w.name}</span>
                  <span className="font-medium text-foreground">{w.occupied}/{w.total}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Discharge TAT Distribution */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Discharge TAT Distribution</h3>
        {tat.distribution.length > 0 ? (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={tat.distribution}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="bucket" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} />
              <Tooltip />
              <Bar dataKey="count" name="Discharges" fill="hsl(25, 95%, 53%)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-sm text-muted-foreground py-8 text-center">No discharge data for this period</p>
        )}
      </div>

      {/* Top Diagnoses */}
      <div className="bg-card border border-border rounded-xl p-4">
        <h3 className="text-sm font-semibold text-foreground mb-3">Top 10 Diagnoses</h3>
        <ResponsiveContainer width="100%" height={Math.max(200, (diagnoses?.length || 0) * 28)}>
          <BarChart data={diagnoses || []} layout="vertical">
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis type="number" tick={{ fontSize: 10 }} />
            <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={150} />
            <Tooltip />
            <Bar dataKey="count" name="Cases" fill="hsl(217, 60%, 50%)" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default ClinicalTab;
