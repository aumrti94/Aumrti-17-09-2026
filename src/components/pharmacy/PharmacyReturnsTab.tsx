import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, Loader2, ChevronDown, ChevronUp, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { formatCurrency } from "@/lib/currency";

interface Props {
  hospitalId: string;
  storeId?: string | null;
}

interface DispensingItem {
  id: string;
  dispensing_id: string;
  drug_name: string;
  quantity_dispensed: number;
  return_quantity: number | null;
  return_reason: string | null;
  return_status: string;
  batch_id: string | null;
  batch_number: string;
  unit_price: number;
  gst_percent: number;
  is_ndps: boolean;
  dispensed_at: string;
  patient_name: string | null;
  uhid: string | null;
  patient_id: string | null;
  admission_id: string | null;
  bill_id: string | null;
  bill_payment_status: string | null;
}

const RETURN_REASONS = [
  { value: "unused",               label: "Unused / Not needed" },
  { value: "excess",               label: "Excess dispensed" },
  { value: "patient_discharged",   label: "Patient discharged" },
  { value: "physician_order",      label: "Physician order changed" },
  { value: "wrong_drug",           label: "Wrong drug dispensed" },
  { value: "adverse_reaction",     label: "Adverse reaction" },
  { value: "prescription_changed", label: "Prescription changed" },
  { value: "expired",              label: "Expired drug" },
  { value: "other",                label: "Other" },
];

const STOCK_ACTIONS = [
  { value: "returned_to_stock", label: "Return to stock",     cls: "bg-emerald-100 text-emerald-700 border-emerald-300" },
  { value: "quarantined",       label: "Quarantine",          cls: "bg-amber-100 text-amber-700 border-amber-300" },
  { value: "destroyed",         label: "Destroy / Dispose",   cls: "bg-red-100 text-red-700 border-red-300" },
];

const PharmacyReturnsTab: React.FC<Props> = ({ hospitalId, storeId }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<DispensingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [returnQty, setReturnQty] = useState<Record<string, string>>({});
  const [returnReason, setReturnReason] = useState<Record<string, string>>({});
  const [stockAction, setStockAction] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [showReturned, setShowReturned] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle();
      setUserId(data?.id || null);
    })();
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const since = new Date(Date.now() - 30 * 86400000).toISOString();

    const { data, error } = await (supabase as any)
      .from("pharmacy_dispensing_items")
      .select(`
        id, drug_name, quantity_dispensed, return_quantity, return_reason,
        return_status, batch_id, batch_number, unit_price, gst_percent, is_ndps,
        dispensing_id,
        pharmacy_dispensing!inner(
          dispensed_at, hospital_id, admission_id, patient_id,
          patients(full_name, uhid)
        )
      `)
      .eq("pharmacy_dispensing.hospital_id", hospitalId)
      .gte("pharmacy_dispensing.dispensed_at", since)
      .gt("quantity_dispensed", 0)
      .order("pharmacy_dispensing.dispensed_at", { ascending: false })
      .limit(300);

    if (error) {
      console.error("Returns load error:", error);
      setLoading(false);
      return;
    }

    // Collect admission_ids → look up linked bills
    const admissionIds = [
      ...new Set(
        (data || [])
          .map((d: any) => d.pharmacy_dispensing?.admission_id)
          .filter(Boolean) as string[]
      ),
    ];

    const billMap = new Map<string, { id: string; payment_status: string }>();
    if (admissionIds.length > 0) {
      const { data: bills } = await (supabase as any)
        .from("bills")
        .select("id, admission_id, payment_status, bill_type")
        .in("admission_id", admissionIds)
        .neq("bill_status", "cancelled")
        .order("created_at", { ascending: false });

      for (const b of bills || []) {
        if (!billMap.has(b.admission_id)) {
          billMap.set(b.admission_id, { id: b.id, payment_status: b.payment_status });
        }
      }
    }

    const mapped: DispensingItem[] = (data || []).map((d: any) => {
      const rec = d.pharmacy_dispensing || {};
      const admId = rec.admission_id || null;
      const bill = admId ? billMap.get(admId) : null;
      return {
        id: d.id,
        dispensing_id: d.dispensing_id,
        drug_name: d.drug_name,
        quantity_dispensed: d.quantity_dispensed,
        return_quantity: d.return_quantity,
        return_reason: d.return_reason,
        return_status: d.return_status || "none",
        batch_id: d.batch_id,
        batch_number: d.batch_number || "",
        unit_price: Number(d.unit_price || 0),
        gst_percent: Number(d.gst_percent || 0),
        is_ndps: !!d.is_ndps,
        dispensed_at: rec.dispensed_at || "",
        patient_name: rec.patients?.full_name || null,
        uhid: rec.patients?.uhid || null,
        patient_id: rec.patient_id || null,
        admission_id: admId,
        bill_id: bill?.id || null,
        bill_payment_status: bill?.payment_status || null,
      };
    });

    setItems(mapped);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleReturn = async (item: DispensingItem) => {
    const qty = parseFloat(returnQty[item.id] || "0");
    const reason = returnReason[item.id];
    const action = stockAction[item.id] || "returned_to_stock";

    if (!qty || qty <= 0 || qty > item.quantity_dispensed) {
      toast({ title: "Invalid quantity", variant: "destructive" });
      return;
    }
    if (!reason) {
      toast({ title: "Return reason required", variant: "destructive" });
      return;
    }

    setSaving(item.id);
    try {
      const now = new Date().toISOString();
      const base = qty * item.unit_price;
      const gst  = parseFloat((base * (item.gst_percent / 100)).toFixed(2));
      const totalRefund = parseFloat((base + gst).toFixed(2));

      // ── 1. Mark dispensing item as returned ───────────────────────────────
      await (supabase as any)
        .from("pharmacy_dispensing_items")
        .update({
          return_quantity:     qty,
          return_reason:       reason,
          return_status:       "confirmed",
          returned_at:         now,
          returned_by:         userId,
          return_confirmed_by: userId,
        })
        .eq("id", item.id);

      // ── 2. Stock action ───────────────────────────────────────────────────
      if (item.batch_id) {
        if (action === "returned_to_stock") {
          const { data: batchRow } = await (supabase as any)
            .from("drug_batches")
            .select("quantity_available")
            .eq("id", item.batch_id)
            .maybeSingle();
          if (batchRow) {
            await (supabase as any)
              .from("drug_batches")
              .update({ quantity_available: (batchRow.quantity_available || 0) + qty })
              .eq("id", item.batch_id);
          }
        } else if (action === "quarantined") {
          await (supabase as any)
            .from("drug_batches")
            .update({ status: "quarantined" })
            .eq("id", item.batch_id);
        } else if (action === "destroyed") {
          await (supabase as any)
            .from("drug_batches")
            .update({ status: "destroyed" })
            .eq("id", item.batch_id);
        }
      }

      // ── 3. Bill adjustment via credit note (IPD only) ─────────────────────
      let creditNoteId: string | null = null;
      let cnNumber: string | null = null;
      let billAdjusted = false;

      if (item.admission_id && totalRefund > 0) {
        cnNumber = await generateBillNumber(hospitalId, "CN");

        const { data: cn, error: cnErr } = await (supabase as any)
          .from("credit_notes")
          .insert({
            hospital_id:    hospitalId,
            credit_note_number: cnNumber,
            patient_id:     item.patient_id,
            admission_id:   item.admission_id,
            original_bill_id: item.bill_id || null,
            dispensing_id:  item.dispensing_id,
            credit_amount:  parseFloat(base.toFixed(2)),
            gst_credit:     gst,
            total_credit:   totalRefund,
            return_reason:  reason,
            requires_insurance_amendment: false,
            status:         "approved",
            created_by:     userId,
            approved_by:    userId,
            approved_at:    now,
          })
          .select("id")
          .maybeSingle();

        if (!cnErr && cn) {
          creditNoteId = cn.id;

          await (supabase as any).from("credit_note_items").insert({
            hospital_id:        hospitalId,
            credit_note_id:     cn.id,
            dispensing_item_id: item.id,
            drug_name:          item.drug_name,
            return_quantity:    qty,
            unit_rate:          item.unit_price,
            gst_percent:        item.gst_percent,
            gst_credit:         gst,
            line_credit:        totalRefund,
          });

          // If bill already paid, create a refund payable
          if (item.bill_payment_status === "paid") {
            await (supabase as any).from("refund_payables").insert({
              hospital_id:    hospitalId,
              patient_id:     item.patient_id,
              admission_id:   item.admission_id,
              credit_note_id: cn.id,
              amount:         totalRefund,
              status:         "pending_approval",
              requested_by:   userId,
              notes:          `Drug return: ${cnNumber}. Requires billing supervisor approval.`,
            });
          }

          billAdjusted = true;
        } else {
          console.warn("Credit note creation failed:", cnErr?.message);
        }
      }

      // ── 4. pharmacy_return_audit ──────────────────────────────────────────
      await (supabase as any).from("pharmacy_return_audit").insert({
        hospital_id:        hospitalId,
        dispensing_item_id: item.id,
        patient_id:         item.patient_id || null,
        admission_id:       item.admission_id || null,
        bill_id:            billAdjusted ? item.bill_id : null,
        credit_note_id:     creditNoteId,
        drug_name:          item.drug_name,
        batch_number:       item.batch_number || null,
        quantity_returned:  qty,
        unit_price:         item.unit_price,
        total_refund:       totalRefund,
        return_reason:      reason,
        stock_action:       action,
        bill_adjusted:      billAdjusted,
        bill_adjustment_at: billAdjusted ? now : null,
        created_by:         userId,
      });

      // ── 5. Clear form state ───────────────────────────────────────────────
      setExpandedId(null);
      setReturnQty(prev  => { const n = { ...prev };  delete n[item.id]; return n; });
      setReturnReason(prev => { const n = { ...prev }; delete n[item.id]; return n; });
      setStockAction(prev  => { const n = { ...prev }; delete n[item.id]; return n; });

      if (billAdjusted) {
        toast({
          title: `Return recorded — Credit Note ${cnNumber}`,
          description: `Bill adjusted by ₹${formatCurrency(totalRefund)}. ${
            item.bill_payment_status === "paid"
              ? "Refund pending billing supervisor approval."
              : "Credit applied to outstanding balance."
          }`,
        });
      } else {
        const actionLabel =
          action === "quarantined" ? "batch quarantined" :
          action === "destroyed"   ? "batch disposed" :
          `${qty} units restored to stock`;
        toast({
          title: `Return recorded — ${item.drug_name}`,
          description: actionLabel.charAt(0).toUpperCase() + actionLabel.slice(1) + ".",
        });
      }

      load();
    } catch (e: any) {
      toast({ title: "Failed to record return", description: e.message, variant: "destructive" });
    } finally {
      setSaving(null);
    }
  };

  const pending = items.filter(i => !i.return_quantity || i.return_status === "none");
  const returned = items.filter(i => i.return_quantity && i.return_quantity > 0 && i.return_status !== "none");

  const fmtDate = (iso: string) =>
    iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div className="p-4 space-y-4 max-w-3xl">
      <div className="flex items-center gap-2 mb-1">
        <RotateCcw className="h-4 w-4 text-amber-600" />
        <span className="text-sm font-semibold">Drug Returns (last 30 days)</span>
        <Badge variant="outline" className="text-[10px] ml-auto">{pending.length} pending</Badge>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading dispensing records…</span>
        </div>
      ) : pending.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4">
          No returnable dispensing records in the last 30 days.
        </p>
      ) : (
        <div className="space-y-1.5">
          {pending.map((item) => {
            const expanded = expandedId === item.id;
            const isIpd = !!item.admission_id;
            const qty = parseFloat(returnQty[item.id] || "0");
            const base = qty * item.unit_price;
            const gst  = base * (item.gst_percent / 100);
            const estRefund = parseFloat((base + gst).toFixed(2));
            const action = stockAction[item.id] || "returned_to_stock";

            return (
              <div key={item.id} className="border border-border rounded-lg overflow-hidden">
                <div
                  className="flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors"
                  onClick={() => setExpandedId(expanded ? null : item.id)}
                >
                  <div>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{item.drug_name}</p>
                      {isIpd && (
                        <Badge className="text-[9px] h-4 px-1.5 bg-blue-100 text-blue-700">IPD</Badge>
                      )}
                      {item.bill_id && (
                        <Badge className="text-[9px] h-4 px-1.5 bg-purple-100 text-purple-700">Bill</Badge>
                      )}
                      {item.is_ndps && (
                        <Badge className="text-[9px] h-4 px-1.5 bg-red-100 text-red-700">NDPS</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {item.patient_name || "—"}{item.uhid ? ` (${item.uhid})` : ""} ·{" "}
                      {fmtDate(item.dispensed_at)} · Qty: {item.quantity_dispensed}
                      {item.unit_price > 0 && ` · ₹${item.unit_price}/unit`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px]">Returnable</Badge>
                    {expanded
                      ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-border bg-muted/30 p-3 space-y-3">
                    {/* IPD bill-adjustment notice */}
                    {isIpd && item.bill_id && (
                      <div className="flex items-start gap-1.5 text-[11px] text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-1.5">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>IPD patient — a credit note will be raised against the linked IPD bill.</span>
                      </div>
                    )}
                    {item.is_ndps && (
                      <div className="flex items-start gap-1.5 text-[11px] text-destructive bg-destructive/5 border border-destructive/20 rounded px-2 py-1.5">
                        <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>NDPS drug — use <strong>Drug Return</strong> in the Dispense workspace for full dual sign-off compliance.</span>
                      </div>
                    )}

                    {/* Qty + Reason row */}
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground font-medium block mb-1">
                          Return Qty (max {item.quantity_dispensed})
                        </label>
                        <Input
                          type="number"
                          min={1}
                          max={item.quantity_dispensed}
                          value={returnQty[item.id] || ""}
                          onChange={e => setReturnQty(p => ({ ...p, [item.id]: e.target.value }))}
                          placeholder="Qty"
                          className="h-7 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground font-medium block mb-1">Reason *</label>
                        <select
                          value={returnReason[item.id] || ""}
                          onChange={e => setReturnReason(p => ({ ...p, [item.id]: e.target.value }))}
                          className="w-full h-7 text-sm border border-input rounded px-2 bg-background"
                        >
                          <option value="">Select reason…</option>
                          {RETURN_REASONS.map(r => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    {/* Stock action */}
                    <div>
                      <label className="text-[10px] text-muted-foreground font-medium block mb-1">
                        Stock Disposition *
                      </label>
                      <div className="flex gap-1.5">
                        {STOCK_ACTIONS.map(a => (
                          <button
                            key={a.value}
                            onClick={() => setStockAction(p => ({ ...p, [item.id]: a.value }))}
                            className={cn(
                              "flex-1 px-2 py-1.5 text-[11px] rounded border font-medium transition-colors",
                              action === a.value ? a.cls : "bg-background border-border hover:bg-muted"
                            )}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Refund preview */}
                    {estRefund > 0 && item.bill_id && (
                      <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1.5">
                        <CheckCircle2 className="h-3 w-3 shrink-0" />
                        Bill credit: <strong>₹{formatCurrency(estRefund)}</strong> will be raised as a credit note.
                        {item.bill_payment_status === "paid" && (
                          <span className="ml-1 text-amber-700">(Bill already paid — refund payable will be created)</span>
                        )}
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs flex-1"
                        disabled={saving === item.id || !returnQty[item.id] || !returnReason[item.id]}
                        onClick={() => handleReturn(item)}
                      >
                        {saving === item.id && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                        Confirm Return
                        {estRefund > 0 && item.bill_id && ` · Adj. ₹${formatCurrency(estRefund)}`}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setExpandedId(null)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Returned history */}
      {returned.length > 0 && (
        <div>
          <button
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowReturned(!showReturned)}
          >
            {showReturned
              ? <ChevronUp className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
            {returned.length} returned item{returned.length !== 1 ? "s" : ""} (last 30 days)
          </button>

          {showReturned && (
            <div className="mt-2 space-y-1.5">
              {returned.map(item => (
                <div
                  key={item.id}
                  className="flex items-center justify-between border border-border rounded-lg px-3 py-2 bg-emerald-50/50 dark:bg-emerald-950/20"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-foreground">{item.drug_name}</p>
                      {item.admission_id && (
                        <Badge className="text-[9px] h-4 px-1.5 bg-blue-100 text-blue-700">IPD</Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {item.patient_name || "—"} · {fmtDate(item.dispensed_at)} · Returned: {item.return_quantity}/{item.quantity_dispensed}
                      {item.unit_price > 0 && item.return_quantity
                        ? ` · ₹${formatCurrency(item.return_quantity * item.unit_price)}`
                        : ""}
                    </p>
                  </div>
                  <Badge className="bg-emerald-100 text-emerald-700 text-[10px]">
                    {item.return_reason?.replace(/_/g, " ")}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PharmacyReturnsTab;
