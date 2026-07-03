import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { Loader2, Droplets } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  admissionId: string;
  patientId: string;
  hospitalId: string;
  patientBloodGroup?: string | null;
  onRequested?: () => void;
}

const COMPONENTS = [
  { value: "packed_rbc", label: "Packed RBC" },
  { value: "whole_blood", label: "Whole Blood" },
  { value: "ffp", label: "Fresh Frozen Plasma (FFP)" },
  { value: "platelets", label: "Platelets" },
  { value: "cryoprecipitate", label: "Cryoprecipitate" },
];

const BLOOD_GROUPS = ["A", "B", "AB", "O"];
const RH_FACTORS = [
  { value: "positive", label: "Positive (+)" },
  { value: "negative", label: "Negative (−)" },
];

const parseBloodGroup = (raw: string | null | undefined): { group: string; rh: string } => {
  if (!raw) return { group: "", rh: "" };
  const clean = raw.trim().toUpperCase();
  const rh = clean.endsWith("+") || clean.toLowerCase().includes("pos") ? "positive"
    : clean.endsWith("-") || clean.toLowerCase().includes("neg") ? "negative"
    : "";
  const group = clean.replace(/[+-]/g, "").replace(/positive|negative/i, "").trim();
  return { group: BLOOD_GROUPS.includes(group) ? group : "", rh };
};

const BloodRequestModal: React.FC<Props> = ({
  open, onClose, admissionId, patientId, hospitalId, patientBloodGroup, onRequested,
}) => {
  const parsed = parseBloodGroup(patientBloodGroup);

  const [form, setForm] = useState({
    blood_group: parsed.group,
    rh_factor: parsed.rh,
    component: "packed_rbc",
    units_required: 1,
    urgency: "routine",
    indication: "",
  });
  const [saving, setSaving] = useState(false);

  const handleSubmit = async () => {
    if (!form.blood_group || !form.rh_factor) {
      toast({ title: "Blood group and Rh factor are required", variant: "destructive" });
      return;
    }
    if (!form.indication.trim()) {
      toast({ title: "Clinical indication is required (NABH compliance)", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: userData } = await (supabase as any)
        .from("users")
        .select("id")
        .eq("auth_user_id", user?.id ?? "")
        .maybeSingle();

      const { error } = await (supabase as any).from("blood_requests").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        admission_id: admissionId,
        blood_group: form.blood_group,
        rh_factor: form.rh_factor,
        component: form.component,
        units_required: form.units_required,
        urgency: form.urgency,
        indication: form.indication.trim(),
        requested_by: userData?.id ?? null,
        status: "pending",
      });

      if (error) throw error;

      toast({
        title: "Blood request submitted",
        description: `${form.units_required} unit(s) of ${COMPONENTS.find(c => c.value === form.component)?.label} — ${form.urgency.toUpperCase()}. Blood bank has been notified.`,
      });
      onRequested?.();
      onClose();
    } catch (err: any) {
      toast({ title: "Request failed", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Droplets className="h-5 w-5 text-red-500" />
            Request Blood Transfusion
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Blood Group + Rh */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Blood Group *</Label>
              <select
                value={form.blood_group}
                onChange={(e) => setForm(f => ({ ...f, blood_group: e.target.value }))}
                className="mt-1 w-full h-9 border border-input rounded-md px-2 text-sm bg-background"
              >
                <option value="">Select</option>
                {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs font-semibold">Rh Factor *</Label>
              <select
                value={form.rh_factor}
                onChange={(e) => setForm(f => ({ ...f, rh_factor: e.target.value }))}
                className="mt-1 w-full h-9 border border-input rounded-md px-2 text-sm bg-background"
              >
                <option value="">Select</option>
                {RH_FACTORS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
          </div>

          {/* Component */}
          <div>
            <Label className="text-xs font-semibold">Blood Component *</Label>
            <select
              value={form.component}
              onChange={(e) => setForm(f => ({ ...f, component: e.target.value }))}
              className="mt-1 w-full h-9 border border-input rounded-md px-2 text-sm bg-background"
            >
              {COMPONENTS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          {/* Units + Urgency */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs font-semibold">Units Required *</Label>
              <Input
                type="number"
                min={1}
                max={10}
                value={form.units_required}
                onChange={(e) => setForm(f => ({ ...f, units_required: Math.max(1, parseInt(e.target.value) || 1) }))}
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-semibold">Urgency *</Label>
              <select
                value={form.urgency}
                onChange={(e) => setForm(f => ({ ...f, urgency: e.target.value }))}
                className={`mt-1 w-full h-9 border rounded-md px-2 text-sm bg-background font-medium ${
                  form.urgency === "emergency" ? "border-red-400 text-red-700 bg-red-50"
                  : form.urgency === "urgent" ? "border-amber-400 text-amber-700 bg-amber-50"
                  : "border-input"
                }`}
              >
                <option value="routine">Routine</option>
                <option value="urgent">Urgent</option>
                <option value="emergency">Emergency</option>
              </select>
            </div>
          </div>

          {form.urgency === "emergency" && (
            <div className="bg-red-50 border border-red-300 rounded-lg px-3 py-2 text-xs text-red-800 font-semibold">
              ⚠️ Emergency request — Blood bank will be alerted immediately. Notify Blood Bank directly by phone.
            </div>
          )}

          {/* Indication */}
          <div>
            <Label className="text-xs font-semibold">Clinical Indication *</Label>
            <Textarea
              rows={3}
              value={form.indication}
              onChange={(e) => setForm(f => ({ ...f, indication: e.target.value }))}
              placeholder="e.g. Post-op anaemia, Hb 6.2 g/dL, symptomatic — requires transfusion"
              className="mt-1 text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">Required for NABH audit trail</p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            size="sm"
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={handleSubmit}
            disabled={saving}
          >
            {saving && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Submit Request
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BloodRequestModal;
