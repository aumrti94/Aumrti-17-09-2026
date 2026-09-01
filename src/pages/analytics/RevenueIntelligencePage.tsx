import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatCurrency, formatINRCompact } from "@/lib/currency";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subMonths, differenceInDays } from "date-fns";

const COLORS = ["#1A2F5A","#3b82f6","#10b981","#f59e0b","#ef4444","#8b5cf6","#06b6d4"];

export default function RevenueIntelligencePage() {
  const { hospitalId } = useHospitalId();
  const [period, setPeriod] = useState("6");
  const [activeTab, setActiveTab] = useState("service");
  const [loading, setLoading] = useState(true);

  const [serviceData, setServiceData]       = useState<any[]>([]);
  const [payorMix, setPayorMix]             = useState<any[]>([]);
  const [revenueTrend, setRevenueTrend]     = useState<any[]>([]);
  const [kpi, setKpi] = useState({ totalRev: 0, avgLOS: 0, occupancy: 0, arDays: 0 });
  const [loadError, setLoadError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    setLoadError(null);
    const months = parseInt(period);
    const from = format(subMonths(new Date(), months), "yyyy-MM-dd");
    const periodDays = Math.max(1, differenceInDays(new Date(), subMonths(new Date(), months)));

    const [billsRes, admRes, occupiedBedsRes, activeBedsRes] = await Promise.all([
      // NOTE: bills has no net_amount / payer_type columns. Billed value is
      // total_amount, collections are paid_amount, and payer comes off the
      // linked admission (same embed BillingPage uses).
      (supabase as any).from("bills")
        .select("bill_type, bill_date, payment_status, total_amount, paid_amount, balance_due, admission:admissions(payer_type)")
        .eq("hospital_id", hospitalId)
        .neq("bill_status", "cancelled")
        .gte("bill_date", from),
      (supabase as any).from("admissions").select("admitted_at, discharged_at")
        .eq("hospital_id", hospitalId).gte("admitted_at", from),
      (supabase as any).from("beds").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("is_active", true).eq("status", "occupied"),
      (supabase as any).from("beds").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId).eq("is_active", true),
    ]);

    const firstErr = billsRes.error || admRes.error || occupiedBedsRes.error || activeBedsRes.error;
    if (firstErr) {
      console.error("[RevenueIntelligence] query failed", firstErr);
      setLoadError(firstErr.message || "Failed to load revenue data.");
      setLoading(false);
      return;
    }

    const bills = billsRes.data || [];
    const admissions = admRes.data || [];
    const billed = (b: any) => Number(b.total_amount || 0);

    // Service line revenue (billed)
    const serviceMap: Record<string, number> = {};
    bills.forEach((b: any) => {
      const t = b.bill_type || "other";
      serviceMap[t] = (serviceMap[t] || 0) + billed(b);
    });
    setServiceData(
      Object.entries(serviceMap)
        .filter(([, revenue]) => revenue > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([name, revenue]) => ({ name: name.toUpperCase(), revenue }))
    );

    // Payor mix — payer_type lives on the admission; OPD/walk-in bills are self pay
    const payorMap: Record<string, number> = {};
    bills.forEach((b: any) => {
      const p = b.admission?.payer_type || "self_pay";
      payorMap[p] = (payorMap[p] || 0) + billed(b);
    });
    const totalBillRev = Object.values(payorMap).reduce((s, v) => s + v, 0);
    setPayorMix(
      Object.entries(payorMap)
        .filter(([, value]) => value > 0)
        .sort(([, a], [, b]) => b - a)
        .map(([name, value]) => ({ name: name.replace(/_/g, " ").toUpperCase(), value, pct: totalBillRev ? Math.round(value / totalBillRev * 100) : 0 }))
    );

    // Monthly revenue trend (billed), oldest month first
    const monthMap: Record<string, { label: string; revenue: number }> = {};
    bills.forEach((b: any) => {
      if (!b.bill_date) return;
      const d = new Date(b.bill_date);
      if (isNaN(d.getTime())) return;
      const key = format(d, "yyyy-MM");
      if (!monthMap[key]) monthMap[key] = { label: format(d, "MMM yy"), revenue: 0 };
      monthMap[key].revenue += billed(b);
    });
    setRevenueTrend(
      Object.keys(monthMap).sort().map(k => ({ month: monthMap[k].label, revenue: monthMap[k].revenue }))
    );

    // KPIs — collections, per metrics_registry analytics.revenue.total_collection
    const totalRev = bills.reduce((s: number, b: any) => s + Number(b.paid_amount || 0), 0);

    const discharged = admissions.filter((a: any) => a.discharged_at && a.admitted_at);
    const avgLOS = discharged.length > 0
      ? discharged.reduce((s: number, a: any) => s + Math.max(0, differenceInDays(new Date(a.discharged_at), new Date(a.admitted_at))), 0) / discharged.length
      : 0;

    // AR days = outstanding balance / average daily collections
    const outstanding = bills.reduce((s: number, b: any) => s + Number(b.balance_due || 0), 0);
    const dailyRev = totalRev / periodDays;
    const arDays = dailyRev > 0 ? Math.round(outstanding / dailyRev) : 0;

    const totalBeds = activeBedsRes.count || 0;
    const occupancy = totalBeds > 0 ? Math.round(((occupiedBedsRes.count || 0) / totalBeds) * 100) : 0;

    setKpi({ totalRev, avgLOS: parseFloat(avgLOS.toFixed(1)), occupancy, arDays });
    setLoading(false);
  }, [hospitalId, period]);

  useEffect(() => { fetchData(); }, [fetchData]);

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Revenue Intelligence</h1>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="h-8 w-36 text-[12px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="3">Last 3 months</SelectItem>
            <SelectItem value="6">Last 6 months</SelectItem>
            <SelectItem value="12">Last 12 months</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center"><Loader2 size={24} className="animate-spin text-muted-foreground" /></div>
      ) : loadError ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3">
          <p className="text-[13px] text-destructive">Could not load revenue data.</p>
          <p className="text-[11px] text-muted-foreground max-w-md text-center">{loadError}</p>
          <Button size="sm" variant="outline" className="h-8 text-[12px]" onClick={fetchData}>Retry</Button>
        </div>
      ) : (
        <>
          {/* KPI bar */}
          <div className="flex-shrink-0 grid grid-cols-4 gap-3 p-4 bg-muted/20 border-b border-border">
            {[
              { l: "Total Collections", v: formatCurrency(kpi.totalRev), c: "text-green-600" },
              { l: "Avg. Length of Stay", v: `${kpi.avgLOS} days`, c: "text-blue-600" },
              { l: "Bed Occupancy", v: `${kpi.occupancy}%`, c: "text-violet-600" },
              { l: "AR Days Outstanding", v: `${kpi.arDays} days`, c: kpi.arDays > 45 ? "text-red-600" : "text-foreground" },
            ].map(k => (
              <div key={k.l} className="bg-card border border-border rounded-xl p-3">
                <p className="text-[11px] text-muted-foreground">{k.l}</p>
                <p className={cn("text-[20px] font-bold mt-0.5", k.c)}>{k.v}</p>
              </div>
            ))}
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
            <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
              <TabsTrigger value="service" className="text-[13px]">Service Line P&L</TabsTrigger>
              <TabsTrigger value="payor" className="text-[13px]">Payor Mix</TabsTrigger>
              <TabsTrigger value="trend" className="text-[13px]">Revenue Trend</TabsTrigger>
            </TabsList>

            <TabsContent value="service" className="flex-1 overflow-auto p-5 m-0">
              <div className="max-w-2xl bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Billed Revenue by Service Line</p>
                {serviceData.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-8">No revenue data in this period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={serviceData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={formatINRCompact} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [formatCurrency(v), "Revenue"]} />
                      <Bar dataKey="revenue" fill="#1A2F5A" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </TabsContent>

            <TabsContent value="payor" className="flex-1 overflow-auto p-5 m-0">
              {payorMix.length === 0 ? (
                <div className="max-w-2xl bg-card border border-border rounded-xl p-4">
                  <p className="text-[12px] text-muted-foreground text-center py-8">No revenue data in this period.</p>
                </div>
              ) : (
              <div className="grid grid-cols-2 gap-5">
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-[13px] font-semibold text-foreground mb-3">Payor Mix Distribution</p>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie data={payorMix} cx="50%" cy="50%" outerRadius={90} dataKey="value"
                        label={({ name, pct }) => `${name} ${pct}%`} labelLine={false}>
                        {payorMix.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => [formatCurrency(v), "Revenue"]} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="bg-card border border-border rounded-xl p-4">
                  <p className="text-[13px] font-semibold text-foreground mb-3">Payor Breakdown</p>
                  <div className="space-y-2">
                    {payorMix.map((p, i) => (
                      <div key={p.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                          <p className="text-[12px] text-foreground">{p.name}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[12px] font-medium tabular-nums">{formatCurrency(p.value)}</p>
                          <p className="text-[10px] text-muted-foreground">{p.pct}%</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              )}
            </TabsContent>

            <TabsContent value="trend" className="flex-1 overflow-auto p-5 m-0">
              <div className="max-w-3xl bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Monthly Billed Revenue Trend</p>
                {revenueTrend.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-8">No data available.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenueTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={formatINRCompact} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [formatCurrency(v), "Revenue"]} />
                      <Line type="monotone" dataKey="revenue" stroke="#1A2F5A" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}
