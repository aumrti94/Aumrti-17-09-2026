import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getErrorMessage } from "@/lib/errorMessage";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/FormError";
import { DEVICE_LABELS } from "@/lib/ipcBundles";
import { Loader2 } from "lucide-react";

function toLocalInputValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface RemovalTarget {
  id: string;
  deviceType: string;
  insertedAt: string;
}

/**
 * Records a device removal, which stops its device-days accruing.
 *
 * The removal time is validated against the insertion time here as well as by the
 * ipc_device_usage_removal_after_insertion CHECK constraint: qi_collect_hic_device
 * has no GREATEST(..., 0), so an inverted pair would subtract device-days from the
 * hospital's denominator and inflate every rate on the dashboard.
 */
export const RemoveDeviceDialog: React.FC<{
  target: RemovalTarget | null;
  onOpenChange: (v: boolean) => void;
  userId: string | null;
  onSaved: () => void;
}> = ({ target, onOpenChange, userId, onSaved }) => {
  const { toast } = useToast();
  const [removedAt, setRemovedAt] = useState(() => toLocalInputValue(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (target) { setRemovedAt(toLocalInputValue(new Date())); setError(null); }
  }, [target]);

  const save = async () => {
    if (!target) return;
    const removed = new Date(removedAt);

    if (removed < new Date(target.insertedAt)) {
      setError("Removal time cannot be before the insertion time.");
      return;
    }
    if (removed.getTime() > Date.now() + 60_000) {
      setError("Removal time cannot be in the future.");
      return;
    }

    setSaving(true);
    setError(null);
    const { error: err } = await (supabase as any)
      .from("ipc_device_usage")
      .update({ device_removed_at: removed.toISOString(), removed_by: userId ?? null })
      .eq("id", target.id);
    setSaving(false);

    if (err) { setError(getErrorMessage(err)); return; }
    toast({ title: "Device removal recorded" });
    onSaved();
    onOpenChange(false);
  };

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>
            Remove {target ? DEVICE_LABELS[target.deviceType] ?? target.deviceType : "Device"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-1">
          {target && (
            <p className="text-xs text-muted-foreground">
              Inserted {new Date(target.insertedAt).toLocaleString()}
            </p>
          )}
          <div>
            <Label>Removed At *</Label>
            <Input
              type="datetime-local"
              className="h-8 text-sm mt-1"
              value={removedAt}
              min={target ? toLocalInputValue(new Date(target.insertedAt)) : undefined}
              max={toLocalInputValue(new Date())}
              onChange={e => setRemovedAt(e.target.value)}
            />
          </div>
          <FormError message={error} />
        </div>

        <div className="flex justify-end gap-2 mt-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />} Record Removal
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default RemoveDeviceDialog;
