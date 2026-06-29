import React, { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Download, AlertTriangle, Loader2, CheckCircle2 } from "lucide-react";
import { formatINR } from "@/lib/currency";

interface Props {
  hospitalId: string | null;
}

interface TBRow {
  account_code: string;
  account_name: string;
  account_type: string;
  total_debit: number;
  total_credit: number;
}

const TYPE_ORDER = ["asset", "liability", "equity", "income", "expense"] as const;
const TYPE_LABEL: Record<string, string> = {
  asset: "ASSETS",
  liability: "LIABILITIES",
  equity: "EQUITY",
  income: "INCOME",
  expense: "EXPENSES",
};

/** Default to current Indian financial year: 1 Apr → 31 Mar. */
function getDefaultFY(): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const fyStartYear = now.getMonth() >= 3 ? y : y - 1; // Jan–Mar belongs to previous FY
  return {
    from: `${fyStartYear}-04-01`,
    to: `${fyStartYear + 1}-03-31`,
  };
}

function downloadCSV(filename: string, headers: string[], rows: string[][]) {
  const csv = [
    headers.join(","),
    ...rows.map((r) => r.map((c) => `"${(c ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const TrialBalanceTab: React.FC<Props> = ({ hospitalId }) => {
  const fy = useMemo(getDefaultFY, []);
  const [fromDate, setFromDate] = useState(fy.from);
  const [toDate, setToDate] = useState(fy.to);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["trial-balance", hospitalId, fromDate, toDate],
    enabled: !!hospitalId && !!fromDate && !!toDate,
    queryFn: async (): Promise<TBRow[]> => {
      // Step 1 — fetch journal entry IDs in the date range (entry_date).
      const { data: entries, error: entriesErr } = await (supabase as any)
        .from("journal_entries")
        .select("id")
        .eq("hospital_id", hospitalId)
        .gte("entry_date", fromDate)
        .lte("entry_date", toDate);
      if (entriesErr) throw entriesErr;
      const entryIds = (entries || []).map((e: any) => e.id);
      if (entryIds.length === 0) return [];

      // Step 2 — fetch line items for those entries (paginated to bypass 1000-row limit).
      const allLines: any[] = [];
      const PAGE = 1000;
      for (let i = 0; i < entryIds.length; i += 200) {
        const slice = entryIds.slice(i, i + 200);
        let from = 0;
        while (true) {
          const { data: lines, error } = await (supabase as any)
            .from("journal_line_items")
            .select("account_code, account_name, debit_amount, credit_amount")
            .eq("hospital_id", hospitalId)
            .in("journal_id", slice)
            .range(from, from + PAGE - 1);
          if (error) throw error;
          if (!lines || lines.length === 0) break;
          allLines.push(...lines);
          if (lines.length < PAGE) break;
          from += PAGE;
        }
      }

      // Step 3 — fetch chart of accounts to resolve account_type per code.
      const { data: coa, error: coaErr } = await (supabase as any)
        .from("chart_of_accounts")
        .select("code, name, account_type")
        .eq("hospital_id", hospitalId);
      if (coaErr) throw coaErr;
      const coaMap: Record<string, { name: string; account_type: string }> = {};
      (coa || []).forEach((a: any) => {
        coaMap[a.code] = { name: a.name, account_type: a.account_type };
      });

      // Step 4 — aggregate by account_code.
      const agg: Record<string, TBRow> = {};
      for (const li of allLines) {
        const code = li.account_code || "—";
        if (!agg[code]) {
          agg[code] = {
            account_code: code,
            account_name: coaMap[code]?.name || li.account_name || code,
            account_type: coaMap[code]?.account_type || "other",
            total_debit: 0,
            total_credit: 0,
          };
        }
        agg[code].total_debit += Number(li.debit_amount || 0);
        agg[code].total_credit += Number(li.credit_amount || 0);
      }
      return Object.values(agg)
        .filter((r) => r.total_debit !== 0 || r.total_credit !== 0)
        .sort((a, b) => {
          const ai = TYPE_ORDER.indexOf(a.account_type as any);
          const bi = TYPE_ORDER.indexOf(b.account_type as any);
          if (ai !== bi) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          return a.account_code.localeCompare(b.account_code);
        });
    },
  });

  const rows = data || [];
  const grouped = useMemo(() => {
    const g: Record<string, TBRow[]> = {};
    for (const r of rows) {
      const key = r.account_type || "other";
      if (!g[key]) g[key] = [];
      g[key].push(r);
    }
    return g;
  }, [rows]);

  const totalDebit = rows.reduce((s, r) => s + r.total_debit, 0);
  const totalCredit = rows.reduce((s, r) => s + r.total_credit, 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;

  const handleExport = () => {
    if (!rows.length) return;
    downloadCSV(
      `trial_balance_${fromDate}_to_${toDate}.csv`,
      ["Account Code", "Account Name", "Type", "Debit (INR)", "Credit (INR)", "Balance (INR)"],
      [
        ...rows.map((r) => [
          r.account_code,
          r.account_name,
          r.account_type,
          r.total_debit.toFixed(2),
          r.total_credit.toFixed(2),
          (r.total_debit - r.total_credit).toFixed(2),
        ]),
        ["", "", "TOTALS", totalDebit.toFixed(2), totalCredit.toFixed(2), (totalDebit - totalCredit).toFixed(2)],
      ]
    );
  };

  const orderedTypes = [
    ...TYPE_ORDER.filter((t) => grouped[t]?.length),
    ...Object.keys(grouped).filter((t) => !(TYPE_ORDER as readonly string[]).includes(t)),
  ];

  return (
    <Card className="border-border mt-4">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <CardTitle className="text-sm">Trial Balance</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fromDate} to {toDate}
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label className="text-[11px] text-muted-foreground">From Date</Label>
              <Input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="h-8 text-xs w-36"
              />
            </div>
            <div>
              <Label className="text-[11px] text-muted-foreground">To Date</Label>
              <Input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="h-8 text-xs w-36"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExport}
              disabled={!rows.length}
              className="h-8 text-xs"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Export to CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!isBalanced && rows.length > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <div className="text-xs">
              <p className="font-semibold">Trial Balance is out of balance — check for unbalanced journal entries</p>
              <p className="mt-0.5 opacity-90">
                Debit total {formatINR(totalDebit)} ≠ Credit total {formatINR(totalCredit)} (difference: {formatINR(Math.abs(totalDebit - totalCredit))})
              </p>
            </div>
          </div>
        )}

        {isBalanced && rows.length > 0 && (
          <div className="mb-3 inline-flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Trial Balance is balanced
          </div>
        )}

        {isLoading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin inline mr-2" /> Loading trial balance...
          </div>
        ) : isError ? (
          <div className="py-12 text-center text-sm text-destructive">Failed to load trial balance.</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No journal entries posted in this period.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs w-28">Account Code</TableHead>
                <TableHead className="text-xs">Account Name</TableHead>
                <TableHead className="text-xs w-24">Type</TableHead>
                <TableHead className="text-xs text-right w-32">Debit (₹)</TableHead>
                <TableHead className="text-xs text-right w-32">Credit (₹)</TableHead>
                <TableHead className="text-xs text-right w-32">Balance (₹)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orderedTypes.map((type) => (
                <React.Fragment key={type}>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableCell colSpan={6} className="py-1.5 text-[11px] font-bold tracking-wider text-muted-foreground">
                      {TYPE_LABEL[type] ?? type.toUpperCase()}
                    </TableCell>
                  </TableRow>
                  {grouped[type].map((r) => {
                    const bal = r.total_debit - r.total_credit;
                    return (
                      <TableRow key={r.account_code}>
                        <TableCell className="text-xs font-mono">{r.account_code}</TableCell>
                        <TableCell className="text-xs">{r.account_name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-[10px] capitalize">
                            {r.account_type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {r.total_debit > 0 ? formatINR(r.total_debit) : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-right font-mono">
                          {r.total_credit > 0 ? formatINR(r.total_credit) : "—"}
                        </TableCell>
                        <TableCell
                          className={`text-xs text-right font-mono font-medium ${
                            bal < 0 ? "text-destructive" : ""
                          }`}
                        >
                          {bal === 0 ? "—" : bal > 0 ? formatINR(bal) : `(${formatINR(Math.abs(bal))})`}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </React.Fragment>
              ))}
              <TableRow className="border-t-2 bg-muted/30 font-bold">
                <TableCell colSpan={3} className="text-xs font-bold">
                  TOTALS
                </TableCell>
                <TableCell className="text-xs text-right font-mono">{formatINR(totalDebit)}</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatINR(totalCredit)}</TableCell>
                <TableCell
                  className={`text-xs text-right font-mono ${
                    isBalanced ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"
                  }`}
                >
                  {isBalanced ? "✓ Balanced" : formatINR(Math.abs(totalDebit - totalCredit))}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
};

export default TrialBalanceTab;
