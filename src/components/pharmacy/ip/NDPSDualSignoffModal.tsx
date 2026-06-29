import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ShieldAlert, Lock, CheckCircle2, XCircle } from "lucide-react";

interface NDPSRow {
  drug_id: string;
  drug_name: string;
  quantity: number;
}

interface NDPSDualSignoffModalProps {
  open: boolean;
  onClose: () => void;
  onApproved: (countersignerId: string, prescriberLicence: string) => void;
  ndpsRows: NDPSRow[];
  patientName: string;
  prescriberName: string;
  dispensingId: string;
  hospitalId: string;
  prescriptionNumber?: string;
}

type Step = "step_a" | "step_b_waiting" | "step_b_countersign";

interface SeniorPharmacist {
  id: string;
  full_name: string;
  email: string;
}

const NDPSDualSignoffModal: React.FC<NDPSDualSignoffModalProps> = ({
  open,
  onClose,
  onApproved,
  ndpsRows,
  patientName,
  prescriberName,
  dispensingId,
  hospitalId,
  prescriptionNumber,
}) => {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>("step_a");

  // Step A state
  const [primaryEmail, setPrimaryEmail] = useState("");
  const [primaryUserId, setPrimaryUserId] = useState("");
  const [password, setPassword] = useState("");
  const [prescriberRegNo, setPrescriberRegNo] = useState("");
  const [prescriberLicence, setPrescriberLicence] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [stagedIds, setStagedIds] = useState<string[]>([]);

  // Step B state
  const [seniorPharmacists, setSeniorPharmacists] = useState<SeniorPharmacist[]>([]);
  const [selectedCountersigner, setSelectedCountersigner] = useState("");
  const [counterPassword, setCounterPassword] = useState("");
  const [countersigning, setCountersigning] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [showRejectForm, setShowRejectForm] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("step_a");
    setPassword("");
    setPrescriberRegNo("");
    setPrescriberLicence("");
    setCounterPassword("");
    setRejectionReason("");
    setShowRejectForm(false);
    setStagedIds([]);
    setSelectedCountersigner("");

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setPrimaryEmail(user.email || "");
      supabase.from("users").select("id").eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }) => { if (data?.id) setPrimaryUserId(data.id); });
    });
  }, [open]);

  const loadSeniorPharmacists = async () => {
    const { data } = await (supabase as any)
      .from("users")
      .select("id, full_name, email")
      .eq("hospital_id", hospitalId)
      .in("role", ["senior_pharmacist", "chief_pharmacist", "hospital_admin"])
      .eq("is_active", true);
    setSeniorPharmacists(data || []);
  };

  const verifyAndStage = async () => {
    if (!prescriberRegNo.trim()) {
      toast({ title: "Prescriber registration number is required", variant: "destructive" });
      return;
    }
    if (!password) {
      toast({ title: "Your password is required to proceed", variant: "destructive" });
      return;
    }
    setVerifying(true);
    try {
      // Re-authenticate primary pharmacist (verifies identity without swapping session)
      const { error: authErr } = await supabase.auth.signInWithPassword({
        email: primaryEmail,
        password,
      });
      if (authErr) {
        toast({ title: "Incorrect password", description: authErr.message, variant: "destructive" });
        setVerifying(false);
        return;
      }

      // Create staging rows (one per NDPS drug)
      const inserts = ndpsRows.map(row => ({
        hospital_id:           hospitalId,
        dispensing_id:         dispensingId,
        drug_id:               row.drug_id,
        drug_name:             row.drug_name,
        quantity:              row.quantity,
        patient_name:          patientName,
        prescriber_name:       prescriberName,
        prescriber_reg_no:     prescriberRegNo.trim(),
        prescriber_licence:    prescriberLicence.trim() || null,
        prescription_number:   prescriptionNumber || null,
        primary_pharmacist_id: primaryUserId,
        status:                "pending",
      }));

      const { data: staged, error: stageErr } = await (supabase as any)
        .from("ndps_pending_dispenses")
        .insert(inserts)
        .select("id");

      if (stageErr) throw stageErr;
      setStagedIds((staged || []).map((r: any) => r.id));

      // In-app alert to senior pharmacists
      await (supabase as any).from("clinical_alerts").insert({
        hospital_id:    hospitalId,
        alert_type:     "ndps_countersign_required",
        alert_message:  `NDPS dual sign-off required: ${ndpsRows.length} narcotic drug(s) for ${patientName} — prescriber: ${prescriberName}. Open Dispensing Workspace to counter-sign.`,
        severity:       "critical",
        is_acknowledged: false,
      });

      await loadSeniorPharmacists();
      setStep("step_b_waiting");
    } catch (err: any) {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    } finally {
      setVerifying(false);
    }
  };

  const countersignAndApprove = async () => {
    if (!selectedCountersigner) {
      toast({ title: "Select a counter-signer", variant: "destructive" });
      return;
    }
    if (!counterPassword) {
      toast({ title: "Counter-signer password is required", variant: "destructive" });
      return;
    }
    setCountersigning(true);
    try {
      const signer = seniorPharmacists.find(p => p.id === selectedCountersigner);
      if (!signer?.email) throw new Error("Counter-signer email not found");

      // Save current session to restore after verification
      const { data: { session: currentSession } } = await supabase.auth.getSession();

      const { error: counterAuthErr } = await supabase.auth.signInWithPassword({
        email: signer.email,
        password: counterPassword,
      });

      // Restore primary pharmacist session regardless of outcome
      if (currentSession) {
        await supabase.auth.setSession({
          access_token: currentSession.access_token,
          refresh_token: currentSession.refresh_token,
        });
      }

      if (counterAuthErr) {
        toast({ title: "Counter-signer password incorrect", description: counterAuthErr.message, variant: "destructive" });
        setCountersigning(false);
        return;
      }

      // Mark all staged rows as approved
      await (supabase as any)
        .from("ndps_pending_dispenses")
        .update({
          status:          "approved",
          countersigner_id: selectedCountersigner,
          resolved_at:     new Date().toISOString(),
        })
        .in("id", stagedIds);

      toast({ title: "Counter-sign approved — dispensing NDPS drugs" });
      onApproved(selectedCountersigner, prescriberLicence.trim());
    } catch (err: any) {
      toast({ title: "Counter-sign failed", description: err.message, variant: "destructive" });
    } finally {
      setCountersigning(false);
    }
  };

  const rejectDispense = async () => {
    if (!rejectionReason.trim()) {
      toast({ title: "Rejection reason is required", variant: "destructive" });
      return;
    }
    setRejecting(true);
    try {
      await (supabase as any)
        .from("ndps_pending_dispenses")
        .update({
          status:           "rejected",
          rejection_reason: rejectionReason.trim(),
          resolved_at:      new Date().toISOString(),
          countersigner_id: selectedCountersigner || null,
        })
        .in("id", stagedIds);

      // Alert to the prescribing doctor's department
      await (supabase as any).from("clinical_alerts").insert({
        hospital_id:    hospitalId,
        alert_type:     "ndps_dispense_rejected",
        alert_message:  `NDPS dispense REJECTED for ${patientName} — prescriber: ${prescriberName}. Reason: ${rejectionReason.trim()}. Drugs: ${ndpsRows.map(r => r.drug_name).join(", ")}.`,
        severity:       "high",
        is_acknowledged: false,
      });

      toast({ title: "NDPS dispense rejected", description: "Doctor has been alerted via clinical notifications" });
      onClose();
    } catch (err: any) {
      toast({ title: "Rejection failed", description: err.message, variant: "destructive" });
    } finally {
      setRejecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <ShieldAlert size={18} className="text-destructive" />
            NDPS Act — Mandatory Dual Sign-Off
          </DialogTitle>
        </DialogHeader>

        {/* Drug Summary */}
        <div className="bg-destructive/5 border border-destructive/20 rounded-lg p-3 space-y-1">
          <p className="text-[11px] font-bold text-destructive uppercase tracking-wide">Narcotic / Schedule X Drugs</p>
          {ndpsRows.map((r, i) => (
            <div key={i} className="flex justify-between text-[12px]">
              <span className="font-medium">{r.drug_name}</span>
              <span className="text-muted-foreground">Qty: {r.quantity}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground pt-1">Patient: <span className="font-medium text-foreground">{patientName}</span></p>
        </div>

        {/* ─── STEP A: Primary Pharmacist Verification ─── */}
        {step === "step_a" && (
          <div className="space-y-3">
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
              <p className="text-[12px] font-bold text-amber-800">Step 1 of 2 — Primary Pharmacist Verification</p>
              <p className="text-[11px] text-amber-700 mt-0.5">Re-enter your password to confirm prescriber details and stage this dispense for counter-sign.</p>
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-semibold text-foreground">Prescriber: {prescriberName}</label>
              <Input
                placeholder="Prescriber Registration No. (required)"
                value={prescriberRegNo}
                onChange={e => setPrescriberRegNo(e.target.value)}
                className="h-9 text-sm"
              />
              <Input
                placeholder="Prescriber NDPS Licence No. (optional)"
                value={prescriberLicence}
                onChange={e => setPrescriberLicence(e.target.value)}
                className="h-9 text-sm"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-foreground">Your Password ({primaryEmail})</label>
              <Input
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") verifyAndStage(); }}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" size="sm" onClick={onClose} className="text-xs">Cancel</Button>
              <Button
                size="sm"
                className="text-xs bg-amber-600 hover:bg-amber-700"
                onClick={verifyAndStage}
                disabled={verifying || !password || !prescriberRegNo}
              >
                {verifying ? "Verifying…" : "Verify & Alert Counter-Signer"}
              </Button>
            </div>
          </div>
        )}

        {/* ─── STEP B WAITING: Counter-signer notified ─── */}
        {step === "step_b_waiting" && (
          <div className="space-y-3">
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
              <CheckCircle2 size={15} className="text-blue-600 mt-0.5 shrink-0" />
              <div>
                <p className="text-[12px] font-bold text-blue-800">Step 2 of 2 — Counter-Signer Approval</p>
                <p className="text-[11px] text-blue-700 mt-0.5">Senior pharmacist notified via in-app alert. Select the counter-signer below and proceed immediately, or ask them to approve from their dashboard.</p>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-foreground">Select Counter-Signer</label>
              <Select value={selectedCountersigner} onValueChange={setSelectedCountersigner}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Choose senior pharmacist / chief pharmacist…" />
                </SelectTrigger>
                <SelectContent>
                  {seniorPharmacists.map(p => (
                    <SelectItem key={p.id} value={p.id} className="text-sm">{p.full_name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="text-xs text-destructive" onClick={() => setShowRejectForm(true)}>
                <XCircle size={13} className="mr-1" /> Reject
              </Button>
              <Button
                size="sm"
                className="text-xs"
                disabled={!selectedCountersigner}
                onClick={() => setStep("step_b_countersign")}
              >
                <Lock size={13} className="mr-1" /> Counter-Sign Now
              </Button>
            </div>
          </div>
        )}

        {/* ─── STEP B COUNTERSIGN: Counter-signer password ─── */}
        {step === "step_b_countersign" && (
          <div className="space-y-3">
            <div className="bg-violet-50 border border-violet-200 rounded-lg p-3">
              <p className="text-[12px] font-bold text-violet-800">Senior Pharmacist Counter-Sign</p>
              <p className="text-[11px] text-violet-700 mt-0.5">
                Counter-signing as: <span className="font-semibold">{seniorPharmacists.find(p => p.id === selectedCountersigner)?.full_name}</span>
              </p>
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-foreground">Counter-Signer Password</label>
              <Input
                type="password"
                placeholder="Enter counter-signer's password"
                value={counterPassword}
                onChange={e => setCounterPassword(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") countersignAndApprove(); }}
                className="h-9 text-sm"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setStep("step_b_waiting")}>Back</Button>
              <Button
                size="sm"
                className="text-xs text-destructive-foreground bg-destructive hover:bg-destructive/90"
                variant="outline"
                onClick={() => setShowRejectForm(true)}
              >
                <XCircle size={13} className="mr-1" /> Reject
              </Button>
              <Button
                size="sm"
                className="text-xs bg-violet-600 hover:bg-violet-700"
                onClick={countersignAndApprove}
                disabled={countersigning || !counterPassword}
              >
                {countersigning ? "Approving…" : "Approve & Counter-Sign"}
              </Button>
            </div>
          </div>
        )}

        {/* ─── Rejection form (overlay on step B) ─── */}
        {showRejectForm && (
          <div className="border border-destructive/30 rounded-lg p-3 space-y-2 bg-destructive/5">
            <p className="text-[12px] font-bold text-destructive">Reject NDPS Dispense</p>
            <Textarea
              placeholder="Enter rejection reason (required)"
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              className="text-sm min-h-[72px]"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" size="sm" className="text-xs" onClick={() => setShowRejectForm(false)}>Cancel</Button>
              <Button
                size="sm"
                variant="destructive"
                className="text-xs"
                disabled={rejecting || !rejectionReason.trim()}
                onClick={rejectDispense}
              >
                {rejecting ? "Rejecting…" : "Confirm Rejection"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NDPSDualSignoffModal;
