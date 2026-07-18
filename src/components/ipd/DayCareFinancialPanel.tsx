/**
 * DayCareFinancialPanel — read-only money summary for an admitted day care patient.
 *
 * The point is the variance line: the estimate is what the patient was quoted at booking,
 * but the final bill legitimately moves (a premium lens, extra consumables). Surfacing the
 * gap while the patient is still in the unit is the only chance to collect it — after a
 * same-day discharge they are gone.
 */

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { formatINRExact } from "@/lib/currency";
import { findAdmissionBill } from "@/lib/admissionBill";
import { ExternalLink, TrendingUp } from "lucide-react";

interface Props {
  hospitalId: string;
  admissionId: string;
}

interface Figures {
  estimate: number;
  deposit: number;
  billed: number;
  paid: number;
  balance: number;
  billId: string | null;
}

const DayCareFinancialPanel: React.FC<Props> = ({ hospitalId, admissionId }) => {
  const navigate = useNavigate();
  const [f, setF] = useState<Figures | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [estRes, balRes, found] = await Promise.all([
        (supabase as any)
          .from("admission_estimates")
          .select("estimated_amount")
          .eq("admission_id", admissionId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        (supabase as any)
          .from("ipd_advance_balances")
          .select("total_deposited")
          .eq("admission_id", admissionId)
          .maybeSingle(),
        findAdmissionBill(hospitalId, admissionId, { paymentStatuses: [] }),
      ]);

      let billed = 0, paid = 0, balance = 0;
      if (found) {
        const { data: bill } = await (supabase as any)
          .from("bills")
          .select("total_amount, paid_amount, balance_due")
          .eq("id", found.id)
          .maybeSingle();
        billed  = Number(bill?.total_amount) || 0;
        paid    = Number(bill?.paid_amount) || 0;
        balance = Math.max(0, Number(bill?.balance_due) || 0);
      }

      if (cancelled) return;
      setF({
        estimate: Number(estRes?.data?.estimated_amount) || 0,
        deposit:  Number(balRes?.data?.total_deposited) || 0,
        billed, paid, balance,
        billId: found?.id ?? null,
      });
    })();
    return () => { cancelled = true; };
  }, [hospitalId, admissionId]);

  if (!f) return null;

  const variance = f.billed - f.estimate;
  const showVariance = f.estimate > 0 && Math.abs(variance) >= 1;

  return (
    <div className="border rounded-lg divide-y">
      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-xs font-semibold">Financials</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 text-xs"
          onClick={() => navigate(`/billing?action=new&admission_id=${admissionId}&type=daycare`)}
        >
          <ExternalLink size={11} />
          Open in Billing
        </Button>
      </div>

      <Row label="Estimate given" value={formatINRExact(f.estimate)} />
      <Row label="Deposit collected" value={formatINRExact(f.deposit)} />
      <Row label="Billed so far" value={formatINRExact(f.billed)} />

      {showVariance && (
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <TrendingUp size={11} />
            {variance > 0 ? "Over estimate" : "Under estimate"}
          </span>
          <span className={`text-sm font-medium ${variance > 0 ? "text-amber-600" : "text-muted-foreground"}`}>
            {variance > 0 ? "+" : "−"}{formatINRExact(Math.abs(variance))}
          </span>
        </div>
      )}

      <div className="px-3 py-2 flex items-center justify-between">
        <span className="text-xs text-muted-foreground">Balance due</span>
        <span className={`text-sm font-semibold ${f.balance > 0 ? "text-red-600" : "text-teal-600"}`}>
          {formatINRExact(f.balance)}
        </span>
      </div>

      {!f.billId && (
        <p className="px-3 py-2 text-xs text-amber-700">No bill raised for this procedure yet.</p>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="px-3 py-2 flex items-center justify-between">
    <span className="text-xs text-muted-foreground">{label}</span>
    <span className="text-sm font-medium">{value}</span>
  </div>
);

export default DayCareFinancialPanel;
