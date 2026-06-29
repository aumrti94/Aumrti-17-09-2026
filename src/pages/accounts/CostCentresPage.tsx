import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

const PERIODS = [
  { value: "this_month", label: "This Month" },
  { value: "last_month", label: "Last Month" },
  { value: "this_quarter", label: "This Quarter" },
  { value: "this_year", label: "This Year" },
];

const getDateRange = (period: string) => {
  const now = new Date();
  let start: Date, end: Date;
  switch (period) {
    case "last_month":
      start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      end = new Date(now.getFullYear(), now.getMonth(), 0);
      break;
    case "this_quarter":
      start = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      end = now;
      break;
    case "this_year":
      start = new Date(now.getFullYear(), now.getMonth() < 3 ? -9 : 3, 1);
      end = now;
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      end = now;
  }
  return { start: start.toISOString().split("T")[0], end: end.toISOString().split("T")[0] };
};

const fmt = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const CostCentresPage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const navigate = useNavigate();
  const [period, setPeriod] = useState("this_month");
  const [departments, setDepartments] = useState<{ id: string; name: string }[]>([]);
  const [lineItems, setLineItems] = useState<{ cost_centre_id: string; debit_amount: number; credit_amount: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const [budgets, setBudgets] = useState<Record<string, string>>({});

  const dateRange = getDateRange(period);

  useEffect(() => {
    if (!hospitalId) return;
    loadData();
  }, [hospitalId, period]);

  useEffect(() => {
    if (!hospitalId) return;
    // Load budgets from localStorage
    const saved: Record<string, string> = {};
    departments.forEach(d => {
      const key = `hms_ccbudget_${hospitalId}_${d.id}`;
      const val = localStorage.getItem(key);
      if (val) saved[d.id] = val;
    });
    setBudgets(saved);
  }, [departments, hospitalId]);

  const loadData = async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [{ data: depts }, { data: items }] = await Promise.all([
      supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).order("name"),
      (supabase as any)
        .from("journal_line_items")
        .select("cost_centre_id, account_code, debit_amount, credit_amount")
        .eq("hospital_id", hospitalId)
        .not("cost_centre_id", "is", null)
        .like("account_code", "5%")
        .gte("created_at", dateRange.start)
        .lte("created_at", dateRange.end + "T23:59:59"),
    ]);
    setDepartments(depts || []);
    setLineItems(items || []);
    setLoading(false);
  };

  const spendByDept = useMemo(() => {
    const map: Record<string, number> = {};
    for (const li of lineItems) {
      if (!li.cost_centre_id) continue;
      map[li.cost_centre_id] = (map[li.cost_centre_id] || 0) + Number(li.debit_amount || 0) - Number(li.credit_amount || 0);
    }
    return map;
  }, [lineItems]);

  const saveBudget = (deptId: string, value: string) => {
    if (!hospitalId) return;
    localStorage.setItem(`hms_ccbudget_${hospitalId}_${deptId}`, value);
    setBudgets(prev => ({ ...prev, [deptId]: value }));
  };

  const totalSpend = departments.reduce((s, d) => s + (spendByDept[d.id] || 0), 0);
  const totalBudget = departments.reduce((s, d) => s + (parseFloat(budgets[d.id] || "0") || 0), 0);

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/accounts")} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft size={18} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-foreground">Cost Centres</h1>
            <p className="text-sm text-muted-foreground">Expense tracking by department with budget targets</p>
          </div>
        </div>
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-40 h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map(p => <SelectItem key={p.value} value={p.value} className="text-xs">{p.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center flex-1">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Card className="border-border flex-1">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Department Expense Tracking — {dateRange.start} to {dateRange.end}</CardTitle>
              <p className="text-xs text-muted-foreground">Enter monthly budget per department to track variance</p>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Cost Centre (Department)</TableHead>
                  <TableHead className="text-xs text-right">Actual Spend</TableHead>
                  <TableHead className="text-xs text-right w-40">Monthly Budget (₹)</TableHead>
                  <TableHead className="text-xs text-right">Variance</TableHead>
                  <TableHead className="text-xs">Utilisation</TableHead>
                  <TableHead className="text-xs text-center">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {departments.map(dept => {
                  const actual = spendByDept[dept.id] || 0;
                  const budget = parseFloat(budgets[dept.id] || "0") || 0;
                  const variance = budget - actual;
                  const utilPct = budget > 0 ? Math.min((actual / budget) * 100, 100) : 0;
                  const overBudget = budget > 0 && actual > budget;

                  return (
                    <TableRow key={dept.id}>
                      <TableCell className="text-xs font-medium">{dept.name}</TableCell>
                      <TableCell className="text-xs text-right font-mono">{fmt(actual)}</TableCell>
                      <TableCell className="text-xs text-right">
                        <Input
                          type="number"
                          placeholder="—"
                          value={budgets[dept.id] || ""}
                          onChange={e => setBudgets(prev => ({ ...prev, [dept.id]: e.target.value }))}
                          onBlur={e => saveBudget(dept.id, e.target.value)}
                          className="h-7 text-xs text-right w-36 ml-auto"
                        />
                      </TableCell>
                      <TableCell className={`text-xs text-right font-mono ${budget === 0 ? "text-muted-foreground" : variance >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-500"}`}>
                        {budget === 0 ? "—" : variance >= 0 ? `+${fmt(variance)}` : `(${fmt(Math.abs(variance))})`}
                      </TableCell>
                      <TableCell className="w-32">
                        {budget > 0 ? (
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-2 bg-muted rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${utilPct >= 100 ? "bg-red-500" : utilPct >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
                                style={{ width: `${utilPct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-muted-foreground w-8 text-right">{utilPct.toFixed(0)}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-center">
                        {budget > 0 ? (
                          <Badge variant="outline" className={`text-[9px] ${overBudget ? "border-red-300 text-red-600 bg-red-50 dark:bg-red-950/20" : "border-emerald-300 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/20"}`}>
                            {overBudget ? "Over" : "On Track"}
                          </Badge>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
                {departments.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-xs text-muted-foreground py-8">No departments found. Add departments in Settings → Departments.</TableCell>
                  </TableRow>
                )}
                {departments.length > 0 && (
                  <TableRow className="border-t-2 bg-muted/30 font-bold">
                    <TableCell className="text-xs font-bold">TOTAL</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{fmt(totalSpend)}</TableCell>
                    <TableCell className="text-xs text-right font-mono font-bold">{totalBudget > 0 ? fmt(totalBudget) : "—"}</TableCell>
                    <TableCell className={`text-xs text-right font-mono font-bold ${totalBudget === 0 ? "text-muted-foreground" : totalBudget - totalSpend >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-500"}`}>
                      {totalBudget === 0 ? "—" : totalBudget - totalSpend >= 0 ? `+${fmt(totalBudget - totalSpend)}` : `(${fmt(Math.abs(totalBudget - totalSpend))})`}
                    </TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                )}
              </TableBody>
            </Table>
            <p className="text-[10px] text-muted-foreground mt-3">Budget amounts are saved locally in your browser. Actual spend is sourced from journal line items tagged with cost centre.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default CostCentresPage;
