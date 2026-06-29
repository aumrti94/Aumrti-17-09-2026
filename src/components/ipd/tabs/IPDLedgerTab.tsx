import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  admissionId: string;
  patientId: string;
  hospitalId: string;
}

interface LedgerLine {
  date: string;
  description: string;
  amount: number;
  category: "room" | "pharmacy" | "lab" | "other";
}

const CATEGORY_COLORS: Record<string, string> = {
  room: "bg-blue-50 text-blue-700",
  pharmacy: "bg-purple-50 text-purple-700",
  lab: "bg-amber-50 text-amber-700",
  other: "bg-slate-50 text-slate-600",
};

const BED_RATES: Record<string, number> = {
  icu: 5000, sicu: 5000, picu: 4500, nicu: 4500,
  hdu: 3000, isolation: 2500,
  private: 2000, semi_private: 1200, general: 600,
};

const IPDLedgerTab: React.FC<Props> = ({ admissionId, patientId, hospitalId }) => {
  const [lines, setLines] = useState<LedgerLine[]>([]);
  const [advances, setAdvances] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const ledger: LedgerLine[] = [];

    // 1. Room charges
    const { data: adm } = await (supabase as any)
      .from("admissions")
      .select("admitted_at, beds!admissions_bed_id_fkey(bed_category, ward_id)")
      .eq("id", admissionId)
      .maybeSingle();

    if (adm?.admitted_at) {
      const admittedAt = new Date(adm.admitted_at);
      const now = new Date();
      const daysDiff = Math.max(1, Math.ceil((now.getTime() - admittedAt.getTime()) / (1000 * 60 * 60 * 24)));
      const bedCategory = adm.beds?.bed_category || "general";
      const dailyRate = BED_RATES[bedCategory] ?? 600;
      ledger.push({
        date: admittedAt.toISOString().split("T")[0],
        description: `Room Charge — ${bedCategory.replace("_", " ")} × ${daysDiff} day${daysDiff !== 1 ? "s" : ""} @ ₹${dailyRate.toLocaleString("en-IN")}`,
        amount: dailyRate * daysDiff,
        category: "room",
      });
    }

    // 2. Pharmacy
    const { data: pharm } = await (supabase as any)
      .from("pharmacy_dispensing_records")
      .select("total_amount, dispensed_at, notes")
      .eq("admission_id", admissionId)
      .order("dispensed_at", { ascending: true });

    (pharm || []).forEach((r: any) => {
      if (r.total_amount) {
        ledger.push({
          date: (r.dispensed_at || "").split("T")[0],
          description: `Pharmacy Dispensing${r.notes ? ` — ${r.notes}` : ""}`,
          amount: Number(r.total_amount),
          category: "pharmacy",
        });
      }
    });

    // 3. Lab orders
    const { data: labs } = await (supabase as any)
      .from("lab_orders")
      .select("order_date, id")
      .eq("admission_id", admissionId)
      .neq("status", "cancelled");

    (labs || []).forEach((l: any) => {
      ledger.push({
        date: l.order_date,
        description: `Lab Order — ${l.id.slice(0, 8).toUpperCase()}`,
        amount: 0,
        category: "lab",
      });
    });

    // 4. Bill line items linked to admission
    const { data: billItems } = await (supabase as any)
      .from("bill_line_items")
      .select("description, total_amount, created_at, bills!inner(admission_id)")
      .eq("bills.admission_id", admissionId)
      .order("created_at", { ascending: true });

    (billItems || []).forEach((b: any) => {
      if (b.total_amount) {
        ledger.push({
          date: (b.created_at || "").split("T")[0],
          description: b.description || "Service charge",
          amount: Number(b.total_amount),
          category: "other",
        });
      }
    });

    // 5. Advances — ipd_advance_balances (primary) + unmirrored advance_receipts (legacy)
    const [advBalance, ipdAdvRefs, receiptsData] = await Promise.all([
      (supabase as any)
        .from("ipd_advance_balances")
        .select("total_deposited")
        .eq("admission_id", admissionId)
        .maybeSingle(),
      (supabase as any)
        .from("ipd_advances")
        .select("reference_no")
        .eq("admission_id", admissionId)
        .not("reference_no", "is", null),
      (supabase as any)
        .from("advance_receipts")
        .select("amount, receipt_number")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", patientId),
    ]);

    const mirroredRefs = new Set(
      (ipdAdvRefs.data || []).map((r: any) => r.reference_no)
    );
    const unmirroredReceiptTotal = (receiptsData.data || [])
      .filter((r: any) => !mirroredRefs.has(r.receipt_number))
      .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

    const totalAdvance = Number(advBalance.data?.total_deposited || 0) + unmirroredReceiptTotal;

    ledger.sort((a, b) => a.date.localeCompare(b.date));
    setLines(ledger);
    setAdvances(totalAdvance);
    setLoading(false);
  }, [admissionId, hospitalId]);

  useEffect(() => { load(); }, [load]);

  const totalCharges = lines.reduce((s, l) => s + l.amount, 0);
  const balance = totalCharges - advances;
  const fmt = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  return (
    <div className="h-full flex flex-col overflow-hidden p-4 space-y-3">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3 flex-shrink-0">
        <div className="bg-muted/50 rounded-lg p-3">
          <p className="text-[11px] text-muted-foreground">Total Charges</p>
          <p className="text-lg font-bold text-foreground">{fmt(totalCharges)}</p>
        </div>
        <div className="bg-emerald-50 rounded-lg p-3">
          <p className="text-[11px] text-emerald-700">Advance Paid</p>
          <p className="text-lg font-bold text-emerald-700">{fmt(advances)}</p>
        </div>
        <div className={`rounded-lg p-3 ${balance > 0 ? "bg-amber-50" : "bg-emerald-50"}`}>
          <p className={`text-[11px] ${balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>Balance Due</p>
          <p className={`text-lg font-bold ${balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>
            {balance > 0 ? fmt(balance) : "Nil"}
          </p>
        </div>
      </div>

      {/* Ledger table */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-border">
        {loading ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading...</div>
        ) : lines.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">No charges recorded</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/70 backdrop-blur z-10">
              <tr className="text-[10px] font-semibold text-muted-foreground uppercase">
                <th className="text-left py-2 px-3">Date</th>
                <th className="text-left py-2 px-3">Description</th>
                <th className="text-center py-2 px-3">Category</th>
                <th className="text-right py-2 px-3">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {lines.map((l, idx) => (
                <tr key={idx} className="hover:bg-muted/20 transition-colors">
                  <td className="py-2 px-3 text-xs tabular-nums text-muted-foreground whitespace-nowrap">
                    {l.date ? new Date(l.date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—"}
                  </td>
                  <td className="py-2 px-3 text-xs">{l.description}</td>
                  <td className="py-2 px-3 text-center">
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold capitalize ${CATEGORY_COLORS[l.category]}`}>
                      {l.category}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums font-semibold text-sm">
                    {l.amount > 0 ? fmt(l.amount) : <span className="text-muted-foreground text-xs">Pending</span>}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-border">
              <tr className="bg-muted/30 font-bold">
                <td colSpan={3} className="py-2 px-3 text-xs text-right text-muted-foreground uppercase">Total</td>
                <td className="py-2 px-3 text-right text-sm tabular-nums">{fmt(totalCharges)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
};

export default IPDLedgerTab;
