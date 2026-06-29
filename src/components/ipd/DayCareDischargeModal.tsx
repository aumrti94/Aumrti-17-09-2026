import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import { LogOut, CheckCircle2 } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  admissionId: string;
  patientName: string;
  procedureName: string;
  onDischarged: () => void;
}

const DayCareDischargeModal: React.FC<Props> = ({
  open,
  onClose,
  admissionId,
  patientName,
  procedureName,
  onDischarged,
}) => {
  const [procedureDone, setProcedureDone] = useState(false);
  const [billingCleared, setBillingCleared] = useState(false);
  const [patientStable, setPatientStable] = useState(false);
  const [consentSigned, setConsentSigned] = useState(false);
  const [dischargeNotes, setDischargeNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const allChecked = procedureDone && billingCleared && patientStable && consentSigned;

  const handleDischarge = async () => {
    if (!allChecked) {
      toast({ title: "Complete all checklist items", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    const now = new Date().toISOString();

    const { error } = await supabase
      .from("admissions")
      .update({
        status: "discharged",
        discharged_at: now,
        discharge_notes: dischargeNotes || null,
        discharge_type: "day_care",
      } as any)
      .eq("id", admissionId);

    if (error) {
      toast({ title: "Discharge failed", description: error.message, variant: "destructive" });
      setSubmitting(false);
      return;
    }

    toast({ title: "Patient discharged", description: `${patientName} — day care complete` });
    onDischarged();
    onClose();
    setSubmitting(false);
  };

  const checks = [
    { id: "proc", label: "Procedure completed successfully", checked: procedureDone, onChange: setProcedureDone },
    { id: "billing", label: "Bill finalised and payment cleared", checked: billingCleared, onChange: setBillingCleared },
    { id: "stable", label: "Patient stable, vitals checked, fit for discharge", checked: patientStable, onChange: setPatientStable },
    { id: "consent", label: "Discharge instructions given, consent signed", checked: consentSigned, onChange: setConsentSigned },
  ];

  return (
    <Dialog open={open} onOpenChange={v => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LogOut size={18} className="text-teal-600" />
            Day Care Discharge
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{patientName}</span>
            {" — "}
            {procedureName}
          </div>

          <div className="space-y-3">
            {checks.map(c => (
              <div key={c.id} className="flex items-center gap-3">
                <Checkbox
                  id={c.id}
                  checked={c.checked}
                  onCheckedChange={v => c.onChange(!!v)}
                />
                <label htmlFor={c.id} className="text-sm cursor-pointer">{c.label}</label>
              </div>
            ))}
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium">Discharge Notes</label>
            <Textarea
              rows={3}
              value={dischargeNotes}
              onChange={e => setDischargeNotes(e.target.value)}
              placeholder="Post-procedure instructions, follow-up date, medications…"
            />
          </div>

          {allChecked && (
            <div className="flex items-center gap-2 text-xs text-teal-700 bg-teal-50 border border-teal-200 rounded p-2">
              <CheckCircle2 size={13} />
              All checks complete — ready to discharge.
            </div>
          )}

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              className="bg-teal-600 hover:bg-teal-700"
              onClick={handleDischarge}
              disabled={!allChecked || submitting}
            >
              {submitting ? "Discharging…" : "Confirm Discharge"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default DayCareDischargeModal;
