import React, { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface OncologyPatientsTabProps {
  showRegister: boolean;
  onCloseRegister: () => void;
}

const ECOG = [
  "0 — Fully active",
  "1 — Restricted in strenuous activity",
  "2 — Ambulatory, self-care, <50% in bed",
  "3 — Limited self-care, >50% in bed",
  "4 — Completely disabled",
];

const OncologyPatientsTab: React.FC<OncologyPatientsTabProps> = ({ showRegister, onCloseRegister }) => {
  const { toast } = useToast();
  const [patients, setPatients] = useState<any[]>([]);
  const [protocols, setProtocols] = useState<any[]>([]);
  const [allPatients, setAllPatients] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [registerModal, setRegisterModal] = useState(false);
  const [form, setForm] = useState({ patientId: "", diagnosis: "", icdCode: "", stage: "", protocolId: "", heightCm: "", weightKg: "", ecog: "0", totalCycles: "" });

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (showRegister) { setRegisterModal(true); loadAllPatients(); } }, [showRegister]);

  const loadData = async () => {
    const [pRes, prRes] = await Promise.all([
      (supabase as any).from("oncology_patients").select("*, patients(*), chemo_protocols(*)").eq("is_active", true).order("registered_at", { ascending: false }),
      (supabase as any).from("chemo_protocols").select("*").eq("is_active", true),
    ]);
    setPatients(pRes.data || []);
    setProtocols(prRes.data || []);
  };

  const loadAllPatients = async () => {
    const { data } = await supabase.from("patients").select("id, full_name, uhid").order("full_name").limit(500);
    setAllPatients(data || []);
  };

  const bsa = form.heightCm && form.weightKg ? Math.sqrt((parseFloat(form.heightCm) * parseFloat(form.weightKg)) / 3600) : 0;

  const handleRegister = async () => {
    if (!form.patientId || !form.diagnosis) { toast({ title: "Patient and diagnosis required", variant: "destructive" }); return; }
    const patient = allPatients.find((p) => p.id === form.patientId);
    const hospitalRes = await supabase.from("patients").select("hospital_id").eq("id", form.patientId).maybeSingle();
    const hospitalId = hospitalRes.data?.hospital_id;
    if (!hospitalId) { toast({ title: "Hospital not found", variant: "destructive" }); return; }

    const { error } = await (supabase as any).from("oncology_patients").insert({
      hospital_id: hospitalId,
      patient_id: form.patientId,
      primary_diagnosis: form.diagnosis,
      icd_code: form.icdCode || null,
      stage: form.stage || null,
      protocol_id: form.protocolId || null,
      total_cycles_planned: form.totalCycles ? parseInt(form.totalCycles) : null,
      height_cm: form.heightCm ? parseFloat(form.heightCm) : null,
      weight_kg: form.weightKg ? parseFloat(form.weightKg) : null,
      bsa_m2: bsa > 0 ? Math.round(bsa * 100) / 100 : null,
      performance_status: parseInt(form.ecog),
    });

    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Oncology patient registered" });
    setRegisterModal(false);
    onCloseRegister();
    loadData();
  };

  const filtered = patients.filter((p: any) => (p.patients?.full_name || "").toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="space-y-3 mt-3">
      <Input placeholder="Search patients..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {filtered.map((p: any) => (
          <Card key={p.id}>
            <CardContent className="p-3">
              <p className="text-sm font-bold">{p.patients?.full_name}</p>
              <p className="text-xs text-muted-foreground">{p.patients?.uhid}</p>
              <p className="text-xs font-medium mt-1">{p.primary_diagnosis}</p>
              {p.stage && <Badge variant="outline" className="text-[10px] mt-1">{p.stage}</Badge>}
              <div className="flex gap-2 mt-2 text-[11px]">
                <span>Protocol: <span className="font-medium">{p.chemo_protocols?.protocol_name || "—"}</span></span>
                <span>Cycle: <span className="font-medium">{p.current_cycle}/{p.total_cycles_planned || "?"}</span></span>
              </div>
              <div className="flex gap-2 mt-1 text-[11px]">
                <span>BSA: <span className="font-bold text-primary">{p.bsa_m2 || "—"} m²</span></span>
                <span>ECOG: {p.performance_status ?? "—"}</span>
              </div>
            </CardContent>
          </Card>
        ))}
        {filtered.length === 0 && <p className="text-sm text-muted-foreground col-span-full text-center py-8">No oncology patients registered</p>}
      </div>

      <Dialog open={registerModal} onOpenChange={(o) => { setRegisterModal(o); if (!o) onCloseRegister(); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Register Oncology Patient</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-[60vh] overflow-y-auto">
            <div>
              <Label>Link to Patient</Label>
              <Select value={form.patientId} onValueChange={(v) => setForm({ ...form, patientId: v })}>
                <SelectTrigger><SelectValue placeholder="Search patient" /></SelectTrigger>
                <SelectContent>
                  {allPatients.map((p) => <SelectItem key={p.id} value={p.id}>{p.full_name} ({p.uhid})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Primary Diagnosis *</Label><Input value={form.diagnosis} onChange={(e) => setForm({ ...form, diagnosis: e.target.value })} placeholder="e.g. Carcinoma Breast Stage IIB" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>ICD-10 Code</Label><Input value={form.icdCode} onChange={(e) => setForm({ ...form, icdCode: e.target.value })} placeholder="C50.9" /></div>
              <div><Label>Stage</Label><Input value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })} placeholder="T2N1M0" /></div>
            </div>
            <div>
              <Label>Protocol</Label>
              <Select value={form.protocolId} onValueChange={(v) => setForm({ ...form, protocolId: v })}>
                <SelectTrigger><SelectValue placeholder="Select protocol" /></SelectTrigger>
                <SelectContent>
                  {protocols.map((pr: any) => <SelectItem key={pr.id} value={pr.id}>{pr.protocol_name} — {pr.cancer_type}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Total Cycles Planned</Label><Input type="number" value={form.totalCycles} onChange={(e) => setForm({ ...form, totalCycles: e.target.value })} /></div>
            <p className="text-xs font-semibold text-muted-foreground">BSA Calculator (Mosteller)</p>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Height (cm)</Label><Input value={form.heightCm} onChange={(e) => setForm({ ...form, heightCm: e.target.value })} /></div>
              <div><Label>Weight (kg)</Label><Input value={form.weightKg} onChange={(e) => setForm({ ...form, weightKg: e.target.value })} /></div>
            </div>
            {bsa > 0 && <p className="text-lg font-bold text-primary text-center">BSA = {bsa.toFixed(2)} m²</p>}
            <div>
              <Label>ECOG Performance Status</Label>
              <Select value={form.ecog} onValueChange={(v) => setForm({ ...form, ecog: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ECOG.map((e, i) => <SelectItem key={i} value={String(i)}>{e}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button className="w-full" onClick={handleRegister}>Register Patient</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OncologyPatientsTab;
