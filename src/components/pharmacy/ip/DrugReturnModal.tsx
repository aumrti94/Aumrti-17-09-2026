import React, { useState, useEffect, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Lock, Loader2, RotateCcw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency } from "@/lib/currency";
import { processPharmacyReturn, STOCK_ACTIONS, type StockAction } from "@/lib/pharmacyReturns";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { useHospitalContext } from "@/hooks/useHospitalContext";
import { hasActionAccess } from "@/lib/tabPermissions";

interface DispensedItem {
  id: string;
  drug_name: string;
  batch_number: string;
  batch_id: string;
  drug_id: string;
  drug_schedule: string | null;
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
  stockAction: StockAction;
}

interface PharmacyUser {
  id: string;
  full_name: string;
  role: string;
  email: string;
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
  const { permissions, role } = useHospitalContext();
  const canProcessReturn = hasActionAccess("pharmacy", "process_return", permissions, role);
  const canQuarantineDestroy = hasActionAccess("pharmacy", "quarantine_destroy_stock", permissions, role);
  const [items, setItems] = useState<DispensedItem[]>([]);
  const [lines, setLines] = useState<Record<string, ReturnLine>>({});
  const [step, setStep] = useState<"select" | "ndps_confirm">("select");
  const [pharmacistUsers, setPharmacistUsers] = useState<PharmacyUser[]>([]);
  const [ndpsPharmacistId, setNdpsPharmacistId] = useState("");
  const [ndpsSeniorId, setNdpsSeniorId] = useState("");
  // Senior sign-off re-authentication (KNOWN-BUG, found live) — see the password field's own
  // comment below for why this exists.
  const [ndpsSeniorPassword, setNdpsSeniorPassword] = useState("");
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => setCurrentUserId(data?.id || null));
    });
  }, []);

  const fetchItems = useCallback(async () => {
    setLoading(true);
    // Join through pharmacy_dispensing to filter by admission
    const { data } = await (supabase as any)
      .from("pharmacy_dispensing_items")
      .select(`
        id, drug_name, batch_number, batch_id, drug_id, dispensing_id,
        quantity_dispensed, unit_price, gst_percent, is_ndps, return_status,
        return_quantity, drug_master(drug_schedule),
        pharmacy_dispensing!inner(admission_id, hospital_id)
      `)
      .eq("pharmacy_dispensing.admission_id", admissionId)
      .eq("pharmacy_dispensing.hospital_id", hospitalId)
      .gt("quantity_dispensed", 0);

    const unreturned = (data || [])
      .filter((i: any) => !i.return_status || i.return_status === "none")
      .map((i: any) => ({ ...i, drug_schedule: i.drug_master?.drug_schedule || null }));
    setItems(unreturned);
    setLoading(false);
  }, [admissionId, hospitalId]);

  const fetchPharmacists = useCallback(async () => {
    // app_role enum has no senior_pharmacist/chief_pharmacist value — querying for them
    // throws (invalid enum literal), which silently emptied this dropdown. `email` is
    // fetched now (it wasn't before) because the senior sign-off re-authenticates by password.
    const { data, error } = await (supabase as any)
      .from("users")
      .select("id, full_name, role, email")
      .eq("hospital_id", hospitalId)
      .in("role", ["pharmacist", "hospital_admin"]);
    if (error) console.error("fetchPharmacists failed:", error.message);
    setPharmacistUsers(data || []);
  }, [hospitalId]);

  useEffect(() => {
    fetchItems();
    fetchPharmacists();
  }, [admissionId, fetchItems, fetchPharmacists]);

  const updateLine = (itemId: string, patch: Partial<ReturnLine>) => {
    setLines(prev => ({
      ...prev,
      [itemId]: { qty: 0, reason: "", stockAction: "returned_to_stock", ...prev[itemId], ...patch },
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
    if (!canProcessReturn) {
      toast({ title: "You don't have permission to process returns", variant: "destructive" });
      return;
    }
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
      // NDPS senior sign-off re-authentication (KNOWN-BUG, found live) — mirrors the pattern
      // already used for IP dispensing (NDPSDualSignoffModal.tsx) and retail (RetailPayment.tsx):
      // sign in as the named senior pharmacist to prove the password is genuinely theirs, then
      // restore the current user's own session regardless of outcome.
      if (hasNdps) {
        const senior = pharmacistUsers.find(p => p.id === ndpsSeniorId);
        if (!senior?.email) throw new Error("Senior pharmacist not found");

        const { data: { session: ownSession } } = await supabase.auth.getSession();
        const { error: seniorAuthErr } = await supabase.auth.signInWithPassword({
          email: senior.email,
          password: ndpsSeniorPassword,
        });
        if (ownSession) {
          await supabase.auth.setSession({
            access_token: ownSession.access_token,
            refresh_token: ownSession.refresh_token,
          });
        }
        if (seniorAuthErr) {
          throw new Error(`Senior pharmacist's password is incorrect: ${seniorAuthErr.message}`);
        }
      }

      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: userData } = await (supabase as any)
        .from("users")
        .select("id")
        .eq("auth_user_id", user.id)
        .maybeSingle();
      if (!userData) throw new Error("User not found");

      const userId = userData.id;

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

      const isInsurance = pharmBill
        ? Number(pharmBill.insurance_amount ?? 0) > 0
        : false;

      // ── 2. Process the return through the shared pharmacy-return helper ────
      const result = await processPharmacyReturn(
        {
          hospitalId,
          patientId,
          patientName,
          admissionId,
          billId: pharmBill?.id ?? null,
          billPaymentStatus: pharmBill?.payment_status ?? null,
          userId,
          ndpsPharmacistId: ndpsPharmacistId || null,
          ndpsSeniorId: ndpsSeniorId || null,
          requiresInsuranceAmendment: isInsurance,
          insuranceAmendmentNotes: isInsurance && pharmBill?.payment_status === "paid"
            ? "Claim amount reduced by credit note — amendment required if claim already submitted"
            : null,
        },
        activeLines.map(item => {
          const l = lines[item.id];
          return {
            dispensingItemId: item.id,
            dispensingId: item.dispensing_id,
            drugId: item.drug_id,
            drugSchedule: item.drug_schedule,
            drugName: item.drug_name,
            batchId: item.batch_id,
            batchNumber: item.batch_number,
            quantity: l.qty,
            unitPrice: item.unit_price,
            gstPercent: item.gst_percent,
            isNdps: item.is_ndps,
            reason: l.reason,
            stockAction: l.stockAction || "returned_to_stock",
          };
        })
      );

      if (result.totalRefund > 0 && !result.creditNoteId) {
        throw new Error("Credit note creation failed");
      }

      if (result.refundPayableCreated) {
        toast({
          title: "Refund payable created",
          description: `₹${formatCurrency(result.totalRefund)} pending billing supervisor approval.`,
        });
      }

      // ── 3. Insurance flag ─────────────────────────────────────────────────
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

      // ── 4. NABH evidence ──────────────────────────────────────────────────
      logNABHEvidence(
        hospitalId,
        "MOM.7",
        `Drug return processed: ${patientName}, CN ${result.creditNoteNumber}, ` +
        `${activeLines.length} item(s), Credit ₹${formatCurrency(result.totalRefund)}. ` +
        `Reasons: ${[...new Set(activeLines.map(i => lines[i.id].reason))].join(", ")}` +
        (hasNdps ? ". NDPS items returned — register entry created." : ""),
        "compliant"
      );

      toast({ title: `Return processed — Credit Note ${result.creditNoteNumber} (₹${formatCurrency(result.totalRefund)})` });
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
                        {!!line?.qty && (
                          <div className="flex gap-1.5">
                            {STOCK_ACTIONS.filter(a => a.value === "returned_to_stock" || canQuarantineDestroy).map(a => (
                              <button
                                key={a.value}
                                type="button"
                                onClick={() => updateLine(item.id, { stockAction: a.value })}
                                className={cn(
                                  "flex-1 px-2 py-1 text-[10px] rounded border font-medium transition-colors",
                                  (line?.stockAction ?? "returned_to_stock") === a.value
                                    ? a.cls
                                    : "bg-background border-border hover:bg-muted"
                                )}
                              >
                                {a.label}
                              </button>
                            ))}
                          </div>
                        )}
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
                disabled={activeLines.length === 0 || submitting || !canProcessReturn}
                title={!canProcessReturn ? "You don't have permission to process returns" : undefined}
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
                  onValueChange={(v) => { setNdpsSeniorId(v); setNdpsSeniorPassword(""); }}
                >
                  <SelectTrigger className="h-9 text-[13px]">
                    <SelectValue placeholder="Select senior pharmacist…" />
                  </SelectTrigger>
                  <SelectContent>
                    {pharmacistUsers
                      // Excludes the current user AND whoever is already picked as Confirming
                      // Pharmacist (KNOWN-BUG, found live) — neither exclusion existed before,
                      // so the same person could be selected in both fields, and even a
                      // genuinely different name required no verification at all: picking a
                      // name WAS the entire "sign-off". The password field below (with real
                      // re-authentication in submitReturn) closes the second half of that gap.
                      .filter(u => u.role === "hospital_admin" && u.id !== currentUserId && u.id !== ndpsPharmacistId)
                      .map(u => (
                        <SelectItem key={u.id} value={u.id} className="text-[13px]">
                          {u.full_name} ({u.role})
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {ndpsSeniorId && (
                <div>
                  <label className="text-[12px] font-semibold text-foreground block mb-1">
                    Senior Pharmacist's Password *
                  </label>
                  <Input
                    type="password"
                    placeholder="Enter senior pharmacist's password"
                    value={ndpsSeniorPassword}
                    onChange={e => setNdpsSeniorPassword(e.target.value)}
                    className="h-9 text-[13px]"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" size="sm" className="flex-1" onClick={() => setStep("select")}>
                ← Back
              </Button>
              <Button
                size="sm"
                className="flex-1 bg-destructive hover:bg-destructive/90"
                disabled={!ndpsPharmacistId || !ndpsSeniorId || !ndpsSeniorPassword || submitting || !canProcessReturn}
                title={!canProcessReturn ? "You don't have permission to process returns" : undefined}
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
