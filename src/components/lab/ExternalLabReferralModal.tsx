import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { X, ExternalLink } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
  patientId?: string;
  patientName?: string;
  onCreated: () => void;
}

const ExternalLabReferralModal: React.FC<Props> = ({ open, onClose, hospitalId, patientId, patientName, onCreated }) => {
  const { toast } = useToast();
  const [labName, setLabName] = useState("");
  const [labPhone, setLabPhone] = useState("");
  const [labAddress, setLabAddress] = useState("");
  const [testsInput, setTestsInput] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!labName.trim()) { toast({ title: "Lab name is required", variant: "destructive" }); return; }
    setSaving(true);
    const tests = testsInput.split(",").map(t => t.trim()).filter(Boolean);
    const { error } = await (supabase as any).from("external_lab_referrals").insert({
      hospital_id: hospitalId,
      patient_id: patientId || null,
      lab_name: labName.trim(),
      lab_phone: labPhone.trim() || null,
      lab_address: labAddress.trim() || null,
      tests_ordered: tests.length ? tests : [],
      report_expected_at: expectedDate || null,
      status: "pending",
    });
    if (error) {
      toast({ title: "Failed to create referral", variant: "destructive" });
    } else {
      toast({ title: "External lab referral created" });
      onCreated();
      onClose();
    }
    setSaving(false);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-background rounded-xl shadow-xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <ExternalLink className="h-4 w-4 text-blue-500" />
            <h2 className="text-sm font-bold">Refer to External Lab</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X className="h-4 w-4" /></button>
        </div>

        {patientName && (
          <div className="bg-muted/50 rounded-lg px-3 py-2 text-xs mb-3">
            Patient: <span className="font-semibold">{patientName}</span>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Lab Name *</label>
            <Input value={labName} onChange={e => setLabName(e.target.value)} placeholder="e.g. Metropolis, SRL, Thyrocare" className="h-8 text-sm" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] text-muted-foreground font-medium block mb-1">Lab Phone</label>
              <Input value={labPhone} onChange={e => setLabPhone(e.target.value)} placeholder="Contact number" className="h-8 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground font-medium block mb-1">Report Expected By</label>
              <Input type="date" value={expectedDate} onChange={e => setExpectedDate(e.target.value)}
                min={new Date().toISOString().split("T")[0]} className="h-8 text-sm" />
            </div>
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Lab Address</label>
            <Input value={labAddress} onChange={e => setLabAddress(e.target.value)} placeholder="Address (optional)" className="h-8 text-sm" />
          </div>

          <div>
            <label className="text-[11px] text-muted-foreground font-medium block mb-1">Tests Ordered (comma-separated)</label>
            <Input value={testsInput} onChange={e => setTestsInput(e.target.value)}
              placeholder="e.g. HbA1c, Lipid Profile, Thyroid Panel" className="h-8 text-sm" />
          </div>

          <div className="flex gap-2 pt-1">
            <Button onClick={handleSave} disabled={saving} className="flex-1">Create Referral</Button>
            <Button variant="ghost" onClick={onClose}>Cancel</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ExternalLabReferralModal;
