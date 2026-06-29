import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatCurrency } from "@/lib/currency";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, DollarSign, Download, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, subMonths, startOfMonth, endOfMonth, differenceInDays } from "date-fns";

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

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const from = format(subMonths(new Date(), parseInt(period)), "yyyy-MM-dd");

    const [billsRes, admRes] = await Promise.all([
      (supabase as any).from("bills").select("bill_type, net_amount, payer_type, created_at, payment_status")
        .eq("hospital_id", hospitalId).gte("created_at", from),
      (supabase as any).from("admissions").select("admitted_at, discharged_at, payer_type")
        .eq("hospital_id", hospitalId).gte("admitted_at", from),
    ]);

    const bills = billsRes.data || [];
    const admissions = admRes.data || [];

    // Service line revenue
    const serviceMap: Record<string, number> = {};
    bills.forEach((b: any) => {
      const t = b.bill_type || "other";
      serviceMap[t] = (serviceMap[t] || 0) + Number(b.net_amount || 0);
    });
    setServiceData(
      Object.entries(serviceMap)
        .sort(([, a], [, b]) => b - a)
        .map(([name, revenue]) => ({ name: name.toUpperCase(), revenue }))
    );

    // Payor mix
    const payorMap: Record<string, number> = {};
    bills.forEach((b: any) => {
      const p = b.payer_type || "self_pay";
      payorMap[p] = (payorMap[p] || 0) + Number(b.net_amount || 0);
    });
    const totalBillRev = Object.values(payorMap).reduce((s, v) => s + v, 0);
    setPayorMix(
      Object.entries(payorMap)
        .sort(([, a], [, b]) => b - a)
        .map(([name, value]) => ({ name: name.replace(/_/g, " ").toUpperCase(), value, pct: totalBillRev ? Math.round(value / totalBillRev * 100) : 0 }))
    );

    // Monthly revenue trend
    const monthMap: Record<string, number> = {};
    bills.forEach((b: any) => {
      const mo = format(new Date(b.created_at), "MMM yy");
      monthMap[mo] = (monthMap[mo] || 0) + Number(b.net_amount || 0);
    });
    setRevenueTrend(Object.entries(monthMap).map(([month, revenue]) => ({ month, revenue })));

    // KPIs
    const totalRev = bills.filter((b: any) => b.payment_status === "paid")
      .reduce((s: number, b: any) => s + Number(b.net_amount || 0), 0);

    const discharged = admissions.filter((a: any) => a.discharged_at);
    const avgLOS = discharged.length > 0
      ? discharged.reduce((s: number, a: any) => s + differenceInDays(new Date(a.discharged_at), new Date(a.admitted_at)), 0) / discharged.length
      : 0;

    const unpaidAmt = bills.filter((b: any) => b.payment_status !== "paid")
      .reduce((s: number, b: any) => s + Number(b.net_amount || 0), 0);
    const arDays = totalRev > 0 ? Math.round(unpaidAmt / (totalRev / parseInt(period) / 30)) : 0;

    setKpi({ totalRev, avgLOS: parseFloat(avgLOS.toFixed(1)), occupancy: Math.min(Math.round(admissions.length / (parseInt(period) * 30 / 100) * 10), 100), arDays });
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
      ) : (
        <>
          {/* KPI bar */}
          <div className="flex-shrink-0 grid grid-cols-4 gap-3 p-4 bg-muted/20 border-b border-border">
            {[
              { l: "Total Revenue", v: formatCurrency(kpi.totalRev), c: "text-green-600" },
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
                <p className="text-[13px] font-semibold text-foreground mb-3">Revenue by Service Line</p>
                {serviceData.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-8">No revenue data in this period.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={serviceData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `₹${(v/1000).toFixed(0)}K`} tick={{ fontSize: 11 }} />
                      <Tooltip formatter={(v: number) => [formatCurrency(v), "Revenue"]} />
                      <Bar dataKey="revenue" fill="#1A2F5A" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </TabsContent>

            <TabsContent value="payor" className="flex-1 overflow-auto p-5 m-0">
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
            </TabsContent>

            <TabsContent value="trend" className="flex-1 overflow-auto p-5 m-0">
              <div className="max-w-3xl bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-3">Monthly Revenue Trend</p>
                {revenueTrend.length === 0 ? (
                  <p className="text-[12px] text-muted-foreground text-center py-8">No data available.</p>
                ) : (
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={revenueTrend}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis tickFormatter={v => `₹${(v/100000).toFixed(1)}L`} tick={{ fontSize: 11 }} />
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
