import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const TOXICITY_TYPES = ["Haematological", "GI", "Neurological", "Renal", "Hepatic", "Alopecia", "Mucositis", "Fatigue", "Cardiac", "Dermatological"];

const OncologyReportsTab: React.FC = () => {
  const { toast } = useToast();
  const [toxicities, setToxicities] = useState<any[]>([]);
  const [wastage, setWastage] = useState<any[]>([]);
  const [showToxForm, setShowToxForm] = useState(false);
  const [orders, setOrders] = useState<any[]>([]);
  const [toxForm, setToxForm] = useState({ orderId: "", cycleNumber: 1, type: "", grade: 1, onsetDate: new Date().toISOString().split("T")[0], description: "", doseModified: false, modType: "", hospitalised: false });

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const [tRes, wRes, oRes] = await Promise.all([
      (supabase as any).from("toxicity_events").select("*, patients(full_name), chemo_orders(cycle_number, chemo_protocols(protocol_name))").order("created_at", { ascending: false }).limit(50),
      (supabase as any).from("vial_wastage").select("*").order("created_at", { ascending: false }).limit(100),
      (supabase as any).from("chemo_orders").select("id, cycle_number, oncology_patients(patients(full_name))").order("created_at", { ascending: false }).limit(50),
    ]);
    setToxicities(tRes.data || []);
    setWastage(wRes.data || []);
    setOrders(oRes.data || []);
  };

  const submitToxicity = async () => {
    if (!toxForm.orderId || !toxForm.type) { toast({ title: "Order and toxicity type required", variant: "destructive" }); return; }
    const order = orders.find((o: any) => o.id === toxForm.orderId);
    const { error } = await (supabase as any).from("toxicity_events").insert({
      hospital_id: (await supabase.from("patients").select("hospital_id").limit(1).maybeSingle()).data?.hospital_id,
      patient_id: (await (supabase as any).from("chemo_orders").select("patient_id").eq("id", toxForm.orderId).maybeSingle()).data?.patient_id,
      order_id: toxForm.orderId,
      cycle_number: toxForm.cycleNumber,
      toxicity_type: toxForm.type,
      ctcae_grade: toxForm.grade,
      onset_date: toxForm.onsetDate,
      description: toxForm.description || null,
      dose_modified: toxForm.doseModified,
      dose_modification_type: toxForm.doseModified ? toxForm.modType : null,
      hospitalised: toxForm.hospitalised,
    });
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Toxicity event recorded" });
    setShowToxForm(false);
    loadData();
  };

  const totalWaste = wastage.reduce((s, w) => s + (parseFloat(w.waste_cost) || 0), 0);

  return (
    <div className="space-y-4 mt-3">
      {/* Toxicity Section */}
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between">
          <CardTitle className="text-sm">Toxicity Events</CardTitle>
          <Button size="sm" onClick={() => setShowToxForm(true)}>+ Record Toxicity</Button>
        </CardHeader>
        <CardContent>
          {toxicities.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No toxicity events recorded</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Patient</TableHead>
                  <TableHead>Cycle</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>CTCAE Grade</TableHead>
                  <TableHead>Onset</TableHead>
                  <TableHead>Dose Modified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {toxicities.map((t: any) => (
                  <TableRow key={t.id}>
                    <TableCell className="text-xs">{t.patients?.full_name || "—"}</TableCell>
                    <TableCell className="text-xs">{t.cycle_number}</TableCell>
                    <TableCell className="text-xs">{t.toxicity_type}</TableCell>
                    <TableCell>
                      <Badge className={`text-[10px] ${t.ctcae_grade >= 3 ? "bg-red-100 text-red-800" : t.ctcae_grade === 2 ? "bg-amber-100 text-amber-800" : "bg-green-100 text-green-800"}`}>
                        Grade {t.ctcae_grade}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">{format(new Date(t.onset_date), "dd/MM/yyyy")}</TableCell>
                    <TableCell className="text-xs">{t.dose_modified ? t.dose_modification_type || "Yes" : "No"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Vial Wastage */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Vial Wastage Report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg font-bold text-destructive mb-2">Total waste this month: ₹{totalWaste.toLocaleString("en-IN")}</p>
          {wastage.length === 0 ? <p className="text-sm text-muted-foreground">No wastage records</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Drug</TableHead>
                  <TableHead>Ordered (mg)</TableHead>
                  <TableHead>Administered (mg)</TableHead>
                  <TableHead>Wasted (mg)</TableHead>
                  <TableHead>Cost (₹)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {wastage.map((w: any) => (
                  <TableRow key={w.id}>
                    <TableCell className="text-xs font-medium">{w.drug_name}</TableCell>
                    <TableCell className="text-xs">{w.ordered_dose_mg}</TableCell>
                    <TableCell className="text-xs">{w.administered_dose_mg}</TableCell>
                    <TableCell className="text-xs text-destructive font-medium">{w.wasted_dose_mg}</TableCell>
                    <TableCell className="text-xs">₹{parseFloat(w.waste_cost || 0).toLocaleString("en-IN")}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Toxicity Form Modal */}
      <Dialog open={showToxForm} onOpenChange={setShowToxForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Record Toxicity Event</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Chemo Order</Label>
              <Select value={toxForm.orderId} onValueChange={(v) => setToxForm({ ...toxForm, orderId: v })}>
                <SelectTrigger><SelectValue placeholder="Select order" /></SelectTrigger>
                <SelectContent>
                  {orders.map((o: any) => (
                    <SelectItem key={o.id} value={o.id}>{o.oncology_patients?.patients?.full_name || "—"} · Cycle {o.cycle_number}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Cycle #</Label><Input type="number" value={toxForm.cycleNumber} onChange={(e) => setToxForm({ ...toxForm, cycleNumber: parseInt(e.target.value) || 1 })} /></div>
              <div><Label>Onset Date</Label><Input type="date" value={toxForm.onsetDate} onChange={(e) => setToxForm({ ...toxForm, onsetDate: e.target.value })} /></div>
            </div>
            <div>
              <Label>Toxicity Type</Label>
              <Select value={toxForm.type} onValueChange={(v) => setToxForm({ ...toxForm, type: v })}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {TOXICITY_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CTCAE Grade</Label>
              <Select value={String(toxForm.grade)} onValueChange={(v) => setToxForm({ ...toxForm, grade: parseInt(v) })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">Grade 1 — Mild</SelectItem>
                  <SelectItem value="2">Grade 2 — Moderate</SelectItem>
                  <SelectItem value="3">Grade 3 — Severe</SelectItem>
                  <SelectItem value="4">Grade 4 — Life-threatening</SelectItem>
                  <SelectItem value="5">Grade 5 — Death</SelectItem>
                </SelectContent>
              </Select>
              {toxForm.grade >= 3 && <p className="text-xs text-destructive mt-1 font-medium">⚠️ Grade {toxForm.grade} — Clinical alert will be generated</p>}
            </div>
            <div><Label>Description</Label><Textarea value={toxForm.description} onChange={(e) => setToxForm({ ...toxForm, description: e.target.value })} rows={2} /></div>
            <div className="flex items-center gap-3">
              <Switch checked={toxForm.doseModified} onCheckedChange={(c) => setToxForm({ ...toxForm, doseModified: c })} />
              <Label>Dose modified?</Label>
            </div>
            {toxForm.doseModified && (
              <Select value={toxForm.modType} onValueChange={(v) => setToxForm({ ...toxForm, modType: v })}>
                <SelectTrigger><SelectValue placeholder="Modification type" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hold">Hold</SelectItem>
                  <SelectItem value="reduce">Reduce</SelectItem>
                  <SelectItem value="discontinue">Discontinue</SelectItem>
                </SelectContent>
              </Select>
            )}
            <div className="flex items-center gap-3">
              <Switch checked={toxForm.hospitalised} onCheckedChange={(c) => setToxForm({ ...toxForm, hospitalised: c })} />
              <Label>Hospitalised?</Label>
            </div>
            <Button className="w-full" onClick={submitToxicity}>Record Toxicity</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default OncologyReportsTab;
