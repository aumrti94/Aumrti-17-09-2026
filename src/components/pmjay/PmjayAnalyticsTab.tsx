import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { BarChart3, AlertTriangle } from "lucide-react";

interface SchemeStats {
  scheme_name: string;
  preauths: number;
  approvals: number;
  claims: number;
  settled: number;
  recovery: number;
}

interface DenialCategory {
  category: string;
  count: number;
}

const COLORS = ["#1A2F5A", "#0E7B7B", "#D97706", "#DC2626", "#7C3AED", "#0369A1"];

const PmjayAnalyticsTab: React.FC = () => {
  const [schemeStats, setSchemeStats] = useState<SchemeStats[]>([]);
  const [denialCategories, setDenialCategories] = useState<DenialCategory[]>([]);
  const [ageing, setAgeing] = useState({ over30: 0, over60: 0, over90: 0, totalOutstanding: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAnalytics(); }, []);

  const loadAnalytics = async () => {
    setLoading(true);
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();

    const [schemesRes, preAuthRes, claimsRes, denialRes] = await Promise.all([
      supabase.from("govt_schemes").select("id, scheme_name").eq("is_active", true),
      supabase.from("pre_auth_requests").select("scheme_id, status").gte("created_at", monthStart),
      supabase.from("pmjay_claims").select("scheme_id, status, claimed_amount, settled_amount, submitted_at").gte("created_at", monthStart),
      supabase.from("denial_logs").select("category").gte("created_at", monthStart),
    ]);

    const schemeList = schemesRes.data || [];
    const preAuths = preAuthRes.data || [];
    const claims = claimsRes.data || [];
    const denials = denialRes.data || [];

    // Scheme stats
    const stats: SchemeStats[] = schemeList.map((s: any) => {
      const sPre = preAuths.filter((p: any) => p.scheme_id === s.id);
      const sClaims = claims.filter((c: any) => c.scheme_id === s.id);
      const totalClaimed = sClaims.reduce((sum: number, c: any) => sum + Number(c.claimed_amount || 0), 0);
      const totalSettled = sClaims.filter((c: any) => c.status === "settled").reduce((sum: number, c: any) => sum + Number(c.settled_amount || 0), 0);
      return {
        scheme_name: s.scheme_name,
        preauths: sPre.length,
        approvals: sPre.filter((p: any) => p.status === "approved").length,
        claims: sClaims.length,
        settled: totalSettled,
        recovery: totalClaimed > 0 ? Math.round((totalSettled / totalClaimed) * 100) : 0,
      };
    });
    setSchemeStats(stats);

    // Denial categories
    const catMap: Record<string, number> = {};
    denials.forEach((d: any) => { catMap[d.category || "other"] = (catMap[d.category || "other"] || 0) + 1; });
    setDenialCategories(Object.entries(catMap).map(([category, count]) => ({ category, count })));

    // Ageing
    const now = new Date();
    const pendingClaims = claims.filter((c: any) => ["submitted", "under_review"].includes(c.status));
    let o30 = 0, o60 = 0, o90 = 0, totalOut = 0;
    pendingClaims.forEach((c: any) => {
      if (!c.submitted_at) return;
      const days = Math.floor((now.getTime() - new Date(c.submitted_at).getTime()) / 86400000);
      const amt = Number(c.claimed_amount || 0);
      totalOut += amt;
      if (days > 90) o90++;
      else if (days > 60) o60++;
      else if (days > 30) o30++;
    });
    setAgeing({ over30: o30, over60: o60, over90: o90, totalOutstanding: totalOut });
    setLoading(false);
  };

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="h-full overflow-y-auto p-4 space-y-5">
      {/* Scheme-wise summary */}
      <div>
        <h3 className="text-sm font-bold mb-2">Scheme-Wise Summary (Current Month)</h3>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-3 py-2 text-[11px] font-semibold text-muted-foreground">Scheme</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground">Pre-Auths</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground">Approvals</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground">Claims</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground">Settled ₹</th>
                <th className="text-right px-3 py-2 text-[11px] font-semibold text-muted-foreground">Recovery %</th>
              </tr>
            </thead>
            <tbody>
              {schemeStats.length === 0 ? (
                <tr><td colSpan={6} className="text-center py-6 text-muted-foreground">No scheme data this month</td></tr>
              ) : schemeStats.map(s => (
                <tr key={s.scheme_name} className="border-t border-border">
                  <td className="px-3 py-2 font-medium">{s.scheme_name}</td>
                  <td className="px-3 py-2 text-right font-mono">{s.preauths}</td>
                  <td className="px-3 py-2 text-right font-mono">{s.approvals}</td>
                  <td className="px-3 py-2 text-right font-mono">{s.claims}</td>
                  <td className="px-3 py-2 text-right font-mono">₹{s.settled.toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right">
                    <span className={cn("font-bold", s.recovery >= 70 ? "text-emerald-700" : s.recovery >= 40 ? "text-amber-700" : "text-red-700")}>
                      {s.recovery}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Denial Analysis */}
        <div>
          <h3 className="text-sm font-bold mb-2">Denial Analysis</h3>
          <div className="border border-border rounded-lg p-3">
            {denialCategories.length === 0 ? (
              <div className="text-center text-muted-foreground text-sm py-6">No denials this month</div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="w-32 h-32">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={denialCategories} dataKey="count" nameKey="category" cx="50%" cy="50%" outerRadius={55} innerRadius={30}>
                        {denialCategories.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1">
                  {denialCategories.map((d, i) => (
                    <div key={d.category} className="flex items-center gap-2 text-[12px]">
                      <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                      <span className="capitalize">{d.category.replace(/_/g, " ")}</span>
                      <span className="font-mono font-bold">({d.count})</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* AR Ageing */}
        <div>
          <h3 className="text-sm font-bold mb-2">AR Ageing (Govt Schemes)</h3>
          <div className="border border-border rounded-lg p-3 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-amber-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold font-mono text-amber-700">{ageing.over30}</div>
                <div className="text-[10px] text-amber-600">&gt; 30 days</div>
              </div>
              <div className="bg-orange-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold font-mono text-orange-700">{ageing.over60}</div>
                <div className="text-[10px] text-orange-600">&gt; 60 days</div>
              </div>
              <div className="bg-red-50 rounded-lg p-2 text-center">
                <div className="text-lg font-bold font-mono text-red-700">{ageing.over90}</div>
                <div className="text-[10px] text-red-600">&gt; 90 days</div>
              </div>
            </div>
            <div className="text-center pt-1">
              <div className="text-[11px] text-muted-foreground">Total Outstanding</div>
              <div className="text-lg font-bold font-mono">₹{(ageing.totalOutstanding / 100000).toFixed(1)}L</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PmjayAnalyticsTab;
