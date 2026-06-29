import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus } from "lucide-react";

const WORK_TYPES = [
  { value: "crown", label: "Crown" },
  { value: "bridge", label: "Bridge" },
  { value: "rpd", label: "Removable Partial Denture" },
  { value: "fpd", label: "Fixed Partial Denture" },
  { value: "complete_denture", label: "Complete Denture" },
  { value: "orthodontic_appliance", label: "Orthodontic Appliance" },
  { value: "night_guard", label: "Night Guard" },
  { value: "bleaching_tray", label: "Bleaching Tray" },
  { value: "implant_crown", label: "Implant Crown" },
  { value: "inlay_onlay", label: "Inlay/Onlay" },
];

const STATUS_COLORS: Record<string, string> = {
  ordered: "bg-blue-100 text-blue-800",
  in_lab: "bg-amber-100 text-amber-800",
  ready: "bg-green-100 text-green-800",
  delivered: "bg-muted text-muted-foreground",
  returned_for_correction: "bg-red-100 text-red-800",
  cancelled: "bg-muted text-muted-foreground line-through",
};

interface LabOrdersTabProps {
  patientId: string;
  hospitalId: string;
  userId: string | null;
}

const LabOrdersTab: React.FC<LabOrdersTabProps> = ({ patientId, hospitalId, userId }) => {
  const { toast } = useToast();
  const [orders, setOrders] = useState<any[]>([]);
  const [showNew, setShowNew] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    work_type: "", tooth_numbers: "", lab_name: "", material: "", shade: "",
    expected_date: "", cost: 0, notes: "",
  });

  useEffect(() => { loadOrders(); }, [patientId]);

  const loadOrders = async () => {
    const { data, error } = await supabase
      .from("dental_lab_orders")
      .select("*")
      .eq("patient_id", patientId)
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false });
    if (error) { console.error(error); return; }
    setOrders(data || []);
  };

  const handleSubmit = async () => {
    if (!form.work_type || !userId) {
      if (!userId) toast({ title: "Please log in first", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase.from("dental_lab_orders").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        ordered_by: userId,
        work_type: form.work_type,
        tooth_numbers: form.tooth_numbers || "N/A",
        lab_name: form.lab_name || null,
        material: form.material || null,
        shade: form.shade || null,
        expected_date: form.expected_date || null,
        cost: form.cost || null,
        notes: form.notes || null,
        order_date: new Date().toISOString().split("T")[0],
        status: "ordered",
      });
      if (error) throw error;
      toast({ title: "Lab order placed" });
      setShowNew(false);
      setForm({ work_type: "", tooth_numbers: "", lab_name: "", material: "", shade: "", expected_date: "", cost: 0, notes: "" });
      loadOrders();
    } catch (err: any) {
      toast({ title: "Failed to place order", description: err.message, variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    const { error } = await supabase.from("dental_lab_orders").update({ status }).eq("id", id);
    if (error) { toast({ title: "Update failed", variant: "destructive" }); return; }
    if (status === "ready") toast({ title: "Lab work ready — remind patient to book fitting" });
    loadOrders();
  };

  return (
    <div className="space-y-4 overflow-y-auto" style={{ maxHeight: "calc(100vh - 240px)" }}>
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Lab Orders</h4>
        <Button size="sm" onClick={() => setShowNew(true)}><Plus size={14} className="mr-1" /> New Lab Order</Button>
      </div>

      <div className="bg-card rounded-lg border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Work Type</TableHead>
              <TableHead>Tooth</TableHead>
              <TableHead>Lab</TableHead>
              <TableHead>Material</TableHead>
              <TableHead>Ordered</TableHead>
              <TableHead>Expected</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-28">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.length === 0 && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground py-8">No lab orders yet</TableCell></TableRow>
            )}
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="text-xs capitalize">{o.work_type?.replace(/_/g, " ")}</TableCell>
                <TableCell className="font-mono text-xs">{o.tooth_numbers || "—"}</TableCell>
                <TableCell className="text-xs">{o.lab_name || "—"}</TableCell>
                <TableCell className="text-xs">{o.material || "—"}</TableCell>
                <TableCell className="text-xs">{o.order_date ? new Date(o.order_date).toLocaleDateString("en-IN") : "—"}</TableCell>
                <TableCell className="text-xs">{o.expected_date ? new Date(o.expected_date).toLocaleDateString("en-IN") : "—"}</TableCell>
                <TableCell>
                  <Badge className={`text-[10px] ${STATUS_COLORS[o.status] || ""}`}>{o.status?.replace(/_/g, " ")}</Badge>
                </TableCell>
                <TableCell>
                  {o.status === "ordered" && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => updateStatus(o.id, "in_lab")}>In Lab</Button>
                  )}
                  {o.status === "in_lab" && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => updateStatus(o.id, "ready")}>Ready</Button>
                  )}
                  {o.status === "ready" && (
                    <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => updateStatus(o.id, "delivered")}>Delivered</Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={showNew} onOpenChange={setShowNew}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Lab Order</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-muted-foreground">Work Type</label>
              <Select value={form.work_type} onValueChange={(v) => setForm({ ...form, work_type: v })}>
                <SelectTrigger><SelectValue placeholder="Select work type" /></SelectTrigger>
                <SelectContent>
                  {WORK_TYPES.map(w => <SelectItem key={w.value} value={w.value}>{w.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Tooth Numbers</label>
                <Input value={form.tooth_numbers} onChange={(e) => setForm({ ...form, tooth_numbers: e.target.value })} placeholder="e.g. 16 crown" />
              </div>
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Lab Name</label>
                <Input value={form.lab_name} onChange={(e) => setForm({ ...form, lab_name: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Material</label>
                <Input value={form.material} onChange={(e) => setForm({ ...form, material: e.target.value })} />
              </div>
              <div className="w-24">
                <label className="text-xs text-muted-foreground">Shade</label>
                <Input value={form.shade} onChange={(e) => setForm({ ...form, shade: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-xs text-muted-foreground">Expected Date</label>
                <Input type="date" value={form.expected_date} onChange={(e) => setForm({ ...form, expected_date: e.target.value })} />
              </div>
              <div className="w-28">
                <label className="text-xs text-muted-foreground">Cost ₹</label>
                <Input type="number" value={form.cost || ""} onChange={(e) => setForm({ ...form, cost: parseInt(e.target.value) || 0 })} />
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Special Instructions</label>
              <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
            </div>
            <Button onClick={handleSubmit} disabled={submitting || !form.work_type} className="w-full">
              {submitting ? "Ordering..." : "Place Order"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default LabOrdersTab;
