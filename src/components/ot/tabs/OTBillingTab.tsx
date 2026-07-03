import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { chargeOTCase } from "@/lib/serviceBilling";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { Button } from "@/components/ui/button";
import { Loader2, Receipt, RefreshCw, ExternalLink, CheckCircle2, AlertCircle } from "lucide-react";
import type { OTSchedule } from "@/pages/ot/OTPage";

interface Props {
  schedule: OTSchedule;
  hospitalId: string | null;
}

interface BilledItem {
  id: string;
  description: string;
  item_type: string;
  quantity: number;
  unit_rate: number;
  total_amount: number;
  gst_amount: number;
}

const TYPE_LABEL: Record<string, string> = {
  ot_charge: "OT Facility",
  surgeon_fee: "Surgeon Fee",
  anaesthesia_fee: "Anaesthesia",
  implant: "Implant / Consumable",
};

const OTBillingTab: React.FC<Props> = ({ schedule, hospitalId }) => {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [billedItems, setBilledItems] = useState<BilledItem[]>([]);
  const [linkedBillId, setLinkedBillId] = useState<string | null>(null);
  const [linkedBillNumber, setLinkedBillNumber] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [unbilledImplantsPreview, setUnbilledImplantsPreview] = useState<{ item_name: string; unit_cost: number; quantity: number }[]>([]);

  useEffect(() => {
    (supabase as any)
      .from("ot_implants")
      .select("item_name, unit_cost, quantity")
      .eq("schedule_id", schedule.id)
      .eq("billed", false)
      .then(({ data }: any) => setUnbilledImplantsPreview(data || []));
  }, [schedule.id]);

  const loadBillingStatus = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);

    // Find the bill: IPD bill for admitted patients, or bill linked via ot_schedules.bill_id
    let billId: string | null = null;
    let billNumber: string | null = null;

    if (schedule.admission_id) {
      const { data: ipdBill } = await supabase
        .from("bills")
        .select("id, bill_number")
        .eq("hospital_id", hospitalId)
        .eq("admission_id", schedule.admission_id)
        .eq("bill_type", "ipd")
        .maybeSingle();
      billId = ipdBill?.id || null;
      billNumber = ipdBill?.bill_number || null;
    } else {
      // Non-admitted (daycare/OPD): check ot_schedules.bill_id
      const { data: schedRow } = await (supabase as any)
        .from("ot_schedules")
        .select("bill_id, bills(id, bill_number)")
        .eq("id", schedule.id)
        .maybeSingle() as { data: any };
      billId = schedRow?.bill_id || null;
      billNumber = schedRow?.bills?.bill_number || null;
    }

    setLinkedBillId(billId);
    setLinkedBillNumber(billNumber);

    if (billId) {
      const { data: items } = await (supabase as any)
        .from("bill_line_items")
        .select("id, description, item_type, quantity, unit_rate, total_amount, gst_amount")
        .eq("bill_id", billId)
        .eq("source_module", "ot");
      setBilledItems((items as BilledItem[]) || []);
    } else {
      setBilledItems([]);
    }

    setLoading(false);
  }, [hospitalId, schedule.id, schedule.admission_id]);

  useEffect(() => { loadBillingStatus(); }, [loadBillingStatus]);

  const pushOTCharges = async (targetBillId: string) => {
    const result = await chargeOTCase({ hospitalId: hospitalId!, billId: targetBillId, schedule });
    if (result.itemsAdded > 0) {
      toast({ title: `${result.itemsAdded} OT charge(s) added to bill` });
    } else {
      toast({ title: "All OT charges already in bill" });
    }
  };

  const handlePushToIPDBill = async () => {
    if (!hospitalId || !schedule.admission_id) return;
    setPushing(true);

    let billId = linkedBillId;
    if (!billId) {
      // Create a fresh IPD bill
      const billNum = await generateBillNumber(hospitalId, "BILL");
      const { data: newBill } = await supabase.from("bills").insert({
        hospital_id: hospitalId,
        patient_id: schedule.patient_id,
        admission_id: schedule.admission_id,
        bill_number: billNum,
        bill_type: "ipd",
        bill_date: new Date().toISOString().split("T")[0],
        bill_status: "draft",
        payment_status: "unpaid",
        total_amount: 0,
        balance_due: 0,
      }).select("id").maybeSingle();
      billId = newBill?.id || null;
    }

    if (!billId) {
      toast({ title: "Failed to find or create IPD bill", variant: "destructive" });
      setPushing(false);
      return;
    }

    await pushOTCharges(billId);
    await loadBillingStatus();
    setPushing(false);
  };

  const handleCreateDaycareBill = async () => {
    if (!hospitalId) return;
    setPushing(true);

    const billNum = await generateBillNumber(hospitalId, "BILL");
    const { data: newBill } = await supabase.from("bills").insert({
      hospital_id: hospitalId,
      patient_id: schedule.patient_id,
      bill_number: billNum,
      bill_type: "daycare",
      bill_date: schedule.scheduled_date,
      bill_status: "draft",
      payment_status: "unpaid",
      total_amount: 0,
      balance_due: 0,
      notes: `OT Procedure: ${schedule.surgery_name}`,
    }).select("id").maybeSingle();

    if (!newBill?.id) {
      toast({ title: "Failed to create bill", variant: "destructive" });
      setPushing(false);
      return;
    }

    await pushOTCharges(newBill.id);
    await loadBillingStatus();
    setPushing(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalBilled = billedItems.reduce((s, i) => s + Number(i.total_amount), 0);
  const isBilled = billedItems.length > 0;
  const isCompleted = schedule.status === "completed";

  return (
    <div className="p-4 space-y-4 overflow-y-auto h-full">
      {/* Status banner */}
      <div className={`flex items-center gap-3 rounded-lg px-4 py-3 border ${isBilled ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
        {isBilled
          ? <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
          : <AlertCircle className="h-4 w-4 text-amber-600 flex-shrink-0" />}
        <div className="flex-1">
          <p className={`text-sm font-semibold ${isBilled ? "text-emerald-800" : "text-amber-800"}`}>
            {isBilled ? "OT charges billed" : isCompleted ? "OT charges not yet billed" : "Case not completed — bill after case ends"}
          </p>
          {linkedBillNumber && (
            <p className="text-xs text-muted-foreground">Bill: {linkedBillNumber}</p>
          )}
        </div>
        {linkedBillId && (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => navigate(`/billing?bill_id=${linkedBillId}`)}>
            <ExternalLink className="h-3 w-3" /> View Bill
          </Button>
        )}
      </div>

      {/* Billed line items */}
      {isBilled && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/40 px-3 py-2 border-b border-border">
            <span className="text-xs font-bold text-foreground uppercase tracking-wide">OT Charges in Bill</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/20">
                <th className="text-left px-3 py-1.5 text-xs text-muted-foreground font-medium">Description</th>
                <th className="text-right px-3 py-1.5 text-xs text-muted-foreground font-medium">Qty</th>
                <th className="text-right px-3 py-1.5 text-xs text-muted-foreground font-medium">Rate</th>
                <th className="text-right px-3 py-1.5 text-xs text-muted-foreground font-medium">GST</th>
                <th className="text-right px-3 py-1.5 text-xs text-muted-foreground font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {billedItems.map((item) => (
                <tr key={item.id} className="border-b border-border/50 last:border-0">
                  <td className="px-3 py-2">
                    <span className="text-[11px] text-muted-foreground block">{TYPE_LABEL[item.item_type] || item.item_type}</span>
                    <span className="text-xs text-foreground">{item.description}</span>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-foreground">{item.quantity}</td>
                  <td className="px-3 py-2 text-right text-xs text-foreground">₹{Number(item.unit_rate).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">₹{Number(item.gst_amount).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2 text-right text-xs font-semibold text-foreground">₹{Number(item.total_amount).toLocaleString("en-IN")}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-muted/30">
                <td colSpan={4} className="px-3 py-2 text-xs font-bold text-right text-foreground">Total OT Charges</td>
                <td className="px-3 py-2 text-right text-sm font-bold text-foreground">₹{totalBilled.toLocaleString("en-IN")}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Implants/consumables preview (if any) */}
      {!isBilled && isCompleted && unbilledImplantsPreview.length > 0 && (
        <div className="border border-border rounded-lg overflow-hidden">
          <div className="bg-muted/40 px-3 py-2 border-b border-border">
            <span className="text-xs font-bold text-foreground uppercase tracking-wide">Implants / Consumables</span>
          </div>
          {unbilledImplantsPreview.map((imp, i) => (
            <div key={i} className="flex justify-between items-center px-3 py-2 border-b border-border/50 last:border-0">
              <span className="text-xs text-foreground">{imp.item_name}</span>
              <span className="text-xs font-medium text-foreground">
                {imp.quantity} × ₹{imp.unit_cost.toLocaleString("en-IN")}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {isCompleted && (
        <div className="flex gap-2 pt-1">
          {schedule.admission_id ? (
            <Button
              onClick={handlePushToIPDBill}
              disabled={pushing}
              className="flex-1 gap-2"
              size="sm"
            >
              {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
              {isBilled ? "Re-sync OT Charges to IPD Bill" : "Push OT Charges to IPD Bill"}
            </Button>
          ) : (
            <Button
              onClick={handleCreateDaycareBill}
              disabled={pushing || isBilled}
              className="flex-1 gap-2"
              size="sm"
            >
              {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
              {isBilled ? "Bill Created" : "Create Daycare Bill"}
            </Button>
          )}
          {isBilled && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => { loadBillingStatus(); }}
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          )}
        </div>
      )}

      {!isCompleted && (
        <p className="text-xs text-muted-foreground text-center py-4">
          OT billing is available once the case is marked <strong>Completed</strong> via End Case.
        </p>
      )}
    </div>
  );
};

export default OTBillingTab;
