import React, { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { EntityList } from "@/components/shared/EntityList";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Plus, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";

interface JELine {
  account_id: string;
  account_code: string;
  account_name: string;
  debit: string;
  credit: string;
}

const emptyLine = (): JELine => ({ account_id: "", account_code: "", account_name: "", debit: "", credit: "" });

export default function JournalWorkbenchPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");

  // Modal state
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ date: new Date().toISOString().split("T")[0], description: "" });
  const [lines, setLines] = useState<JELine[]>([emptyLine(), emptyLine()]);
  const [accounts, setAccounts] = useState<{ id: string; code: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  const { data: journals, isLoading } = useQuery({
    queryKey: ["journal_entries", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await supabase
        .from("journal_entries")
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("entry_date", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data;
    },
    enabled: !!hospitalId,
  });

  useEffect(() => {
    if (!showModal || !hospitalId) return;
    (supabase as any)
      .from("chart_of_accounts")
      .select("id, code, name")
      .eq("hospital_id", hospitalId)
      .eq("is_active", true)
      .eq("is_control", false)
      .order("code")
      .then(({ data }: any) => setAccounts(data || []));
  }, [showModal, hospitalId]);

  const filteredJournals = React.useMemo(() => {
    if (!journals) return [];
    if (!searchTerm) return journals;
    const lower = searchTerm.toLowerCase();
    return journals.filter(
      (j) =>
        j.entry_number?.toLowerCase().includes(lower) ||
        j.description?.toLowerCase().includes(lower) ||
        j.source_module?.toLowerCase().includes(lower)
    );
  }, [journals, searchTerm]);

  const totalDebit = lines.reduce((s, l) => s + (parseFloat(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseFloat(l.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0;

  const setLine = (idx: number, field: keyof JELine, value: string) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const pickAccount = (idx: number, accountId: string) => {
    const acct = accounts.find(a => a.id === accountId);
    if (!acct) return;
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, account_id: acct.id, account_code: acct.code, account_name: acct.name } : l));
  };

  const saveJE = async () => {
    if (!isBalanced || !hospitalId) return;
    const validLines = lines.filter(l => l.account_id && (parseFloat(l.debit) > 0 || parseFloat(l.credit) > 0));
    setSaving(true);
    const entryNumber = `MJE-${form.date.replace(/-/g, "")}-${Date.now().toString().slice(-4)}`;
    const { data: je, error } = await supabase.from("journal_entries").insert({
      hospital_id: hospitalId,
      entry_date: form.date,
      description: form.description,
      entry_number: entryNumber,
      entry_type: "manual",
      source_module: "accounts",
      total_debit: totalDebit,
      total_credit: totalCredit,
      is_balanced: true,
      is_auto: false,
    }).select("id").maybeSingle();
    if (error || !je) {
      toast({ title: "Save failed", description: error?.message, variant: "destructive" });
      setSaving(false);
      return;
    }
    await supabase.from("journal_line_items").insert(validLines.map(l => ({
      hospital_id: hospitalId,
      journal_entry_id: je.id,
      account_id: l.account_id,
      account_code: l.account_code,
      account_name: l.account_name,
      debit_amount: parseFloat(l.debit) || 0,
      credit_amount: parseFloat(l.credit) || 0,
    })));
    toast({ title: "Journal entry posted" });
    queryClient.invalidateQueries({ queryKey: ["journal_entries", hospitalId] });
    setShowModal(false);
    setForm({ date: new Date().toISOString().split("T")[0], description: "" });
    setLines([emptyLine(), emptyLine()]);
    setSaving(false);
  };

  const columns = [
    { key: "entry_date", header: "Date", render: (item: any) => new Date(item.entry_date).toLocaleDateString("en-IN") },
    { key: "entry_number", header: "JE Number", render: (item: any) => <span className="font-medium">{item.entry_number}</span> },
    { key: "description", header: "Description", render: (item: any) => <span className="text-muted-foreground truncate max-w-[300px] block">{item.description}</span> },
    { key: "source_module", header: "Source", render: (item: any) => <span className="capitalize">{item.source_module}</span> },
    { key: "total_debit", header: "Amount", render: (item: any) => <span className="font-medium">₹{item.total_debit.toLocaleString("en-IN", { minimumFractionDigits: 2 })}</span> },
    {
      key: "is_balanced",
      header: "Status",
      render: (item: any) => (
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${item.is_balanced ? "bg-emerald-50 text-emerald-700" : "bg-destructive/10 text-destructive"}`}>
          {item.is_balanced ? "Balanced" : "Unbalanced"}
        </span>
      ),
    },
  ];

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate("/accounts")} className="p-1.5 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-xl font-bold text-foreground">Journal Workbench</h1>
          <p className="text-sm text-muted-foreground">View and post manual and automated journal entries</p>
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <EntityList
          title="Recent Journal Entries"
          data={filteredJournals}
          columns={columns}
          isLoading={isLoading}
          searchPlaceholder="Search JE number or description..."
          onSearch={setSearchTerm}
          onAdd={() => setShowModal(true)}
        />
      </div>

      {/* New Journal Entry Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="text-sm">New Manual Journal Entry</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Date *</Label>
                <Input type="date" value={form.date} onChange={e => setForm(p => ({ ...p, date: e.target.value }))} className="h-8 text-xs" />
              </div>
              <div>
                <Label className="text-xs">Description / Narration *</Label>
                <Input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. Accrual adjustment" className="h-8 text-xs" />
              </div>
            </div>

            {/* Line Items */}
            <div>
              <div className="grid grid-cols-[1fr_110px_110px_32px] gap-2 mb-1 px-1">
                <span className="text-xs font-medium text-muted-foreground">Account</span>
                <span className="text-xs font-medium text-muted-foreground text-right">Debit (₹)</span>
                <span className="text-xs font-medium text-muted-foreground text-right">Credit (₹)</span>
                <span />
              </div>
              <div className="space-y-1.5">
                {lines.map((line, idx) => (
                  <div key={idx} className="grid grid-cols-[1fr_110px_110px_32px] gap-2 items-center">
                    <Select value={line.account_id} onValueChange={v => pickAccount(idx, v)}>
                      <SelectTrigger className="h-8 text-xs">
                        <SelectValue placeholder="Select account..." />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map(a => (
                          <SelectItem key={a.id} value={a.id} className="text-xs">{a.code} — {a.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={line.debit}
                      onChange={e => { setLine(idx, "debit", e.target.value); if (e.target.value) setLine(idx, "credit", ""); }}
                      className="h-8 text-xs text-right"
                    />
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={line.credit}
                      onChange={e => { setLine(idx, "credit", e.target.value); if (e.target.value) setLine(idx, "debit", ""); }}
                      className="h-8 text-xs text-right"
                    />
                    <button
                      onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}
                      disabled={lines.length <= 2}
                      className="h-8 w-8 flex items-center justify-center rounded text-muted-foreground hover:text-destructive disabled:opacity-30"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              <button onClick={() => setLines(prev => [...prev, emptyLine()])} className="mt-2 flex items-center gap-1 text-xs text-primary hover:underline">
                <Plus size={12} /> Add line
              </button>
            </div>

            {/* Balance indicator */}
            <div className={`flex items-center justify-between px-3 py-2 rounded-md text-xs font-medium ${isBalanced ? "bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700" : "bg-amber-50 dark:bg-amber-950/20 text-amber-700"}`}>
              <span>Debit: ₹{totalDebit.toFixed(2)} &nbsp;|&nbsp; Credit: ₹{totalCredit.toFixed(2)}</span>
              <span>{isBalanced ? "✓ Balanced" : `Off by ₹${Math.abs(totalDebit - totalCredit).toFixed(2)}`}</span>
            </div>

            <Button onClick={saveJE} disabled={!isBalanced || saving || !form.description} className="w-full">
              {saving ? "Posting..." : "Post Journal Entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
