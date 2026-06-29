import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Plus, Loader2 } from "lucide-react";
import { differenceInDays, format } from "date-fns";
import { cn } from "@/lib/utils";
import { logNABHEvidence } from "@/lib/nabh-evidence";

interface CalibrationRecord {
  id: string;
  analyzer_name: string;
  calibration_date: string;
  next_calibration_date: string;
  calibrated_by: string;
  calibration_type: string;
  pass_fail: "pass" | "fail" | "acceptable";
  deviation_percent: number | null;
  certificate_number: string | null;
  notes: string | null;
}

interface Props {
  hospitalId: string;
}

const STATUS_STYLE: Record<string, string> = {
  pass: "bg-green-50 border-green-200 text-green-700",
  fail: "bg-red-50 border-red-200 text-red-700",
  acceptable: "bg-amber-50 border-amber-200 text-amber-700",
};

const LabCalibrationTab: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [records, setRecords] = useState<CalibrationRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    analyzer_name: "",
    calibration_date: new Date().toISOString().split("T")[0],
    next_calibration_date: "",
    calibrated_by: "",
    calibration_type: "internal",
    pass_fail: "pass" as "pass" | "fail" | "acceptable",
    deviation_percent: "",
    certificate_number: "",
    notes: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("lab_calibration_records")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("next_calibration_date", { ascending: true });
    setRecords(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.analyzer_name || !form.calibration_date || !form.next_calibration_date) {
      toast({ title: "Analyzer name and dates are required", variant: "destructive" });
      return;
    }
    setSaving(true);
    const { error } = await (supabase as any).from("lab_calibration_records").insert({
      hospital_id: hospitalId,
      analyzer_name: form.analyzer_name.trim(),
      calibration_date: form.calibration_date,
      next_calibration_date: form.next_calibration_date,
      calibrated_by: form.calibrated_by,
      calibration_type: form.calibration_type,
      pass_fail: form.pass_fail,
      deviation_percent: form.deviation_percent ? parseFloat(form.deviation_percent) : null,
      certificate_number: form.certificate_number || null,
      notes: form.notes || null,
    });
    if (error) {
      toast({ title: "Failed to save", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Calibration record saved" });
      logNABHEvidence(hospitalId, "NABL.CAL", `Calibration: ${form.analyzer_name} on ${form.calibration_date} — ${form.pass_fail.toUpperCase()}`);
      setShowModal(false);
      load();
    }
    setSaving(false);
  };

  const today = new Date();
  const overdueCount = records.filter((r) => new Date(r.next_calibration_date) < today).length;
  const dueSoonCount = records.filter((r) => {
    const days = differenceInDays(new Date(r.next_calibration_date), today);
    return days >= 0 && days <= 30;
  }).length;

  if (loading) return <div className="flex items-center justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold">Analyzer Calibration Records — NABL</h2>
          {overdueCount > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              <AlertTriangle size={10} className="mr-1" /> {overdueCount} Overdue
            </Badge>
          )}
          {dueSoonCount > 0 && (
            <Badge variant="outline" className="text-[10px] border-amber-300 bg-amber-50 text-amber-700">
              {dueSoonCount} Due in 30 days
            </Badge>
          )}
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowModal(true)}>
          <Plus size={13} /> Add Calibration
        </Button>
      </div>

      {records.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          No calibration records. Add your first calibration to track NABL compliance.
        </div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                <th className="px-3 py-2 text-left">Analyzer</th>
                <th className="px-3 py-2 text-center">Calibration Date</th>
                <th className="px-3 py-2 text-center">Type</th>
                <th className="px-3 py-2 text-center">Result</th>
                <th className="px-3 py-2 text-center">Deviation %</th>
                <th className="px-3 py-2 text-left">Certificate</th>
                <th className="px-3 py-2 text-center">Next Due</th>
                <th className="px-3 py-2 text-left">Calibrated By</th>
              </tr>
            </thead>
            <tbody>
              {records.map((r) => {
                const daysUntilDue = differenceInDays(new Date(r.next_calibration_date), today);
                const isOverdue = daysUntilDue < 0;
                const isDueSoon = daysUntilDue >= 0 && daysUntilDue <= 30;
                return (
                  <tr key={r.id} className={cn("border-t border-border hover:bg-muted/30", isOverdue ? "bg-red-50/40 dark:bg-red-950/10" : "")}>
                    <td className="px-3 py-2 text-xs font-medium">{r.analyzer_name}</td>
                    <td className="px-3 py-2 text-xs text-center">{format(new Date(r.calibration_date), "dd/MM/yyyy")}</td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="outline" className="text-[9px] capitalize">{r.calibration_type}</Badge>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <Badge variant="outline" className={cn("text-[9px] capitalize", STATUS_STYLE[r.pass_fail])}>
                        {r.pass_fail === "pass" ? <CheckCircle2 size={9} className="mr-1" /> : <AlertTriangle size={9} className="mr-1" />}
                        {r.pass_fail}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-center font-mono">{r.deviation_percent != null ? `${r.deviation_percent}%` : "—"}</td>
                    <td className="px-3 py-2 text-xs font-mono">{r.certificate_number || "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={cn("text-xs font-bold", isOverdue ? "text-destructive" : isDueSoon ? "text-amber-600" : "text-muted-foreground")}>
                        {format(new Date(r.next_calibration_date), "dd/MM/yyyy")}
                        {isOverdue && ` (${Math.abs(daysUntilDue)}d overdue)`}
                        {isDueSoon && !isOverdue && ` (${daysUntilDue}d)`}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{r.calibrated_by || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <Dialog open onOpenChange={() => setShowModal(false)}>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Add Calibration Record</DialogTitle></DialogHeader>
            <div className="grid grid-cols-2 gap-3 py-2">
              <div className="col-span-2"><Label>Analyzer Name *</Label><Input value={form.analyzer_name} onChange={(e) => setForm(f => ({ ...f, analyzer_name: e.target.value }))} placeholder="Sysmex XP-300, Cobas c111..." className="mt-1" /></div>
              <div><Label>Calibration Date *</Label><Input type="date" value={form.calibration_date} onChange={(e) => setForm(f => ({ ...f, calibration_date: e.target.value }))} className="mt-1" /></div>
              <div><Label>Next Due Date *</Label><Input type="date" value={form.next_calibration_date} onChange={(e) => setForm(f => ({ ...f, next_calibration_date: e.target.value }))} className="mt-1" /></div>
              <div>
                <Label>Type</Label>
                <select value={form.calibration_type} onChange={(e) => setForm(f => ({ ...f, calibration_type: e.target.value }))} className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                  {["internal", "external", "manufacturer", "iqc"].map(t => <option key={t} value={t} className="capitalize">{t}</option>)}
                </select>
              </div>
              <div>
                <Label>Result</Label>
                <select value={form.pass_fail} onChange={(e) => setForm(f => ({ ...f, pass_fail: e.target.value as any }))} className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 text-sm">
                  <option value="pass">Pass</option>
                  <option value="acceptable">Acceptable</option>
                  <option value="fail">Fail</option>
                </select>
              </div>
              <div><Label>Deviation %</Label><Input type="number" step="0.1" value={form.deviation_percent} onChange={(e) => setForm(f => ({ ...f, deviation_percent: e.target.value }))} placeholder="e.g. 2.5" className="mt-1" /></div>
              <div><Label>Certificate No.</Label><Input value={form.certificate_number} onChange={(e) => setForm(f => ({ ...f, certificate_number: e.target.value }))} className="mt-1" /></div>
              <div className="col-span-2"><Label>Calibrated By</Label><Input value={form.calibrated_by} onChange={(e) => setForm(f => ({ ...f, calibrated_by: e.target.value }))} placeholder="Technician name / agency" className="mt-1" /></div>
              <div className="col-span-2"><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} className="mt-1" /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save Record"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default LabCalibrationTab;
