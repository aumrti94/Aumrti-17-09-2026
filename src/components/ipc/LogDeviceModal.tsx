import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormError } from "@/components/ui/FormError";
import { AdmissionPicker, type AdmissionOption } from "@/components/ipc/AdmissionPicker";
import { DEVICE_TYPES, hasInsertBundle } from "@/lib/ipcBundles";
import type { BundleTarget } from "@/components/ipc/BundleChecklistModal";
import { Loader2 } from "lucide-react";

/** `datetime-local` wants local wall-clock time, not a UTC ISO string. */
function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Records a device insertion from the IPC module.
 *
 * Until this existed, device-days could only be created at the IPD bedside, so an
 * IPC nurse working from the surveillance dashboard had no way to populate the
 * denominators — and every HAI rate was structurally empty regardless.
 */
export const LogDeviceModal: React.FC<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hospitalId: string;
  userId: string | null;
  onSaved: () => void;
  /** Called when the saved device has an insertion bundle, so the caller can chain into it. */
  onInsertBundle?: (target: BundleTarget) => void;
}> = ({ open, onOpenChange, hospitalId, userId, onSaved, onInsertBundle }) => {
  const { toast } = useToast();
  const [admission, setAdmission] = useState<AdmissionOption | null>(null);
  const [deviceType, setDeviceType] = useState("");
  const [insertedAt, setInsertedAt] = useState(() => toLocalInputValue(new Date()));
  const [insertionSite, setInsertionSite] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setAdmission(null);
    setDeviceType("");
    setInsertedAt(toLocalInputValue(new Date()));
    setInsertionSite("");
    setNotes("");
    setError(null);
  }, [open]);

  const save = async () => {
    if (!admission || !deviceType) {
      setError("Select an admission and a device type.");
      return;
    }
    setSaving(true);
    setError(null);

    const { data, error: err } = await (supabase as any).from("ipc_device_usage").insert({
      hospital_id: hospitalId,
      admission_id: admission.admissionId,
      patient_id: admission.patientId,
      ward_id: admission.wardId,
      device_type: deviceType,
      device_inserted_at: new Date(insertedAt).toISOString(),
      insertion_site: insertionSite || null,
      notes: notes || null,
      inserted_by: userId ?? null,
    }).select().maybeSingle();

    setSaving(false);
    if (err) { setError(getErrorMessage(err)); return; }

    toast({ title: "Device recorded" });
    onSaved();
    onOpenChange(false);

    if (hasInsertBundle(deviceType) && onInsertBundle && data?.id) {
      onInsertBundle({
        deviceUsageId: data.id,
        admissionId: admission.admissionId,
        patientId: admission.patientId,
        deviceType,
        patientLabel: `${admission.label}${admission.sublabel ? ` — ${admission.sublabel}` : ""}`,
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Log Device</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          <div>
            <Label>Admission *</Label>
            <div className="mt-1">
              <AdmissionPicker hospitalId={hospitalId} value={admission} onChange={setAdmission} disabled={saving} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Device Type *</Label>
              <Select value={deviceType} onValueChange={setDeviceType}>
                <SelectTrigger className="h-8 text-sm mt-1"><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {DEVICE_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Inserted At *</Label>
              <Input
                type="datetime-local"
                className="h-8 text-sm mt-1"
                value={insertedAt}
                max={toLocalInputValue(new Date())}
                onChange={e => setInsertedAt(e.target.value)}
              />
            </div>
          </div>

          <div>
            <Label>Insertion Site</Label>
            <Input
              className="h-8 text-sm mt-1"
              placeholder="e.g. right subclavian"
              value={insertionSite}
              onChange={e => setInsertionSite(e.target.value)}
            />
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea className="text-sm mt-1" rows={2} value={notes} onChange={e => setNotes(e.target.value)} />
          </div>

          <FormError message={error} />

          {deviceType && hasInsertBundle(deviceType) && (
            <p className="text-[11px] text-muted-foreground">
              The insertion bundle checklist will open after saving.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Save Device
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default LogDeviceModal;
