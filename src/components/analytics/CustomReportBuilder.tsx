import React, { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Download, Calendar, Trash2, Loader2, Save } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import * as XLSX from "xlsx";
import type { DateRange } from "@/hooks/useAnalyticsData";
import ScheduleReportModal from "./ScheduleReportModal";

const DATA_SOURCES: Record<string, { label: string; metrics: string[] }> = {
  revenue: { label: "Revenue & Billing", metrics: ["Total Billed", "Total Collected", "Outstanding", "Bill Count", "Avg Bill Value"] },
  opd: { label: "OPD Visits", metrics: ["Patient Count", "Department-wise", "Doctor-wise"] },
  ipd: { label: "IPD Admissions", metrics: ["Admission Count", "Discharge Count", "Avg LOS", "Occupancy %"] },
  lab: { label: "Lab Orders", metrics: ["Test Count", "Pending", "Reported"] },
  pharmacy: { label: "Pharmacy Sales", metrics: ["Total Sales", "Retail Count", "IP Count"] },
  quality: { label: "Quality Indicators", metrics: ["Indicator Values", "Targets", "Compliance %"] },
};

const GROUP_BY_OPTIONS = ["Day", "Week", "Month", "Department", "Doctor"];
const CHART_TYPES = ["bar", "line", "pie", "table"] as const;
const CHART_COLORS = ["hsl(217,91%,60%)", "hsl(142,71%,45%)", "hsl(263,70%,50%)", "hsl(25,95%,53%)", "hsl(0,84%,60%)", "hsl(172,66%,50%)"];

interface SavedReport {
  id: string;
  name: string;
  source: string;
  groupBy: string;
  metrics: string[];
  chartType: string;
}

async function getHospitalId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
  return data?.hospital_id || null;
}

const CustomReportBuilder: React.FC<{ range: DateRange }> = ({ range }) => {
  const [name, setName] = useState("My Custom Report");
  const [source, setSource] = useState("revenue");
  const [groupBy, setGroupBy] = useState("Day");
  const [selectedMetrics, setSelectedMetrics] = useState<Set<string>>(new Set(["Total Collected"]));
  const [chartType, setChartType] = useState<typeof CHART_TYPES[number]>("bar");
  const [previewData, setPreviewData] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [savedReports, setSavedReports] = useState<SavedReport[]>(() => {
    try { return JSON.parse(localStorage.getItem("custom_reports") || "[]"); } catch { return []; }
  });

  const toggleMetric = (m: string) => {
    setSelectedMetrics(prev => {
      const next = new Set(prev);
      next.has(m) ? next.delete(m) : next.add(m);
      return next;
    });
  };

  const runQuery = useCallback(async () => {
    setLoading(true);
    try {
      const hospitalId = await getHospitalId();
      if (!hospitalId) throw new Error("No hospital");

      let result: any[] = [];

      if (source === "revenue") {
        const { data } = await supabase.from("bills")
          .select("bill_date, total_amount, paid_amount, balance_due")
          .eq("hospital_id", hospitalId)
          .gte("bill_date", range.from).lte("bill_date", range.to)
          .order("bill_date");

        const grouped: Record<string, { billed: number; collected: number; outstanding: number; count: number }> = {};
        (data || []).forEach(b => {
          const key = groupBy === "Month" ? b.bill_date.slice(0, 7) : b.bill_date;
          if (!grouped[key]) grouped[key] = { billed: 0, collected: 0, outstanding: 0, count: 0 };
          grouped[key].billed += Number(b.total_amount) || 0;
          grouped[key].collected += Number(b.paid_amount) || 0;
          grouped[key].outstanding += Number(b.balance_due) || 0;
          grouped[key].count++;
        });

        result = Object.entries(grouped).map(([date, v]) => ({
          name: date, "Total Billed": v.billed, "Total Collected": v.collected,
          Outstanding: v.outstanding, "Bill Count": v.count,
          "Avg Bill Value": v.count > 0 ? Math.round(v.billed / v.count) : 0,
        }));
      } else if (source === "opd") {
        const { data } = await supabase.from("opd_encounters")
          .select("created_at")
          .eq("hospital_id", hospitalId)
          .gte("created_at", range.from).lte("created_at", range.to + "T23:59:59");

        const grouped: Record<string, number> = {};
        (data || []).forEach(o => {
          const key = groupBy === "Month" ? o.created_at?.slice(0, 7) || "" : o.created_at?.split("T")[0] || "";
          grouped[key] = (grouped[key] || 0) + 1;
        });
        result = Object.entries(grouped).map(([date, count]) => ({ name: date, "Patient Count": count }));
      } else if (source === "ipd") {
        const { data } = await supabase.from("admissions")
          .select("admitted_at, discharged_at, status")
          .eq("hospital_id", hospitalId)
          .gte("admitted_at", range.from).lte("admitted_at", range.to + "T23:59:59");

        const admissions = data || [];
        const discharges = admissions.filter(a => a.status === "discharged");
        result = [{
          name: "Period Total",
          "Admission Count": admissions.length,
          "Discharge Count": discharges.length,
          "Avg LOS": discharges.length > 0
            ? Math.round(discharges.filter(a => a.admitted_at && a.discharged_at)
              .reduce((s, a) => s + (new Date(a.discharged_at!).getTime() - new Date(a.admitted_at!).getTime()) / 86400000, 0) / discharges.length * 10) / 10
            : 0,
        }];
      } else if (source === "lab") {
        const { data } = await supabase.from("lab_order_items")
          .select("status, created_at, hospital_id")
          .eq("hospital_id", hospitalId)
          .gte("created_at", range.from)
          .lte("created_at", range.to + "T23:59:59");

        const grouped: Record<string, { total: number; pending: number; reported: number }> = {};
        (data || []).forEach(item => {
          const key = groupBy === "Month" ? (item.created_at?.slice(0, 7) || "") : (item.created_at?.split("T")[0] || "");
          if (!grouped[key]) grouped[key] = { total: 0, pending: 0, reported: 0 };
          grouped[key].total++;
          if (["ordered", "sample_collected", "in_process"].includes(item.status)) grouped[key].pending++;
          if (item.status === "completed") grouped[key].reported++;
        });
        result = Object.entries(grouped).map(([date, v]) => ({
          name: date, "Test Count": v.total, Pending: v.pending, Reported: v.reported,
        }));
      } else if (source === "pharmacy") {
        const { data } = await supabase.from("bills")
          .select("bill_date, total_amount, bill_type")
          .eq("hospital_id", hospitalId)
          .eq("bill_type", "pharmacy")
          .gte("bill_date", range.from)
          .lte("bill_date", range.to)
          .order("bill_date");

        const grouped: Record<string, { sales: number; retail: number; ip: number }> = {};
        (data || []).forEach(b => {
          const key = groupBy === "Month" ? b.bill_date.slice(0, 7) : b.bill_date;
          if (!grouped[key]) grouped[key] = { sales: 0, retail: 0, ip: 0 };
          grouped[key].sales += Number(b.total_amount) || 0;
          grouped[key].retail++;
        });
        result = Object.entries(grouped).map(([date, v]) => ({
          name: date, "Total Sales": v.sales, "Retail Count": v.retail, "IP Count": v.ip,
        }));
      } else if (source === "quality") {
        const { data } = await supabase.from("quality_indicators")
          .select("indicator_name, value, target, unit, category")
          .eq("hospital_id", hospitalId);

        result = (data || []).map(q => ({
          name: q.indicator_name,
          "Indicator Values": q.value,
          Targets: q.target,
          "Compliance %": q.target && q.value ? Math.round((q.value / q.target) * 100) : 0,
        }));
      }

      setPreviewData(result.sort((a, b) => (a.name || "").localeCompare(b.name || "")));
    } catch (e: any) {
      toast.error(e.message || "Query failed");
    } finally {
      setLoading(false);
    }
  }, [source, range, groupBy]);

  const saveReport = () => {
    const report: SavedReport = {
      id: Date.now().toString(),
      name, source, groupBy, metrics: [...selectedMetrics], chartType,
    };
    const updated = [...savedReports, report];
    setSavedReports(updated);
    localStorage.setItem("custom_reports", JSON.stringify(updated));
    toast.success("Report saved ✓");
  };

  const deleteReport = (id: string) => {
    const updated = savedReports.filter(r => r.id !== id);
    setSavedReports(updated);
    localStorage.setItem("custom_reports", JSON.stringify(updated));
  };

  const loadReport = (r: SavedReport) => {
    setName(r.name);
    setSource(r.source);
    setGroupBy(r.groupBy);
    setSelectedMetrics(new Set(r.metrics));
    setChartType(r.chartType as any);
  };

  const exportPreview = () => {
    if (!previewData?.length) return;
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(previewData);
    XLSX.utils.book_append_sheet(wb, ws, "Report");
    XLSX.writeFile(wb, `${name.replace(/\s+/g, "_")}.xlsx`);
    toast.success("Report exported ✓");
  };

  const metrics = DATA_SOURCES[source]?.metrics || [];
  const activeMetrics = metrics.filter(m => selectedMetrics.has(m));

  return (
    <div className="flex h-full min-h-0">
      {/* LEFT — Config */}
      <div className="w-[320px] flex-shrink-0 border-r border-border bg-card overflow-y-auto p-4 space-y-4">
        <h2 className="text-sm font-bold text-foreground">Build Custom Report</h2>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase">Report Name</label>
          <Input value={name} onChange={e => setName(e.target.value)} className="text-[13px]" />
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase">Data Source</label>
          <Select value={source} onValueChange={v => { setSource(v); setSelectedMetrics(new Set([DATA_SOURCES[v]?.metrics[0] || ""])); }}>
            <SelectTrigger className="text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(DATA_SOURCES).map(([k, v]) => (
                <SelectItem key={k} value={k}>{v.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase">Date Range</label>
          <p className="text-[12px] text-foreground">{range.from} → {range.to}</p>
        </div>

        <div className="space-y-1">
          <label className="text-[11px] font-medium text-muted-foreground uppercase">Group By</label>
          <Select value={groupBy} onValueChange={setGroupBy}>
            <SelectTrigger className="text-[13px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              {GROUP_BY_OPTIONS.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase">Metrics</label>
          <div className="flex flex-wrap gap-1.5">
            {metrics.map(m => (
              <button key={m} onClick={() => toggleMetric(m)}
                className={cn("px-2.5 py-1 rounded-full text-[11px] font-medium border transition-colors",
                  selectedMetrics.has(m) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-accent"
                )}>
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-medium text-muted-foreground uppercase">Chart Type</label>
          <div className="flex gap-1.5">
            {(["bar", "line", "pie", "table"] as const).map(t => (
              <button key={t} onClick={() => setChartType(t)}
                className={cn("flex-1 py-1.5 rounded-lg text-[11px] font-medium border transition-colors capitalize",
                  chartType === t ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"
                )}>
                {t === "table" ? "Table" : `${t.charAt(0).toUpperCase() + t.slice(1)} Chart`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={runQuery} disabled={loading} className="flex-1 gap-1.5 text-[12px]">
            {loading ? <Loader2 size={12} className="animate-spin" /> : null}
            Preview Report
          </Button>
          <Button onClick={saveReport} variant="outline" size="icon" className="h-9 w-9"><Save size={14} /></Button>
        </div>

        {savedReports.length > 0 && (
          <div className="space-y-2 pt-2 border-t border-border">
            <h3 className="text-[11px] font-bold text-muted-foreground uppercase">Saved Reports</h3>
            {savedReports.map(r => (
              <div key={r.id} className="flex items-center justify-between text-[12px] py-1.5 px-2 rounded-lg hover:bg-muted cursor-pointer" onClick={() => loadReport(r)}>
                <span className="text-foreground font-medium truncate">{r.name}</span>
                <button onClick={e => { e.stopPropagation(); deleteReport(r.id); }} className="text-muted-foreground hover:text-destructive">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* RIGHT — Preview */}
      <div className="flex-1 overflow-y-auto p-5">
        {!previewData ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            Configure report on the left and click "Preview Report"
          </div>
        ) : previewData.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No data found for the selected criteria
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-foreground">{name}</h3>
                <p className="text-[12px] text-muted-foreground">{range.from} → {range.to}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="text-[11px] gap-1.5" onClick={exportPreview}>
                  <Download size={12} /> Export
                </Button>
                <Button size="sm" variant="outline" className="text-[11px] gap-1.5" onClick={() => setScheduleOpen(true)}>
                  <Calendar size={12} /> Schedule
                </Button>
              </div>
            </div>

            {/* Chart */}
            {chartType !== "table" && (
              <div className="bg-card border border-border rounded-xl p-4" style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === "bar" ? (
                    <BarChart data={previewData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      {activeMetrics.map((m, i) => (
                        <Bar key={m} dataKey={m} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
                      ))}
                    </BarChart>
                  ) : chartType === "line" ? (
                    <LineChart data={previewData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      {activeMetrics.map((m, i) => (
                        <Line key={m} dataKey={m} stroke={CHART_COLORS[i % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                      ))}
                    </LineChart>
                  ) : (
                    <PieChart>
                      <Pie data={previewData.slice(0, 8)} dataKey={activeMetrics[0] || "value"} nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={50} label={{ fontSize: 11 }}>
                        {previewData.slice(0, 8).map((_, i) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                    </PieChart>
                  )}
                </ResponsiveContainer>
              </div>
            )}

            {/* Data Table */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-muted/50">
                      {Object.keys(previewData[0] || {}).map(k => (
                        <th key={k} className="text-left px-3 py-2 font-semibold text-foreground border-b border-border">{k}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewData.map((row, i) => (
                      <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
                        {Object.values(row).map((v: any, j) => (
                          <td key={j} className="px-3 py-1.5 text-foreground">
                            {typeof v === "number" ? v.toLocaleString("en-IN") : String(v ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      <ScheduleReportModal
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
        reportName={name}
      />
    </div>
  );
};

export default CustomReportBuilder;
