import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Lock, Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { formatCurrency } from "@/lib/currency";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { useToast } from "@/hooks/use-toast";

interface DispensedItem {
  id: string;
  drug_name: string;
  batch_number: string;
  batch_id: string;
  drug_id: string;
  dispensing_id: string;
  quantity_dispensed: number;
  unit_price: number;
  gst_percent: number;
  is_ndps: boolean;
  return_status: string;
}

interface ReturnLine {
  qty: number;
  reason: string;
}

interface PharmacyUser {
  id: string;
  full_name: string;
  role: string;
}

interface Props {
  admissionId: string;
  patientId: string;
  patientName: string;
  hospitalId: string;
  onClose: () => void;
  onComplete: () => void;
}

const RETURN_REASONS = [
  { value: "unused", label: "Unused / Not needed" },
  { value: "adverse_reaction", label: "Adverse Reaction" },
  { value: "prescription_changed", label: "Prescription Changed" },
  { value: "patient_expired", label: "Patient Expired" },
];

const DrugReturnModal: React.FC<Props> = ({
  admissionId, patientId, patientName, hospitalId, onClose, onComplete,
}) => {
  const { toast } = useToast();
  const [items, setItems] = useState<DispensedItem[]>([]);
  const [lines, setLines] = useState<Record<string, ReturnLine>>({});
  const [step, setStep] = useState<"select" | "ndps_confirm">("select");
  const [pharmacistUsers, setPharmacistUsers] = useState<PharmacyUser[]>([]);
  const [ndpsPharmacistId, setNdpsPharmacistId] = useState("");
  const [ndpsSeniorId, setNdpsSeniorId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchItems();
    fetchPharmacists();
  }, [admissionId]);

  const fetchItems = async () => {
    setLoading(true);
    // Join through pharmacy_dispensing to filter by admission
    const { data } = await (supabase as any)
      .from("pharmacy_dispensing_items")
      .select(`
        id, drug_name, batch_number, batch_id, drug_id, dispensing_id,
        quantity_dispensed, unit_price, gst_percent, is_ndps, return_status,
        return_quantity,
        pharmacy_dispensing!inner(admission_id, hospital_id)
      `)
      .eq("pharmacy_dispensing.admission_id", admissionId)
      .eq("pharmacy_dispensing.hospital_id", hospitalId)
      .gt("quantity_dispensed", 0);

    const unreturned = (data || []).filter(
      (i: any) => !i.return_status || i.return_status === "none"
    );
    setItems(unreturned);
    setLoading(false);
  };

  const fetchPharmacists = async () => {
    const { data } = await (supabase as any)
      .from("users")
      .select("id, full_name, role")
      .eq("hospital_id", hospitalId)
      .in("role", ["pharmacist", "senior_pharmacist", "chief_pharmacist", "hospital_admin"]);
    setPharmacistUsers(data || []);
  };

  const updateLine = (itemId: string, patch: Partial<ReturnLine>) => {
    setLines(prev => ({
      ...prev,
      [itemId]: { qty: 0, reason: "", ...prev[itemId], ...patch },
    }));
  };

  const activeLines = items.filter(i => (lines[i.id]?.qty ?? 0) > 0 && lines[i.id]?.reason);
  const ndpsActive  = activeLines.filter(i => i.is_ndps);
  const hasNdps     = ndpsActive.length > 0;

  const totalCredit = activeLines.reduce((s, i) => {
    const qty = lines[i.id]?.qty ?? 0;
    const base = qty * i.unit_price;
    const gst  = base * (i.gst_percent / 100);
    return s + base + gst;
  }, 0);

  const handleProceed = () => {
    if (activeLines.length === 0) {
      toast({ title: "Select at least one item to return", variant: "destructive" });
      return;
    }
    for (const item of activeLines) {
      const l = lines[item.id];
      if (l.qty > item.quantity_dispensed) {
        toast({ title: `Return qty for ${item.drug_name} exceeds dispensed qty`, variant: "destructive" });
        return;
      }
    }
    if (hasNdps) {
      setStep("ndps_confirm");
    } else {
      submitReturn();
    }
  };

  const submitReturn = async () => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: userData } = await (supabase as any)
        .from("users")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (!userData) throw new Error("User not found");

      const userId = userData.id;
      const now    = new Date().toISOString();

      // ── 1. Find original pharmacy bill for this admission ──────────────────
      const { data: pharmBill } = await supabase
        .from("bills")
        .select("id, payment_status, insurance_amount, total_amount")
        .eq("admission_id", admissionId)
        .eq("hospital_id", hospitalId)
        .eq("bill_type", "pharmacy" as any)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // ── 2. Process each returned item ─────────────────────────────────────
      let totalBase   = 0;
      let totalGstCr  = 0;
      const creditLinePayloads: any[] = [];

      for (const item of activeLines) {
        const l    = lines[item.id];
        const base = l.qty * item.unit_price;
        const gst  = parseFloat((base * (item.gst_percent / 100)).toFixed(2));

        totalBase  += base;
        totalGstCr += gst;

        // 2a. Update dispensing item
        await (supabase as any)
          .from("pharmacy_dispensing_items")
          .update({
            return_quantity:     l.qty,
            return_reason:       l.reason,
            return_status:       "confirmed",
            returned_at:         now,
            returned_by:         userId,
            return_confirmed_by: hasNdps && item.is_ndps ? ndpsPharmacistId || userId : userId,
            ...(item.is_ndps && ndpsSeniorId ? { ndps_return_senior_id: ndpsSeniorId } : {}),
          })
          .eq("id", item.id);

        // 2b. Restore batch stock
        const { data: batchRow } = await supabase
          .from("drug_batches")
          .select("quantity_available")
          .eq("id", item.batch_id)
          .maybeSingle();

        if (batchRow) {
          await supabase
            .from("drug_batches")
            .update({ quantity_available: (batchRow.quantity_available ?? 0) + l.qty })
            .eq("id", item.batch_id);
        }

        // 2c. NDPS return register entry (immutable — trigger prevents mutation)
        if (item.is_ndps && item.drug_id) {
          const { data: lastNdps } = await supabase
            .from("ndps_register")
            .select("balance_after")
            .eq("drug_id", item.drug_id)
            .eq("hospital_id", hospitalId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          const newBalance = Number(lastNdps?.balance_after ?? 0) + l.qty;

          await supabase.from("ndps_register").insert({
            hospital_id:           hospitalId,
            drug_id:               item.drug_id,
            drug_name:             item.drug_name,
            transaction_type:      "return",
            quantity:              l.qty,
            balance_after:         newBalance,
            patient_name:          patientName,
            pharmacist_id:         ndpsPharmacistId || userId,
            second_pharmacist_id:  ndpsSeniorId || null,
            remarks:               `Return: ${l.reason}. Dispensing item ${item.id}`,
          });
        }

        creditLinePayloads.push({
          itemId:      item.id,
          drug_name:   item.drug_name,
          qty:         l.qty,
          unit_price:  item.unit_price,
          gst_percent: item.gst_percent,
          gst_credit:  gst,
          line_credit: parseFloat((base + gst).toFixed(2)),
        });
      }

      const totalCredit = parseFloat((totalBase + totalGstCr).toFixed(2));

      // ── 3. Credit note ────────────────────────────────────────────────────
      const cnNumber = await generateBillNumber(hospitalId, "CN");

      const isInsurance = pharmBill
        ? Number(pharmBill.insurance_amount ?? 0) > 0
        : false;

      const { data: cn, error: cnErr } = await (supabase as any)
        .from("credit_notes")
        .insert({
          hospital_id:                  hospitalId,
          credit_note_number:           cnNumber,
          patient_id:                   patientId,
          admission_id:                 admissionId,
          original_bill_id:             pharmBill?.id ?? null,
          dispensing_id:                activeLines[0]?.dispensing_id ?? null,
          credit_amount:                parseFloat(totalBase.toFixed(2)),
          gst_credit:                   parseFloat(totalGstCr.toFixed(2)),
          total_credit:                 totalCredit,
          return_reason:                [...new Set(activeLines.map(i => lines[i.id].reason))].join(", "),
          requires_insurance_amendment: isInsurance,
          insurance_amendment_notes:    isInsurance && pharmBill?.payment_status === "paid"
            ? "Claim amount reduced by credit note — amendment required if claim already submitted"
            : null,
          status:        "approved",
          created_by:    userId,
          approved_by:   userId,
          approved_at:   now,
        })
        .select("id")
        .maybeSingle();

      if (cnErr || !cn) throw new Error(`Credit note creation failed: ${cnErr?.message}`);

      // 3a. Credit note line items
      await (supabase as any).from("credit_note_items").insert(
        creditLinePayloads.map(p => ({
          hospital_id:       hospitalId,
          credit_note_id:    cn.id,
          dispensing_item_id: p.itemId,
          drug_name:         p.drug_name,
          return_quantity:   p.qty,
          unit_rate:         p.unit_price,
          gst_percent:       p.gst_percent,
          gst_credit:        p.gst_credit,
          line_credit:       p.line_credit,
        }))
      );

      // ── 4. Journal entry: reverse pharmacy revenue ────────────────────────
      await autoPostJournalEntry({
        triggerEvent:  "credit_note_pharmacy",
        sourceModule:  "pharmacy",
        sourceId:      cn.id,
        amount:        totalCredit,
        description:   `Drug Return Credit Note ${cnNumber} — ${patientName}`,
        hospitalId,
        postedBy:      user.id,
      });

      // ── 5. Refund payable — only when bill already paid ───────────────────
      if (pharmBill?.payment_status === "paid" && totalCredit > 0) {
        await (supabase as any).from("refund_payables").insert({
          hospital_id:    hospitalId,
          patient_id:     patientId,
          admission_id:   admissionId,
          credit_note_id: cn.id,
          amount:         totalCredit,
          status:         "pending_approval",
          requested_by:   userId,
          notes:          `Drug return: ${cnNumber}. Requires billing supervisor approval before processing.`,
        });
        toast({
          title: "Refund payable created",
          description: `₹${formatCurrency(totalCredit)} pending billing supervisor approval.`,
        });
      }

      // ── 6. Insurance flag ─────────────────────────────────────────────────
      if (isInsurance) {
        const alreadySubmitted = await (async () => {
          const { data: claim } = await (supabase as any)
            .from("pmjay_claims")
            .select("status")
            .eq("bill_id", pharmBill!.id)
            .maybeSingle();
          return claim && !["draft", "pending"].includes(claim.status);
        })();

        if (alreadySubmitted) {
          toast({
            title: "Insurance claim flagged for amendment",
            description: "Credit note raised on a submitted claim. Notify the insurance executive.",
            variant: "destructive",
          });
        }
      }

      // ── 7. NABH evidence ──────────────────────────────────────────────────
      logNABHEvidence(
        hospitalId,
        "MOM.7",
        `Drug return processed: ${patientName}, CN ${cnNumber}, ` +
        `${activeLines.length} item(s), Credit ₹${formatCurrency(totalCredit)}. ` +
        `Reasons: ${[...new Set(activeLines.map(i => lines[i.id].reason))].join(", ")}` +
        (hasNdps ? ". NDPS items returned — register entry created." : ""),
        "compliant"
      );

      toast({ title: `Return processed — Credit Note ${cnNumber} (₹${formatCurrency(totalCredit)})` });
      onComplete();
    } catch (err: any) {
      toast({ title: "Return failed", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <RotateCcw size={16} className="text-amber-600" />
            Return Drugs — {patientName}
          </DialogTitle>
        </DialogHeader>

        {step === "select" && (
          <div className="space-y-3">
            {loading ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No previously dispensed items found for this admission.
              </p>
            ) : (
              <>
                <p className="text-[12px] text-muted-foreground">
                  Select items to return. Partial returns are allowed.
                </p>
                <div className="border rounded-lg divide-y divide-border">
                  {items.map(item => {
                    const line = lines[item.id];
                    const base = (line?.qty ?? 0) * item.unit_price;
                    const gst  = base * (item.gst_percent / 100);
                    return (
                      <div key={item.id} className="p-3 space-y-2">
                        <div className="flex items-start gap-3">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-semibold text-foreground">{item.drug_name}</span>
                              {item.is_ndps && (
                                <Badge className="text-[9px] px-1.5 py-0 h-4 bg-destructive/10 text-destructive border-destructive/30">
                                  <Lock size={8} className="mr-0.5" /> NDPS
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              Batch: {item.batch_number} · Dispensed: {item.quantity_dispensed} units · ₹{formatCurrency(item.unit_price)}/unit
                            </p>
                          </div>
                          {line?.qty > 0 && line?.reason && (
                            <span className="text-[11px] text-amber-700 font-medium">
                              −₹{formatCurrency(parseFloat((base + gst).toFixed(2)))}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] text-muted-foreground w-16">Return qty</span>
                            <Input
                              type="number"
                              min={0}
                              max={item.quantity_dispensed}
                              value={line?.qty ?? 0}
                              onChange={e => updateLine(item.id, { qty: Math.min(item.quantity_dispensed, Math.max(0, parseInt(e.target.value) || 0)) })}
                              className="w-20 h-8 text-center text-sm"
                            />
                            <span className="text-[11px] text-muted-foreground">/ {item.quantity_dispensed}</span>
                          </div>
                          <Select
                            value={line?.reason ?? ""}
                            onValueChange={v => updateLine(item.id, { reason: v })}
                            disabled={!line?.qty}
                          >
                            <SelectTrigger className="h-8 text-[12px] flex-1">
                              <SelectValue placeholder="Select reason…" />
                            </SelectTrigger>
                            <SelectContent>
                              {RETURN_REASONS.map(r => (
                                <SelectItem key={r.value} value={r.value} className="text-[12px]">{r.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {activeLines.length > 0 && (
                  <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-lg px-3 py-2 text-[12px] text-amber-700 flex justify-between items-center">
                    <span>{activeLines.length} item(s) to return</span>
                    <span className="font-bold">Credit: −₹{formatCurrency(totalCredit)}</span>
                  </div>
                )}

                {hasNdps && (
                  <div className="flex items-start gap-2 bg-destructive/5 border border-destructive/20 rounded-lg p-3">
                    <AlertTriangle size={14} className="text-destructive mt-0.5 shrink-0" />
                    <p className="text-[12px] text-destructive">
                      NDPS drugs selected. Pharmacist confirmation and senior pharmacist sign-off required on the next step.
                      An immutable NDPS return register entry will be created.
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose} className="flex-1">Cancel</Button>
              <Button
                size="sm"
                className="flex-1"
                disabled={activeLines.length === 0 || submitting}
                onClick={handleProceed}
              >
                {hasNdps ? "Next: NDPS Confirmation →" : "Confirm Return"}
              </Button>
            </div>
          </div>
        )}

        {step === "ndps_confirm" && (
          <div className="space-y-4">
            <div className="flex items-start gap-2 bg-destructive/5 border border-destructive/20 rounded-lg p-3">
              <Lock size={14} className="text-destructive mt-0.5 shrink-0" />
              <div className="text-[12px] text-destructive space-y-1">
                <p className="font-semibold">NDPS Drug Return — Dual Sign-off Required</p>
                <p>
                  Returning: {ndpsActive.map(i => `${i.drug_name} × ${lines[i.id]?.qty}`).join(", ")}.
                  An immutable register entry will be created under NDPS Act 1985.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-semibold text-foreground block mb-1">
                  Confirming Pharmacist *
                </label>
                <Select value={ndpsPharmacistId} onValueChange={setNdpsPharmacistId}>
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Select pharmacist…" />
                  </SelectTrigger>
                  <SelectContent>
                    {pharmacistUsers.map(u => (
                      <SelectItem key={u.id} value={u.id} className="text-[13px]">
                        {u.full_name} ({u.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="text-[12px] font-semibold text-foreground block mb-1">
                  Senior Pharmacist Sign-off *
                </label>
                <Select
                  value={ndpsSeniorId}
                  onValueChange={setNdpsSeniorId}
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Select senior pharmacist…" />
                  </SelectTrigger>
                  <SelectContent>
                    {pharmacistUsers
                      .filter(u => ["senior_pharmacist", "chief_pharmacist", "hospital_admin"].includes(u.role))
                      .map(u => (
                        <SelectItem key={u.id} value={u.id} className="text-[13px]">
                          {u.full_name} ({u.role})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setStep("select")}>
                ← Back
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-destructive hover:bg-destructive/90"
                disabled={!ndpsPharmacistId || !ndpsSeniorId || submitting}
                onClick={submitReturn}
              >
                {submitting
                  ? <><Loader2 size={14} className="animate-spin mr-1" /> Processing…</>
                  : "Sign & Confirm NDPS Return"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default DrugReturnModal;
