import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { syncAdvanceToBill } from "@/lib/advanceBillSync";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Props {
  hospitalId: string;
  onClose: () => void;
  onCreated: () => void;
  prefilledPatient?: { id: string; full_name: string; uhid: string } | null;
  prefilledAmount?: number;
  admissionId?: string | null;
}

const AdvanceReceiptModal: React.FC<Props> = ({ hospitalId, onClose, onCreated, prefilledPatient, prefilledAmount, admissionId }) => {
  const { toast } = useToast();
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<any[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<any>(prefilledPatient || null);
  const [amount, setAmount] = useState(prefilledAmount ? String(prefilledAmount) : "");
  const [paymentMode, setPaymentMode] = useState("cash");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (prefilledPatient) setSelectedPatient(prefilledPatient);
    if (prefilledAmount) setAmount(String(prefilledAmount));
  }, [prefilledPatient, prefilledAmount]);

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

    const { error } = await supabase.from("advance_receipts").insert({
      hospital_id: hospitalId,
      patient_id: selectedPatient.id,
      receipt_number: `ADV-${dateStr}-${seq}`,
      amount: Number(amount),
      payment_mode: paymentMode,
      received_by: userData?.id || null,
      notes: notes || null,
    });

    if (error) {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    } else {
      // Mirror deposit into ipd_advances (Advance tab) + sync to bill_payments (billing/analytics)
      if (admissionId) {
        await (supabase as any).from("ipd_advances").insert({
          hospital_id:      hospitalId,
          admission_id:     admissionId,
          patient_id:       selectedPatient.id,
          amount:           Number(amount),
          transaction_type: "deposit",
          payment_mode:     paymentMode,
          reference_no:     `ADV-${dateStr}-${seq}`,
          description:      notes || "Advance deposit",
          collected_by:     userData?.id || null,
        });
        // Sync to bill_payments so billing, analytics and dashboard reflect the receipt
        await syncAdvanceToBill({
          admissionId,
          hospitalId,
          amount:      Number(amount),
          paymentMode,
          userId:      userData?.id ?? null,
          referenceNo: `ADV-${dateStr}-${seq}`,
          notes:       notes || "Advance deposit",
        });
      }
      toast({ title: `Advance of ₹${Number(amount).toLocaleString("en-IN")} received from ${selectedPatient.full_name}` });
      onCreated();
    }
    setSubmitting(false);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Collect Advance</DialogTitle>
        </DialogHeader>
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
          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Amount (₹) *</label>
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9 text-sm mt-1" autoFocus={!!prefilledPatient} />
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Payment Mode</label>
            <Select value={paymentMode} onValueChange={setPaymentMode}>
              <SelectTrigger className="h-9 text-sm mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="upi">UPI</SelectItem>
                <SelectItem value="card">Card</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-bold uppercase text-muted-foreground">Notes</label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} className="h-9 text-sm mt-1" placeholder="Optional" />
          </div>
          <Button onClick={handleSubmit} disabled={submitting || !selectedPatient || !amount} className="w-full h-10">
            {submitting ? "Processing..." : "Collect Advance"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AdvanceReceiptModal;
