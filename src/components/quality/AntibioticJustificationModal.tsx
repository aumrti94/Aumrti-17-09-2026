import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FlaskConical } from "lucide-react";
import { logNABHEvidence } from "@/lib/nabh-evidence";

interface Props {
  open: boolean;
  drugName: string;
  hospitalId: string;
  patientId?: string;
  admissionId?: string;
  encounterId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

const AntibioticJustificationModal: React.FC<Props> = ({
  open, drugName, hospitalId, patientId, admissionId, encounterId, onSaved, onCancel,
}) => {
  const [form, setForm] = useState({
    indication: "", culture_available: false, culture_ref: "",
    empirical: true, de_escalation_plan: "", review_date: "",
    iv_to_oral_plan: false, duration_days: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.indication.trim()) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    await (supabase as any).from("antibiotic_justifications").insert({
      hospital_id: hospitalId,
      patient_id: patientId || null,
      admission_id: admissionId || null,
      encounter_id: encounterId || null,
      drug_name: drugName,
      prescribed_by: userData.user?.id || null,
      indication: form.indication,
      culture_available: form.culture_available,
      culture_ref: form.culture_ref || null,
      empirical: form.empirical,
      de_escalation_plan: form.de_escalation_plan || null,
      review_date: form.review_date || null,
      iv_to_oral_plan: form.iv_to_oral_plan,
      duration_days: form.duration_days ? Number(form.duration_days) : null,
    });
    await logNABHEvidence(hospitalId, "MOM.8",
      `Antibiotic justification recorded for ${drugName} — Indication: ${form.indication}`);
    setSaving(false);
    setForm({ indication: "", culture_available: false, culture_ref: "", empirical: true, de_escalation_plan: "", review_date: "", iv_to_oral_plan: false, duration_days: "" });
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-blue-700">
            <FlaskConical className="h-4 w-4" /> Antibiotic Stewardship — Justification
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="text-xs bg-blue-50 border border-blue-200 rounded-md p-2 text-blue-800">
            <span className="font-bold">{drugName}</span> is an antibiotic. Document justification before prescribing.
          </div>

          <div>
            <label className="text-xs font-medium">Clinical Indication *</label>
            <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={2}
              placeholder="e.g. Community-acquired pneumonia, suspected MRSA…"
              value={form.indication} onChange={e => setForm(f => ({ ...f, indication: e.target.value }))} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.empirical}
              onChange={e => setForm(f => ({ ...f, empirical: e.target.checked }))} />
            Empirical therapy (culture pending)
          </label>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.culture_available}
              onChange={e => setForm(f => ({ ...f, culture_available: e.target.checked }))} />
            Culture result available
          </label>

          {form.culture_available && (
            <div>
              <label className="text-xs font-medium">Culture / Sensitivity Reference</label>
              <Input placeholder="Lab report / culture ID" value={form.culture_ref}
                onChange={e => setForm(f => ({ ...f, culture_ref: e.target.value }))} />
            </div>
          )}

          <div>
            <label className="text-xs font-medium">Duration (days)</label>
            <Input type="number" placeholder="7" value={form.duration_days}
              onChange={e => setForm(f => ({ ...f, duration_days: e.target.value }))} />
          </div>

          <div>
            <label className="text-xs font-medium">Review Date</label>
            <Input type="date" value={form.review_date}
              onChange={e => setForm(f => ({ ...f, review_date: e.target.value }))} />
          </div>

          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.iv_to_oral_plan}
              onChange={e => setForm(f => ({ ...f, iv_to_oral_plan: e.target.checked }))} />
            IV-to-Oral switch planned
          </label>

          <div>
            <label className="text-xs font-medium">De-escalation Plan</label>
            <textarea className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background resize-none" rows={2}
              placeholder="Narrow spectrum once culture available…"
              value={form.de_escalation_plan} onChange={e => setForm(f => ({ ...f, de_escalation_plan: e.target.value }))} />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" onClick={handleSave} disabled={!form.indication.trim() || saving}>
              {saving ? "Saving…" : "Save Justification"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AntibioticJustificationModal;
