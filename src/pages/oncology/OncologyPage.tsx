import React, { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import DaycareBoardTab from "@/components/oncology/DaycareBoardTab";
import ChemoOrdersTab from "@/components/oncology/ChemoOrdersTab";
import OncologyPatientsTab from "@/components/oncology/OncologyPatientsTab";
import ProtocolsTab from "@/components/oncology/ProtocolsTab";
import OncologyReportsTab from "@/components/oncology/OncologyReportsTab";

const ECOG = [
  "0 — Fully active",
  "1 — Restricted in strenuous activity",
  "2 — Ambulatory, self-care, <50% in bed",
  "3 — Limited self-care, >50% in bed",
  "4 — Completely disabled",
];

const OncologyPage: React.FC = () => {
  const { toast } = useToast();
  const [kpis, setKpis] = useState({ todaySessions: 0, pendingVerification: 0, chairsOccupied: 0, totalChairs: 0, lowAnc: 0 });
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [registerModal, setRegisterModal] = useState(false);

  // Register form state
  const [allPatients, setAllPatients] = useState<any[]>([]);
  const [protocols, setProtocols] = useState<any[]>([]);
  const [form, setForm] = useState({ patientId: "", diagnosis: "", icdCode: "", stage: "", protocolId: "", heightCm: "", weightKg: "", ecog: "0", totalCycles: "" });

  useEffect(() => { loadKpis(); }, []);

  const loadKpis = async () => {
    const today = new Date().toISOString().split("T")[0];
    const [ordersRes, chairsRes] = await Promise.all([
      (supabase as any).from("chemo_orders").select("id, status, anc, scheduled_date").eq("scheduled_date", today),
      (supabase as any).from("daycare_chairs").select("id, status"),
    ]);
    const orders = ordersRes.data || [];
    const chairs = chairsRes.data || [];
    setKpis({
      todaySessions: orders.length,
      pendingVerification: orders.filter((o: any) => o.status === "pending_verification").length,
      chairsOccupied: chairs.filter((c: any) => c.status === "occupied").length,
      totalChairs: chairs.length,
      lowAnc: orders.filter((o: any) => o.anc !== null && parseFloat(o.anc) < 1000).length,
    });
  };

  const openRegister = async () => {
    setRegisterModal(true);
    const [pRes, prRes] = await Promise.all([
      supabase.from("patients").select("id, full_name, uhid").order("full_name").limit(500),
      (supabase as any).from("chemo_protocols").select("*").eq("is_active", true),
    ]);
    setAllPatients(pRes.data || []);
    setProtocols(prRes.data || []);
  };

  const bsa = form.heightCm && form.weightKg ? Math.sqrt((parseFloat(form.heightCm) * parseFloat(form.weightKg)) / 3600) : 0;

  const handleRegister = async () => {
    if (!form.patientId || !form.diagnosis) { toast({ title: "Patient and diagnosis required", variant: "destructive" }); return; }
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
    setForm({ patientId: "", diagnosis: "", icdCode: "", stage: "", protocolId: "", heightCm: "", weightKg: "", ecog: "0", totalCycles: "" });
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-background shrink-0" style={{ height: 52 }}>
        <h1 className="text-base font-bold text-foreground">🎗️ Oncology & Chemotherapy</h1>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">💊 {kpis.todaySessions} Sessions Today</Badge>
          <Badge variant="outline" className={`text-xs ${kpis.pendingVerification > 0 ? "border-amber-500 text-amber-700 bg-amber-50" : ""}`}>
            ⚠️ {kpis.pendingVerification} Awaiting Verification
          </Badge>
          <Badge variant="outline" className="text-xs">🪑 {kpis.chairsOccupied}/{kpis.totalChairs} Chairs</Badge>
          {kpis.lowAnc > 0 && (
            <Badge variant="destructive" className="text-xs">🔬 {kpis.lowAnc} Low ANC</Badge>
          )}
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShowNewOrder(true)}>+ New Chemo Order</Button>
          <Button size="sm" variant="outline" onClick={openRegister}>+ Register Patient</Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="daycare" className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="mx-4 mt-2 w-fit shrink-0">
          <TabsTrigger value="daycare">🪑 Daycare Board</TabsTrigger>
          <TabsTrigger value="orders">📋 Orders</TabsTrigger>
          <TabsTrigger value="patients">👤 Patients</TabsTrigger>
          <TabsTrigger value="protocols">⚗️ Protocols</TabsTrigger>
          <TabsTrigger value="reports">📊 Reports</TabsTrigger>
        </TabsList>
        <TabsContent value="daycare" className="flex-1 overflow-auto px-4 pb-4">
          <DaycareBoardTab showNewOrder={showNewOrder} onCloseNewOrder={() => setShowNewOrder(false)} onRefresh={loadKpis} />
        </TabsContent>
        <TabsContent value="orders" className="flex-1 overflow-auto px-4 pb-4">
          <ChemoOrdersTab onRefresh={loadKpis} />
        </TabsContent>
        <TabsContent value="patients" className="flex-1 overflow-auto px-4 pb-4">
          <OncologyPatientsTab showRegister={false} onCloseRegister={() => {}} />
        </TabsContent>
        <TabsContent value="protocols" className="flex-1 overflow-auto px-4 pb-4">
          <ProtocolsTab />
        </TabsContent>
        <TabsContent value="reports" className="flex-1 overflow-auto px-4 pb-4">
          <OncologyReportsTab />
        </TabsContent>
      </Tabs>

      {/* Register Oncology Patient Modal — always rendered */}
      <Dialog open={registerModal} onOpenChange={setRegisterModal}>
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

export default OncologyPage;
