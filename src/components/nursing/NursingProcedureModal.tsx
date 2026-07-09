import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { calcGST, roundCurrency } from "@/lib/currency";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { recordServiceCharge } from "@/lib/serviceBilling";
import { deductCentralFEFO } from "@/lib/inventoryStock";
import { Search, X } from "lucide-react";

const PROCEDURES = [
  "Dressing Change", "Wound Care", "IV Cannulation", "Catheterisation",
  "Injection Administration", "Nebulisation", "O2 Administration (per hour)",
  "Suturing", "ECG Recording", "Blood Sugar Check", "Enema",
  "Ryles Tube Insertion", "Tracheostomy Care", "Suctioning", "Splint Application",
];

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  /** Pre-fill for IPD context */
  defaultPatientId?: string;
  defaultAdmissionId?: string;
}

export default function NursingProcedureModal({ open, onClose, hospitalId, defaultPatientId, defaultAdmissionId }: Props) {
  const [patientId, setPatientId] = useState(defaultPatientId || "");
  const [admissionId] = useState(defaultAdmissionId || "");
  const [procedureName, setProcedureName] = useState("");
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  // Consumables used during the procedure — deducted from central inventory
  const [consumables, setConsumables] = useState<{ item_id: string; item_name: string; quantity: number }[]>([]);
  const [itemSearch, setItemSearch] = useState("");
  const [itemResults, setItemResults] = useState<any[]>([]);

  const searchItems = async (q: string) => {
    setItemSearch(q);
    if (q.length < 2) { setItemResults([]); return; }
    const { data } = await (supabase as any).from("inventory_items")
      .select("id, item_name, uom").eq("hospital_id", hospitalId).eq("is_active", true)
      .ilike("item_name", `%${q}%`).limit(6);
    setItemResults(data || []);
  };
  const addConsumable = (item: any) => {
    if (!consumables.find((c) => c.item_id === item.id)) {
      setConsumables([...consumables, { item_id: item.id, item_name: item.item_name, quantity: 1 }]);
    }
    setItemSearch(""); setItemResults([]);
  };

  const handleLogAndBill = async () => {
    if (!patientId || !procedureName) {
      toast.error("Patient and procedure are required");
      return;
    }
    setSaving(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await supabase.from("users").select("id").eq("auth_user_id", user?.id || "").maybeSingle();
      const userId = userData?.id || null;

      // Look up rate
      const { data: svc } = await supabase.from("service_master").select("fee, gst_percent, gst_applicable")
        .eq("hospital_id", hospitalId).eq("is_active", true)
        .ilike("name", `%${procedureName.replace(/[()]/g, "").split(" ").slice(0, 2).join("%")}%`)
        .eq("item_type", "nursing_procedure").limit(1).maybeSingle();

      const unitRate = svc?.fee ? Number(svc.fee) : 150;
      const gstPct = svc?.gst_applicable ? (Number(svc.gst_percent) || 0) : 0;
      const totalFee = roundCurrency(unitRate * quantity);
      const gstAmt = calcGST(totalFee, gstPct);
      const grandTotal = roundCurrency(totalFee + gstAmt);

      // Check if patient has an active admission
      let activeAdmissionId = admissionId || null;
      if (!activeAdmissionId) {
        const { data: adm } = await supabase.from("admissions").select("id")
          .eq("hospital_id", hospitalId).eq("patient_id", patientId).eq("status", "admitted").limit(1).maybeSingle();
        if (adm) activeAdmissionId = adm.id;
      }

      let billId: string | null = null;

      if (activeAdmissionId) {
        // IPD: find existing IPD bill or create one
        const { data: existingBill } = await (supabase as any).from("bills").select("id, subtotal, gst_amount, total_amount")
          .eq("hospital_id", hospitalId).eq("admission_id", activeAdmissionId)
          .in("payment_status", ["unpaid", "partial"]).order("created_at", { ascending: false }).limit(1).maybeSingle();

        if (existingBill) {
          billId = existingBill.id;
          // Add line item to existing bill
          await supabase.from("bill_line_items").insert({
            hospital_id: hospitalId, bill_id: billId!,
            description: `Nursing: ${procedureName}`, item_type: "nursing_procedure",
            unit_rate: unitRate, quantity, taxable_amount: totalFee,
            gst_percent: gstPct, gst_amount: gstAmt, total_amount: grandTotal,
            source_module: "nursing",
          });
          const result = await recalculateBillTotalsSafe(billId!);
          if (!result.ok) {
            console.error("Nursing bill recalculation failed:", result.error);
            toast.error(result.error || "Bill totals could not be updated");
          }
        } else {
          // Create new IPD bill
          const billNumber = await generateBillNumber(hospitalId, "NURS");
          const { data: bill } = await supabase.from("bills").insert({
            hospital_id: hospitalId, patient_id: patientId, admission_id: activeAdmissionId,
            bill_number: billNumber, bill_type: "ipd" as any, bill_date: new Date().toISOString().split("T")[0],
            subtotal: totalFee, gst_amount: gstAmt, total_amount: grandTotal,
            patient_payable: grandTotal, paid_amount: 0, balance_due: grandTotal,
            payment_status: "unpaid", bill_status: "final", created_by: userId,
          }).select("id").maybeSingle();
          billId = bill?.id || null;
          if (billId) {
            await supabase.from("bill_line_items").insert({
              hospital_id: hospitalId, bill_id: billId,
              description: `Nursing: ${procedureName}`, item_type: "nursing_procedure",
              unit_rate: unitRate, quantity, taxable_amount: totalFee,
              gst_percent: gstPct, gst_amount: gstAmt, total_amount: grandTotal,
              source_module: "nursing",
            });
          }
        }
      } else {
        // OPD: standalone nursing bill
        const billNumber = await generateBillNumber(hospitalId, "NURS");
        const { data: bill } = await supabase.from("bills").insert({
          hospital_id: hospitalId, patient_id: patientId,
          bill_number: billNumber, bill_type: "opd", bill_date: new Date().toISOString().split("T")[0],
          subtotal: totalFee, gst_amount: gstAmt, total_amount: grandTotal,
          patient_payable: grandTotal, paid_amount: 0, balance_due: grandTotal,
          payment_status: "unpaid", bill_status: "final", created_by: userId,
        }).select("id").maybeSingle();
        billId = bill?.id || null;
        if (billId) {
          await supabase.from("bill_line_items").insert({
            hospital_id: hospitalId, bill_id: billId,
            description: `Nursing: ${procedureName}`, item_type: "nursing_procedure",
            unit_rate: unitRate, quantity, taxable_amount: totalFee,
            gst_percent: gstPct, gst_amount: gstAmt, total_amount: grandTotal,
            source_module: "nursing",
          });
        }
      }

      if (billId) {
        recordServiceCharge({
          hospitalId, patientId, admissionId: activeAdmissionId,
          serviceModule: "nursing",
          serviceName: `Nursing: ${procedureName}`,
          quantity, unitRate, gstPercent: gstPct, gstAmount: gstAmt, totalAmount: grandTotal,
          billId, performedBy: userId,
        });
      }

      // Insert nursing_procedures record
      const { data: procRow } = await (supabase as any).from("nursing_procedures").insert({
        hospital_id: hospitalId, patient_id: patientId,
        admission_id: activeAdmissionId || null,
        procedure_name: procedureName, procedure_type: "general",
        quantity, performed_by: userId, notes: notes || null,
        billed: !!billId, bill_id: billId,
      }).select("id").maybeSingle();

      // Record consumables used and deduct them from central inventory (FEFO)
      for (const c of consumables) {
        await (supabase as any).from("nursing_procedure_consumables").insert({
          hospital_id: hospitalId, nursing_procedure_id: procRow?.id || null,
          inventory_item_id: c.item_id, item_name: c.item_name, quantity: c.quantity, stock_deducted: true,
        });
        await deductCentralFEFO({
          hospitalId, itemId: c.item_id, qty: c.quantity,
          ledger: { transactionType: "nursing_consumption", referenceId: procRow?.id || null, referenceType: "nursing", createdBy: userId, notes: `Nursing consumable — ${c.item_name}` },
        });
      }

      // Post journal entry
      if (billId) {
        await autoPostJournalEntry({
          triggerEvent: activeAdmissionId ? "bill_finalized_ipd" : "bill_finalized_opd",
          sourceModule: "nursing", sourceId: billId, amount: grandTotal,
          description: `Nursing Procedure: ${procedureName}`,
          hospitalId, postedBy: userId || "",
        });
      }

      toast.success(`Logged & billed: ₹${grandTotal.toLocaleString("en-IN")} (${procedureName})`);
      onClose();
    } catch (err) {
      console.error("Nursing procedure error:", err);
      toast.error("Failed to log procedure");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>🩹 Log Nursing Procedure</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Patient *</Label>
            <PatientSearchPicker hospitalId={hospitalId} value={patientId} onChange={setPatientId} />
          </div>
          <div>
            <Label>Procedure *</Label>
            <Select value={procedureName} onValueChange={setProcedureName}>
              <SelectTrigger><SelectValue placeholder="Select procedure" /></SelectTrigger>
              <SelectContent>
                {PROCEDURES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Quantity</Label>
              <Input type="number" min={1} value={quantity} onChange={e => setQuantity(Number(e.target.value) || 1)} />
            </div>
            <div className="flex items-end">
              <p className="text-xs text-muted-foreground pb-2">e.g. O₂ hours, dressing count</p>
            </div>
          </div>
          <div>
            <Label>Consumables used (deducted from stock)</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input placeholder="Search inventory item…" value={itemSearch} onChange={e => searchItems(e.target.value)} className="pl-8" />
              {itemResults.length > 0 && (
                <div className="absolute z-20 left-0 right-0 mt-0.5 max-h-40 overflow-auto border border-border rounded-md bg-popover shadow">
                  {itemResults.map((it) => (
                    <div key={it.id} onClick={() => addConsumable(it)} className="px-3 py-1.5 text-sm hover:bg-muted cursor-pointer">{it.item_name} <span className="text-xs text-muted-foreground">({it.uom})</span></div>
                  ))}
                </div>
              )}
            </div>
            {consumables.map((c, idx) => (
              <div key={c.item_id} className="flex items-center gap-2 mt-1.5">
                <span className="text-sm flex-1 truncate">{c.item_name}</span>
                <Input type="number" min={1} value={c.quantity} onChange={e => { const cp = [...consumables]; cp[idx].quantity = Number(e.target.value) || 1; setConsumables(cp); }} className="h-8 w-16" />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-destructive" onClick={() => setConsumables(consumables.filter((_, i) => i !== idx))}><X className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
          <div>
            <Label>Notes</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Clinical notes (optional)" rows={2} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleLogAndBill} disabled={saving}>
              {saving ? "Processing..." : "Log & Bill"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
