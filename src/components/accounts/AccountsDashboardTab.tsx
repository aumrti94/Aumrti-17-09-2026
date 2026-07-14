import React, { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowUpRight, ArrowDownRight, TrendingUp, Wallet, Landmark, AlertTriangle, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, Legend } from "recharts";
import FinancialAnomalyCard from "./FinancialAnomalyCard";
import PostingFailuresCard from "./PostingFailuresCard";
import { fetchLedgerBalances, type LedgerAccountBalance } from "@/lib/financialStatements";
import { startOfMonth, endOfMonth, format } from "date-fns";

interface Props {
  hospitalId: string | null;
  dateRange: { start: string; end: string };
}

const REVENUE_ACCTS = ["4001","4002","4003","4004","4005","4006","4007","4008","4009","4010","4011","4020"];
const REVENUE_LABELS: Record<string, string> = {
  "4001": "OPD", "4002": "IPD", "4003": "OT", "4004": "Lab",
  "4005": "Radiology", "4006": "Pharmacy IP", "4007": "Pharmacy Retail",
  "4008": "Procedures", "4009": "Emergency", "4010": "Insurance",
  "4011": "PMJAY/CGHS", "4020": "Other",
};
const PIE_COLORS = ["#10B981","#3B82F6","#8B5CF6","#F59E0B","#EC4899","#06B6D4","#F97316","#6366F1","#EF4444","#14B8A6","#A855F7","#64748B"];

const EXPENSE_GROUPS: Record<string, { label: string; codes: string[] }> = {
  salary: { label: "Salaries", codes: ["5001","5002","5003","5004","5005","5006"] },
  drugs: { label: "Drug Purchases", codes: ["5010","5011","5012"] },
  rent: { label: "Rent", codes: ["5020"] },
  utilities: { label: "Utilities", codes: ["5021","5022","5023"] },
  maintenance: { label: "Maintenance", codes: ["5030","5031","5032"] },
  other: { label: "Other", codes: ["5040","5041","5042","5043","5050","5051","5060"] },
};

const AccountsDashboardTab: React.FC<Props> = ({ hospitalId, dateRange }) => {
  // Period-scoped (entry_date within dateRange), via the shared ledger lib —
  // never created_at, so a backdated entry lands in the period it was dated for.
  const [ledgerBalances, setLedgerBalances] = useState<LedgerAccountBalance[]>([]);
  const [recentEntries, setRecentEntries] = useState<any[]>([]);
  const [arBalances, setArBalances] = useState(0);
  const [cashBalances, setCashBalances] = useState(0);
  const [hasRules, setHasRules] = useState<boolean | null>(null);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Trailing 6 real calendar months — independent of the page's own date
  // filter, which previously left 5 of 6 trend months empty whenever a
  // narrower period (e.g. "This Month") was selected.
  const [monthlyTrend, setMonthlyTrend] = useState<{ month: string; revenue: number; expenses: number }[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    loadAll();
  }, [hospitalId, dateRange]);

  useEffect(() => {
    if (!hospitalId) return;
    loadMonthlyTrend();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hospitalId]);

  const loadAll = async () => {
    const [balances, { data: recent }, { data: arItems }, { data: cashItems }, { count: rulesCount }] = await Promise.all([
      fetchLedgerBalances(hospitalId!, dateRange.start, dateRange.end),
      supabase.from("journal_entries").select("*").eq("hospital_id", hospitalId!).order("created_at", { ascending: false }).limit(10),
      supabase.from("journal_line_items").select("account_code, debit_amount, credit_amount").eq("hospital_id", hospitalId!).in("account_code", ["1010","1011","1012"]),
      supabase.from("journal_line_items").select("account_code, debit_amount, credit_amount").eq("hospital_id", hospitalId!).in("account_code", ["1001","1002","1003"]),
      (supabase as any).from("auto_posting_rules").select("id", { count: "exact", head: true }).eq("hospital_id", hospitalId!).eq("is_active", true),
    ]);
    setLedgerBalances(balances);
    setRecentEntries(recent || []);
    setArBalances((arItems || []).reduce((s, i) => s + Number(i.debit_amount || 0) - Number(i.credit_amount || 0), 0));
    setCashBalances((cashItems || []).reduce((s, i) => s + Number(i.debit_amount || 0) - Number(i.credit_amount || 0), 0));
    setHasRules((rulesCount ?? 0) > 0);
  };

  const loadMonthlyTrend = async () => {
    const months: { label: string; start: string; end: string }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i, 1);
      months.push({
        label: d.toLocaleString("en-IN", { month: "short", year: "2-digit" }),
        start: format(startOfMonth(d), "yyyy-MM-dd"),
        end: format(endOfMonth(d), "yyyy-MM-dd"),
      });
    }
    const results = await Promise.all(months.map((m) => fetchLedgerBalances(hospitalId!, m.start, m.end)));
    setMonthlyTrend(months.map((m, idx) => {
      const rows = results[idx];
      const revenue = rows.filter((r) => r.account_type === "revenue").reduce((s, r) => s + (r.total_credit - r.total_debit), 0);
      const expenses = rows.filter((r) => r.account_type === "expense").reduce((s, r) => s + (r.total_debit - r.total_credit), 0);
      return { month: m.label, revenue, expenses };
    }));
  };

  const totalRevenue = useMemo(() => ledgerBalances.filter((r) => r.account_type === "revenue").reduce((s, r) => s + (r.total_credit - r.total_debit), 0), [ledgerBalances]);
  const totalExpenses = useMemo(() => ledgerBalances.filter((r) => r.account_type === "expense").reduce((s, r) => s + (r.total_debit - r.total_credit), 0), [ledgerBalances]);
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : "0.0";

  // Revenue breakdown for donut
  const revenueBreakdown = useMemo(() => {
    return ledgerBalances
      .filter((r) => r.account_type === "revenue")
      .map((r) => ({ name: REVENUE_LABELS[r.account_code] || r.account_name, value: r.total_credit - r.total_debit }))
      .filter((r) => r.value > 0);
  }, [ledgerBalances]);

  // Expense breakdown by groups
  const expenseBreakdown = useMemo(() => {
    const byCode: Record<string, number> = {};
    ledgerBalances.filter((r) => r.account_type === "expense").forEach((r) => {
      byCode[r.account_code] = r.total_debit - r.total_credit;
    });
    return Object.values(EXPENSE_GROUPS).map((g) => ({
      name: g.label,
      value: g.codes.reduce((s, code) => s + (byCode[code] || 0), 0),
    })).filter((g) => g.value > 0);
  }, [ledgerBalances]);

  const fmt = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
  const fmtShort = (n: number) => {
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)}L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(1)}K`;
    return `₹${n.toFixed(0)}`;
  };

  const kpis = [
    { label: "Revenue This Month", value: fmt(totalRevenue), icon: ArrowUpRight, color: "text-emerald-600", bg: "bg-emerald-50 dark:bg-emerald-950/20" },
    { label: "Expenses This Month", value: fmt(totalExpenses), icon: ArrowDownRight, color: "text-destructive", bg: "bg-destructive/10" },
    { label: "Net Profit/Loss", value: (netProfit >= 0 ? "" : "-") + fmt(netProfit), sub: `Margin: ${profitMargin}%`, icon: TrendingUp, color: netProfit >= 0 ? "text-emerald-600" : "text-destructive", bg: netProfit >= 0 ? "bg-emerald-50 dark:bg-emerald-950/20" : "bg-destructive/10" },
    { label: "Accounts Receivable", value: fmt(arBalances), icon: Wallet, color: "text-amber-500", bg: "bg-amber-50 dark:bg-amber-950/20" },
    { label: "Cash & Bank Balance", value: fmt(cashBalances), icon: Landmark, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950/20" },
  ];

  return (
    <div className="p-5 space-y-4 overflow-auto h-full">
      {/* Auto-posting rules missing warning */}
      {hasRules === false && !bannerDismissed && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-3 text-sm">
          <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-amber-800 dark:text-amber-300">
              No auto-posting rules configured
            </p>
            <p className="text-amber-700 dark:text-amber-400 mt-0.5">
              Journal entries will not be created for bills, payments, or payroll until rules are set up.
              Go to <strong>Settings → Accounting → Auto-Posting Rules</strong> to configure them, or
              run the latest migration to auto-seed defaults for this hospital.
            </p>
          </div>
          <button
            onClick={() => setBannerDismissed(true)}
            className="text-amber-500 hover:text-amber-700 dark:hover:text-amber-200 shrink-0"
            aria-label="Dismiss"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ROW 1: 5 KPIs */}
      <div className="grid grid-cols-5 gap-3">
        {kpis.map((k) => (
          <Card key={k.label} className="border-border">
            <CardContent className="p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] text-muted-foreground leading-tight">{k.label}</span>
                <div className={`h-7 w-7 rounded-lg ${k.bg} flex items-center justify-center`}>
                  <k.icon size={14} className={k.color} />
                </div>
              </div>
              <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
              {"sub" in k && k.sub && <p className="text-[10px] text-muted-foreground">{k.sub}</p>}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ROW 2: Revenue vs Expense Chart + Revenue Donut */}
      <div className="grid grid-cols-5 gap-4">
        <Card className="col-span-3 border-border">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs">Monthly Revenue vs Expenses</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} tickFormatter={fmtShort} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Area type="monotone" dataKey="revenue" stroke="#10B981" fill="#10B98130" strokeWidth={2} name="Revenue" />
                <Area type="monotone" dataKey="expenses" stroke="#EF4444" fill="#EF444420" strokeWidth={2} strokeDasharray="5 5" name="Expenses" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card className="col-span-2 border-border">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs">Revenue Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-2 flex items-center justify-center">
            {revenueBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground py-8">No revenue data</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={revenueBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {revenueBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ROW 3: Expense Breakdown + Recent Entries */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-border">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs">Expense Categories</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {expenseBreakdown.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No expense data</p>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={expenseBreakdown} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={fmtShort} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={90} />
                  <Tooltip formatter={(v: number) => fmt(v)} />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="border-border">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs">Recent Journal Entries</CardTitle>
          </CardHeader>
          <CardContent className="p-2">
            {recentEntries.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-8">No entries yet</p>
            ) : (
              <div className="space-y-1 max-h-[200px] overflow-auto">
                {recentEntries.map((e) => (
                  <div key={e.id} className="flex items-center justify-between py-1.5 border-b border-border last:border-0">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[10px] font-mono font-semibold text-foreground">{e.entry_number}</span>
                        <Badge variant="outline" className={`text-[9px] px-1.5 py-0 ${
                          e.entry_type?.startsWith("auto")
                            ? "bg-primary/10 text-primary border-primary/30"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {e.entry_type?.startsWith("auto") ? "AUTO" : "MANUAL"}
                        </Badge>
                      </div>
                      <p className="text-[10px] text-muted-foreground truncate">{e.description}</p>
                    </div>
                    <div className="text-right ml-2">
                      <p className="text-xs font-semibold text-foreground">{fmt(e.total_debit)}</p>
                      <p className="text-[9px] text-muted-foreground">{e.entry_date}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Unposted journal entries (no matching auto_posting_rules) */}
      <PostingFailuresCard hospitalId={hospitalId} />

      {/* Financial Anomaly Detector */}
      <FinancialAnomalyCard hospitalId={hospitalId} />
    </div>
  );
};

export default AccountsDashboardTab;
