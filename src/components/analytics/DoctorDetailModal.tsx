import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { useDoctorRevenueByCategory, type DoctorScore } from "@/hooks/useDoctorDeptData";
import type { DateRange } from "@/hooks/useAnalyticsData";
import { Skeleton } from "@/components/ui/skeleton";
import { formatINRExact } from "@/lib/currency";

const fmt = formatINRExact;

const COLORS = ["hsl(var(--primary))", "hsl(217, 60%, 60%)", "hsl(142, 50%, 45%)", "hsl(38, 90%, 55%)"];

interface Props {
  doc: DoctorScore | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  range: DateRange;
}

const DoctorDetailModal: React.FC<Props> = ({ doc, open, onOpenChange, range }) => {
  const { data: revenueByCategory, isLoading: categoryLoading } = useDoctorRevenueByCategory(doc?.id ?? null, range);
  if (!doc) return null;

  const initials = doc.full_name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();

  const activityData = [
    { name: "OPD Visits", value: doc.opdCount },
    { name: "IPD Admits", value: doc.ipdCount },
    { name: "OT Cases", value: doc.otCases },
  ];

  const pieData = activityData.filter(d => d.value > 0);
  const totalPatients = doc.opdCount + doc.ipdCount;

  const kpis = [
    { label: "Total Revenue", value: fmt(doc.revenue), color: "text-emerald-600" },
    { label: "OPD Visits", value: String(doc.opdCount), color: "text-foreground" },
    { label: "IPD Admits", value: String(doc.ipdCount), color: "text-foreground" },
    { label: "OT Cases", value: String(doc.otCases), color: "text-foreground" },
    { label: "Avg LOS", value: doc.avgLOS ? `${doc.avgLOS} days` : "—", color: "text-foreground" },
    { label: "Avg Rev/Patient", value: totalPatients > 0 ? fmt(Math.round(doc.revenue / totalPatients)) : "—", color: "text-foreground" },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <Avatar className="h-12 w-12">
              <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <DialogTitle className="text-base">{doc.full_name}</DialogTitle>
              <DialogDescription className="text-xs">{doc.department_name}</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* KPI Grid */}
        <div className="grid grid-cols-3 gap-3 mt-2">
          {kpis.map(k => (
            <div key={k.label} className="bg-muted/50 rounded-lg p-3 text-center">
              <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
              <p className="text-[10px] text-muted-foreground">{k.label}</p>
            </div>
          ))}
        </div>

        {/* Activity Breakdown Bar Chart */}
        <div className="bg-card border border-border rounded-xl p-4 mt-3">
          <h4 className="text-sm font-semibold text-foreground mb-3">Activity Breakdown</h4>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={activityData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip />
              <Bar dataKey="value" name="Count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Patient Mix Pie */}
        {pieData.length > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 mt-3">
            <h4 className="text-sm font-semibold text-foreground mb-3">Patient Mix</h4>
            <div className="flex items-center justify-center gap-6">
              <ResponsiveContainer width={160} height={160}>
                <PieChart>
                  <Pie data={pieData} cx="50%" cy="50%" innerRadius={40} outerRadius={65} dataKey="value" paddingAngle={3}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <div className="space-y-2">
                {pieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-2 text-xs">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                    <span className="text-muted-foreground">{d.name}</span>
                    <span className="font-semibold text-foreground">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Revenue by Category (Billed) — bill_line_items grouped by category. Distinct from
            the collected-₹ "Total Revenue" KPI above since payments aren't itemized. */}
        <div className="bg-card border border-border rounded-xl p-4 mt-3">
          <h4 className="text-sm font-semibold text-foreground mb-3">Revenue by Category (Billed)</h4>
          {categoryLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : revenueByCategory && revenueByCategory.length > 0 ? (
            <div className="flex items-center gap-6">
              <ResponsiveContainer width={140} height={140}>
                <PieChart>
                  <Pie data={revenueByCategory} cx="50%" cy="50%" innerRadius={35} outerRadius={55} dataKey="value" paddingAngle={2}>
                    {revenueByCategory.map((entry, i) => (
                      <Cell key={i} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex-1 space-y-1.5">
                {revenueByCategory.map(item => (
                  <div key={item.name} className="flex items-center gap-2 text-[11px]">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: item.fill }} />
                    <span className="flex-1 text-muted-foreground">{item.name}</span>
                    <span className="font-medium text-foreground">{fmt(item.value)}</span>
                    <span className="text-muted-foreground">{item.pct}%</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-8">No billed line items for this period</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DoctorDetailModal;
