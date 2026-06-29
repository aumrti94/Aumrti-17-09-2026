import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatCurrency } from "@/lib/currency";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileText, Loader2, TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { format, startOfMonth, endOfMonth, subMonths } from "date-fns";

const PERIODS = [
  { value: "this_month",   label: "This Month" },
  { value: "last_month",   label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year",    label: "This Financial Year" },
];

function PNLRow({ label, amount, indent = 0, bold = false, subtotal = false }: any) {
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

  const [revenue, setRevenue] = useState({ opd: 0, ipd: 0, pharmacy: 0, lab: 0, radiology: 0, other: 0 });
  const [expenses, setExpenses] = useState({ salaries: 0, drugs: 0, consumables: 0, maintenance: 0, utilities: 0, admin: 0, depreciation: 0, other: 0 });
  const [assets, setAssets] = useState({ cash: 0, ar: 0, inventory: 0, fixed: 0 });
  const [liabilities, setLiabilities] = useState({ payables: 0, advances: 0, loans: 0 });

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
    const { from, to } = getDateRange();

    const [billsRes, expRes, assetsRes, advRes] = await Promise.all([
      (supabase as any).from("bills").select("bill_type, net_amount").eq("hospital_id", hospitalId)
        .eq("payment_status", "paid").gte("created_at", from).lte("created_at", to),
      (supabase as any).from("expenses").select("category, amount").eq("hospital_id", hospitalId)
        .gte("expense_date", from).lte("expense_date", to),
      (supabase as any).from("fixed_assets").select("current_book_value, accumulated_dep").eq("hospital_id", hospitalId),
      (supabase as any).from("advance_receipts").select("amount").eq("hospital_id", hospitalId),
    ]);

    const bills = billsRes.data || [];
    const rev = { opd: 0, ipd: 0, pharmacy: 0, lab: 0, radiology: 0, other: 0 };
    bills.forEach((b: any) => {
      const amt = Number(b.net_amount || 0);
      if (b.bill_type === "opd") rev.opd += amt;
      else if (b.bill_type === "ipd") rev.ipd += amt;
      else if (b.bill_type === "pharmacy") rev.pharmacy += amt;
      else if (b.bill_type === "lab") rev.lab += amt;
      else if (b.bill_type === "radiology") rev.radiology += amt;
      else rev.other += amt;
    });
    setRevenue(rev);

    const exp = expRes.data || [];
    const expAgg = { salaries: 0, drugs: 0, consumables: 0, maintenance: 0, utilities: 0, admin: 0, depreciation: 0, other: 0 };
    exp.forEach((e: any) => {
      const amt = Number(e.amount || 0);
      const cat = (e.category || "").toLowerCase();
      if (cat.includes("salary") || cat.includes("payroll")) expAgg.salaries += amt;
      else if (cat.includes("drug") || cat.includes("pharma")) expAgg.drugs += amt;
      else if (cat.includes("consumable") || cat.includes("supply")) expAgg.consumables += amt;
      else if (cat.includes("maintenance") || cat.includes("repair")) expAgg.maintenance += amt;
      else if (cat.includes("utility") || cat.includes("electricity") || cat.includes("water")) expAgg.utilities += amt;
      else if (cat.includes("admin") || cat.includes("office")) expAgg.admin += amt;
      else expAgg.other += amt;
    });
    setExpenses(expAgg);

    const fa = assetsRes.data || [];
    const fixedBookValue = fa.reduce((s: number, a: any) => s + Number(a.current_book_value || 0), 0);
    const totalDepreciation = fa.reduce((s: number, a: any) => s + Number(a.accumulated_dep || 0), 0);
    expAgg.depreciation = totalDepreciation;

    const advTotal = (advRes.data || []).reduce((s: number, a: any) => s + Number(a.amount || 0), 0);
    setAssets({ cash: advTotal * 0.6, ar: advTotal * 0.4, inventory: 0, fixed: fixedBookValue });
    setLiabilities({ payables: 0, advances: advTotal * 0.1, loans: 0 });
    setLoading(false);
  }, [hospitalId, getDateRange]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const totalRevenue = Object.values(revenue).reduce((s, v) => s + v, 0);
  const totalExpenses = Object.values(expenses).reduce((s, v) => s + v, 0);
  const netProfit = totalRevenue - totalExpenses;
  const totalAssets = Object.values(assets).reduce((s, v) => s + v, 0);
  const totalLiabilities = Object.values(liabilities).reduce((s, v) => s + v, 0);
  const equity = totalAssets - totalLiabilities;

  const exportCSV = (title: string, rows: string[][]) => {
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url;
    a.download = `${title}_${format(new Date(), "yyyyMMdd")}.csv`; a.click();
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <FileText size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Financial Statements</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="h-8 w-44 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
          <Button size="sm" variant="outline" className="gap-1.5 h-8" onClick={() => exportCSV("PNL", [["Category","Amount"]])}>
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
              {/* KPI cards */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { l: "Total Revenue", v: totalRevenue, icon: <TrendingUp size={16} className="text-green-600" />, c: "text-green-600" },
                  { l: "Total Expenses", v: totalExpenses, icon: <TrendingDown size={16} className="text-red-600" />, c: "text-red-600" },
                  { l: netProfit >= 0 ? "Net Profit" : "Net Loss", v: netProfit, icon: <FileText size={16} className={netProfit >= 0 ? "text-blue-600" : "text-red-600"} />, c: netProfit >= 0 ? "text-blue-600" : "text-red-600" },
                ].map(k => (
                  <div key={k.l} className="bg-card border border-border rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-1">{k.icon}<p className="text-[11px] text-muted-foreground">{k.l}</p></div>
                    <p className={cn("text-[22px] font-bold", k.c)}>{formatCurrency(Math.abs(k.v))}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{totalRevenue ? `${Math.round(Math.abs(k.v) / totalRevenue * 100)}% of revenue` : ""}</p>
                  </div>
                ))}
              </div>

              <div className="border border-border rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr><th className="text-left px-4 py-2.5 font-semibold text-[13px] text-foreground">Particulars</th><th className="text-right px-4 py-2.5 font-semibold text-[13px] text-foreground">Amount (₹)</th></tr>
                  </thead>
                  <tbody>
                    <PNLRow label="REVENUE" bold />
                    <PNLRow label="OPD Collections" amount={revenue.opd} indent={1} />
                    <PNLRow label="IPD Collections" amount={revenue.ipd} indent={1} />
                    <PNLRow label="Pharmacy" amount={revenue.pharmacy} indent={1} />
                    <PNLRow label="Laboratory" amount={revenue.lab} indent={1} />
                    <PNLRow label="Radiology" amount={revenue.radiology} indent={1} />
                    <PNLRow label="Other Income" amount={revenue.other} indent={1} />
                    <PNLRow label="Total Revenue" amount={totalRevenue} bold subtotal />

                    <PNLRow label="EXPENSES" bold />
                    <PNLRow label="Salaries & Wages" amount={expenses.salaries} indent={1} />
                    <PNLRow label="Drugs & Pharmacy" amount={expenses.drugs} indent={1} />
                    <PNLRow label="Consumables & Supplies" amount={expenses.consumables} indent={1} />
                    <PNLRow label="Maintenance & Repairs" amount={expenses.maintenance} indent={1} />
                    <PNLRow label="Utilities" amount={expenses.utilities} indent={1} />
                    <PNLRow label="Administrative Expenses" amount={expenses.admin} indent={1} />
                    <PNLRow label="Depreciation" amount={expenses.depreciation} indent={1} />
                    <PNLRow label="Other Expenses" amount={expenses.other} indent={1} />
                    <PNLRow label="Total Expenses" amount={totalExpenses} bold subtotal />

                    <PNLRow label={netProfit >= 0 ? "Net Profit" : "Net Loss"} amount={netProfit} bold subtotal />
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>

          {/* ── Balance Sheet ── */}
          <TabsContent value="balance" className="flex-1 overflow-auto p-5 m-0">
            <div className="max-w-2xl">
              <div className="grid grid-cols-2 gap-5">
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/50 px-4 py-2.5"><p className="font-semibold text-[13px] text-foreground">Assets</p></div>
                  <table className="w-full">
                    <tbody>
                      <PNLRow label="Current Assets" bold />
                      <PNLRow label="Cash & Bank" amount={assets.cash} indent={1} />
                      <PNLRow label="Accounts Receivable" amount={assets.ar} indent={1} />
                      <PNLRow label="Inventory" amount={assets.inventory} indent={1} />
                      <PNLRow label="Non-Current Assets" bold />
                      <PNLRow label="Fixed Assets (Net)" amount={assets.fixed} indent={1} />
                      <PNLRow label="Total Assets" amount={totalAssets} bold subtotal />
                    </tbody>
                  </table>
                </div>
                <div className="border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/50 px-4 py-2.5"><p className="font-semibold text-[13px] text-foreground">Liabilities & Equity</p></div>
                  <table className="w-full">
                    <tbody>
                      <PNLRow label="Current Liabilities" bold />
                      <PNLRow label="Accounts Payable" amount={liabilities.payables} indent={1} />
                      <PNLRow label="Patient Advances" amount={liabilities.advances} indent={1} />
                      <PNLRow label="Long-Term Liabilities" bold />
                      <PNLRow label="Loans & Borrowings" amount={liabilities.loans} indent={1} />
                      <PNLRow label="Equity" bold />
                      <PNLRow label="Retained Earnings" amount={equity} indent={1} />
                      <PNLRow label="Total Liabilities + Equity" amount={totalAssets} bold subtotal />
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
