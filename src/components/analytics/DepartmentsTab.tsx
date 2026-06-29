import React, { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Maximize2 } from "lucide-react";
import { useDeptPerformance, useDeptDoctors, useDeptTopServices } from "@/hooks/useDoctorDeptData";
import AnalyticsKPICard from "./AnalyticsKPICard";
import DepartmentDetailModal from "./DepartmentDetailModal";
import type { DateRange } from "@/hooks/useAnalyticsData";

const fmt = (n: number) => {
  if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
  return `₹${n.toLocaleString("en-IN")}`;
};

const DepartmentsTab: React.FC<{ range: DateRange }> = ({ range }) => {
  const { data: depts, isLoading } = useDeptPerformance(range);
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(null);
  const [drillDeptId, setDrillDeptId] = useState<string | null>(null);
  const { data: deptDoctors } = useDeptDoctors(selectedDeptId, range);
  const { data: topServices } = useDeptTopServices(selectedDeptId, range);

  const selectedDept = depts?.find(d => d.id === selectedDeptId);
  const maxRevenue = Math.max(1, ...(depts || []).map(d => d.revenue));
  const totalRevenue = (depts || []).reduce((s, d) => s + d.revenue, 0);

  if (isLoading) return <div className="p-5 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full" />)}</div>;

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left — Department List */}
      <div className="w-[360px] flex-shrink-0 border-r border-border bg-card overflow-y-auto">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold text-foreground">Department Performance</h3>
          <p className="text-[10px] text-muted-foreground mt-0.5">{depts?.length || 0} departments</p>
        </div>

        <div className="divide-y divide-border/50">
          {(depts || []).map(dept => (
            <div
              key={dept.id}
              className={cn(
                "px-4 py-3 transition-colors",
                selectedDeptId === dept.id
                  ? "bg-primary/5 border-l-2 border-primary"
                  : "hover:bg-muted/50 border-l-2 border-transparent"
              )}
            >
              <button onClick={() => setSelectedDeptId(dept.id)} className="w-full text-left">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[13px] font-semibold text-foreground">{dept.name}</span>
                  <span className="text-[10px] text-muted-foreground">{dept.doctorCount} doctors</span>
                </div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[13px] font-bold text-foreground">{fmt(dept.revenue)}</span>
                  <span className="text-[10px] text-muted-foreground">
                    {dept.opdCount} OPD · {dept.ipdCount} IPD
                  </span>
                </div>
                <div className="h-1 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary/60 rounded-full"
                    style={{ width: `${Math.round((dept.revenue / maxRevenue) * 100)}%` }}
                  />
                </div>
                <p className="text-[9px] text-muted-foreground mt-1">{dept.revenueShare}% of total revenue</p>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); setDrillDeptId(dept.id); }}
                className="mt-2 text-[10px] font-medium text-primary hover:underline inline-flex items-center gap-1"
              >
                <Maximize2 size={10} /> View Drill-Down
              </button>
            </div>
          ))}
        </div>
      </div>

      <DepartmentDetailModal
        open={!!drillDeptId}
        onOpenChange={(v) => !v && setDrillDeptId(null)}
        deptId={drillDeptId}
        deptName={depts?.find(d => d.id === drillDeptId)?.name || ""}
      />

      {/* Right — Department Detail */}
      <div className="flex-1 overflow-y-auto">
        {!selectedDept ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Select a department from the list
          </div>
        ) : (
          <div className="p-5 space-y-4">
            {/* Dept Header */}
            <div>
              <h2 className="text-lg font-bold text-foreground">{selectedDept.name}</h2>
              <p className="text-xs text-muted-foreground">
                {selectedDept.doctorCount} doctors · {selectedDept.opdCount} OPD visits · {selectedDept.ipdCount} IPD admits
              </p>
            </div>

            {/* KPI Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <AnalyticsKPICard icon="💰" iconBg="bg-emerald-100" value={fmt(selectedDept.revenue)} label="Revenue This Period" />
              <AnalyticsKPICard icon="📊" iconBg="bg-blue-100" value={`${selectedDept.revenueShare}%`} label="% of Hospital Revenue" />
              <AnalyticsKPICard icon="👤" iconBg="bg-purple-100"
                value={selectedDept.opdCount > 0 ? fmt(Math.round(selectedDept.revenue / (selectedDept.opdCount + selectedDept.ipdCount))) : "₹0"}
                label="Avg Revenue / Patient" />
              <AnalyticsKPICard icon="🏥" iconBg="bg-amber-100"
                value={`${selectedDept.opdCount + selectedDept.ipdCount}`}
                label="Total Patients" />
            </div>

            {/* Top Services Chart */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-sm font-semibold text-foreground mb-3">Top Services</h3>
              {topServices && topServices.length > 0 ? (
                <ResponsiveContainer width="100%" height={Math.max(150, topServices.length * 28)}>
                  <BarChart data={topServices} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={v => fmt(v)} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Bar dataKey="total" name="Revenue" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-8">No service data available for this period</p>
              )}
            </div>

            {/* Doctor Contribution Table */}
            {deptDoctors && deptDoctors.length > 0 && (
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border">
                  <h3 className="text-sm font-semibold text-foreground">Doctor Contribution</h3>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Doctor</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">OPD</th>
                      <th className="text-right px-3 py-2 font-medium text-muted-foreground">Revenue</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Share %</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deptDoctors.map(doc => (
                      <tr key={doc.name} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="px-4 py-2 font-medium text-foreground">{doc.name}</td>
                        <td className="px-3 py-2 text-right">{doc.opd}</td>
                        <td className="px-3 py-2 text-right font-semibold text-emerald-600">{fmt(doc.revenue)}</td>
                        <td className="px-4 py-2 text-right text-muted-foreground">{doc.share}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DepartmentsTab;
