import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { differenceInDays } from "date-fns";
import { Phone, ExternalLink, IndianRupee, AlertTriangle, Clock, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

interface AgeingBucket {
  tpa: string;
  range0_30: number;
  range31_60: number;
  range61_90: number;
  range90plus: number;
  total: number;
  count: number;
}

const TPAAgeing: React.FC = () => {
  const [buckets, setBuckets] = useState<AgeingBucket[]>([]);
  const [loading, setLoading] = useState(true);
  const [settledThisMonth, setSettledThisMonth] = useState({ amount: 0, count: 0 });
  const { toast } = useToast();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [claimsRes, settledRes] = await Promise.all([
      supabase.from("insurance_claims")
        .select("tpa_name, claimed_amount, settled_amount, submitted_at, status")
        .in("status", ["submitted", "under_review", "approved", "partially_approved"]),
      supabase.from("insurance_claims")
        .select("settled_amount")
        .eq("status", "settled")
        .gte("settlement_date", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)),
    ]);

    const claims = claimsRes.data || [];
    const settled = settledRes.data || [];
    setSettledThisMonth({
      amount: settled.reduce((s, c) => s + Number(c.settled_amount || 0), 0),
      count: settled.length,
    });

    if (!claims.length) { setBuckets([]); setLoading(false); return; }

    const tpaMap: Record<string, AgeingBucket> = {};
    claims.forEach(c => {
      if (!tpaMap[c.tpa_name]) {
        tpaMap[c.tpa_name] = { tpa: c.tpa_name, range0_30: 0, range31_60: 0, range61_90: 0, range90plus: 0, total: 0, count: 0 };
      }
      const b = tpaMap[c.tpa_name];
      const days = c.submitted_at ? differenceInDays(new Date(), new Date(c.submitted_at)) : 0;
      const amt = Number(c.claimed_amount) - Number(c.settled_amount || 0);
      if (amt <= 0) return;
      b.total += amt;
      b.count += 1;
      if (days <= 30) b.range0_30 += amt;
      else if (days <= 60) b.range31_60 += amt;
      else if (days <= 90) b.range61_90 += amt;
      else b.range90plus += amt;
    });

    setBuckets(Object.values(tpaMap).sort((a, b) => b.total - a.total));
    setLoading(false);
  };

  const fmt = (n: number) => n > 0 ? `₹${(n / 100000).toFixed(1)}L` : "—";
  const fmtFull = (n: number) => `₹${n.toLocaleString("en-IN")}`;
  const totals = buckets.reduce((acc, b) => ({
    r0: acc.r0 + b.range0_30, r1: acc.r1 + b.range31_60, r2: acc.r2 + b.range61_90, r3: acc.r3 + b.range90plus, t: acc.t + b.total, c: acc.c + b.count
  }), { r0: 0, r1: 0, r2: 0, r3: 0, t: 0, c: 0 });

  const avgDays = buckets.length > 0 ? Math.round(
    buckets.reduce((sum, b) => {
      const weighted = (b.range0_30 > 0 ? 15 : 0) + (b.range31_60 > 0 ? 45 : 0) + (b.range61_90 > 0 ? 75 : 0) + (b.range90plus > 0 ? 120 : 0);
      const activeRanges = [b.range0_30, b.range31_60, b.range61_90, b.range90plus].filter(v => v > 0).length;
      return sum + (activeRanges > 0 ? weighted / activeRanges : 0);
    }, 0) / buckets.length
  ) : 0;

  const followUpTPA = (tpa: string, outstanding: number) => {
    const msg = encodeURIComponent(
      `Dear ${tpa} Team,\n\nHospital outstanding claims: ${fmtFull(outstanding)}\nPlease expedite settlement at the earliest.\n\nRegards`
    );
    window.open(`https://wa.me/?text=${msg}`, "_blank", "noopener,noreferrer");
  };

  const chartData = buckets.slice(0, 8).map(b => ({
    name: b.tpa.length > 15 ? b.tpa.slice(0, 14) + "…" : b.tpa,
    "0-30 days": Math.round(b.range0_30 / 1000),
    "31-60 days": Math.round(b.range31_60 / 1000),
    "61-90 days": Math.round(b.range61_90 / 1000),
    "90+ days": Math.round(b.range90plus / 1000),
  }));

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="h-full overflow-auto p-4 space-y-4">
      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
              <IndianRupee size={12} /> Total Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-xl font-bold tabular-nums text-foreground">{fmt(totals.t)}</p>
            <p className="text-[10px] text-muted-foreground">Across {buckets.length} TPAs</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
              <AlertTriangle size={12} /> Overdue (&gt;60 days)
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-xl font-bold tabular-nums text-destructive">{fmt(totals.r2 + totals.r3)}</p>
            <p className="text-[10px] text-muted-foreground">{buckets.filter(b => b.range61_90 + b.range90plus > 0).length} TPAs at risk</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
              <Clock size={12} /> Avg Settlement Days
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-xl font-bold tabular-nums text-foreground">{avgDays} days</p>
            <p className="text-[10px] text-muted-foreground">Target: 45 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-[11px] text-muted-foreground font-medium flex items-center gap-1.5">
              <TrendingUp size={12} /> This Month Settled
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <p className="text-xl font-bold tabular-nums text-emerald-600">{fmt(settledThisMonth.amount)}</p>
            <p className="text-[10px] text-muted-foreground">{settledThisMonth.count} claims settled</p>
          </CardContent>
        </Card>
      </div>

      {/* Ageing Table */}
      <div className="bg-background rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">TPA / Insurer</TableHead>
              <TableHead className="text-[11px] text-right">0–30 days</TableHead>
              <TableHead className="text-[11px] text-right">31–60 days</TableHead>
              <TableHead className="text-[11px] text-right">61–90 days</TableHead>
              <TableHead className="text-[11px] text-right">90+ days</TableHead>
              <TableHead className="text-[11px] text-right">Total</TableHead>
              <TableHead className="text-[11px] text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buckets.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-8">No outstanding claims</TableCell></TableRow>
            ) : (
              <>
                {buckets.map(b => (
                  <TableRow key={b.tpa}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary/10 text-primary flex items-center justify-center text-[10px] font-bold flex-shrink-0">
                          {b.tpa.charAt(0)}
                        </div>
                        <div>
                          <div className="text-[13px] font-medium text-foreground">{b.tpa}</div>
                          <div className="text-[10px] text-muted-foreground">{b.count} claims</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-emerald-600">{b.range0_30 > 0 ? fmtFull(b.range0_30) : "—"}</TableCell>
                    <TableCell className={`text-right text-xs tabular-nums ${b.range31_60 > 0 ? "text-amber-600 bg-amber-50/50" : ""}`}>
                      {b.range31_60 > 0 ? fmtFull(b.range31_60) : "—"}
                    </TableCell>
                    <TableCell className={`text-right text-xs tabular-nums ${b.range61_90 > 0 ? "text-orange-600 bg-orange-50/50" : ""}`}>
                      {b.range61_90 > 0 ? fmtFull(b.range61_90) : "—"}
                    </TableCell>
                    <TableCell className={`text-right text-xs tabular-nums font-bold ${b.range90plus > 0 ? "text-destructive bg-destructive/5" : ""}`}>
                      {b.range90plus > 0 ? fmtFull(b.range90plus) : "—"}
                    </TableCell>
                    <TableCell className="text-right text-[13px] font-bold tabular-nums text-foreground">{fmtFull(b.total)}</TableCell>
                    <TableCell className="text-center">
                      <Button size="sm" variant="ghost" className="text-[10px] h-6 gap-1" onClick={() => followUpTPA(b.tpa, b.total)}>
                        <Phone size={11} /> Follow Up
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell className="text-[13px] font-bold">TOTAL</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{fmtFull(totals.r0)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{fmtFull(totals.r1)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{fmtFull(totals.r2)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums">{fmtFull(totals.r3)}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums font-bold">{fmtFull(totals.t)}</TableCell>
                  <TableCell />
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>

      {/* Stacked Bar Chart */}
      {chartData.length > 0 && (
        <div className="bg-background rounded-lg border border-border p-4">
          <p className="text-[11px] font-semibold uppercase text-muted-foreground mb-3">Ageing Distribution by TPA (₹ in thousands)</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 10, top: 0, bottom: 0 }}>
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 10 }} />
              <Tooltip formatter={(v: number) => `₹${v}K`} contentStyle={{ fontSize: 11 }} />
              <Bar dataKey="0-30 days" stackId="a" fill="hsl(var(--chart-2))" radius={0} />
              <Bar dataKey="31-60 days" stackId="a" fill="hsl(var(--chart-4))" radius={0} />
              <Bar dataKey="61-90 days" stackId="a" fill="hsl(var(--chart-3))" radius={0} />
              <Bar dataKey="90+ days" stackId="a" fill="hsl(var(--destructive))" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};

export default TPAAgeing;
