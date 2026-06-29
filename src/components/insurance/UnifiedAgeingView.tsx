import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { differenceInDays } from "date-fns";

interface AgeingRow {
  source: string;
  submitted: number;
  pending: number;
  approved: number;
  settled: number;
  outstanding: number;
}

const UnifiedAgeingView: React.FC = () => {
  const [rows, setRows] = useState<AgeingRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [privateRes, govtRes, schemesRes] = await Promise.all([
      supabase.from("insurance_claims").select("tpa_name, claimed_amount, approved_amount, settled_amount, status"),
      supabase.from("pmjay_claims").select("scheme_id, claimed_amount, approved_amount, settled_amount, status"),
      supabase.from("govt_schemes").select("id, scheme_name"),
    ]);

    const schemeMap = Object.fromEntries((schemesRes.data || []).map(s => [s.id, s.scheme_name]));
    const tpaMap: Record<string, AgeingRow> = {};

    (privateRes.data || []).forEach(c => {
      if (!tpaMap[c.tpa_name]) tpaMap[c.tpa_name] = { source: c.tpa_name, submitted: 0, pending: 0, approved: 0, settled: 0, outstanding: 0 };
      const r = tpaMap[c.tpa_name];
      const claimed = Number(c.claimed_amount || 0);
      const settledAmt = Number(c.settled_amount || 0);
      r.submitted++;
      if (["submitted", "under_review"].includes(c.status)) { r.pending += claimed; r.outstanding += claimed; }
      if (["approved", "partially_approved"].includes(c.status)) { r.approved += Number(c.approved_amount || claimed); r.outstanding += claimed - settledAmt; }
      if (c.status === "settled") r.settled += settledAmt;
    });

    (govtRes.data || []).forEach((c: any) => {
      const name = schemeMap[c.scheme_id] || "Govt Scheme";
      if (!tpaMap[name]) tpaMap[name] = { source: name, submitted: 0, pending: 0, approved: 0, settled: 0, outstanding: 0 };
      const r = tpaMap[name];
      const claimed = Number(c.claimed_amount || 0);
      const settledAmt = Number(c.settled_amount || 0);
      r.submitted++;
      if (["submitted", "under_review"].includes(c.status || "")) { r.pending += claimed; r.outstanding += claimed; }
      if (["approved", "partially_approved"].includes(c.status || "")) { r.approved += Number(c.approved_amount || claimed); r.outstanding += claimed - settledAmt; }
      if (c.status === "settled") r.settled += settledAmt;
    });

    setRows(Object.values(tpaMap).sort((a, b) => b.outstanding - a.outstanding));
    setLoading(false);
  };

  const fmt = (n: number) => n > 0 ? `₹${n.toLocaleString("en-IN")}` : "—";
  const totals = rows.reduce((acc, r) => ({
    submitted: acc.submitted + r.submitted,
    pending: acc.pending + r.pending,
    approved: acc.approved + r.approved,
    settled: acc.settled + r.settled,
    outstanding: acc.outstanding + r.outstanding,
  }), { submitted: 0, pending: 0, approved: 0, settled: 0, outstanding: 0 });

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="h-full overflow-auto p-4">
      <div className="bg-background rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">TPA / Scheme</TableHead>
              <TableHead className="text-[11px] text-right">Submitted</TableHead>
              <TableHead className="text-[11px] text-right">Pending ₹</TableHead>
              <TableHead className="text-[11px] text-right">Approved ₹</TableHead>
              <TableHead className="text-[11px] text-right">Settled ₹</TableHead>
              <TableHead className="text-[11px] text-right">Outstanding ₹</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground text-sm py-8">No claims data</TableCell></TableRow>
            ) : (
              <>
                {rows.map(r => (
                  <TableRow key={r.source}>
                    <TableCell className="text-[13px] font-medium">{r.source}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums">{r.submitted}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-amber-600">{fmt(r.pending)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-emerald-600">{fmt(r.approved)}</TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-emerald-700">{fmt(r.settled)}</TableCell>
                    <TableCell className="text-right text-[13px] font-bold tabular-nums">{fmt(r.outstanding)}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-muted/50 font-bold">
                  <TableCell className="text-[13px] font-bold">TOTAL</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-bold">{totals.submitted}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-bold">{fmt(totals.pending)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-bold">{fmt(totals.approved)}</TableCell>
                  <TableCell className="text-right text-xs tabular-nums font-bold">{fmt(totals.settled)}</TableCell>
                  <TableCell className="text-right text-[13px] tabular-nums font-bold">{fmt(totals.outstanding)}</TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
};

export default UnifiedAgeingView;
