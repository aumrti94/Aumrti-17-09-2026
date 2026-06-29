import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Printer } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  hospitalId: string;
  showCreate: boolean;
  onCloseCreate: () => void;
  onRefresh?: () => void;
}

const mannerOptions = ["natural", "accident", "suicide", "homicide", "undetermined"];

const DeathCertificatesTab: React.FC<Props> = ({ hospitalId, showCreate, onCloseCreate, onRefresh }) => {
  const [certs, setCerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [doctors, setDoctors] = useState<any[]>([]);

  // Form
  const [patientSearch, setPatientSearch] = useState("");
  const [patients, setPatients] = useState<any[]>([]);
  const [patientId, setPatientId] = useState("");
  const [timeOfDeath, setTimeOfDeath] = useState("");
  const [cause1a, setCause1a] = useState("");
  const [cause1b, setCause1b] = useState("");
  const [cause1c, setCause1c] = useState("");
  const [cause2, setCause2] = useState("");
  const [icdCode, setIcdCode] = useState("");
  const [manner, setManner] = useState("natural");
  const [isMlc, setIsMlc] = useState(false);
  const [certifiedBy, setCertifiedBy] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (hospitalId) init(); }, [hospitalId]);

  const init = async () => {
    fetchCerts();
    const { data: docs } = await (supabase as any).from("users").select("id, full_name").eq("hospital_id", hospitalId).eq("role", "doctor").eq("is_active", true);
    setDoctors(docs || []);
  };

  const fetchCerts = async () => {
    if (!hospitalId) return;
    setLoading(true);
    const { data, error } = await (supabase as any).from("death_certificates").select("*, patients(full_name, uhid)").eq("hospital_id", hospitalId).order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setCerts(data || []);
    setLoading(false);
  };

  const searchPatients = async (q: string) => {
    setPatientSearch(q);
    if (q.length < 2 || !hospitalId) { setPatients([]); return; }
    const { data } = await (supabase as any).from("patients").select("id, full_name, uhid").eq("hospital_id", hospitalId).or(`full_name.ilike.%${q}%,uhid.ilike.%${q}%`).limit(10);
    setPatients(data || []);
  };

  const printMCCD = (cert: any) => {
    const doctorName = doctors.find(d => d.id === cert.certified_by)?.full_name || "—";
    const html = `<html><head><title>MCCD — ${cert.patients?.full_name || "Patient"}</title>
    <style>
      body { font-family: 'Times New Roman', serif; padding: 40px; color: #000; max-width: 800px; margin: 0 auto; }
      h1 { text-align: center; font-size: 18px; border-bottom: 2px solid #000; padding-bottom: 8px; margin-bottom: 4px; }
      h2 { text-align: center; font-size: 13px; font-weight: normal; margin-top: 0; color: #444; }
      .meta { display: flex; justify-content: space-between; margin: 16px 0; font-size: 13px; }
      .section { margin: 12px 0; }
      .section-title { font-weight: bold; font-size: 12px; text-transform: uppercase; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-bottom: 8px; }
      .field { margin: 6px 0; font-size: 13px; }
      .field-label { font-weight: bold; display: inline-block; min-width: 180px; }
      .cause-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
      .cause-table td { border: 1px solid #999; padding: 8px; font-size: 13px; }
      .cause-table td:first-child { width: 80px; font-weight: bold; background: #f5f5f5; }
      .footer { margin-top: 40px; display: flex; justify-content: space-between; font-size: 12px; }
      .signature-line { border-top: 1px solid #000; width: 200px; text-align: center; padding-top: 4px; margin-top: 40px; }
      @media print { body { padding: 20px; } }
    </style></head><body>
      <h1>MEDICAL CERTIFICATE OF CAUSE OF DEATH</h1>
      <h2>(MCCD — Form 4/4A under Registration of Births and Deaths Act)</h2>
      <div class="meta">
        <span><b>MCCD No:</b> ${cert.mccd_form_number || "—"}</span>
        <span><b>Date of Issue:</b> ${cert.issued_at ? new Date(cert.issued_at).toLocaleDateString("en-IN") : "—"}</span>
      </div>
      <div class="section">
        <div class="section-title">Deceased Information</div>
        <div class="field"><span class="field-label">Name:</span> ${cert.patients?.full_name || "—"}</div>
        <div class="field"><span class="field-label">UHID:</span> ${cert.patients?.uhid || "—"}</div>
        <div class="field"><span class="field-label">Date & Time of Death:</span> ${cert.time_of_death ? new Date(cert.time_of_death).toLocaleString("en-IN") : "—"}</div>
      </div>
      <div class="section">
        <div class="section-title">Cause of Death</div>
        <table class="cause-table">
          <tr><td>I (a)</td><td><b>Immediate cause:</b> ${cert.cause_1a || "—"}</td></tr>
          <tr><td>I (b)</td><td><b>Antecedent cause:</b> ${cert.cause_1b || "—"}</td></tr>
          <tr><td>I (c)</td><td><b>Underlying cause:</b> ${cert.cause_1c || "—"}</td></tr>
          <tr><td>II</td><td><b>Contributing conditions:</b> ${cert.cause_2 || "—"}</td></tr>
        </table>
      </div>
      <div class="section">
        <div class="section-title">Additional Information</div>
        <div class="field"><span class="field-label">ICD Code (underlying):</span> ${cert.icd_code || "—"}</div>
        <div class="field"><span class="field-label">Manner of Death:</span> ${(cert.manner_of_death || "").toUpperCase()}</div>
        <div class="field"><span class="field-label">Medico-Legal Case:</span> ${cert.is_mlc ? "YES" : "NO"}</div>
      </div>
      <div class="footer">
        <div>
          <div class="signature-line">Certifying Medical Practitioner</div>
          <div style="text-align:center; font-size:12px; margin-top:4px;">${doctorName}</div>
        </div>
        <div>
          <div class="signature-line">Seal / Stamp</div>
        </div>
      </div>
    </body></html>`;
    const w = window.open("", "_blank", "noopener,noreferrer");
    if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
  };

  const createCert = async () => {
    if (!patientId || !timeOfDeath || !cause1a || !certifiedBy) { toast.error("Fill all required fields"); return; }
    setSaving(true);
    const mccdNum = `MCCD-${Date.now()}`;
    const { data: newCert, error } = await (supabase as any).from("death_certificates").insert({
      hospital_id: hospitalId,
      patient_id: patientId,
      time_of_death: timeOfDeath,
      cause_1a: cause1a,
      cause_1b: cause1b || null,
      cause_1c: cause1c || null,
      cause_2: cause2 || null,
      icd_code: icdCode || null,
      manner_of_death: manner,
      is_mlc: isMlc,
      certified_by: certifiedBy,
      mccd_form_number: mccdNum,
      issued_at: new Date().toISOString(),
    }).select("*, patients(full_name, uhid)").maybeSingle();

    if (error) { toast.error(error.message); setSaving(false); return; }
    toast.success("Death certificate created");
    setSaving(false);
    onCloseCreate();
    setPatientId(""); setCause1a(""); setCause1b(""); setCause1c(""); setCause2(""); setIcdCode("");
    setPatientSearch(""); setTimeOfDeath(""); setManner("natural"); setIsMlc(false); setCertifiedBy("");
    fetchCerts();
    onRefresh?.();

    // Auto-print
    if (newCert) printMCCD(newCert);
  };

  return (
    <>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-auto border rounded-lg">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Patient</TableHead>
                <TableHead>Time of Death</TableHead>
                <TableHead>Cause (1a)</TableHead>
                <TableHead>Manner</TableHead>
                <TableHead>MLC</TableHead>
                <TableHead>MCCD #</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">Loading...</TableCell></TableRow>
              ) : certs.length === 0 ? (
                <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground">No death certificates</TableCell></TableRow>
              ) : certs.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="text-[13px] font-medium">{c.patients?.full_name}</div>
                    <div className="text-[10px] text-muted-foreground font-mono">{c.patients?.uhid}</div>
                  </TableCell>
                  <TableCell className="text-xs">{c.time_of_death ? new Date(c.time_of_death).toLocaleString("en-IN") : "—"}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate">{c.cause_1a}</TableCell>
                  <TableCell><Badge variant="secondary" className="capitalize">{c.manner_of_death}</Badge></TableCell>
                  <TableCell>{c.is_mlc ? <Badge variant="destructive">MLC</Badge> : "—"}</TableCell>
                  <TableCell className="text-[10px] font-mono">{c.mccd_form_number || "—"}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => printMCCD(c)}>
                      <Printer className="h-3 w-3 mr-1" /> Print
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={showCreate} onOpenChange={onCloseCreate}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-auto">
          <DialogHeader><DialogTitle>📜 Generate Death Certificate</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Patient</Label>
              <Input placeholder="Search patient..." value={patientSearch} onChange={(e) => searchPatients(e.target.value)} />
              {patients.length > 0 && (
                <div className="border rounded mt-1 max-h-32 overflow-auto">
                  {patients.map((p) => (
                    <button key={p.id} onClick={() => { setPatientId(p.id); setPatientSearch(p.full_name); setPatients([]); }}
                      className="w-full text-left px-2 py-1 text-sm hover:bg-muted">{p.full_name} — {p.uhid}</button>
                  ))}
                </div>
              )}
            </div>
            <div><Label className="text-xs">Time of Death *</Label><Input type="datetime-local" value={timeOfDeath} onChange={(e) => setTimeOfDeath(e.target.value)} /></div>
            <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
              <p className="text-xs font-semibold">Cause of Death (MCCD Format)</p>
              <div><Label className="text-[10px]">1a. Immediate cause *</Label><Textarea value={cause1a} onChange={(e) => setCause1a(e.target.value)} rows={1} /></div>
              <div><Label className="text-[10px]">1b. Due to (antecedent)</Label><Textarea value={cause1b} onChange={(e) => setCause1b(e.target.value)} rows={1} /></div>
              <div><Label className="text-[10px]">1c. Due to (underlying)</Label><Textarea value={cause1c} onChange={(e) => setCause1c(e.target.value)} rows={1} /></div>
              <div><Label className="text-[10px]">Part II: Contributing conditions</Label><Textarea value={cause2} onChange={(e) => setCause2(e.target.value)} rows={1} /></div>
            </div>
            <div><Label className="text-xs">ICD Code (underlying cause)</Label><Input value={icdCode} onChange={(e) => setIcdCode(e.target.value)} placeholder="e.g. I25.9" /></div>
            <div>
              <Label className="text-xs">Manner of Death</Label>
              <Select value={manner} onValueChange={setManner}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{mannerOptions.map((m) => <SelectItem key={m} value={m} className="capitalize">{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={isMlc} onCheckedChange={setIsMlc} />
              <Label className="text-xs">MLC Case</Label>
            </div>
            <div>
              <Label className="text-xs">Certified By *</Label>
              <Select value={certifiedBy} onValueChange={setCertifiedBy}>
                <SelectTrigger><SelectValue placeholder="Select doctor" /></SelectTrigger>
                <SelectContent>{doctors.map((d) => <SelectItem key={d.id} value={d.id}>{d.full_name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <Button onClick={createCert} disabled={saving} className="w-full">Generate Certificate</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default DeathCertificatesTab;
