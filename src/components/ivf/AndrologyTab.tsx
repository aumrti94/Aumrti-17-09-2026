import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import PatientSearchPicker from "@/components/shared/PatientSearchPicker";

const AndrologyTab = () => {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  // Form
  const [patientId, setPatientId] = useState("");
  const [volume, setVolume] = useState("");
  const [ph, setPh] = useState("");
  const [concentration, setConcentration] = useState("");
  const [totalCount, setTotalCount] = useState("");
  const [totalMotility, setTotalMotility] = useState("");
  const [progressive, setProgressive] = useState("");
  const [morphology, setMorphology] = useState("");
  const [vitality, setVitality] = useState("");
  const [dfi, setDfi] = useState("");
  const [icsiIndicated, setIcsiIndicated] = useState(false);
  const [reportNotes, setReportNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("andrology_reports").select("*").order("test_date", { ascending: false }).limit(100);
    if (error) console.error(error);
    setReports(data || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleSave = async () => {
    if (!patientId) { toast.error("Patient is required"); return; }
    setSaving(true);
    const { data: userData } = await supabase.from("users").select("id, hospital_id").limit(1).maybeSingle();
    const { error } = await supabase.from("andrology_reports").insert({
      hospital_id: userData?.hospital_id,
      patient_id: patientId,
      test_date: new Date().toISOString().split("T")[0],
      volume_ml: volume ? parseFloat(volume) : null,
      ph: ph ? parseFloat(ph) : null,
      concentration_m_ml: concentration ? parseFloat(concentration) : null,
      total_count: totalCount ? parseFloat(totalCount) : null,
      total_motility_pct: totalMotility ? parseInt(totalMotility) : null,
      progressive_motility_pct: progressive ? parseInt(progressive) : null,
      morphology_pct: morphology ? parseInt(morphology) : null,
      vitality_pct: vitality ? parseInt(vitality) : null,
      dfi_percent: dfi ? parseFloat(dfi) : null,
      icsi_indicated: icsiIndicated,
      report_notes: reportNotes || null,
      reported_by: userData?.id,
    });
    if (error) { console.error(error); toast.error("Failed to save report"); }
    else {
      toast.success("Andrology report saved");
      setShowAdd(false);
      setPatientId(""); setVolume(""); setPh(""); setConcentration("");
      setTotalCount(""); setTotalMotility(""); setProgressive("");
      setMorphology(""); setVitality(""); setDfi("");
      setIcsiIndicated(false); setReportNotes("");
      load();
    }
    setSaving(false);
  };

  const whoFlag = (label: string, value: number | null, min: number) => {
    if (value === null || value === undefined) return null;
    return value < min ? "text-red-600 font-semibold" : "text-green-700";
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Semen Analysis Reports (WHO 6th Ed)</h3>
        <Button size="sm" onClick={() => setShowAdd(true)}>+ New Report</Button>
      </div>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Volume</TableHead>
              <TableHead>Conc (M/mL)</TableHead>
              <TableHead>Motility %</TableHead>
              <TableHead>Progressive %</TableHead>
              <TableHead>Morphology %</TableHead>
              <TableHead>DFI %</TableHead>
              <TableHead>ICSI?</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">Loading…</TableCell></TableRow>
            ) : reports.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No reports</TableCell></TableRow>
            ) : reports.map((r) => (
              <TableRow key={r.id}>
                <TableCell>{r.test_date}</TableCell>
                <TableCell className={`font-mono ${whoFlag("vol", r.volume_ml, 1.4)}`}>{r.volume_ml ?? "—"}</TableCell>
                <TableCell className={`font-mono ${whoFlag("conc", r.concentration_m_ml, 16)}`}>{r.concentration_m_ml ?? "—"}</TableCell>
                <TableCell className={`font-mono ${whoFlag("mot", r.total_motility_pct, 42)}`}>{r.total_motility_pct ?? "—"}%</TableCell>
                <TableCell className={`font-mono ${whoFlag("prog", r.progressive_motility_pct, 30)}`}>{r.progressive_motility_pct ?? "—"}%</TableCell>
                <TableCell className={`font-mono ${whoFlag("morph", r.morphology_pct, 4)}`}>{r.morphology_pct ?? "—"}%</TableCell>
                <TableCell className="font-mono">{r.dfi_percent ?? "—"}%</TableCell>
                <TableCell>
                  {r.icsi_indicated && <Badge variant="destructive" className="text-[10px]">ICSI</Badge>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Add Report Modal */}
      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Semen Analysis (WHO 6th Ed)</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Patient *</Label>
              <PatientSearchPicker hospitalId="" value={patientId} onChange={(id) => setPatientId(id)} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Volume (mL) ≥1.4</Label><Input type="number" step="0.01" value={volume} onChange={(e) => setVolume(e.target.value)} /></div>
              <div><Label className="text-xs">pH ≥7.2</Label><Input type="number" step="0.01" value={ph} onChange={(e) => setPh(e.target.value)} /></div>
              <div><Label className="text-xs">Conc (M/mL) ≥16</Label><Input type="number" step="0.01" value={concentration} onChange={(e) => setConcentration(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Total Count (M) ≥39</Label><Input type="number" value={totalCount} onChange={(e) => setTotalCount(e.target.value)} /></div>
              <div><Label className="text-xs">Total Motility % ≥42</Label><Input type="number" value={totalMotility} onChange={(e) => setTotalMotility(e.target.value)} /></div>
              <div><Label className="text-xs">Progressive % ≥30</Label><Input type="number" value={progressive} onChange={(e) => setProgressive(e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label className="text-xs">Morphology % ≥4</Label><Input type="number" value={morphology} onChange={(e) => setMorphology(e.target.value)} /></div>
              <div><Label className="text-xs">Vitality % ≥54</Label><Input type="number" value={vitality} onChange={(e) => setVitality(e.target.value)} /></div>
              <div><Label className="text-xs">DFI %</Label><Input type="number" step="0.01" value={dfi} onChange={(e) => setDfi(e.target.value)} /></div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={icsiIndicated} onCheckedChange={setIcsiIndicated} />
              <Label className="text-xs">ICSI Indicated</Label>
            </div>
            <div><Label className="text-xs">Notes</Label><Textarea value={reportNotes} onChange={(e) => setReportNotes(e.target.value)} rows={2} /></div>
            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? "Saving…" : "Save Report"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AndrologyTab;
