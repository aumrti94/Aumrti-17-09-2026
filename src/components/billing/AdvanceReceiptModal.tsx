import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { syncAdvanceToBill } from "@/lib/advanceBillSync";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatINRExact } from "@/lib/currency";
import { printDocument, printHeader } from "@/lib/printUtils";
import { CheckCircle2, Printer, IndianRupee } from "lucide-react";

interface Props {
  hospitalId: string;
  onClose: () => void;
  /**
   * Fired when the user is DONE with the receipt, not the moment the money is recorded.
   * Every caller unmounts this modal from onCreated, so firing it at insert time would
   * destroy the modal before the receipt could be shown or printed.
   */
  onCreated: () => void;
  prefilledPatient?: { id: string; full_name: string; uhid: string } | null;
  prefilledAmount?: number;
  admissionId?: string | null;
}

const PAYMENT_MODES = [
  { value: "cash", label: "💵 Cash" },
  { value: "upi", label: "📱 UPI" },
  { value: "card", label: "💳 Card" },
  { value: "cheque", label: "🧾 Cheque" },
];

interface ReceiptData {
  receiptNumber: string;
  date: string;
  patientName: string;
  uhid: string;
  amount: number;
  paymentMode: string;
  reference: string | null;
  admissionNumber: string | null;
  procedureName: string | null;
  notes: string | null;
}

const AdvanceReceiptModal: React.FC<Props> = ({ hospitalId, onClose, onCreated, prefilledPatient, prefilledAmount, admissionId }) => {
  const { toast } = useToast();
  const [step, setStep] = useState<"collect" | "receipt">("collect");
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(prefilledPatient || null);
  const [amount, setAmount] = useState(prefilledAmount ? String(prefilledAmount) : "");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [paymentRef, setPaymentRef] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [hospitalInfo, setHospitalInfo] = useState<{ name: string; address: string | null } | null>(null);
  const [context, setContext] = useState<{ admissionNumber: string | null; procedureName: string | null }>({
    admissionNumber: null, procedureName: null,
  });

  useEffect(() => {
    if (prefilledPatient) setSelectedPatient(prefilledPatient);
    if (prefilledAmount) setAmount(String(prefilledAmount));
  }, [prefilledPatient, prefilledAmount]);

  useEffect(() => {
    (supabase as any).from("hospitals").select("name, address").eq("id", hospitalId).maybeSingle()
      .then(({ data }: any) => setHospitalInfo(data || null));
  }, [hospitalId]);

  // Context for the receipt: which stay/procedure this deposit is against.
  useEffect(() => {
    if (!admissionId) { setContext({ admissionNumber: null, procedureName: null }); return; }
    (supabase as any)
      .from("admissions")
      .select("admission_number, admitting_diagnosis, procedure:day_care_procedures(procedure_name)")
      .eq("id", admissionId)
      .maybeSingle()
      .then(({ data }: any) => setContext({
        admissionNumber: data?.admission_number ?? null,
        procedureName: data?.procedure?.procedure_name ?? data?.admitting_diagnosis ?? null,
      }));
  }, [admissionId]);

  const searchPatients = async (q: string) => {
    setPatientSearch(q);
    if (q.length < 2) { setPatients([]); return; }
    const { data } = await supabase
      .from("patients")
      .select("id, full_name, uhid, phone")
      .eq("hospital_id", hospitalId)
      .or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%,phone.ilike.%${q}%`)
      .limit(8);
    setPatients(data || []);
  };

  const handleSubmit = async () => {
    if (!selectedPatient || !amount) return;
    setSubmitting(true);

    const { data: { user } } = await supabase.auth.getUser();
    const { data: userData } = await supabase
      .from("users")
      .select("id")
      .eq("auth_user_id", user?.id || "")
      .maybeSingle();

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const { count } = await supabase
      .from("advance_receipts")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hospitalId);
    const seq = String((count ?? 0) + 1).padStart(4, "0");
    const receiptNumber = `ADV-${dateStr}-${seq}`;

    const { error } = await (supabase as any).from("advance_receipts").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.id,
      // Attribute the receipt to the stay it was collected for. Without this the
      // receipt is unattributable and leaks into every other admission's ledger.
      // Null = a patient-level advance taken outside any admission.
      admission_id: admissionId || null,
      receipt_number: receiptNumber,
      amount: Number(amount),
      payment_mode: paymentMode,
      received_by: userData?.id || null,
      notes: notes || null,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    // Mirror deposit into ipd_advances (Advance tab) + sync to bill_payments (billing/analytics)
    if (admissionId) {
      await (supabase as any).from("ipd_advances").insert({
        hospital_id:      hospitalId,
        admission_id:     admissionId,
        patient_id:       selectedPatient.id,
        amount:           Number(amount),
        transaction_type: "deposit",
        payment_mode:     paymentMode,
        reference_no:     receiptNumber,
        description:      notes || "Advance deposit",
        collected_by:     userData?.id || null,
      });
      // Sync to bill_payments so billing, analytics and dashboard reflect the receipt.
      // Returns null when no bill exists yet (e.g. a deposit taken before admission) —
      // the admit flow back-fills it once the bill is created.
      await syncAdvanceToBill({
        admissionId,
        hospitalId,
        amount:      Number(amount),
        paymentMode,
        userId:      userData?.id ?? null,
        referenceNo: receiptNumber,
        notes:       notes || "Advance deposit",
      });
    }

    setReceipt({
      receiptNumber,
      date: new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }),
      patientName: selectedPatient.full_name,
      uhid: selectedPatient.uhid || "",
      amount: Number(amount),
      paymentMode,
      reference: paymentMode !== "cash" && paymentRef.trim() ? paymentRef.trim() : null,
      admissionNumber: context.admissionNumber,
      procedureName: context.procedureName,
      notes: notes || null,
    });
    setStep("receipt");
    setSubmitting(false);
  };

  const handlePrintReceipt = () => {
    if (!receipt) return;
    const hospitalName = hospitalInfo?.name || "Hospital Receipt";
    const hospitalAddress = hospitalInfo?.address || "";

    const body = `
      ${printHeader(hospitalName, hospitalAddress)}
      <div style="text-align:center; border-bottom:1px dashed #cbd5e1; padding-bottom:10px; margin-bottom:10px;">
        <strong style="font-size:16px;">ADVANCE / DEPOSIT RECEIPT</strong><br/>
        <small>${receipt.date}</small>
      </div>

      <div class="row"><span class="label">Receipt No.</span><span class="amount">${receipt.receiptNumber}</span></div>
      <div class="row"><span class="label">Patient</span><span class="value">${receipt.patientName}</span></div>
      <div class="row"><span class="label">UHID</span><span class="amount">${receipt.uhid}</span></div>
      ${receipt.admissionNumber ? `<div class="row"><span class="label">Admission No.</span><span class="amount">${receipt.admissionNumber}</span></div>` : ""}
      ${receipt.procedureName ? `<div class="row"><span class="label">Procedure</span><span class="value">${receipt.procedureName}</span></div>` : ""}

      <div style="border-top:1px dashed #cbd5e1; padding-top:10px; margin-top:10px;">
        <div class="row">
          <span class="label">Amount Received</span>
          <span class="amount" style="font-size:18px;">₹${receipt.amount.toLocaleString("en-IN")}</span>
        </div>
        <div class="row">
          <span class="label">Payment</span>
          <span class="paid">Paid (${receipt.paymentMode})</span>
        </div>
        ${receipt.reference ? `<div class="row"><span class="label">Reference</span><span class="amount">${receipt.reference}</span></div>` : ""}
        ${receipt.notes ? `<div class="row"><span class="label">Notes</span><span class="value">${receipt.notes}</span></div>` : ""}
      </div>

      <style>
        .row { display: flex; justify-content: space-between; margin-bottom: 6px; }
        .label { color: #64748b; font-size: 12px; }
        .value { font-weight: 600; color: #1e293b; text-align: right; }
        .paid { color: #059669; font-weight: 600; }
        .amount { font-family: 'JetBrains Mono', monospace; font-weight: 600; }
      </style>

      <div style="text-align:center; font-size:11px; color:#94a3b8; margin-top:20px; border-top:1px dashed #cbd5e1; padding-top:10px;">
        This is an advance against the final bill. Adjusted at discharge.
      </div>
    `;

    printDocument("Advance Receipt", body, { width: 450, height: 650 });
  };

  /**
   * Done — the money is already recorded; this just dismisses the receipt.
   * Calls onCreated() ONLY: every caller's onCreated already closes this modal, so also
   * calling onClose() here would double-fire their close/refresh handlers.
   */
  const finish = () => { onCreated(); };

  return (
    <Dialog open onOpenChange={(v) => { if (!v) { if (step === "receipt") finish(); else onClose(); } }}>
      <DialogContent className="max-w-md">
        {step === "collect" ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <IndianRupee size={17} className="text-[#0E7B7B]" />
                Collect Advance
              </DialogTitle>
            </DialogHeader>
            <p className="text-[13px] text-muted-foreground -mt-2">Pay before the procedure</p>

            <div className="space-y-4">
              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Patient *</label>
                {selectedPatient ? (
                  <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-lg mt-1">
                    <span className="text-sm font-bold">{selectedPatient.full_name}</span>
                    <span className="text-[10px] text-muted-foreground">{selectedPatient.uhid}</span>
                    {!prefilledPatient && (
                      <button onClick={() => setSelectedPatient(null)} className="ml-auto text-xs text-muted-foreground">Change</button>
                    )}
                  </div>
                ) : (
                  <>
                    <Input placeholder="Search patient..." value={patientSearch}
                      onChange={(e) => searchPatients(e.target.value)} className="h-9 text-sm mt-1" autoFocus />
                    {patients.length > 0 && (
                      <div className="border border-border rounded-lg bg-card shadow-lg mt-1 max-h-40 overflow-y-auto">
                        {patients.map((p) => (
                          <button key={p.id} onClick={() => { setSelectedPatient(p); setPatients([]); }}
                            className="w-full text-left px-3 py-2 hover:bg-muted/50 text-sm border-b border-border last:border-0">
                            {p.full_name} · <span className="text-muted-foreground">{p.uhid}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              {(context.procedureName || context.admissionNumber) && (
                <div className="p-3 bg-muted/40 rounded-lg border space-y-1">
                  {context.procedureName && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Procedure</span>
                      <span className="font-medium">{context.procedureName}</span>
                    </div>
                  )}
                  {context.admissionNumber && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Admission</span>
                      <span className="font-mono text-xs">{context.admissionNumber}</span>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Amount (₹) *</label>
                <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
                  className="h-12 text-lg font-bold mt-1" autoFocus={!!prefilledPatient} />
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Payment Mode</label>
                <div className="flex gap-2 mt-1.5">
                  {PAYMENT_MODES.map((m) => (
                    <button
                      key={m.value}
                      onClick={() => setPaymentMode(m.value)}
                      className={cn(
                        "flex-1 h-11 rounded-lg text-xs font-medium transition-colors",
                        paymentMode === m.value
                          ? "bg-[#0E7B7B] text-white shadow-md"
                          : "bg-muted text-muted-foreground hover:bg-muted/70"
                      )}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {paymentMode !== "cash" && (
                <div>
                  <label className="text-[11px] font-bold uppercase text-muted-foreground">Reference / Txn ID</label>
                  <Input value={paymentRef} onChange={(e) => setPaymentRef(e.target.value)}
                    className="h-9 text-sm mt-1" placeholder="Transaction reference..." />
                </div>
              )}

              <div>
                <label className="text-[11px] font-bold uppercase text-muted-foreground">Notes</label>
                <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 text-sm mt-1" placeholder="Optional" />
              </div>

              <Button
                onClick={handleSubmit}
                disabled={submitting || !selectedPatient || !amount}
                className="w-full h-12 bg-[#0E7B7B] hover:bg-[#0a6565] font-bold"
              >
                {submitting ? "Processing…" : `Collect ${formatINRExact(Number(amount) || 0)} →`}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-emerald-700">
                <CheckCircle2 size={18} />
                Advance Collected
              </DialogTitle>
            </DialogHeader>

            <div className="border border-border rounded-lg p-5 bg-card">
              <div className="text-center border-b border-dashed border-border pb-3 mb-3">
                <p className="text-sm font-bold">ADVANCE / DEPOSIT RECEIPT</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{receipt?.date}</p>
              </div>

              <div className="space-y-1.5 text-sm">
                <Line label="Receipt No." value={receipt?.receiptNumber} mono />
                <Line label="Patient" value={receipt?.patientName} />
                <Line label="UHID" value={receipt?.uhid} mono />
                {receipt?.admissionNumber && <Line label="Admission No." value={receipt.admissionNumber} mono />}
                {receipt?.procedureName && <Line label="Procedure" value={receipt.procedureName} />}
              </div>

              <div className="border-t border-dashed border-border mt-3 pt-3 space-y-1.5">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Amount Received</span>
                  <span className="text-lg font-bold">{formatINRExact(receipt?.amount || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Payment</span>
                  <span className="font-medium text-emerald-600">Paid ({receipt?.paymentMode})</span>
                </div>
                {receipt?.reference && <Line label="Reference" value={receipt.reference} mono />}
              </div>

              <div className="border-t border-dashed border-border mt-3 pt-2 text-center">
                <p className="text-[10px] text-muted-foreground">
                  This is an advance against the final bill. Adjusted at discharge.
                </p>
              </div>
            </div>

            <div className="flex gap-3 mt-1">
              <Button onClick={handlePrintReceipt} className="flex-1 h-11 bg-[#1A2F5A] hover:bg-[#152647] gap-2">
                <Printer size={15} /> Print Receipt
              </Button>
              <Button onClick={finish} variant="secondary" className="flex-1 h-11">
                Done
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const Line: React.FC<{ label: string; value?: string | null; mono?: boolean }> = ({ label, value, mono }) => (
  <div className="flex justify-between">
    <span className="text-muted-foreground">{label}</span>
    <span className={cn("font-medium", mono && "font-mono text-xs")}>{value || "—"}</span>
  </div>
);

export default AdvanceReceiptModal;
