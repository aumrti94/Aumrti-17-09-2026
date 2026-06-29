import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useNavigate } from "react-router-dom";

interface PaymentRow {
  mode: string;
  icon: string;
  amount: number;
  count: number;
  pct: number;
}

interface OutstandingBill {
  id: string;
  bill_number: string;
  patient_name: string;
  balance: number;
  bill_type: string;
}

const RevenueDrillDown: React.FC = () => {
  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [outstanding, setOutstanding] = useState<OutstandingBill[]>([]);
  const [totalOutstanding, setTotalOutstanding] = useState(0);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const fetch = useCallback(async () => {
    const today = new Date().toISOString().split("T")[0];

    // Get today's payments
    const { data: payments } = await supabase
      .from("bill_payments")
      .select("payment_mode, amount")
      .gte("payment_date", today);

    const modeMap: Record<string, { amount: number; count: number }> = {};
    let total = 0;
    for (const p of payments || []) {
      const mode = p.payment_mode || "other";
      if (!modeMap[mode]) modeMap[mode] = { amount: 0, count: 0 };
      modeMap[mode].amount += Number(p.amount);
      modeMap[mode].count++;
      total += Number(p.amount);
    }

    const icons: Record<string, string> = {
      cash: "💵", upi: "📱", card: "💳", insurance: "🏥",
      cheque: "📝", online: "🌐", other: "📋",
    };

    const result: PaymentRow[] = Object.entries(modeMap)
      .map(([mode, data]) => ({
        mode,
        icon: icons[mode] || "📋",
        amount: data.amount,
        count: data.count,
        pct: total > 0 ? Math.round((data.amount / total) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    setRows(result);

    // Outstanding bills
    const { data: bills } = await supabase
      .from("bills")
      .select("id, bill_number, patient_id, balance_due, bill_type")
      .gt("balance_due", 0)
      .gte("bill_date", today)
      .order("balance_due", { ascending: false })
      .limit(5);

    let outTotal = 0;
    const outRows: OutstandingBill[] = [];
    for (const b of bills || []) {
      const { data: patient } = await supabase
        .from("patients")
        .select("full_name")
        .eq("id", b.patient_id)
        .maybeSingle();
      outRows.push({
        id: b.id,
        bill_number: b.bill_number,
        patient_name: patient?.full_name || "Unknown",
        balance: Number(b.balance_due),
        bill_type: b.bill_type,
      });
      outTotal += Number(b.balance_due);
    }
    setOutstanding(outRows);
    setTotalOutstanding(outTotal);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  if (loading) {
    return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-muted animate-pulse rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-4">
      {/* Breakdown */}
      <div>
        <h4 className="text-[11px] font-bold uppercase text-muted-foreground tracking-wider mb-2">Breakdown by Payment Mode</h4>
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Mode</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Amount</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">Txns</th>
                <th className="text-right px-3 py-2 font-medium text-muted-foreground">%</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={4} className="text-center py-4 text-muted-foreground">No payments today</td></tr>
              ) : rows.map((r) => (
                <tr key={r.mode} className="border-t border-border/50 hover:bg-muted/30 transition-colors">
                  <td className="px-3 py-2 capitalize">{r.icon} {r.mode}</td>
                  <td className="text-right px-3 py-2 font-medium">₹{r.amount.toLocaleString("en-IN")}</td>
                  <td className="text-right px-3 py-2 text-muted-foreground">{r.count}</td>
                  <td className="text-right px-3 py-2 text-muted-foreground">{r.pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Outstanding */}
      {totalOutstanding > 0 && (
        <div>
          <div className="bg-destructive/10 text-destructive text-xs font-medium px-3 py-2 rounded-lg mb-2">
            ⚠️ ₹{totalOutstanding.toLocaleString("en-IN")} uncollected today
          </div>
          <div className="space-y-1.5">
            {outstanding.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between bg-card border border-border rounded-lg px-3 py-2 hover:bg-muted/40 cursor-pointer transition-colors"
                onClick={() => navigate("/billing")}
              >
                <div>
                  <span className="text-xs font-medium text-foreground">{o.patient_name}</span>
                  <span className="text-[10px] text-muted-foreground ml-2">#{o.bill_number}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-destructive">₹{o.balance.toLocaleString("en-IN")}</span>
                  <span className="text-[10px] bg-primary/10 text-primary px-2 py-0.5 rounded-full">Collect →</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RevenueDrillDown;
