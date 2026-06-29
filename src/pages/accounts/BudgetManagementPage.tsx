import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { formatCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Target, Plus, CheckCircle2, XCircle, Loader2, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const FISCAL_YEARS = ["2026-27", "2025-26", "2024-25"];
const MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  pending_approval: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-green-50 text-green-700 border-green-200",
  rejected: "bg-red-50 text-red-700 border-red-200",
};

export default function BudgetManagementPage() {
  const { hospitalId, userId, role } = useHospitalId() as any;
  const { toast } = useToast();
  const [lines, setLines] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fy, setFy] = useState("2026-27");
  const [month, setMonth] = useState("all");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ account_code: "", account_name: "", budgeted_amount: "", notes: "", period_month: "" });

  const isApprover = ["cfo", "hospital_admin", "super_admin"].includes(role || "");

  const fetch = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    let q = (supabase as any).from("budget_lines").select("*").eq("hospital_id", hospitalId).eq("fiscal_year", fy).order("account_code");
    if (month !== "all") q = q.eq("period_month", parseInt(month));
    const { data } = await q;
    setLines(data || []);
    setLoading(false);
  }, [hospitalId, fy, month]);

  useEffect(() => { fetch(); }, [fetch]);

  const addLine = async () => {
    if (!hospitalId || !form.account_code || !form.account_name || !form.budgeted_amount) return;
    setSaving(true);
    await (supabase as any).from("budget_lines").insert({
      hospital_id: hospitalId,
      fiscal_year: fy,
      period_month: form.period_month ? parseInt(form.period_month) : null,
      account_code: form.account_code,
      account_name: form.account_name,
      budgeted_amount: parseFloat(form.budgeted_amount),
      notes: form.notes || null,
      created_by: userId || null,
    });
    setSaving(false);
    setShowForm(false);
    setForm({ account_code: "", account_name: "", budgeted_amount: "", notes: "", period_month: "" });
    fetch();
    toast({ title: "Budget line added" });
  };

  const submitForApproval = async (id: string) => {
    await (supabase as any).from("budget_lines").update({ status: "pending_approval" }).eq("id", id);
    fetch();
    toast({ title: "Submitted for approval" });
  };

  const approve = async (id: string, approved: boolean) => {
    await (supabase as any).from("budget_lines").update({
      status: approved ? "approved" : "rejected",
      approved_by: userId || null,
      approved_at: new Date().toISOString(),
    }).eq("id", id);
    fetch();
    toast({ title: approved ? "Budget line approved" : "Budget line rejected" });
  };

  const totalBudgeted = lines.reduce((s, l) => s + Number(l.budgeted_amount || 0), 0);
  const totalActual   = lines.reduce((s, l) => s + Number(l.actual_amount || 0), 0);
  const totalVariance = totalBudgeted - totalActual;

  const exportCSV = () => {
    const rows = [
      ["Account Code","Account Name","Period","Budgeted","Actual","Variance","Status"],
      ...lines.map(l => [l.account_code, l.account_name, l.period_month ? MONTHS[((l.period_month - 4 + 12) % 12)] : "Annual", l.budgeted_amount, l.actual_amount, l.variance, l.status])
    ];
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url;
    a.download = `Budget_${fy}.csv`; a.click();
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Budget Management</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={fy} onValueChange={setFy}>
            <SelectTrigger className="h-8 w-28 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>{FISCAL_YEARS.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="h-8 w-24 text-[12px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Months</SelectItem>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 4 <= 12 ? i + 4 : i - 8)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={exportCSV} className="gap-1.5 h-8"><Download size={12} /> Export</Button>
          <Button size="sm" onClick={() => setShowForm(true)} className="gap-1.5 h-8"><Plus size={12} /> Add Line</Button>
        </div>
      </div>

      {/* KPI bar */}
      <div className="flex-shrink-0 grid grid-cols-3 gap-3 p-4 bg-muted/20 border-b border-border">
        {[
          { l: "Total Budgeted", v: totalBudgeted, c: "text-foreground" },
          { l: "Actual Spent", v: totalActual, c: "text-red-600" },
          { l: totalVariance >= 0 ? "Savings" : "Over Budget", v: totalVariance, c: totalVariance >= 0 ? "text-green-600" : "text-red-600" },
        ].map(s => (
          <div key={s.l} className="bg-card border border-border rounded-xl p-3">
            <p className="text-[11px] text-muted-foreground">{s.l}</p>
            <p className={cn("text-[20px] font-bold mt-0.5", s.c)}>{formatCurrency(Math.abs(s.v))}</p>
          </div>
        ))}
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md space-y-4 shadow-xl">
            <h2 className="text-[15px] font-bold text-foreground">Add Budget Line</h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] text-muted-foreground">Account Code *</label>
                <Input value={form.account_code} onChange={e => setForm(p => ({ ...p, account_code: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. 5100" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Month (optional)</label>
                <Select value={form.period_month || "annual"} onValueChange={v => setForm(p => ({ ...p, period_month: v === "annual" ? "" : v }))}>
                  <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue placeholder="Annual" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual</SelectItem>
                    {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 4 <= 12 ? i + 4 : i - 8)}>{m}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-muted-foreground">Account Name *</label>
                <Input value={form.account_name} onChange={e => setForm(p => ({ ...p, account_name: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. Pharmacy Purchases" />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-muted-foreground">Budgeted Amount (₹) *</label>
                <Input type="number" value={form.budgeted_amount} onChange={e => setForm(p => ({ ...p, budgeted_amount: e.target.value }))} className="h-9 mt-1 text-[12px]" />
              </div>
              <div className="col-span-2">
                <label className="text-[11px] text-muted-foreground">Notes</label>
                <Input value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} className="h-9 mt-1 text-[12px]" />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={addLine} disabled={saving || !form.account_code || !form.account_name || !form.budgeted_amount} className="gap-1.5">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}Add
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-32"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : lines.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <Target size={28} className="opacity-20 mb-2" />
            <p className="text-[13px]">No budget lines for FY {fy}. Add one to get started.</p>
          </div>
        ) : (
          <table className="w-full text-[12px]">
            <thead className="sticky top-0 bg-muted/50 border-b border-border">
              <tr>
                {["Code","Account Name","Period","Budgeted","Actual","Variance","Status","Actions"].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map(l => {
                const variance = Number(l.budgeted_amount) - Number(l.actual_amount);
                return (
                  <tr key={l.id} className="border-b border-border hover:bg-muted/20">
                    <td className="px-4 py-2.5 font-mono text-[11px] text-muted-foreground">{l.account_code}</td>
                    <td className="px-4 py-2.5 font-medium text-foreground">{l.account_name}</td>
                    <td className="px-4 py-2.5 text-muted-foreground">{l.period_month ? MONTHS[((l.period_month - 4 + 12) % 12)] : "Annual"}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatCurrency(l.budgeted_amount)}</td>
                    <td className="px-4 py-2.5 tabular-nums">{formatCurrency(l.actual_amount)}</td>
                    <td className={cn("px-4 py-2.5 tabular-nums font-medium", variance >= 0 ? "text-green-600" : "text-red-600")}>
                      {variance >= 0 ? "+" : ""}{formatCurrency(variance)}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", STATUS_STYLES[l.status])}>
                        {l.status.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex gap-1">
                        {l.status === "draft" && (
                          <Button size="sm" variant="ghost" onClick={() => submitForApproval(l.id)} className="h-6 text-[10px] px-2">Submit</Button>
                        )}
                        {l.status === "pending_approval" && isApprover && (
                          <>
                            <Button size="sm" onClick={() => approve(l.id, true)} className="h-6 text-[10px] px-2 gap-1">
                              <CheckCircle2 size={10} />Approve
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => approve(l.id, false)} className="h-6 text-[10px] px-2 gap-1 border-red-200 text-red-700">
                              <XCircle size={10} />Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
