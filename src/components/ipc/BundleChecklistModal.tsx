import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FormError } from "@/components/ui/FormError";
import {
  bundleElements, computeCompliancePct, toElementsJson,
  DEVICE_LABELS, type BundleType,
} from "@/lib/ipcBundles";
import { Loader2 } from "lucide-react";

export interface BundleTarget {
  deviceUsageId: string;
  admissionId: string;
  patientId: string;
  deviceType: string;
  patientLabel?: string;
}

/**
 * Records a care-bundle checklist against a device.
 *
 * Always sends an explicit compliance_pct and stores elements as real booleans —
 * the two things IPDDeviceTab silently omitted, which left every row it wrote
 * unscored and read as both 100% (dashboard) and 0% (NABH collector).
 */
export const BundleChecklistModal: React.FC<{
  open: boolean;
  onOpenChange: (v: boolean) => void;
  hospitalId: string;
  userId: string | null;
  target: BundleTarget | null;
  bundleType: BundleType;
  onSaved: () => void;
}> = ({ open, onOpenChange, hospitalId, userId, target, bundleType, onSaved }) => {
  const { toast } = useToast();
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const elements = useMemo(
    () => (target ? bundleElements(target.deviceType, bundleType) : []),
    [target, bundleType],
  );

  useEffect(() => {
    if (open) { setAnswers({}); setError(null); }
  }, [open, target?.deviceUsageId, bundleType]);

  const pct = computeCompliancePct(answers, elements);

  const save = async () => {
    if (!target) return;
    setSaving(true);
    setError(null);

    const { error: err } = await (supabase as any).from("ipc_bundle_checklists").insert({
      hospital_id: hospitalId,
      admission_id: target.admissionId,
      patient_id: target.patientId,
      device_usage_id: target.deviceUsageId,
      device_type: target.deviceType,
      bundle_type: bundleType,
      checklist_date: new Date().toISOString().split("T")[0],
      completed_by: userId ?? null,
      elements: toElementsJson(answers, elements),
      compliance_pct: pct,
    });

    setSaving(false);
    if (err) { setError(getErrorMessage(err)); return; }

    toast({
      title: `Bundle checklist saved — ${pct ?? "—"}%`,
      description: pct != null && pct < 100
        ? "One or more elements were not met — review with the care team."
        : undefined,
    });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {bundleType === "insert" ? "Insertion" : bundleType === "removal" ? "Removal" : "Maintenance"} Bundle
            {target && ` — ${DEVICE_LABELS[target.deviceType] ?? target.deviceType}`}
          </DialogTitle>
        </DialogHeader>

        {target?.patientLabel && (
          <p className="text-xs text-muted-foreground -mt-1">{target.patientLabel}</p>
        )}

        <div className="space-y-2 mt-2">
          {elements.map(el => (
            <label key={el.key} className="flex items-start gap-2.5 p-2 rounded border hover:bg-muted/30 cursor-pointer">
              <Checkbox
                checked={answers[el.key] === true}
                onCheckedChange={v => setAnswers(p => ({ ...p, [el.key]: v === true }))}
                className="mt-0.5"
              />
              <span className="text-sm leading-snug">{el.label}</span>
            </label>
          ))}
          {elements.length === 0 && (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No bundle is defined for this device type.
            </p>
          )}
        </div>

        <FormError message={error} className="mt-1" />

        <div className="flex items-center justify-between mt-3">
          <span className="text-sm">
            Compliance:{" "}
            <span className={
              pct == null ? "text-muted-foreground"
                : pct >= 80 ? "font-bold text-green-600"
                : pct >= 60 ? "font-bold text-amber-600"
                : "font-bold text-red-600"
            }>
              {pct == null ? "—" : `${pct}%`}
            </span>
            {/* Unticked items count against compliance, so say so before they save. */}
            <span className="text-xs text-muted-foreground ml-1.5">(unticked items count as not met)</span>
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
            <Button size="sm" onClick={save} disabled={saving || elements.length === 0}>
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Save Checklist
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BundleChecklistModal;
