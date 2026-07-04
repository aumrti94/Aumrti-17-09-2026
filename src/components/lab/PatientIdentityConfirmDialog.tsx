import React, { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ShieldCheck } from "lucide-react";

// Bedside two-identifier verification before sample collection (lab plan Phase 11).
// Real phlebotomy mandates confirming the patient's identity with two identifiers and
// labelling at the bedside — wrong-patient samples are a sentinel event. This dialog
// makes that step explicit and mandatory: the collector must actively confirm the
// displayed identifiers match the patient in front of them before collection proceeds.

interface Props {
  patientName: string;
  uhid?: string | null;
  dob?: string | null;
  gender?: string | null;
  onConfirm: () => void;
  onClose: () => void;
}

function ageFromDob(dob?: string | null): string {
  if (!dob) return "";
  return `${Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 60 * 60 * 1000))}y`;
}

const PatientIdentityConfirmDialog: React.FC<Props> = ({ patientName, uhid, dob, gender, onConfirm, onClose }) => {
  const [checked, setChecked] = useState(false);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck size={18} className="text-blue-600" /> Verify Patient Identity
          </DialogTitle>
        </DialogHeader>
        <p className="text-[12px] text-muted-foreground -mt-1">
          Confirm the patient's identity using two identifiers before collecting and labelling the sample.
        </p>
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 space-y-1.5">
          <IdRow label="Name" value={patientName} />
          <IdRow label="UHID" value={uhid || "—"} />
          {(dob || gender) && <IdRow label="Age / Sex" value={`${ageFromDob(dob)} ${gender || ""}`.trim() || "—"} />}
        </div>
        <label className="flex items-start gap-2 mt-2 cursor-pointer">
          <input type="checkbox" checked={checked} onChange={e => setChecked(e.target.checked)} className="mt-0.5" />
          <span className="text-[12px] text-foreground">
            I have verified the patient's identity using two identifiers (name and UHID) and will label the sample at the bedside.
          </span>
        </label>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" disabled={!checked} onClick={() => { onConfirm(); onClose(); }}>
            Confirm &amp; Collect
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const IdRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="flex items-baseline gap-2">
    <span className="text-[10px] text-muted-foreground uppercase w-16 shrink-0">{label}</span>
    <span className="text-sm font-semibold text-foreground">{value}</span>
  </div>
);

export default PatientIdentityConfirmDialog;
