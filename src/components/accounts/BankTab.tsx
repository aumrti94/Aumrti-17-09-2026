import React, { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Landmark, Plus, Upload, Bot, CheckCircle2, Link2, Search, Loader2, X } from "lucide-react";
import { toast } from "sonner";

interface Props {
  hospitalId: string | null;
}

interface BankAccount {
  id: string;
  account_name: string;
  bank_name: string;
  account_number: string;
  opening_balance: number;
}

interface BankTxn {
  id: string;
  transaction_date: string;
  description: string;
  debit_amount: number | null;
  credit_amount: number | null;
  balance: number | null;
  reference: string | null;
  is_reconciled: boolean;
  reconciled_with: string | null;
  bank_account_id: string;
}

interface JournalLine {
  id: string;
  account_code: string;
  debit_amount: number;
  credit_amount: number;
  created_at: string;
  journal_entry_id: string;
}

const fmt = (n: number) => `₹${Math.abs(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

const BankTab: React.FC<Props> = ({ hospitalId }) => {
  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([]);
  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [transactions, setTransactions] = useState<BankTxn[]>([]);
  const [loading, setLoading] = useState(false);

  // CSV import
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvData, setCsvData] = useState<string[][]>([]);
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [colMap, setColMap] = useState<{ date: string; desc: string; debit: string; credit: string }>({ date: "", desc: "", debit: "", credit: "" });
  const [showImport, setShowImport] = useState(false);

  // Manual add
  const [showManual, setShowManual] = useState(false);
  const [manualForm, setManualForm] = useState({ date: new Date().toISOString().split("T")[0], description: "", debit: "", credit: "", reference: "" });

  // Match modal
  const [matchTxn, setMatchTxn] = useState<BankTxn | null>(null);
  const [journalLines, setJournalLines] = useState<JournalLine[]>([]);
  const [matchSearch, setMatchSearch] = useState("");
  const [autoMatching, setAutoMatching] = useState(false);

  // Opening balance
  const [openingBalance, setOpeningBalance] = useState<number>(0);

  useEffect(() => {
    if (!hospitalId) return;
    loadBankAccounts();
  }, [hospitalId]);

  const loadBankAccounts = async () => {
    const { data } = await supabase.from("bank_accounts").select("*").eq("hospital_id", hospitalId!).eq("is_active", true);
    setBankAccounts(data || []);
  };

  const loadTransactions = useCallback(async (bankId: string) => {
    setLoading(true);
    const { data } = await supabase.from("bank_transactions").select("*").eq("bank_account_id", bankId).order("transaction_date", { ascending: false }).limit(200);
    setTransactions(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (selectedBankId) loadTransactions(selectedBankId);
  }, [selectedBankId, loadTransactions]);

  // ─── CSV Upload ───
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split("\n").map(l => l.split(",").map(c => c.trim().replace(/^"|"$/g, "")));
      if (lines.length < 2) { toast.error("CSV too short"); return; }
      setCsvHeaders(lines[0]);
      setCsvData(lines.slice(1).filter(l => l.length >= 2 && l.some(c => c.length > 0)));
      setShowImport(true);
    };
    reader.readAsText(file);
  };

  const importCSV = async () => {
    if (!selectedBankId || !hospitalId) return;
    const rows = csvData.map(row => {
      const dateIdx = csvHeaders.indexOf(colMap.date);
      const descIdx = csvHeaders.indexOf(colMap.desc);
      const debitIdx = csvHeaders.indexOf(colMap.debit);
      const creditIdx = csvHeaders.indexOf(colMap.credit);
      return {
        bank_account_id: selectedBankId,
        hospital_id: hospitalId,
        transaction_date: row[dateIdx] || new Date().toISOString().split("T")[0],
        description: row[descIdx] || "",
        debit_amount: Math.abs(parseFloat(row[debitIdx]?.replace(/,/g, "") || "0")) || 0,
        credit_amount: Math.abs(parseFloat(row[creditIdx]?.replace(/,/g, "") || "0")) || 0,
        is_reconciled: false,
      };
    }).filter(r => r.description && (r.debit_amount > 0 || r.credit_amount > 0));

    const { error } = await supabase.from("bank_transactions").insert(rows);
    if (error) { toast.error("Import failed: " + error.message); return; }
    toast.success(`Imported ${rows.length} transactions`);
    setShowImport(false);
    setCsvData([]);
    loadTransactions(selectedBankId);
  };

  // ─── Manual Transaction ───
  const addManualTxn = async () => {
    if (!selectedBankId || !hospitalId) return;
    const { error } = await supabase.from("bank_transactions").insert({
      bank_account_id: selectedBankId,
      hospital_id: hospitalId,
      transaction_date: manualForm.date,
      description: manualForm.description,
      debit_amount: parseFloat(manualForm.debit) || 0,
      credit_amount: parseFloat(manualForm.credit) || 0,
      reference: manualForm.reference || null,
      is_reconciled: false,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Transaction added");
    setShowManual(false);
    setManualForm({ date: new Date().toISOString().split("T")[0], description: "", debit: "", credit: "", reference: "" });
    loadTransactions(selectedBankId);
  };

  // ─── Match Modal ───
  const openMatchModal = async (txn: BankTxn) => {
    setMatchTxn(txn);
    if (!hospitalId) return;
    // Find journal line items for bank/cash accounts around the transaction date
    const { data } = await (supabase as any)
      .from("journal_line_items")
      .select("id, account_code, debit_amount, credit_amount, created_at, journal_entry_id")
      .eq("hospital_id", hospitalId)
      .in("account_code", ["1001", "1002", "1003"])
      .order("created_at", { ascending: false })
      .limit(50);
    setJournalLines(data || []);
  };

  const confirmMatch = async (lineItemId: string) => {
    if (!matchTxn) return;
    const { error } = await (supabase as any).from("bank_transactions").update({ is_reconciled: true, reconciled_with: lineItemId }).eq("id", matchTxn.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Transaction reconciled");
    setMatchTxn(null);
    loadTransactions(selectedBankId);
  };

  // ─── Auto-Match ───
  const runAutoMatch = async () => {
    if (!hospitalId || !selectedBankId) return;
    setAutoMatching(true);
    const unreconciled = transactions.filter(t => !t.is_reconciled);
    const { data: allLines } = await (supabase as any)
      .from("journal_line_items")
      .select("id, account_code, debit_amount, credit_amount, created_at, journal_entry_id")
      .eq("hospital_id", hospitalId)
      .in("account_code", ["1001", "1002", "1003"]);

    let matched = 0;
    const usedLineIds = new Set<string>();

    for (const txn of unreconciled) {
      const txnDebit = Number(txn.debit_amount || 0);
      const txnCredit = Number(txn.credit_amount || 0);
      const txnDate = new Date(txn.transaction_date);

      const match = (allLines || []).find(li => {
        if (usedLineIds.has(li.id)) return false;
        const liDebit = Number(li.debit_amount || 0);
        const liCredit = Number(li.credit_amount || 0);
        const liDate = new Date(li.created_at);
        const dayDiff = Math.abs(txnDate.getTime() - liDate.getTime()) / 86400000;
        // Bank debit matches journal credit and vice versa
        const amountMatch = (txnDebit > 0 && Math.abs(txnDebit - liCredit) < 0.01) ||
                           (txnCredit > 0 && Math.abs(txnCredit - liDebit) < 0.01);
        return amountMatch && dayDiff <= 2;
      });

      if (match) {
        await (supabase as any).from("bank_transactions").update({ is_reconciled: true, reconciled_with: match.id }).eq("id", txn.id);
        usedLineIds.add(match.id);
        matched++;
      }
    }

    toast.success(`Auto-matched ${matched} of ${unreconciled.length} transactions`);
    setAutoMatching(false);
    loadTransactions(selectedBankId);
  };

  // ─── Calculations ───
  const unreconciledTxns = transactions.filter(t => !t.is_reconciled);
  const reconciledTxns = transactions.filter(t => t.is_reconciled);
  const closingBalance = transactions.reduce((s, t) => s + Number(t.credit_amount || 0) - Number(t.debit_amount || 0), openingBalance);
  const unclearedDeposits = unreconciledTxns.reduce((s, t) => s + Number(t.credit_amount || 0), 0);
  const outstandingCheques = unreconciledTxns.reduce((s, t) => s + Number(t.debit_amount || 0), 0);

  const selectedBank = bankAccounts.find(b => b.id === selectedBankId);

  return (
    <div className="p-5 space-y-4">
      {/* Bank Account Selection */}
      <div className="flex items-center gap-4 flex-wrap">
        <Select value={selectedBankId} onValueChange={setSelectedBankId}>
          <SelectTrigger className="w-72 h-9 text-xs">
            <SelectValue placeholder="Select bank account..." />
          </SelectTrigger>
          <SelectContent>
            {bankAccounts.map(a => (
              <SelectItem key={a.id} value={a.id} className="text-xs">{a.account_name} — {a.bank_name} ({a.account_number})</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {bankAccounts.length === 0 && (
          <p className="text-xs text-muted-foreground">No bank accounts configured. Add in Settings.</p>
        )}
      </div>

      {selectedBankId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* ─── LEFT: Import & Transactions ─── */}
          <div className="space-y-4">
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Bank Reconciliation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Import Section */}
                <div>
                  <p className="text-xs font-semibold mb-2">Import Bank Statement</p>
                  <div
                    className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                    onClick={() => fileRef.current?.click()}
                  >
                    <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
                    <p className="text-xs font-medium text-foreground">Upload bank statement CSV</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Supported: SBI, HDFC, ICICI, Axis, Kotak, PNB</p>
                    <input ref={fileRef} type="file" accept=".csv,.xlsx" className="hidden" onChange={handleFileUpload} />
                  </div>
                </div>

                {/* Manual Add */}
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowManual(!showManual)}>
                    <Plus className="h-3 w-3 mr-1" /> Add Transaction
                  </Button>
                  <Button size="sm" variant="outline" className="text-xs" onClick={runAutoMatch} disabled={autoMatching || unreconciledTxns.length === 0}>
                    {autoMatching ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Bot className="h-3 w-3 mr-1" />}
                    Auto-Match
                  </Button>
                </div>

                {showManual && (
                  <div className="grid grid-cols-5 gap-2 p-3 border border-border rounded-md bg-muted/30">
                    <Input type="date" className="text-xs h-8" value={manualForm.date} onChange={e => setManualForm(p => ({ ...p, date: e.target.value }))} />
                    <Input placeholder="Description" className="text-xs h-8 col-span-2" value={manualForm.description} onChange={e => setManualForm(p => ({ ...p, description: e.target.value }))} />
                    <Input placeholder="Debit ₹" type="number" className="text-xs h-8" value={manualForm.debit} onChange={e => setManualForm(p => ({ ...p, debit: e.target.value }))} />
                    <Input placeholder="Credit ₹" type="number" className="text-xs h-8" value={manualForm.credit} onChange={e => setManualForm(p => ({ ...p, credit: e.target.value }))} />
                    <Input placeholder="Reference" className="text-xs h-8 col-span-3" value={manualForm.reference} onChange={e => setManualForm(p => ({ ...p, reference: e.target.value }))} />
                    <Button size="sm" className="text-xs h-8 col-span-2" onClick={addManualTxn}>Save</Button>
                  </div>
                )}

                {/* Opening Balance */}
                <div className="flex items-center gap-2">
                  <label className="text-xs text-muted-foreground whitespace-nowrap">Opening Balance (as per bank):</label>
                  <Input type="number" className="text-xs h-8 w-40" value={openingBalance} onChange={e => setOpeningBalance(parseFloat(e.target.value) || 0)} />
                </div>
              </CardContent>
            </Card>

            {/* Reconciliation Summary */}
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-xs">Reconciliation Summary</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-muted-foreground">Closing balance per bank</span><span className="font-mono font-medium">{fmt(closingBalance)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Opening balance in books</span><span className="font-mono">{fmt(openingBalance)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Add: Uncleared deposits</span><span className="font-mono text-emerald-600">{fmt(unclearedDeposits)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Less: Outstanding cheques</span><span className="font-mono text-red-500">({fmt(outstandingCheques)})</span></div>
                  <div className="border-t border-border pt-1.5 mt-1.5 flex justify-between font-semibold">
                    <span>Adjusted book balance</span>
                    <span className="font-mono">{fmt(closingBalance - unclearedDeposits + outstandingCheques)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Difference</span>
                    <span className={`font-mono font-medium ${Math.abs(unclearedDeposits - outstandingCheques) < 0.01 ? "text-emerald-600" : "text-red-500"}`}>
                      {fmt(unclearedDeposits - outstandingCheques)}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs">
                  <Badge variant="outline" className="text-[10px]">{reconciledTxns.length} reconciled</Badge>
                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">{unreconciledTxns.length} pending</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ─── RIGHT: Reconciliation Table ─── */}
          <Card className="border-border">
            <CardContent className="p-0">
              <Tabs defaultValue="unreconciled">
                <TabsList className="h-9 rounded-none border-b border-border bg-muted/30 w-full justify-start px-3">
                  <TabsTrigger value="unreconciled" className="text-xs">Unreconciled ({unreconciledTxns.length})</TabsTrigger>
                  <TabsTrigger value="reconciled" className="text-xs">Reconciled ({reconciledTxns.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="unreconciled" className="m-0">
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Description</TableHead>
                          <TableHead className="text-xs text-right">Amount</TableHead>
                          <TableHead className="text-xs w-24">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unreconciledTxns.length === 0 ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-8">
                            <CheckCircle2 className="h-5 w-5 mx-auto mb-1 text-emerald-500" />All transactions reconciled
                          </TableCell></TableRow>
                        ) : unreconciledTxns.map(t => (
                          <TableRow key={t.id}>
                            <TableCell className="text-xs font-mono">{t.transaction_date}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{t.description}</TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {Number(t.debit_amount) > 0 && <span className="text-red-500">-{fmt(Number(t.debit_amount))}</span>}
                              {Number(t.credit_amount) > 0 && <span className="text-emerald-600">+{fmt(Number(t.credit_amount))}</span>}
                            </TableCell>
                            <TableCell>
                              <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2" onClick={() => openMatchModal(t)}>
                                <Link2 className="h-3 w-3 mr-0.5" />Match
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>

                <TabsContent value="reconciled" className="m-0">
                  <div className="max-h-[500px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Date</TableHead>
                          <TableHead className="text-xs">Description</TableHead>
                          <TableHead className="text-xs text-right">Amount</TableHead>
                          <TableHead className="text-xs text-center">Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {reconciledTxns.length === 0 ? (
                          <TableRow><TableCell colSpan={4} className="text-center text-xs text-muted-foreground py-8">No reconciled transactions</TableCell></TableRow>
                        ) : reconciledTxns.map(t => (
                          <TableRow key={t.id}>
                            <TableCell className="text-xs font-mono">{t.transaction_date}</TableCell>
                            <TableCell className="text-xs max-w-[200px] truncate">{t.description}</TableCell>
                            <TableCell className="text-xs text-right font-mono">
                              {Number(t.debit_amount) > 0 && <span>-{fmt(Number(t.debit_amount))}</span>}
                              {Number(t.credit_amount) > 0 && <span>{fmt(Number(t.credit_amount))}</span>}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline" className="text-[9px] bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400">✓ Matched</Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ─── CSV Column Mapping Modal ─── */}
      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">Map CSV Columns</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">Found {csvData.length} rows. Map columns:</p>
            {["date", "desc", "debit", "credit"].map(field => (
              <div key={field} className="flex items-center gap-2">
                <label className="text-xs w-20 capitalize">{field === "desc" ? "Description" : field}</label>
                <Select value={(colMap as any)[field]} onValueChange={v => setColMap(p => ({ ...p, [field]: v }))}>
                  <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="Select column" /></SelectTrigger>
                  <SelectContent>
                    {csvHeaders.map(h => <SelectItem key={h} value={h} className="text-xs">{h}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <Button size="sm" className="w-full" onClick={importCSV} disabled={!colMap.date || !colMap.desc}>
              Import {csvData.length} Transactions
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Match Modal ─── */}
      <Dialog open={!!matchTxn} onOpenChange={() => setMatchTxn(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-sm">Match Bank Transaction</DialogTitle>
          </DialogHeader>
          {matchTxn && (
            <div className="space-y-4">
              <Card className="border-border bg-muted/30">
                <CardContent className="p-3 text-xs space-y-1">
                  <p><strong>Date:</strong> {matchTxn.transaction_date}</p>
                  <p><strong>Description:</strong> {matchTxn.description}</p>
                  <p><strong>Amount:</strong> {Number(matchTxn.debit_amount) > 0 ? `-${fmt(Number(matchTxn.debit_amount))}` : `+${fmt(Number(matchTxn.credit_amount))}`}</p>
                </CardContent>
              </Card>

              <div className="relative">
                <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
                <Input placeholder="Search journal entries..." className="pl-8 h-8 text-xs" value={matchSearch} onChange={e => setMatchSearch(e.target.value)} />
              </div>

              <div className="max-h-[250px] overflow-auto border border-border rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px]">Date</TableHead>
                      <TableHead className="text-[10px]">Account</TableHead>
                      <TableHead className="text-[10px] text-right">Debit</TableHead>
                      <TableHead className="text-[10px] text-right">Credit</TableHead>
                      <TableHead className="text-[10px] w-16"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {journalLines.filter(li => {
                      if (!matchSearch) return true;
                      return li.account_code.includes(matchSearch) || li.created_at.includes(matchSearch);
                    }).map(li => (
                      <TableRow key={li.id}>
                        <TableCell className="text-[10px] font-mono">{li.created_at.split("T")[0]}</TableCell>
                        <TableCell className="text-[10px]">{li.account_code}</TableCell>
                        <TableCell className="text-[10px] text-right font-mono">{Number(li.debit_amount) > 0 ? fmt(Number(li.debit_amount)) : "—"}</TableCell>
                        <TableCell className="text-[10px] text-right font-mono">{Number(li.credit_amount) > 0 ? fmt(Number(li.credit_amount)) : "—"}</TableCell>
                        <TableCell>
                          <Button size="sm" variant="ghost" className="text-[10px] h-6 px-2" onClick={() => confirmMatch(li.id)}>
                            <CheckCircle2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default BankTab;
