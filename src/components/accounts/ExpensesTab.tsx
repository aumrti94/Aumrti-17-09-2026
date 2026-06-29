import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { postManualExpenseJournal, EXPENSE_CATEGORY_ACCOUNT } from "@/lib/accounting";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Download, Upload, Banknote, Building2, FileText, Smartphone, CreditCard } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  hospitalId: string | null;
  dateRange: { start: string; end: string };
  userId?: string | null;
}

const CATEGORIES = [
  { value: "salary", label: "Salaries" }, { value: "rent", label: "Rent" },
  { value: "electricity", label: "Electricity" }, { value: "water", label: "Water" },
  { value: "telephone", label: "Telephone" }, { value: "internet", label: "Internet" },
  { value: "fuel", label: "Fuel" }, { value: "vehicle", label: "Vehicle" },
  { value: "maintenance", label: "Equipment Maintenance" }, { value: "repair", label: "Building Maintenance" },
  { value: "housekeeping", label: "Housekeeping" }, { value: "insurance", label: "Insurance" },
  { value: "professional_fees", label: "Professional Fees" }, { value: "marketing", label: "Marketing" },
  { value: "printing", label: "Printing & Stationery" }, { value: "bank_charges", label: "Bank Charges" },
  { value: "miscellaneous", label: "Miscellaneous" }, { value: "other", label: "Other" },
];

const PAYMENT_MODES = [
  { value: "cash", label: "💵 Cash", icon: Banknote },
  { value: "bank_transfer", label: "🏦 Bank Transfer", icon: Building2 },
  { value: "cheque", label: "📜 Cheque", icon: FileText },
  { value: "upi", label: "📱 UPI", icon: Smartphone },
  { value: "card", label: "💳 Card", icon: CreditCard },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(CATEGORIES.map(c => [c.value, c.label]));

type TimeFilter = "all" | "this_week" | "this_month";

const ExpensesTab: React.FC<Props> = ({ hospitalId, dateRange, userId }) => {
  const { toast } = useToast();
  const [expenses, setExpenses] = useState<any[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [catFilter, setCatFilter] = useState("all");
  const [receiptFile, setReceiptFile] = useState<File | null>(null);

  const [form, setForm] = useState({
    expense_date: new Date().toISOString().split("T")[0],
    expense_category: "miscellaneous",
    vendor_name: "",
    description: "",
    amount: "",
    gst_amount: "0",
    payment_mode: "cash",
    reference_number: "",
    department_id: "",
  });

  useEffect(() => {
    if (!hospitalId) return;
    loadExpenses();
    supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).order("name", { ascending: true }).then(({ data }) => setDepartments(data || []));
  }, [hospitalId, dateRange]);

  const loadExpenses = async () => {
    const { data } = await supabase.from("expense_records").select("*")
      .eq("hospital_id", hospitalId!).gte("expense_date", dateRange.start).lte("expense_date", dateRange.end)
      .order("expense_date", { ascending: false });
    setExpenses(data || []);
  };

  const totalAmount = (Number(form.amount) || 0) + (Number(form.gst_amount) || 0);
  const update = (k: string, v: string) => setForm({ ...form, [k]: v });

  const handleSave = async () => {
    if (!hospitalId || !userId) return;
    if (!form.description || !form.amount) { toast({ title: "Fill description and amount", variant: "destructive" }); return; }
    setSaving(true);

    let receiptUrl: string | null = null;
    if (receiptFile) {
      const path = `${hospitalId}/${form.expense_date}/${Date.now()}-${receiptFile.name}`;
      const { data: upload } = await supabase.storage.from("hospital-assets").upload(`expense-receipts/${path}`, receiptFile);
      if (upload?.path) {
        const { data: urlData } = supabase.storage.from("hospital-assets").getPublicUrl(`expense-receipts/${path}`);
        receiptUrl = urlData?.publicUrl || null;
      }
    }

    const { data: expense, error } = await supabase.from("expense_records").insert({
      hospital_id: hospitalId,
      expense_date: form.expense_date,
      expense_category: form.expense_category as any,
      vendor_name: form.vendor_name || null,
      description: form.description,
      amount: Number(form.amount),
      gst_amount: Number(form.gst_amount) || 0,
      total_amount: totalAmount,
      payment_mode: form.payment_mode as any,
      reference_number: form.reference_number || null,
      department_id: form.department_id || null,
      receipt_url: receiptUrl,
      created_by: userId,
    }).select().maybeSingle();

    if (error) { toast({ title: "Failed to save", variant: "destructive" }); setSaving(false); return; }

    const entry = await postManualExpenseJournal({
      hospitalId,
      postedBy: userId,
      amount: totalAmount,
      description: `Expense: ${form.description}`,
      expenseCategory: form.expense_category,
      paymentMode: form.payment_mode,
      sourceId: expense.id,
      costCentreId: form.department_id || undefined,
      entryDate: form.expense_date,
    });

    if (entry) {
      await supabase.from("expense_records").update({ journal_id: entry.id }).eq("id", expense.id);
    }

    toast({ title: `Expense recorded ₹${totalAmount.toLocaleString("en-IN")} — ${entry ? `JE ${entry.entry_number}` : ""}` });
    setSaving(false);
    setReceiptFile(null);
    setForm({ expense_date: new Date().toISOString().split("T")[0], expense_category: "miscellaneous", vendor_name: "", description: "", amount: "", gst_amount: "0", payment_mode: "cash", reference_number: "", department_id: "" });
    loadExpenses();
  };

  // Filtered expenses
  const filtered = expenses.filter(e => {
    if (catFilter !== "all" && e.expense_category !== catFilter) return false;
    if (timeFilter === "this_week") {
      const d = new Date(e.expense_date);
      const now = new Date();
      const weekAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      if (d < weekAgo) return false;
    }
    return true;
  });

  const filteredTotal = filtered.reduce((s, e) => s + Number(e.total_amount || 0), 0);
  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;

  return (
    <div className="flex h-full overflow-hidden">
      {/* LEFT: Expense Form (400px) */}
      <div className="w-[400px] flex-shrink-0 border-r border-border overflow-auto">
        <div className="p-5 space-y-3">
          <h2 className="text-sm font-bold text-foreground">Record Expense</h2>

          <div>
            <Label className="text-xs">Expense Date</Label>
            <Input type="date" value={form.expense_date} onChange={(e) => update("expense_date", e.target.value)} className="h-9 text-xs" />
          </div>

          <div>
            <Label className="text-xs">Expense Category</Label>
            <Select value={form.expense_category} onValueChange={(v) => update("expense_category", v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Vendor / Payee</Label>
            <Input value={form.vendor_name} onChange={(e) => update("vendor_name", e.target.value)} className="h-9 text-xs" placeholder="Who was paid" />
          </div>

          <div>
            <Label className="text-xs">Description *</Label>
            <Textarea value={form.description} onChange={(e) => update("description", e.target.value)} className="text-xs" rows={2} placeholder="e.g. Monthly rent for OPD block — April 2026" />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Amount (₹) *</Label>
              <Input type="number" value={form.amount} onChange={(e) => update("amount", e.target.value)} className="h-9 text-xs" />
            </div>
            <div>
              <Label className="text-xs">GST (₹)</Label>
              <Input type="number" value={form.gst_amount} onChange={(e) => update("gst_amount", e.target.value)} className="h-9 text-xs" />
            </div>
            <div>
              <Label className="text-xs">Total</Label>
              <Input value={`₹${totalAmount.toLocaleString("en-IN")}`} readOnly className="h-9 text-xs bg-muted font-semibold" />
            </div>
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Payment Mode</Label>
            <div className="flex gap-1.5 flex-wrap">
              {PAYMENT_MODES.map((m) => (
                <button key={m.value} onClick={() => update("payment_mode", m.value)}
                  className={cn("text-[10px] px-3 py-1.5 rounded-full border transition-colors",
                    form.payment_mode === m.value ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground hover:border-primary/50"
                  )}>
                  {m.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs">Reference Number</Label>
            <Input value={form.reference_number} onChange={(e) => update("reference_number", e.target.value)} className="h-9 text-xs" placeholder="Cheque / UTR no." />
          </div>

          <div>
            <Label className="text-xs">Department (cost centre)</Label>
            <Select value={form.department_id} onValueChange={(v) => update("department_id", v)}>
              <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Optional" /></SelectTrigger>
              <SelectContent>
                {departments.map((d) => <SelectItem key={d.id} value={d.id} className="text-xs">{d.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label className="text-xs">Receipt Upload</Label>
            <div className="mt-1">
              <label className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded-lg cursor-pointer hover:border-primary/50 transition-colors">
                <Upload size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{receiptFile ? receiptFile.name : "Upload receipt (jpg/png/pdf, max 5MB)"}</span>
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} />
              </label>
            </div>
          </div>

          <Button onClick={handleSave} disabled={saving} className="w-full h-11">
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Save Expense
          </Button>
        </div>
      </div>

      {/* RIGHT: Recent Expenses */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-shrink-0 px-5 py-3 border-b border-border flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {(["all", "this_week", "this_month"] as TimeFilter[]).map((t) => (
              <button key={t} onClick={() => setTimeFilter(t)}
                className={cn("text-[10px] px-3 py-1 rounded-full border transition-colors",
                  timeFilter === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
                )}>
                {t === "all" ? "All" : t === "this_week" ? "This Week" : "This Month"}
              </button>
            ))}
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="h-7 w-32 text-[10px]"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all" className="text-xs">All Categories</SelectItem>
                {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value} className="text-xs">{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-bold text-foreground">Total: {fmt(filteredTotal)}</span>
            <Button size="sm" variant="outline" className="h-7 text-[10px]"><Download size={12} className="mr-1" /> Export Excel</Button>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-5">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Category</TableHead>
                  <TableHead className="text-xs">Vendor</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs text-right">Amount</TableHead>
                  <TableHead className="text-xs">Payment</TableHead>
                  <TableHead className="text-xs">Dept</TableHead>
                  <TableHead className="text-xs text-center">Receipt</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No expenses</TableCell></TableRow>
                ) : (
                  filtered.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="text-xs">{e.expense_date}</TableCell>
                      <TableCell><Badge variant="outline" className="text-[10px]">{CATEGORY_LABELS[e.expense_category] || e.expense_category}</Badge></TableCell>
                      <TableCell className="text-xs">{e.vendor_name || "—"}</TableCell>
                      <TableCell className="text-xs max-w-[180px] truncate">{e.description}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{fmt(e.total_amount)}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{e.payment_mode?.replace(/_/g, " ")}</TableCell>
                      <TableCell className="text-[10px] text-muted-foreground">{departments.find(d => d.id === e.department_id)?.name || "—"}</TableCell>
                      <TableCell className="text-center">
                        {e.receipt_url ? <a href={e.receipt_url} target="_blank" className="text-primary text-[10px] hover:underline">View</a> : <span className="text-muted-foreground text-[10px]">—</span>}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

export default ExpensesTab;
