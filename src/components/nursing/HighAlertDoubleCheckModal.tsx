import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  drugName: string;
  dose?: string;
  marId?: string;
  onConfirmed: (secondNurseId: string) => void;
  onCancel: () => void;
}

const FIVE_RIGHTS = ["Right Patient", "Right Drug", "Right Dose", "Right Route", "Right Time"];

interface Nurse { id: string; full_name: string; }

const HighAlertDoubleCheckModal: React.FC<Props> = ({ open, drugName, dose, marId, onConfirmed, onCancel }) => {
  const { hospitalId } = useHospitalId();
  const [nurses, setNurses] = useState<Nurse[]>([]);
  const [secondNurse, setSecondNurse] = useState("");
  const [rights, setRights] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !hospitalId) return;
    // Filter to nursing roles only — non-nurses should not be listed as second verifier
    supabase.from("users").select("id, full_name")
      .eq("hospital_id", hospitalId).eq("is_active", true)
      .in("role", ["nurse", "sr_nurse", "charge_nurse", "nursing_supervisor", "head_nurse"])
      .order("full_name")
      .then(({ data }) => setNurses(data || []));
    setSecondNurse("");
    setRights({});
  }, [open, hospitalId]);

  const allRightsChecked = FIVE_RIGHTS.every((r) => rights[r]);
  const canConfirm = !!secondNurse && allRightsChecked;

  const handleConfirm = async () => {
    if (!canConfirm || !hospitalId) return;
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const confirmedAt = new Date().toISOString();
    // Build JSONB record of which 5-rights the second nurse verified
    const verifiedRights = {
      right_patient: !!rights["Right Patient"],
      right_drug:    !!rights["Right Drug"],
      right_dose:    !!rights["Right Dose"],
      right_route:   !!rights["Right Route"],
      right_time:    !!rights["Right Time"],
      confirmed_at:  confirmedAt,
    };
    await (supabase as any).from("mar_double_checks").insert({
      hospital_id: hospitalId,
      mar_id: marId || null,
      first_nurse_id: userData.user?.id || null,
      second_nurse_id: secondNurse,
      second_nurse_confirmed_at: confirmedAt,
      five_rights_both: true,
      second_nurse_verified_rights: verifiedRights,
    });
    setSaving(false);
    onConfirmed(secondNurse);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="h-5 w-5" /> High-Alert Medication — Double Check
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="bg-amber-50 border border-amber-200 rounded-md p-3 text-sm">
            <p className="font-bold text-amber-800">{drugName}</p>
            {dose && <p className="text-amber-700 text-xs mt-0.5">{dose}</p>}
            <p className="text-xs text-amber-600 mt-1">This is a high-alert medication. A second nurse must verify before administration.</p>
          </div>

          <div>
            <label className="text-xs font-medium">Second Nurse *</label>
            <select className="w-full mt-1 border rounded-md px-3 py-2 text-sm bg-background"
              value={secondNurse} onChange={e => setSecondNurse(e.target.value)}>
              <option value="">— Select Nurse 2 —</option>
              {nurses.map(n => <option key={n.id} value={n.id}>{n.full_name}</option>)}
            </select>
          </div>

          <div>
            <p className="text-xs font-medium mb-2">Second Nurse — 5 Rights Verification</p>
            <div className="space-y-1.5">
              {FIVE_RIGHTS.map(r => (
                <label key={r} className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-md border cursor-pointer transition-colors text-sm",
                  rights[r] ? "border-green-500 bg-green-50" : "border-border"
                )}>
                  <input type="checkbox" checked={!!rights[r]}
                    onChange={e => setRights(prev => ({ ...prev, [r]: e.target.checked }))} />
                  {r}
                  {rights[r] && <Check className="h-3.5 w-3.5 text-green-600 ml-auto" />}
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
            <Button size="sm" onClick={handleConfirm} disabled={!canConfirm || saving}
              className="bg-amber-600 hover:bg-amber-700 text-white">
              {saving ? "Confirming…" : "Confirm & Proceed"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default HighAlertDoubleCheckModal;
