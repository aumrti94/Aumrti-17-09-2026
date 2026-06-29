import React, { useState, useEffect } from "react";
import { generateBillNumber } from "@/hooks/useBillNumber";
import { autoPostJournalEntry } from "@/lib/accounting";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { recalculateBillTotalsSafe } from "@/lib/billTotals";
import { Plus, Save } from "lucide-react";

const PROCEDURES = [
  "Scaling & Polishing", "Filling (Composite)", "Filling (Amalgam)", "Root Canal Treatment",
  "Crown (PFM)", "Crown (Zirconia)", "Extraction", "Surgical Extraction", "Implant",
  "Bleaching", "Orthodontic Assessment", "Bridge", "Denture",
  "Gingivectomy", "Flap Surgery", "Curettage", "Other",
];

const ICD_CODES = [
  { code: "K02.9", label: "Dental caries, unspecified" },
  { code: "K04.0", label: "Pulpitis" },
  { code: "K05.3", label: "Chronic periodontitis" },
  { code: "K08.1", label: "Loss of teeth due to disease/accident" },
  { code: "K03.6", label: "Deposits [accretions] on teeth" },
  { code: "K00.6", label: "Disturbances in tooth eruption" },
];

interface TreatmentItem {
  tooth_number: string;
  procedure: string;
  icd_10_code?: string;
  priority: "urgent" | "soon" | "elective";
  cost: number;
  sessions: number;
  status: "planned" | "in_progress" | "completed" | "skipped";
}

interface TreatmentPlanTabProps {
  patientId: string;
  hospitalId: string;
  userId: string | null;
}

const PRIORITY_COLORS = { urgent: "bg-red-500 text-white", soon: "bg-amber-500 text-white", elective: "bg-muted text-muted-foreground" };

const TreatmentPlanTab: React.FC<TreatmentPlanTabProps> = ({ patientId, hospitalId, userId }) => {
  const { toast } = useToast();
  const [items, setItems] = useState<TreatmentItem[]>([]);
  const [consent, setConsent] = useState(false);
  const [planId, setPlanId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TreatmentItem>({
    tooth_number: "", procedure: "", icd_10_code: "", priority: "soon", cost: 0, sessions: 1, status: "planned",
  });

  useEffect(() => { loadPlan(); }, [patientId]);

  const loadPlan = async () => {
    const { data } = await supabase
      .from("dental_treatment_plans")
      .select("*")
      .eq("patient_id", patientId)
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (data && data.length > 0) {
      setPlanId(data[0].id);
      const planItems = data[0].plan_items as any;
      if (Array.isArray(planItems)) setItems(planItems);
      setConsent(data[0].patient_consent || false);
    }
  };

  const addItem = () => {
    if (!form.procedure) return;
    setItems(prev => [...prev, { ...form }]);
    setForm({ tooth_number: "", procedure: "", icd_10_code: "", priority: "soon", cost: 0, sessions: 1, status: "planned" });
    setShowAdd(false);
  };

  const updateItemStatus = async (idx: number, status: TreatmentItem["status"]) => {
    setItems(prev => prev.map((item, i) => i === idx ? { ...item, status } : item));
    if (status === "completed") {
      const item = items[idx];
      toast({ title: `₹${item.cost.toLocaleString("en-IN")} billed to patient account` });

      // Auto-create dental bill
      if (item.cost > 0) {
        const { data: currentPlan } = await supabase
          .from("dental_treatment_plans")
          .select("patient_id, chart_id")
          .eq("id", planId!)
          .maybeSingle();

        const today = new Date().toISOString().split("T")[0];
        const billNum = await generateBillNumber(hospitalId, "DENT");

        const gst = Math.round(Number(item.cost) * 0.18 * 100) / 100;

        const { data: newBill } = await supabase.from("bills").insert({
          hospital_id: hospitalId,
          patient_id: currentPlan?.patient_id,
          bill_number: billNum,
          bill_type: "opd",
          bill_date: today,
          bill_status: "final",
          payment_status: "unpaid",
          total_amount: Number(item.cost) + gst,
          balance_due: Number(item.cost) + gst,
          subtotal: Number(item.cost), gst_amount: gst,
          taxable_amount: Number(item.cost), patient_payable: Number(item.cost) + gst,
        }).select("id").maybeSingle();

        if (newBill) {
          await (supabase as any).from("bill_line_items").insert({
            hospital_id: hospitalId, bill_id: newBill.id,
            item_type: "dental",
            description: `Dental: ${item.procedure} ${item.icd_10_code ? `[${item.icd_10_code}]` : ''} — Tooth ${item.tooth_number}`,
            quantity: 1, unit_rate: Number(item.cost),
            taxable_amount: Number(item.cost), gst_percent: 18,
            gst_amount: gst, total_amount: Number(item.cost) + gst,
            source_module: "dental",
          });

          await recalculateBillTotalsSafe(newBill.id);

          const { data: { user: authUser } } = await supabase.auth.getUser();
          await autoPostJournalEntry({
            triggerEvent: "bill_finalized_dental",
            sourceModule: "dental",
            sourceId: newBill.id,
            amount: Number(item.cost) + gst,
            description: `Dental Revenue - ${item.procedure}`,
            hospitalId,
            postedBy: authUser?.id || "",
          });
        }
      }
    }
  };

  const totalCost = items.reduce((s, i) => s + (i.cost || 0), 0);

  const handleSave = async () => {
    if (!userId) { toast({ title: "Please log in first", variant: "destructive" }); return; }
    setSaving(true);
    try {
      const payload: any = {
        hospital_id: hospitalId,
        patient_id: patientId,
        created_by: userId,
        plan_items: items,
        total_cost: totalCost,
        patient_consent: consent,
        consent_date: consent ? new Date().toISOString().split("T")[0] : null,
        status: items.every(i => i.status === "completed") ? "completed"
          : items.some(i => i.status === "in_progress" || i.status === "completed") ? "partially_done"
            : "active",
      };
      if (planId) {
        const { error } = await supabase.from("dental_treatment_plans").update(payload).eq("id", planId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("dental_treatment_plans").insert(payload);
        if (error) throw error;
      }
      toast({ title: "Treatment plan saved" });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Treatment Plan</h4>
        <Button size="sm" onClick={() => setShowAdd(true)}><Plus size={14} className="mr-1" /> Add Item</Button>
      </div>

      <div className="bg-card rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Tooth</TableHead>
              <TableHead>Procedure</TableHead>
              <TableHead>ICD-10</TableHead>
              <TableHead className="w-20">Priority</TableHead>
              <TableHead className="w-20">Cost ₹</TableHead>
              <TableHead className="w-16">Sessions</TableHead>
              <TableHead className="w-28">Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No items yet. Click "+ Add Item" above.</TableCell></TableRow>
            )}
            {items.map((item, idx) => (
              <TableRow key={idx}>
                <TableCell className="font-mono text-xs">{item.tooth_number || "—"}</TableCell>
                <TableCell className="text-xs">{item.procedure}</TableCell>
                <TableCell className="text-xs font-mono">{item.icd_10_code || "—"}</TableCell>
                <TableCell>
                  <Badge className={`text-[10px] capitalize ${PRIORITY_COLORS[item.priority]}`}>{item.priority}</Badge>
                </TableCell>
                <TableCell className="font-mono text-xs">₹{item.cost.toLocaleString("en-IN")}</TableCell>
                <TableCell className="text-xs text-center">{item.sessions}</TableCell>
                <TableCell>
                  <Select value={item.status} onValueChange={(v) => updateItemStatus(idx, v as TreatmentItem["status"])}>
                    <SelectTrigger className="h-7 text-xs w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="in_progress">In Progress</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="skipped">Skipped</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {items.length > 0 && (
          <div className="border-t px-4 py-2 flex justify-end">
            <span className="text-sm font-semibold">Total: ₹{totalCost.toLocaleString("en-IN")}</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 bg-card rounded-lg border p-3">
        <Switch checked={consent} onCheckedChange={setConsent} />
        <span className="text-sm">Patient consented to treatment plan</span>
        {consent && <Badge variant="outline" className="text-xs">Consented {new Date().toLocaleDateString("en-IN")}</Badge>}
      </div>

      <Button onClick={handleSave} disabled={saving} className="w-full">
        <Save size={16} className="mr-2" />
        {saving ? "Saving..." : "Save Treatment Plan"}
      </Button>

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add Treatment Item</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[14px] text-muted-foreground">Tooth Number</label>
                <Input value={form.tooth_number} onChange={(e) => setForm({ ...form, tooth_number: e.target.value })} placeholder="e.g. 16" />
              </div>
              <div className="flex-1">
                <label className="text-[14px] text-muted-foreground">ICD-10 Code</label>
                <Select value={form.icd_10_code} onValueChange={(v) => setForm({ ...form, icd_10_code: v === "none" ? "" : v })}>
                  <SelectTrigger><SelectValue placeholder="Optional" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {ICD_CODES.map(c => <SelectItem key={c.code} value={c.code}>{c.code} - {c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <label className="text-[14px] text-muted-foreground">Procedure</label>
              <Select value={form.procedure} onValueChange={(v) => setForm({ ...form, procedure: v })}>
                <SelectTrigger><SelectValue placeholder="Select procedure" /></SelectTrigger>
                <SelectContent>
                  {PROCEDURES.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[14px] text-muted-foreground">Priority</label>
                <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v as any })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="urgent">Urgent</SelectItem>
                    <SelectItem value="soon">Soon</SelectItem>
                    <SelectItem value="elective">Elective</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex-1">
                <label className="text-[14px] text-muted-foreground">Cost ₹</label>
                <Input type="number" value={form.cost || ""} onChange={(e) => setForm({ ...form, cost: parseInt(e.target.value) || 0 })} />
              </div>
              <div className="w-20">
                <label className="text-[14px] text-muted-foreground">Sessions</label>
                <Input type="number" min={1} value={form.sessions} onChange={(e) => setForm({ ...form, sessions: parseInt(e.target.value) || 1 })} />
              </div>
            </div>
            <Button onClick={addItem} className="w-full" disabled={!form.procedure}>Add to Plan</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default TreatmentPlanTab;
