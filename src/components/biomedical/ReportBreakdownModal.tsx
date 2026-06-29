import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from '@/hooks/useHospitalId';

const DUMMY_USER = "00000000-0000-0000-0000-000000000000";

interface Props { open: boolean; onClose: () => void; onSaved: () => void; }

const ReportBreakdownModal: React.FC<Props> = ({ open, onClose, onSaved }) => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [equipment, setEquipment] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ equipment_id: "", description: "", severity: "medium" });

  useEffect(() => {
    if (!open) return;
    supabase.from("equipment_master").select("id, equipment_name, equipment_code, category, department_id").eq("hospital_id", hospitalId).eq("is_active", true).then(({ data }) => setEquipment(data || []));
  }, [open]);

  const handleSubmit = async () => {
    if (!form.equipment_id || !form.description.trim()) {
      toast({ title: "Equipment and description required", variant: "destructive" }); return;
    }
    setSaving(true);

    const { data: userData } = await supabase.from("users").select("id").eq("hospital_id", hospitalId).limit(1).maybeSingle();
    const userId = userData?.id || DUMMY_USER;

    const { error } = await supabase.from("breakdown_logs").insert({
      hospital_id: hospitalId, equipment_id: form.equipment_id,
      description: form.description, severity: form.severity, reported_by: userId,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); setSaving(false); return; }

    await supabase.from("equipment_master").update({ status: "breakdown" }).eq("id", form.equipment_id);

    if (form.severity === "critical") {
      const eq = equipment.find((e) => e.id === form.equipment_id);
      await supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId, alert_type: "equipment_breakdown",
        severity: "high", alert_message: `Critical equipment breakdown: ${eq?.equipment_name || "Unknown"} (${eq?.equipment_code || ""})`,
      });
    }

    setSaving(false);
    toast({ title: "Breakdown reported — Biomedical team notified" });
    onSaved(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Report Equipment Breakdown</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div>
            <Label>Equipment *</Label>
            <Select value={form.equipment_id} onValueChange={(v) => setForm((f) => ({ ...f, equipment_id: v }))}>
              <SelectTrigger><SelectValue placeholder="Select equipment..." /></SelectTrigger>
              <SelectContent>{equipment.map((e) => <SelectItem key={e.id} value={e.id}>{e.equipment_code} — {e.equipment_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Description *</Label>
            <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3} placeholder="Describe the issue..." />
          </div>
          <div>
            <Label>Severity</Label>
            <Select value={form.severity} onValueChange={(v) => setForm((f) => ({ ...f, severity: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="critical">Critical</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button onClick={handleSubmit} disabled={saving} variant="destructive">{saving ? "Reporting..." : "Report Breakdown"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ReportBreakdownModal;
