import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import { format, differenceInDays, addYears } from "date-fns";
import { useHospitalId } from '@/hooks/useHospitalId';


interface Props { onRefresh: () => void; }

const CalibrationTab: React.FC<Props> = ({ onRefresh }) => {
  const { hospitalId } = useHospitalId();
  const [records, setRecords] = useState<any[]>([]);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    equipment_id: "", calibrated_at: new Date().toISOString().split("T")[0],
    calibrated_by: "", next_due: "", certificate_no: "", result: "pass", observations: "",
  });

  const load = async () => {
    const [rRes, eRes] = await Promise.all([
      supabase.from("calibration_records").select("*, equipment_master(equipment_name, equipment_code)").eq("hospital_id", hospitalId).order("next_due"),
      supabase.from("equipment_master").select("id, equipment_name, equipment_code").eq("hospital_id", hospitalId).eq("is_active", true),
    ]);
    setRecords(rRes.data || []);
    setEquipment(eRes.data || []);
  };

  useEffect(() => { load(); }, []);

  const dueColor = (date: string) => {
    const days = differenceInDays(new Date(date), new Date());
    if (days < 30) return "text-red-600 font-bold";
    if (days < 90) return "text-amber-600";
    return "text-muted-foreground";
  };

  const handleAdd = async () => {
    if (!form.equipment_id || !form.calibrated_by || !form.next_due) return;
    setSaving(true);
    const { error } = await supabase.from("calibration_records").insert({
      hospital_id: hospitalId, equipment_id: form.equipment_id,
      calibrated_at: form.calibrated_at, calibrated_by: form.calibrated_by,
      next_due: form.next_due, certificate_no: form.certificate_no || null,
      result: form.result, observations: form.observations || null,
    });

    if (!error && (form.result === "fail" || form.result === "out_of_range")) {
      await supabase.from("equipment_master").update({ status: "calibration" }).eq("id", form.equipment_id);
      const eq = equipment.find((e) => e.id === form.equipment_id);
      await supabase.from("clinical_alerts").insert({
        hospital_id: hospitalId, alert_type: "calibration_failed", severity: "high",
        alert_message: `Equipment calibration ${form.result.replace(/_/g, " ")}: ${eq?.equipment_name || "Unknown"}`,
      });
    }

    setSaving(false);
    if (error) return;
    setShowAdd(false);
    setForm({ equipment_id: "", calibrated_at: new Date().toISOString().split("T")[0], calibrated_by: "", next_due: "", certificate_no: "", result: "pass", observations: "" });
    load(); onRefresh();
  };

  // Auto-suggest next due on equipment select
  const handleEquipmentSelect = (id: string) => {
    const suggestedNext = addYears(new Date(form.calibrated_at), 1).toISOString().split("T")[0];
    setForm((f) => ({ ...f, equipment_id: id, next_due: f.next_due || suggestedNext }));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex justify-end pb-3 shrink-0">
        <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" /> Add Calibration Record</Button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/50 sticky top-0 z-10">
            <tr className="text-left">
              <th className="px-3 py-2 font-medium">Equipment</th>
              <th className="px-3 py-2 font-medium">Last Calibrated</th>
              <th className="px-3 py-2 font-medium">Agency</th>
              <th className="px-3 py-2 font-medium">Next Due</th>
              <th className="px-3 py-2 font-medium">Certificate</th>
              <th className="px-3 py-2 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-3 py-2">{r.equipment_master?.equipment_name} <span className="font-mono text-xs text-muted-foreground">({r.equipment_master?.equipment_code})</span></td>
                <td className="px-3 py-2">{format(new Date(r.calibrated_at), "dd/MM/yyyy")}</td>
                <td className="px-3 py-2">{r.calibrated_by}</td>
                <td className={`px-3 py-2 ${dueColor(r.next_due)}`}>{format(new Date(r.next_due), "dd/MM/yyyy")}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.certificate_no || "—"}</td>
                <td className="px-3 py-2">
                  <Badge variant={r.result === "pass" ? "default" : "destructive"} className="text-[10px]">
                    {r.result.replace(/_/g, " ").toUpperCase()}
                  </Badge>
                </td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-muted-foreground">No calibration records</td></tr>}
          </tbody>
        </table>
      </div>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Add Calibration Record</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Equipment *</Label>
              <Select value={form.equipment_id} onValueChange={handleEquipmentSelect}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{equipment.map((e) => <SelectItem key={e.id} value={e.id}>{e.equipment_code} — {e.equipment_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Calibration Date *</Label><Input type="date" value={form.calibrated_at} onChange={(e) => setForm((f) => ({ ...f, calibrated_at: e.target.value }))} /></div>
              <div><Label>Next Due *</Label><Input type="date" value={form.next_due} onChange={(e) => setForm((f) => ({ ...f, next_due: e.target.value }))} /></div>
            </div>
            <div><Label>Calibrating Agency *</Label><Input value={form.calibrated_by} onChange={(e) => setForm((f) => ({ ...f, calibrated_by: e.target.value }))} /></div>
            <div><Label>Certificate No</Label><Input value={form.certificate_no} onChange={(e) => setForm((f) => ({ ...f, certificate_no: e.target.value }))} /></div>
            <div><Label>Result *</Label>
              <Select value={form.result} onValueChange={(v) => setForm((f) => ({ ...f, result: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="pass">Pass</SelectItem>
                  <SelectItem value="fail">Fail</SelectItem>
                  <SelectItem value="out_of_range">Out of Range</SelectItem>
                  <SelectItem value="adjusted">Adjusted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(form.result === "fail" || form.result === "out_of_range") && (
              <div className="p-2 rounded bg-red-50 border border-red-200 text-[12px] text-red-700">
                ⚠️ Equipment will be marked for calibration and a clinical alert will be raised.
              </div>
            )}
            <div><Label>Observations</Label><Textarea value={form.observations} onChange={(e) => setForm((f) => ({ ...f, observations: e.target.value }))} rows={2} /></div>
            <Button onClick={handleAdd} disabled={saving} className="w-full">{saving ? "Saving..." : "Save Record"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CalibrationTab;
