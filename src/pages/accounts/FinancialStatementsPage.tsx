import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatCurrency } from "@/lib/currency";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Loader2, TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";
import {
  fetchLedgerBalances,
  buildProfitAndLoss,
  buildBalanceSheet,
  type ProfitAndLoss,
  type BalanceSheet,
} from "@/lib/financialStatements";

const PERIODS = [
  { value: "this_month",   label: "This Month" },
  { value: "last_month",   label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year",    label: "This Financial Year" },
];

const EMPTY_PL: ProfitAndLoss = { revenue: [], expenses: [], totalRevenue: 0, totalExpenses: 0, netProfit: 0 };
const EMPTY_BS: BalanceSheet = {
  assets: [], liabilities: [], equity: [],
  totalAssets: 0, totalLiabilities: 0, totalEquityBase: 0,
  retainedEarnings: 0, totalEquity: 0, isBalanced: true, difference: 0,
};

function StmtRow({ label, amount, indent = 0, bold = false, subtotal = false }: any) {
  return (
    <tr className={cn(subtotal ? "border-t-2 border-foreground bg-muted/20" : "border-b border-border/50 hover:bg-muted/10")}>
      <td className={cn("px-4 py-2 text-[12px]", bold ? "font-bold text-foreground" : "text-foreground")}
        style={{ paddingLeft: `${16 + indent * 16}px` }}>
        {label}
      </td>
      <td className={cn("px-4 py-2 text-[12px] text-right tabular-nums", bold ? "font-bold" : "",
        amount < 0 ? "text-red-600" : "text-foreground")}>
        {amount !== undefined ? formatCurrency(Math.abs(amount)) : ""}
        {amount < 0 ? " (Dr)" : ""}
      </td>
    </tr>
  );
}

export default function FinancialStatementsPage() {
  const { hospitalId } = useHospitalId();
  const [period, setPeriod] = useState("this_month");
  const [activeTab, setActiveTab] = useState("pnl");
  const [loading, setLoading] = useState(true);

  const [pl, setPL] = useState<ProfitAndLoss>(EMPTY_PL);
  const [bs, setBS] = useState<BalanceSheet>(EMPTY_BS);
  const [costCentres, setCostCentres] = useState<{ id: string; name: string }[]>([]);
  const [costCentreId, setCostCentreId] = useState("all");

  useEffect(() => {
    if (!hospitalId) return;
    // Cost centres are modelled as departments (journal_line_items.cost_centre_id
    // references a department), consistent with CostCentresPage.
    (supabase as any).from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).order("name")
      .then(({ data }: any) => setCostCentres(data || []));
  }, [hospitalId]);

  const getDateRange = useCallback(() => {
    const now = new Date();
    if (period === "this_month") return { from: format(startOfMonth(now), "yyyy-MM-dd"), to: format(endOfMonth(now), "yyyy-MM-dd") };
    if (period === "last_month") { const lm = subMonths(now, 1); return { from: format(startOfMonth(lm), "yyyy-MM-dd"), to: format(endOfMonth(lm), "yyyy-MM-dd") }; }
    if (period === "this_quarter") {
      const q = Math.floor(now.getMonth() / 3);
      const qs = new Date(now.getFullYear(), q * 3, 1);
      const qe = new Date(now.getFullYear(), q * 3 + 3, 0);
      return { from: format(qs, "yyyy-MM-dd"), to: format(qe, "yyyy-MM-dd") };
    }
    const fyStart = now.getMonth() >= 3 ? new Date(now.getFullYear(), 3, 1) : new Date(now.getFullYear() - 1, 3, 1);
    const fyEnd   = now.getMonth() >= 3 ? new Date(now.getFullYear() + 1, 2, 31) : new Date(now.getFullYear(), 2, 31);
    return { from: format(fyStart, "yyyy-MM-dd"), to: format(fyEnd, "yyyy-MM-dd") };
  }, [period]);

  const fetchData = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    try {
      const { from, to } = getDateRange();
      const cc = costCentreId === "all" ? null : costCentreId;
      // P&L is period-scoped (and cost-centre-filterable); Balance Sheet is
      // cumulative from inception → period end, always at entity level.
      const [periodRows, cumulativeRows] = await Promise.all([
        fetchLedgerBalances(hospitalId, from, to, cc),
        fetchLedgerBalances(hospitalId, null, to),
      ]);
      setPL(buildProfitAndLoss(periodRows));
      setBS(buildBalanceSheet(cumulativeRows));
    } catch (err) {
      console.error("Financial statements load failed:", err);
      setPL(EMPTY_PL);
      setBS(EMPTY_BS);
    } finally {
      setLoading(false);
    }
  }, [hospitalId, getDateRange, costCentreId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const exportCSV = () => {
    const { from, to } = getDateRange();
    const rows: string[][] = [];
    if (activeTab === "pnl") {
      rows.push(["Profit & Loss", `${from} to ${to}`]);
      rows.push(["Particulars", "Amount (INR)"]);
      rows.push(["REVENUE", ""]);
      pl.revenue.forEach((r) => rows.push([r.account_name, r.amount.toFixed(2)]));
      rows.push(["Total Revenue", pl.totalRevenue.toFixed(2)]);
      rows.push(["EXPENSES", ""]);
      pl.expenses.forEach((r) => rows.push([r.account_name, r.amount.toFixed(2)]));
      rows.push(["Total Expenses", pl.totalExpenses.toFixed(2)]);
      rows.push([pl.netProfit >= 0 ? "Net Profit" : "Net Loss", pl.netProfit.toFixed(2)]);
    } else {
      rows.push(["Balance Sheet", `as at ${to}`]);
      rows.push(["ASSETS", ""]);
      bs.assets.forEach((r) => rows.push([r.account_name, r.amount.toFixed(2)]));
      rows.push(["Total Assets", bs.totalAssets.toFixed(2)]);
      rows.push(["LIABILITIES", ""]);
      bs.liabilities.forEach((r) => rows.push([r.account_name, r.amount.toFixed(2)]));
      rows.push(["Total Liabilities", bs.totalLiabilities.toFixed(2)]);
      rows.push(["EQUITY", ""]);
      bs.equity.forEach((r) => rows.push([r.account_name, r.amount.toFixed(2)]));
      rows.push(["Retained Earnings / Current Earnings", bs.retainedEarnings.toFixed(2)]);
      rows.push(["Total Equity", bs.totalEquity.toFixed(2)]);
      rows.push(["Total Liabilities + Equity", (bs.totalLiabilities + bs.totalEquity).toFixed(2)]);
    }
    const csv = rows.map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `${activeTab === "pnl" ? "PNL" : "BalanceSheet"}_${format(new Date(), "yyyyMMdd")}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Financial Statements</h1>
          <span className="text-[10px] text-muted-foreground ml-2 hidden sm:inline">Computed from the general ledger — ties to Trial Balance</span>
        </div>
        <div className="flex items-center gap-2">
          {costCentres.length > 0 && (
            <Select value={costCentreId} onValueChange={setCostCentreId}>
              <SelectTrigger className="h-8 w-44 text-[12px]" title="Segment the P&L by cost centre"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Cost Centres</SelectItem>
                {costCentres.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-8 w-44 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={exportCSV}>
            <Download size={12} /> Export
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
            <TabsTrigger value="pnl" className="text-[13px]">P&L Statement</TabsTrigger>
            <TabsTrigger value="balance" className="text-[13px]">Balance Sheet</TabsTrigger>
          </TabsList>

          {/* ── P&L ── */}
          <TabsContent value="pnl" className="flex-1 overflow-auto p-5 m-0">
            <div className="max-w-2xl">
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { l: "Total Revenue", v: pl.totalRevenue, icon: <TrendingUp size={16} className="text-green-600" />, c: "text-green-600" },
                  { l: "Total Expenses", v: pl.totalExpenses, icon: <TrendingDown size={16} className="text-red-600" />, c: "text-red-600" },
                  { l: pl.netProfit >= 0 ? "Net Profit" : "Net Loss", v: pl.netProfit, icon: <FileText size={16} className={pl.netProfit >= 0 ? "text-blue-600" : "text-red-600"} />, c: pl.netProfit >= 0 ? "text-blue-600" : "text-red-600" },
                ].map(k => (
                  <div key={k.l} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">{k.icon}<p className="text-[11px] text-muted-foreground">{k.l}</p></div>
                    <p className={cn("text-[22px] font-bold", k.c)}>{formatCurrency(Math.abs(k.v))}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{pl.totalRevenue ? `${Math.round(Math.abs(k.v) / pl.totalRevenue * 100)}% of revenue` : ""}</p>
                  </div>
                ))}
              </div>

              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr><th className="text-left px-4 py-2.5 font-semibold text-[13px] text-foreground">Particulars</th><th className="text-right px-4 py-2.5 font-semibold text-[13px] text-foreground">Amount (₹)</th></tr>
                  </thead>
                  <tbody>
                    <StmtRow label="REVENUE" bold />
                    {pl.revenue.length === 0 && <StmtRow label="No revenue posted in this period" indent={1} />}
                    {pl.revenue.map((r) => <StmtRow key={r.account_code} label={`${r.account_code} · ${r.account_name}`} amount={r.amount} indent={1} />)}
                    <StmtRow label="Total Revenue" amount={pl.totalRevenue} bold subtotal />

                    <StmtRow label="EXPENSES" bold />
                    {pl.expenses.length === 0 && <StmtRow label="No expenses posted in this period" indent={1} />}
                    {pl.expenses.map((r) => <StmtRow key={r.account_code} label={`${r.account_code} · ${r.account_name}`} amount={r.amount} indent={1} />)}
                    <StmtRow label="Total Expenses" amount={pl.totalExpenses} bold subtotal />

                    <StmtRow label={pl.netProfit >= 0 ? "Net Profit" : "Net Loss"} amount={pl.netProfit} bold subtotal />
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ── Balance Sheet ── */}
          <TabsContent value="balance" className="flex-1 overflow-auto p-5 m-0">
            <div className="max-w-3xl">
              {costCentreId !== "all" && (
                <p className="mb-3 text-[11px] text-muted-foreground">
                  The Balance Sheet is shown at entity level. Cost-centre filtering applies to the P&amp;L only.
                </p>
              )}
              {!bs.isBalanced && (
                <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  <div className="text-xs">
                    <p className="font-semibold">Balance Sheet does not tie — check for unbalanced journal entries</p>
                    <p className="mt-0.5 opacity-90">
                      Assets {formatCurrency(bs.totalAssets)} ≠ Liabilities + Equity {formatCurrency(bs.totalLiabilities + bs.totalEquity)} (difference {formatCurrency(Math.abs(bs.difference))})
                    </p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-5">
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/50 px-4 py-2.5"><p className="font-semibold text-[13px] text-foreground">Assets</p></div>
                  <table className="w-full">
                    <tbody>
                      {bs.assets.length === 0 && <StmtRow label="No asset balances" indent={1} />}
                      {bs.assets.map((r) => <StmtRow key={r.account_code} label={`${r.account_code} · ${r.account_name}`} amount={r.amount} indent={1} />)}
                      <StmtRow label="Total Assets" amount={bs.totalAssets} bold subtotal />
                    </tbody>
                  </table>
                </div>
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/50 px-4 py-2.5"><p className="font-semibold text-[13px] text-foreground">Liabilities & Equity</p></div>
                  <table className="w-full">
                    <tbody>
                      <StmtRow label="Liabilities" bold />
                      {bs.liabilities.length === 0 && <StmtRow label="No liability balances" indent={1} />}
                      {bs.liabilities.map((r) => <StmtRow key={r.account_code} label={`${r.account_code} · ${r.account_name}`} amount={r.amount} indent={1} />)}
                      <StmtRow label="Total Liabilities" amount={bs.totalLiabilities} bold subtotal />
                      <StmtRow label="Equity" bold />
                      {bs.equity.map((r) => <StmtRow key={r.account_code} label={`${r.account_code} · ${r.account_name}`} amount={r.amount} indent={1} />)}
                      <StmtRow label="Retained / Current Earnings" amount={bs.retainedEarnings} indent={1} />
                      <StmtRow label="Total Equity" amount={bs.totalEquity} bold subtotal />
                      <StmtRow label="Total Liabilities + Equity" amount={bs.totalLiabilities + bs.totalEquity} bold subtotal />
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
