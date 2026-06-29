import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { AlertTriangle, Plus, Loader2, ClipboardList } from "lucide-react";

const SEVERITY_BADGE: Record<string, string> = {
  mild: "bg-blue-100 text-blue-700",
  moderate: "bg-amber-100 text-amber-700",
  severe: "bg-red-100 text-red-700",
};

const AEFI_TYPES = [
  "Local reaction (pain/redness/swelling at injection site)",
  "Fever",
  "Anaphylaxis / Severe allergic reaction",
  "Abscess at injection site",
  "Lymphadenitis",
  "Paralytic polio following OPV",
  "Encephalopathy",
  "Toxic shock syndrome",
  "Seizure",
  "Other",
];

interface Props { hospitalId: string; }

const AEFIReportingTab: React.FC<Props> = ({ hospitalId }) => {
  const [records, setRecords] = useState<any[]>([]);
  const [showReport, setShowReport] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    patient_name: "",
    patient_phone: "",
    vaccine_name: "",
    vaccination_date: new Date().toISOString().split("T")[0],
    aefi_description: "",
    aefi_severity: "mild",
    onset_hours: "",
    action_taken: "",
  });

  const load = async () => {
    const { data } = await (supabase as any)
      .from("vaccination_records")
      .select("id, patients(full_name, phone), vaccine_name, vaccination_date, aefi_description, aefi_severity, created_at")
      .eq("hospital_id", hospitalId)
      .eq("aefi_reported", true)
      .order("created_at", { ascending: false })
      .limit(100);
    setRecords(data || []);
  };

  useEffect(() => { load(); }, [hospitalId]);

  const save = async () => {
    if (!form.patient_name || !form.vaccine_name || !form.aefi_description) {
      toast.error("Patient name, vaccine, and event description required");
      return;
    }
    setSaving(true);

    // Find or create a minimal vaccination_record for this AEFI
    const { data: patient } = await (supabase as any)
      .from("patients")
      .select("id")
      .eq("hospital_id", hospitalId)
      .ilike("full_name", form.patient_name)
      .limit(1)
      .maybeSingle();

    const { error } = await (supabase as any).from("vaccination_records").insert({
      hospital_id: hospitalId,
      patient_id: patient?.id || null,
      vaccine_name: form.vaccine_name,
      vaccination_date: form.vaccination_date,
      aefi_reported: true,
      aefi_description: `[${AEFI_TYPES.find(t => t === form.aefi_description) ? form.aefi_description : "Other"}: ${form.aefi_description}] Onset: ${form.onset_hours || "unknown"} hours. Action: ${form.action_taken || "Symptomatic"}`,
      aefi_severity: form.aefi_severity as any,
      dose_number: 1,
      administered_by: null,
    });

    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success("AEFI report filed");
    setShowReport(false);
    setForm({ patient_name: "", patient_phone: "", vaccine_name: "", vaccination_date: new Date().toISOString().split("T")[0], aefi_description: "", aefi_severity: "mild", onset_hours: "", action_taken: "" });
    load();
  };

  const stats = {
    total: records.length,
    severe: records.filter(r => r.aefi_severity === "severe").length,
    moderate: records.filter(r => r.aefi_severity === "moderate").length,
  };

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Total AEFI Reports", value: stats.total, color: "text-primary" },
          { label: "Moderate", value: stats.moderate, color: "text-amber-600" },
          { label: "Severe", value: stats.severe, color: "text-red-600" },
        ].map((s) => (
          <Card key={s.label} className="p-4 flex items-center gap-3">
            <AlertTriangle className={`h-7 w-7 ${s.color}`} />
            <div>
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-xl font-bold">{s.value}</p>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">AEFI Reports</h3>
        <Button size="sm" onClick={() => setShowReport(true)}><Plus className="h-4 w-4 mr-1" /> Report AEFI</Button>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Patient</TableHead>
              <TableHead>Vaccine</TableHead>
              <TableHead>Vaccination Date</TableHead>
              <TableHead>Severity</TableHead>
              <TableHead>Description</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium text-sm">{(r.patients as any)?.full_name || "—"}</TableCell>
                <TableCell className="text-sm">{r.vaccine_name}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{r.vaccination_date}</TableCell>
                <TableCell>
                  <Badge className={SEVERITY_BADGE[r.aefi_severity] || "bg-muted text-foreground"}>{r.aefi_severity || "—"}</Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground max-w-[300px] truncate">{r.aefi_description}</TableCell>
              </TableRow>
            ))}
            {records.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8">
                  <ClipboardList className="h-8 w-8 mx-auto mb-2 text-muted-foreground/40" />
                  <p className="text-sm text-muted-foreground">No AEFI reports filed</p>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={showReport} onOpenChange={setShowReport}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>File AEFI Report</DialogTitle></DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2 mb-2">Adverse Event Following Immunization — as per CDSCO guidelines</p>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Patient Name *</Label><Input value={form.patient_name} onChange={(e) => setForm({ ...form, patient_name: e.target.value })} /></div>
              <div><Label>Phone</Label><Input value={form.patient_phone} onChange={(e) => setForm({ ...form, patient_phone: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label>Vaccine Given *</Label><Input placeholder="e.g. BCG, OPV, DPT" value={form.vaccine_name} onChange={(e) => setForm({ ...form, vaccine_name: e.target.value })} /></div>
              <div><Label>Vaccination Date *</Label><Input type="date" value={form.vaccination_date} onChange={(e) => setForm({ ...form, vaccination_date: e.target.value })} /></div>
            </div>
            <div>
              <Label>Adverse Event Type *</Label>
              <Select value={form.aefi_description} onValueChange={(v) => setForm({ ...form, aefi_description: v })}>
                <SelectTrigger><SelectValue placeholder="Select event type" /></SelectTrigger>
                <SelectContent>
                  {AEFI_TYPES.map(t => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Severity *</Label>
                <Select value={form.aefi_severity} onValueChange={(v) => setForm({ ...form, aefi_severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mild">Mild</SelectItem>
                    <SelectItem value="moderate">Moderate</SelectItem>
                    <SelectItem value="severe">Severe</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Onset (hours after vaccine)</Label><Input type="number" placeholder="e.g. 4" value={form.onset_hours} onChange={(e) => setForm({ ...form, onset_hours: e.target.value })} /></div>
            </div>
            <div>
              <Label>Action Taken</Label>
              <Textarea placeholder="e.g. Antihistamine given, patient monitored for 30 min..." value={form.action_taken} onChange={(e) => setForm({ ...form, action_taken: e.target.value })} rows={2} className="text-xs" />
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="outline" onClick={() => setShowReport(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />} File Report</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AEFIReportingTab;
