import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, ChevronRight } from "lucide-react";

interface Props {
  hospitalId: string | null;
  dateRange: { start: string; end: string };
}

const TYPE_COLORS: Record<string, string> = {
  asset: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  liability: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  equity: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  revenue: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  expense: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const LedgerTab: React.FC<Props> = ({ hospitalId }) => {
  const [accounts, setAccounts] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedAccount, setSelectedAccount] = useState<any>(null);
  const [lineItems, setLineItems] = useState<any[]>([]);

  useEffect(() => {
    if (!hospitalId) return;
    loadAccounts();
  }, [hospitalId]);

  const loadAccounts = async () => {
    const { data } = await (supabase as any)
      .from("chart_of_accounts")
      .select("*")
      .eq("hospital_id", hospitalId!)
      .eq("is_active", true)
      .order("code");
    setAccounts(data || []);
  };

  const loadLedger = async (account: any) => {
    setSelectedAccount(account);
    const { data } = await supabase
      .from("journal_line_items")
      .select("*, journal:journal_entries(entry_number, entry_date, description)")
      .eq("account_id", account.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setLineItems(data || []);
  };

  const filtered = accounts.filter(
    (a) =>
      (typeFilter === "all" || a.account_type === typeFilter) &&
      (a.code?.toLowerCase().includes(search.toLowerCase()) || a.name?.toLowerCase().includes(search.toLowerCase()))
  );

  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  if (selectedAccount) {
    let runningBalance = 0;
    return (
      <div className="p-5">
        <button onClick={() => setSelectedAccount(null)} className="text-xs text-primary mb-3 hover:underline">
          ← Back to Chart of Accounts
        </button>
        <h3 className="text-sm font-bold mb-1">{selectedAccount.code} — {selectedAccount.name}</h3>
        <Badge className={TYPE_COLORS[selectedAccount.account_type] || ""}>{selectedAccount.account_type}</Badge>
        <div className="mt-4 border border-border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Date</TableHead>
                <TableHead className="text-xs">Entry #</TableHead>
                <TableHead className="text-xs">Description</TableHead>
                <TableHead className="text-xs text-right">Debit</TableHead>
                <TableHead className="text-xs text-right">Credit</TableHead>
                <TableHead className="text-xs text-right">Balance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lineItems.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No transactions</TableCell></TableRow>
              ) : (
                lineItems.reverse().map((li) => {
                  runningBalance += Number(li.debit_amount || 0) - Number(li.credit_amount || 0);
                  return (
                    <TableRow key={li.id}>
                      <TableCell className="text-xs">{(li as any).journal?.entry_date}</TableCell>
                      <TableCell className="text-xs font-mono">{(li as any).journal?.entry_number}</TableCell>
                      <TableCell className="text-xs">{li.description || (li as any).journal?.description}</TableCell>
                      <TableCell className="text-xs text-right">{Number(li.debit_amount) > 0 ? fmt(li.debit_amount) : ""}</TableCell>
                      <TableCell className="text-xs text-right">{Number(li.credit_amount) > 0 ? fmt(li.credit_amount) : ""}</TableCell>
                      <TableCell className="text-xs text-right font-semibold">{fmt(runningBalance)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input placeholder="Search accounts..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9 h-9 text-xs" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-36 h-9 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all" className="text-xs">All Types</SelectItem>
            <SelectItem value="asset" className="text-xs">Assets</SelectItem>
            <SelectItem value="liability" className="text-xs">Liabilities</SelectItem>
            <SelectItem value="equity" className="text-xs">Equity</SelectItem>
            <SelectItem value="revenue" className="text-xs">Revenue</SelectItem>
            <SelectItem value="expense" className="text-xs">Expenses</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs w-24">Code</TableHead>
              <TableHead className="text-xs">Account Name</TableHead>
              <TableHead className="text-xs w-28">Type</TableHead>
              <TableHead className="text-xs w-28">Subtype</TableHead>
              <TableHead className="text-xs w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((a) => (
              <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => loadLedger(a)}>
                <TableCell className="text-xs font-mono font-semibold">{a.code}</TableCell>
                <TableCell className="text-xs font-medium">{a.name}</TableCell>
                <TableCell><Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[a.account_type] || ""}`}>{a.account_type}</Badge></TableCell>
                <TableCell className="text-[10px] text-muted-foreground">{a.account_subtype || "—"}</TableCell>
                <TableCell><ChevronRight size={14} className="text-muted-foreground" /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default LedgerTab;
