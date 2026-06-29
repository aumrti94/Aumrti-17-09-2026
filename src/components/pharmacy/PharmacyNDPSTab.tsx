import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Printer } from "lucide-react";

interface Props {
  hospitalId: string;
}

interface NDPSRecord {
  id: string;
  drug_name: string;
  drug_schedule: string;
  transaction_type: string;
  quantity: number;
  balance_after: number;
  running_balance: number;
  transaction_date: string;
  patient_name: string | null;
  prescription_number: string | null;
  prescriber_name: string | null;
  pharmacist_name?: string;
  second_pharmacist_name?: string;
  patient_signature_ref?: string | null;
}

const PharmacyNDPSTab: React.FC<Props> = ({ hospitalId }) => {
  const [records, setRecords] = useState<NDPSRecord[]>([]);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split("T")[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split("T")[0]);
  const [scheduleFilter, setScheduleFilter] = useState<"all" | "H1" | "X">("all");

  const fetchRecords = useCallback(async () => {
    let q = (supabase as any)
      .from("ndps_register")
      .select("*")
      .eq("hospital_id", hospitalId)
      .gte("transaction_date", dateFrom)
      .lte("transaction_date", dateTo)
      .order("drug_id", { ascending: true })
      .order("created_at", { ascending: true });
    if (scheduleFilter !== "all") q = q.eq("drug_schedule", scheduleFilter);
    const { data } = await q;

    // Compute running balance client-side (per drug_id)
    const balances: Record<string, number> = {};
    const withRunning = (data || []).map((r: any) => {
      const drugKey = r.drug_id || r.drug_name;
      if (!(drugKey in balances)) balances[drugKey] = 0;
      const delta = r.transaction_type === "receipt" ? Number(r.quantity) : -Number(r.quantity);
      balances[drugKey] += delta;
      return { ...r, running_balance: balances[drugKey] };
    });

    // Reverse to show latest first for display
    withRunning.reverse();
    setRecords(withRunning as NDPSRecord[]);
  }, [hospitalId, dateFrom, dateTo, scheduleFilter]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const txColors: Record<string, string> = {
    receipt: "bg-emerald-50",
    issue: "bg-background",
    return: "bg-blue-50",
    disposal: "bg-orange-50",
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-5 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div>
            <p className="text-sm font-bold text-foreground">NDPS / Schedule H Drug Register</p>
            <p className="text-[11px] text-muted-foreground">Legally mandated register for Schedule H/H1/X drugs</p>
          </div>
          <div className="flex gap-1">
            {(["all", "H1", "X"] as const).map(s => (
              <button key={s} onClick={() => setScheduleFilter(s)}
                className={cn("px-2.5 py-1 rounded text-[10px] font-bold transition-colors",
                  scheduleFilter === s ? "bg-red-600 text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
                {s === "all" ? "All" : `Sch. ${s}`}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-muted-foreground">From</span>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-36 text-xs" />
            <span className="text-muted-foreground">To</span>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-36 text-xs" />
          </div>
          <Button variant="outline" size="sm" className="text-xs" onClick={() => {
            const { printDocument } = require("@/lib/printUtils");
            const rows = records.map((r: any, i: number) => `<tr><td>${i + 1}</td><td>${r.drug_name}</td><td>${r.schedule}</td><td>${r.quantity}</td><td>${r.running_balance}</td><td>${new Date(r.transaction_date).toLocaleDateString("en-IN")}</td></tr>`).join("");
            printDocument("NDPS Register", `<h2 style="color:#1A2F5A">NDPS Register</h2><p style="font-size:11px;color:#64748b">${dateFrom} to ${dateTo}</p><table><tr><th>#</th><th>Drug</th><th>Schedule</th><th>Qty</th><th>Balance</th><th>Date</th></tr>${rows}</table>`);
          }}>
            <Printer size={14} className="mr-1" /> Print Register
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-5 pb-4">
        {records.length === 0 ? (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No NDPS transactions recorded for this period
          </div>
        ) : (
          <table className="w-full text-sm mt-3">
            <thead className="sticky top-0 bg-muted/80 backdrop-blur z-10">
              <tr className="text-[10px] font-semibold text-muted-foreground uppercase">
                <th className="text-left py-2 px-2">Date</th>
                <th className="text-left py-2 px-2">Drug Name</th>
                <th className="text-center py-2 px-2">Schedule</th>
                <th className="text-center py-2 px-2">Type</th>
                <th className="text-right py-2 px-2">Qty</th>
                <th className="text-right py-2 px-2">Balance</th>
                <th className="text-right py-2 px-2">Running Bal.</th>
                <th className="text-left py-2 px-2">Patient</th>
                <th className="text-left py-2 px-2">Prescription #</th>
                <th className="text-left py-2 px-2">Prescriber</th>
                <th className="text-left py-2 px-2">Sig. Ref.</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => (
                <tr key={r.id} className={cn("border-b border-border/30", txColors[r.transaction_type] || "")}>
                  <td className="py-2 px-2 text-xs tabular-nums">
                    {new Date(r.transaction_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}
                  </td>
                  <td className="py-2 px-2 font-medium">{r.drug_name}</td>
                  <td className="py-2 px-2 text-center">
                    <span className="text-[9px] px-1.5 py-0.5 rounded font-bold bg-red-50 text-red-600">{r.drug_schedule}</span>
                  </td>
                  <td className="py-2 px-2 text-center capitalize text-xs">{r.transaction_type}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{Number(r.quantity)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold">{Number(r.balance_after)}</td>
                  <td className="py-2 px-2 text-right tabular-nums font-semibold text-primary">{r.running_balance}</td>
                  <td className="py-2 px-2 text-xs">{r.patient_name || "—"}</td>
                  <td className="py-2 px-2 text-xs font-mono">{r.prescription_number || "—"}</td>
                  <td className="py-2 px-2 text-xs">{r.prescriber_name || "—"}</td>
                  <td className="py-2 px-2 text-xs text-muted-foreground">{r.patient_signature_ref || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default PharmacyNDPSTab;
