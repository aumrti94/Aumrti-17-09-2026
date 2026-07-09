import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { logInsuranceUpdate } from "@/lib/billAmendmentLogger";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatINR, roundCurrency } from "@/lib/currency";
import { differenceInDays } from "date-fns";
import { CheckCircle } from "lucide-react";
import type { BillRecord } from "@/pages/billing/BillingPage";

interface Props {
  bill: BillRecord;
  hospitalId: string | null;
  onRefresh: () => void;
}

interface TpaConfig {
  tpa_name: string;
  room_rent_ceiling: number;
  co_payment_type: string;
  co_payment_value: number;
  deductible: number;
}

const InsuranceTab: React.FC<Props> = ({ bill, hospitalId, onRefresh }) => {
  const { toast } = useToast();
  const [tpaName, setTpaName] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [preAuthNumber, setPreAuthNumber] = useState("");
  const [coverageType, setCoverageType] = useState<"cashless" | "reimbursement">("cashless");
  const [coveredAmount, setCoveredAmount] = useState("");
  const [autoLoaded, setAutoLoaded] = useState(false);

  // TPA config + co-pay calc state
  const [tpaConfig, setTpaConfig] = useState<TpaConfig | null>(null);
  const [admissionDays, setAdmissionDays] = useState(0);
  const [dailyRoomRate, setDailyRoomRate] = useState(0);

  // Reimbursement bank details
  const [bankName, setBankName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [accountHolder, setAccountHolder] = useState("");

  // Load saved insurance details from bill.notes on mount / bill change
  useEffect(() => {
    if (!bill.id) return;
    // Restore previously saved fields from the bill's notes JSON
    if (bill.notes) {
      try {
        const saved = JSON.parse(bill.notes);
        if (saved.tpa)      setTpaName(saved.tpa);
        if (saved.policy)   setPolicyNumber(saved.policy);
        if (saved.pre_auth) setPreAuthNumber(saved.pre_auth);
        if (saved.coverage) setCoverageType(saved.coverage as "cashless" | "reimbursement");
        if (saved.reimbursement_bank) {
          setBankName(saved.reimbursement_bank.bankName || "");
          setAccountNumber(saved.reimbursement_bank.accountNumber || "");
          setIfsc(saved.reimbursement_bank.ifsc || "");
          setAccountHolder(saved.reimbursement_bank.accountHolder || "");
        }
        if (saved.tpa) setAutoLoaded(false); // loaded from saved data, not pre-auth
      } catch {}
    }
    // Pre-fill covered amount from bill.insurance_amount if nothing in notes
    if (!bill.notes && bill.insurance_amount > 0) {
      setCoveredAmount(String(bill.insurance_amount));
    } else if (bill.notes) {
      try {
        // If notes doesn't have covered amount, fallback to bill.insurance_amount
        const saved = JSON.parse(bill.notes);
        if (!saved.covered_amount && bill.insurance_amount > 0) {
          setCoveredAmount(String(bill.insurance_amount));
        } else if (saved.covered_amount) {
          setCoveredAmount(String(saved.covered_amount));
        } else if (bill.insurance_amount > 0) {
          setCoveredAmount(String(bill.insurance_amount));
        }
      } catch {
        if (bill.insurance_amount > 0) setCoveredAmount(String(bill.insurance_amount));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill.id]);

  // Auto-populate from approved pre-auth (only if no saved data yet)
  useEffect(() => {
    if (!bill.admission_id || !hospitalId || bill.insurance_amount > 0) return;
    (supabase as any)
      .from("insurance_pre_auth")
      .select("tpa_name, policy_number, pre_auth_number, approved_amount")
      .eq("admission_id", bill.admission_id)
      .eq("hospital_id", hospitalId)
      .eq("status", "approved")
      .order("approved_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }: { data: any }) => {
        if (!data) return;
        if (data.tpa_name) { setTpaName(data.tpa_name); setAutoLoaded(true); }
        if (data.policy_number) setPolicyNumber(data.policy_number);
        if (data.pre_auth_number) setPreAuthNumber(data.pre_auth_number);
        if (data.approved_amount) setCoveredAmount(String(data.approved_amount));
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bill.admission_id, hospitalId]);

  const fetchTpaConfig = async () => {
    if (!tpaName.trim() || !hospitalId) return;

    const [tpaRes, admRes] = await Promise.all([
      (supabase as any)
        .from("tpa_config")
        .select("tpa_name, room_rent_ceiling, co_payment_type, co_payment_value, deductible")
        .eq("hospital_id", hospitalId)
        .ilike("tpa_name", tpaName.trim())
        .maybeSingle(),
      bill.admission_id
        ? supabase.from("admissions").select("admitted_at, discharged_at").eq("id", bill.admission_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    if (tpaRes.data) {
      setTpaConfig({
        tpa_name: tpaRes.data.tpa_name,
        room_rent_ceiling: Number(tpaRes.data.room_rent_ceiling) || 0,
        co_payment_type: tpaRes.data.co_payment_type || "none",
        co_payment_value: Number(tpaRes.data.co_payment_value) || 0,
        deductible: Number(tpaRes.data.deductible) || 0,
      });
    } else {
      setTpaConfig(null);
    }

    if (admRes.data) {
      const start = new Date(admRes.data.admitted_at);
      const end = admRes.data.discharged_at ? new Date(admRes.data.discharged_at) : new Date();
      const days = Math.max(1, differenceInDays(end, start));
      setAdmissionDays(days);

      // Estimate daily room rate from bill line items tagged as room/ward charges
      if (bill.admission_id) {
        const { data: lines } = await supabase
          .from("bill_line_items")
          .select("description, total_amount, quantity")
          .eq("bill_id", bill.id);
        const roomLine = (lines || []).find(l =>
          /room|ward|bed/i.test(l.description || "")
        );
        if (roomLine) {
          const lineTotal = Number(roomLine.total_amount) || 0;
          const qty = Number(roomLine.quantity) || 1;
          setDailyRoomRate(roundCurrency(lineTotal / qty));
        }
      }
    }
  };

  // Co-pay calculations
  const covered = Number(coveredAmount) || 0;
  const roomCeiling = tpaConfig?.room_rent_ceiling ?? 0;
  const roomExcess = roomCeiling > 0
    ? roundCurrency(Math.max(0, dailyRoomRate - roomCeiling) * admissionDays)
    : 0;
  const coveredNet = roundCurrency(Math.max(0, covered - roomExcess - (tpaConfig?.deductible ?? 0)));
  const coPayAmt = tpaConfig?.co_payment_type === "percentage"
    ? roundCurrency((coveredNet * (tpaConfig.co_payment_value ?? 0)) / 100)
    : tpaConfig?.co_payment_type === "fixed"
    ? (tpaConfig.co_payment_value ?? 0)
    : 0;
  const patientShare = roundCurrency(roomExcess + (tpaConfig?.deductible ?? 0) + coPayAmt);
  const insurancePays = roundCurrency(Math.max(0, covered - patientShare));

  const showCopayCard = !!tpaConfig && (tpaConfig.room_rent_ceiling > 0 || tpaConfig.co_payment_type !== "none" || tpaConfig.deductible > 0);

  const handleSave = async () => {
    // insurance_amount = what TPA actually pays AFTER co-pay / deductible deductions
    // patientShare (room excess + deductible + co-pay) is already computed above.
    // Use insurancePays (net) so the patient's balance correctly reflects their share.
    const netInsurancePays = tpaConfig && showCopayCard ? insurancePays : (Number(coveredAmount) || 0);

    const notesObj: Record<string, any> = {
      tpa: tpaName,
      policy: policyNumber,
      pre_auth: preAuthNumber,
      coverage: coverageType,
      covered_amount: Number(coveredAmount) || 0,
    };
    if (tpaConfig && showCopayCard) {
      notesObj.copay_breakdown = {
        covered_gross:   Number(coveredAmount) || 0,
        room_excess:     roomExcess,
        deductible:      tpaConfig.deductible ?? 0,
        co_pay_amount:   coPayAmt,
        patient_share:   patientShare,
        insurance_pays:  netInsurancePays,
      };
    }
    if (coverageType === "reimbursement" && (bankName || accountNumber || ifsc || accountHolder)) {
      notesObj.reimbursement_bank = { bankName, accountNumber, ifsc, accountHolder };
    }

    const { error } = await supabase.from("bills").update({
      insurance_amount: netInsurancePays,
      notes:            JSON.stringify(notesObj),
    }).eq("id", bill.id);

    if (error) {
      toast({ title: "Failed to save insurance details", variant: "destructive" });
      return;
    }

    await recalculateBillTotalsSafe(bill.id);

    // Audit log — re-fetch the authoritative post-recalculation patient_payable
    // rather than hand-computing it, now that recalculateBillTotalsSafe (not this
    // component) is what actually derives it.
    const { data: updatedBill } = await supabase
      .from("bills")
      .select("patient_payable")
      .eq("id", bill.id)
      .maybeSingle();

    logInsuranceUpdate(bill.id, bill.hospital_id, {
      insurance_amount: bill.insurance_amount ?? 0,
      patient_payable:  bill.patient_payable ?? 0,
    }, {
      insurance_amount: netInsurancePays,
      patient_payable:  updatedBill?.patient_payable ?? 0,
    });

    // Keep the real claims pipeline in sync — a bill with genuine TPA info entered
    // here was previously invisible to ClaimsToSubmit, which sources eligible bills
    // purely from admissions.insurance_type != 'self_pay' plus "no existing claim
    // row for this bill". Additive only: nothing above is removed or changed.
    if (bill.admission_id && hospitalId && tpaName.trim() && netInsurancePays > 0) {
      const { data: admission } = await supabase
        .from("admissions")
        .select("insurance_type")
        .eq("id", bill.admission_id)
        .maybeSingle();
      if (admission && (!admission.insurance_type || admission.insurance_type === "self_pay")) {
        await supabase.from("admissions").update({ insurance_type: tpaName.trim() }).eq("id", bill.admission_id);
      }

      const { data: existingClaim } = await (supabase as any)
        .from("insurance_claims")
        .select("id")
        .eq("bill_id", bill.id)
        .maybeSingle();

      if (!existingClaim) {
        const { data: preAuth } = await (supabase as any)
          .from("insurance_pre_auth")
          .select("id")
          .eq("admission_id", bill.admission_id)
          .eq("hospital_id", hospitalId)
          .eq("status", "approved")
          .order("approved_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        await (supabase as any).from("insurance_claims").insert({
          hospital_id: hospitalId,
          bill_id: bill.id,
          patient_id: bill.patient_id,
          pre_auth_id: preAuth?.id ?? null,
          tpa_name: tpaName.trim(),
          claimed_amount: netInsurancePays,
          status: "draft",
        });
      }
    }

    toast({ title: "Insurance details saved" });
    onRefresh();
  };

  return (
    <div className="max-w-lg space-y-6">
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="text-sm font-bold">Insurance / TPA Details</h3>
          {autoLoaded && (
            <Badge variant="outline" className="text-[10px] text-emerald-700 border-emerald-300 bg-emerald-50 gap-1">
              <CheckCircle size={10} /> Loaded from Pre-Auth
            </Badge>
          )}
        </div>
        <div className="space-y-3">
          <div>
            <Label className="text-sm font-semibold">TPA / Insurer Name</Label>
            <Input
              value={tpaName}
              onChange={e => { setTpaName(e.target.value); setTpaConfig(null); }}
              onBlur={fetchTpaConfig}
              placeholder="e.g. Star Health, ICICI Lombard"
              className="h-9 text-sm mt-1"
            />
          </div>
          <div>
            <Label className="text-sm font-semibold">Policy Number</Label>
            <Input value={policyNumber} onChange={e => setPolicyNumber(e.target.value)} className="h-9 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Pre-Auth Number</Label>
            <Input value={preAuthNumber} onChange={e => setPreAuthNumber(e.target.value)} className="h-9 text-sm mt-1" />
          </div>
          <div>
            <Label className="text-sm font-semibold">Coverage Type</Label>
            <div className="flex gap-2 mt-1">
              {(["cashless", "reimbursement"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setCoverageType(t)}
                  className={cn(
                    "px-4 py-2 rounded-lg text-sm font-medium border transition-colors",
                    coverageType === t
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:bg-muted/50"
                  )}
                >
                  {t === "cashless" ? "Cashless" : "Reimbursement"}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label className="text-sm font-semibold">Covered Amount (₹)</Label>
            <Input type="number" value={coveredAmount} onChange={e => setCoveredAmount(e.target.value)} className="h-9 text-sm mt-1" />
          </div>

          {/* Co-payment Summary Card */}
          {showCopayCard && covered > 0 && (
            <div className="border border-border rounded-lg overflow-hidden">
              <div className="bg-muted/50 px-3 py-2 border-b border-border">
                <p className="text-sm font-semibold">Coverage Rules — {tpaConfig!.tpa_name}</p>
              </div>
              <div className="p-3 space-y-1 text-sm">
                {tpaConfig!.room_rent_ceiling > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Room Rent Ceiling</span>
                    <span>{formatINR(tpaConfig!.room_rent_ceiling)}/day</span>
                  </div>
                )}
                {tpaConfig!.co_payment_type !== "none" && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Co-payment</span>
                    <span>
                      {tpaConfig!.co_payment_type === "percentage"
                        ? `${tpaConfig!.co_payment_value}% of bill`
                        : formatINR(tpaConfig!.co_payment_value)}
                    </span>
                  </div>
                )}
                {tpaConfig!.deductible > 0 && (
                  <div className="flex justify-between text-muted-foreground">
                    <span>Annual Deductible</span>
                    <span>{formatINR(tpaConfig!.deductible)}</span>
                  </div>
                )}

                <div className="border-t border-border mt-2 pt-2 space-y-1">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Estimated Patient Liability</p>
                  {roomExcess > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Room Rent Excess
                        {admissionDays > 0 && dailyRoomRate > 0 && (
                          <span className="text-[11px] ml-1">({admissionDays}d × {formatINR(dailyRoomRate - tpaConfig!.room_rent_ceiling)})</span>
                        )}
                      </span>
                      <span>{formatINR(roomExcess)}</span>
                    </div>
                  )}
                  {tpaConfig!.deductible > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Deductible Applied</span>
                      <span>{formatINR(tpaConfig!.deductible)}</span>
                    </div>
                  )}
                  {coPayAmt > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Co-payment
                        {tpaConfig!.co_payment_type === "percentage" && ` (${tpaConfig!.co_payment_value}%)`}
                      </span>
                      <span>{formatINR(coPayAmt)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Insurance Covered</span>
                    <span className="text-emerald-700 font-medium">{formatINR(insurancePays)}</span>
                  </div>
                  <div className="flex justify-between text-sm font-semibold border-t border-border pt-1 mt-1">
                    <span>Patient's Share</span>
                    <span className={patientShare > 0 ? "text-amber-700" : "text-emerald-700"}>{formatINR(patientShare)}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Reimbursement Bank Details */}
          {coverageType === "reimbursement" && (
            <div className="border border-border rounded-lg p-3 space-y-3 bg-muted/20">
              <p className="text-sm font-semibold">Reimbursement Bank Details</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-sm font-semibold">Bank Name</Label>
                  <Input className="mt-1 h-8 text-sm" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="e.g. SBI, HDFC" />
                </div>
                <div>
                  <Label className="text-sm font-semibold">Account Number</Label>
                  <Input className="mt-1 h-8 text-sm" value={accountNumber} onChange={e => setAccountNumber(e.target.value)} />
                </div>
                <div>
                  <Label className="text-sm font-semibold">IFSC Code</Label>
                  <Input
                    className="mt-1 h-8 text-sm uppercase"
                    value={ifsc}
                    onChange={e => setIfsc(e.target.value.toUpperCase())}
                    placeholder="e.g. SBIN0001234"
                  />
                </div>
                <div>
                  <Label className="text-sm font-semibold">Account Holder</Label>
                  <Input className="mt-1 h-8 text-sm" value={accountHolder} onChange={e => setAccountHolder(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          <Button onClick={handleSave} className="w-full h-10">Save Insurance Details</Button>
        </div>
      </div>
    </div>
  );
};

export default InsuranceTab;
