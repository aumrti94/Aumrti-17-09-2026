import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronDown, ChevronRight, Download, Search, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

interface Props {
  hospitalId: string | null;
  dateRange: { start: string; end: string };
}

const JournalTab: React.FC<Props> = ({ hospitalId, dateRange }) => {
  const { toast } = useToast();
  const [entries, setEntries] = useState<any[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<Record<string, any[]>>({});
  const [accounts, setAccounts] = useState<any[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [reversingId, setReversingId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => setCurrentUserId(data?.id || null));
    });
  }, []);

  // Filters
  const [fromDate, setFromDate] = useState(dateRange.start);
  const [toDate, setToDate] = useState(dateRange.end);
  const [typeFilter, setTypeFilter] = useState("all");
  const [accountFilter, setAccountFilter] = useState("all");
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    setFromDate(dateRange.start);
    setToDate(dateRange.end);
  }, [dateRange]);


  const loadAccounts = useCallback(async () => {
    const { data } = await (supabase as any).from("chart_of_accounts").select("id, code, name")
      .eq("hospital_id", hospitalId!).eq("is_active", true).order("code");
    setAccounts(data || []);
  }, [hospitalId]);

  const loadEntries = useCallback(async () => {
    let query = (supabase as any).from("journal_entries").select("*")
      .eq("hospital_id", hospitalId!)
      .gte("entry_date", fromDate).lte("entry_date", toDate)
      .order("created_at", { ascending: false }).limit(200);

    if (typeFilter === "auto") query = query.like("entry_type", "auto_%");
    else if (typeFilter === "manual") query = query.eq("entry_type", "manual");

    const { data } = await query;
    let results = data || [];

    // If account filter, we need to cross-reference
    if (accountFilter !== "all") {
      const { data: matchingLines } = await supabase.from("journal_line_items").select("journal_id")
        .eq("account_id", accountFilter);
      const journalIds = new Set((matchingLines || []).map(l => l.journal_id));
      results = results.filter(e => journalIds.has(e.id));
    }

    setEntries(results);
  }, [hospitalId, fromDate, toDate, typeFilter, accountFilter]);

  useEffect(() => {
    if (!hospitalId) return;
    loadEntries();
    loadAccounts();
  }, [hospitalId, fromDate, toDate, typeFilter, accountFilter, loadEntries, loadAccounts]);

  const reverseEntry = async (entry: any) => {
    if (!hospitalId || !currentUserId) return;
    if (!confirm(`Reverse journal entry ${entry.entry_number}? This posts a new balanced entry with debits/credits swapped and marks the original as reversed.`)) return;
    setReversingId(entry.id);
    const { data, error } = await (supabase as any).rpc("reverse_journal_entry", {
      p_hospital_id: hospitalId,
      p_journal_id: entry.id,
      p_reversed_by: currentUserId,
    });
    setReversingId(null);
    if (error || data?.status === "error") {
      toast({ title: "Reversal failed", description: error?.message || data?.message, variant: "destructive" });
      return;
    }
    toast({ title: `Reversed as ${data.reversal_entry_number} ✓` });
    loadEntries();
  };

  const toggleExpand = async (id: string) => {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!lineItems[id]) {
      const { data } = await supabase.from("journal_line_items").select("*")
        .eq("journal_id", id).order("debit_amount", { ascending: false });
      setLineItems(prev => ({ ...prev, [id]: data || [] }));
    }
  };

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  const filtered = entries.filter(e =>
    !searchTerm || e.entry_number?.toLowerCase().includes(searchTerm.toLowerCase()) || e.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const totalDebits = filtered.reduce((s, e) => s + Number(e.total_debit || 0), 0);
  const totalCredits = filtered.reduce((s, e) => s + Number(e.total_credit || 0), 0);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter Row */}
      <div className="flex-shrink-0 px-5 py-3 border-b border-border flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 w-36 text-xs" />
          <span className="text-xs text-muted-foreground">to</span>
          <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 w-36 text-xs" />
        </div>

        <div className="flex gap-1.5">
          {(["all", "auto", "manual"] as const).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={cn("text-[10px] px-3 py-1 rounded-full border transition-colors",
                typeFilter === t ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"
              )}>
              {t === "all" ? "All" : t === "auto" ? "Auto" : "Manual"}
            </button>
          ))}
        </div>

        <Select value={accountFilter} onValueChange={setAccountFilter}>
          <SelectTrigger className="h-8 w-48 text-xs"><SelectValue placeholder="Filter by account" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Accounts</SelectItem>
            {accounts.map(a => <SelectItem key={a.id} value={a.id} className="text-xs">{a.code} — {a.name}</SelectItem>)}
          </SelectContent>
        </Select>

        <div className="relative flex-1 min-w-[150px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search entry# or description" value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-8 h-8 text-xs" />
        </div>

        <Button size="sm" variant="outline" className="h-8 text-[10px]"><Download size={12} className="mr-1" /> Export</Button>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        <div className="px-5 py-3">
          <div className="border border-border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs w-8"></TableHead>
                  <TableHead className="text-xs">Entry #</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs">Description</TableHead>
                  <TableHead className="text-xs">Type</TableHead>
                  <TableHead className="text-xs text-right">Debit ₹</TableHead>
                  <TableHead className="text-xs text-right">Credit ₹</TableHead>
                  <TableHead className="text-xs">Source</TableHead>
                  <TableHead className="text-xs w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.length === 0 ? (
                  <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-8">No journal entries</TableCell></TableRow>
                ) : (
                  filtered.map((e) => {
                    // The RPC is the authority on whether an auto-posted entry is safe to
                    // reverse (bill-anchored only) — attempt is allowed here for any
                    // non-reversed, non-reversal entry; a subledger-touching entry (fixed
                    // assets, depreciation, inventory, ...) gets a clear rejection toast.
                    const canReverse = (e.entry_type === "manual" || e.entry_type?.startsWith("auto_")) && !e.reversed_at && !e.reversal_of;
                    return (
                    <React.Fragment key={e.id}>
                      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleExpand(e.id)}>
                        <TableCell className="w-8 px-2">
                          {expanded === e.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </TableCell>
                        <TableCell className="text-xs font-mono font-semibold">{e.entry_number}</TableCell>
                        <TableCell className="text-xs">{e.entry_date}</TableCell>
                        <TableCell className="text-xs max-w-[220px] truncate">{e.description}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 flex-wrap">
                            <Badge variant="outline" className={cn("text-[9px] px-2 py-0",
                              e.entry_type?.startsWith("auto")
                                ? "bg-primary/10 text-primary border-primary/30"
                                : e.entry_type === "reversal"
                                ? "bg-amber-50 text-amber-700 border-amber-300"
                                : "bg-muted text-muted-foreground border-border"
                            )}>
                              {e.entry_type?.startsWith("auto") ? "AUTO" : e.entry_type === "reversal" ? "REVERSAL" : "MANUAL"}
                            </Badge>
                            {e.reversed_at && (
                              <Badge variant="outline" className="text-[9px] px-2 py-0 bg-destructive/10 text-destructive border-destructive/30">REVERSED</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right font-medium">{fmt(e.total_debit)}</TableCell>
                        <TableCell className="text-xs text-right font-medium">{fmt(e.total_credit)}</TableCell>
                        <TableCell className="text-[10px] text-muted-foreground">{e.source_module || "—"}</TableCell>
                        <TableCell onClick={(ev) => ev.stopPropagation()}>
                          {canReverse && (
                            <Button
                              size="sm" variant="ghost"
                              className="h-6 px-2 text-[10px] gap-1 text-muted-foreground hover:text-destructive"
                              disabled={reversingId === e.id}
                              onClick={() => reverseEntry(e)}
                            >
                              <Undo2 size={11} /> {reversingId === e.id ? "…" : "Reverse"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                      {expanded === e.id && (lineItems[e.id] || []).map((li) => (
                        <TableRow key={li.id} className="bg-muted/20">
                          <TableCell></TableCell>
                          <TableCell className="text-[10px] font-mono text-muted-foreground">{li.account_code}</TableCell>
                          <TableCell colSpan={2} className="text-[10px] font-medium">{li.account_name}</TableCell>
                          <TableCell className="text-[10px] text-muted-foreground">{li.cost_centre_id ? "•" : ""}</TableCell>
                          <TableCell className="text-[10px] text-right">{Number(li.debit_amount) > 0 ? fmt(li.debit_amount) : ""}</TableCell>
                          <TableCell className="text-[10px] text-right">{Number(li.credit_amount) > 0 ? fmt(li.credit_amount) : ""}</TableCell>
                          <TableCell></TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      ))}
                    </React.Fragment>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </ScrollArea>

      {/* Totals Bar */}
      <div className="flex-shrink-0 h-10 bg-card border-t border-border flex items-center justify-end gap-6 px-5">
        <span className="text-xs text-muted-foreground">Total Debits: <span className="font-bold text-foreground">{fmt(totalDebits)}</span></span>
        <span className="text-xs text-muted-foreground">Total Credits: <span className="font-bold text-foreground">{fmt(totalCredits)}</span></span>
        {Math.abs(totalDebits - totalCredits) < 0.01 ? (
          <Badge variant="outline" className="text-[9px] bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">✓ Balanced</Badge>
        ) : (
          <Badge variant="outline" className="text-[9px] bg-destructive/10 text-destructive">✗ Unbalanced</Badge>
        )}
      </div>
    </div>
  );
};

export default JournalTab;
