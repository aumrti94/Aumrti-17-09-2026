import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from '@/hooks/useHospitalId';

const CATEGORIES = ["diagnostic","therapeutic","monitoring","laboratory","surgical","ot_equipment","it_equipment","utility","radiation","other"];

interface Props { open: boolean; onClose: () => void; onSaved: () => void; }

const AddEquipmentModal: React.FC<Props> = ({ open, onClose, onSaved }) => {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [departments, setDepartments] = useState<any[]>([]);
  const [form, setForm] = useState({
    equipment_name: "", equipment_code: "", category: "diagnostic", make: "", model: "",
    serial_number: "", department_id: "", location: "", purchase_date: "", purchase_cost: "",
    warranty_expiry: "", warranty_vendor: "", amc_vendor: "", amc_start: "", amc_expiry: "",
    amc_cost: "", aerb_license_no: "", aerb_expiry: "", notes: "",
  });

  useEffect(() => {
    const genCode = async () => {
      // Find max existing code number to avoid duplicates
      const { data: existing } = await supabase.from("equipment_master").select("equipment_code").eq("hospital_id", hospitalId).like("equipment_code", `EQ-${new Date().getFullYear()}-%`);
      const maxSeq = (existing || []).reduce((max, e) => {
        const parts = e.equipment_code?.split("-");
        const num = parts?.length === 3 ? parseInt(parts[2], 10) : 0;
        return num > max ? num : max;
      }, 0);
      const seq = String(maxSeq + 1).padStart(3, "0");
      setForm((f) => ({ ...f, equipment_code: `EQ-${new Date().getFullYear()}-${seq}` }));
    };
    const loadDepts = async () => {
      const { data } = await supabase.from("departments").select("id, name").eq("hospital_id", hospitalId).eq("is_active", true).order("name", { ascending: true });
      setDepartments(data || []);
    };
    if (open && hospitalId) { genCode(); loadDepts(); }
  }, [open, hospitalId]);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.equipment_name || !form.make || !form.model) {
      toast({ title: "Name, Make and Model are required", variant: "destructive" }); return;
    }
    setSaving(true);
    const row: any = {
      hospital_id: hospitalId, equipment_name: form.equipment_name, equipment_code: form.equipment_code,
      category: form.category, make: form.make, model: form.model,
      serial_number: form.serial_number || null, department_id: form.department_id || null,
      location: form.location || null, purchase_date: form.purchase_date || null,
      purchase_cost: form.purchase_cost ? Number(form.purchase_cost) : null,
      warranty_expiry: form.warranty_expiry || null, warranty_vendor: form.warranty_vendor || null,
      amc_vendor: form.amc_vendor || null, amc_start: form.amc_start || null,
      amc_expiry: form.amc_expiry || null, amc_cost: form.amc_cost ? Number(form.amc_cost) : null,
      aerb_license_no: form.aerb_license_no || null, aerb_expiry: form.aerb_expiry || null,
      notes: form.notes || null,
    };
    const { error } = await supabase.from("equipment_master").insert(row);
    setSaving(false);
    if (error) { toast({ title: "Error", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Equipment added" }); onSaved(); onClose();
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add Equipment</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Equipment Name *</Label><Input value={form.equipment_name} onChange={(e) => set("equipment_name", e.target.value)} /></div>
            <div><Label>Code</Label><Input value={form.equipment_code} readOnly className="bg-muted" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Category *</Label>
              <Select value={form.category} onValueChange={(v) => set("category", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Make *</Label><Input value={form.make} onChange={(e) => set("make", e.target.value)} /></div>
            <div><Label>Model *</Label><Input value={form.model} onChange={(e) => set("model", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Serial Number</Label><Input value={form.serial_number} onChange={(e) => set("serial_number", e.target.value)} /></div>
            <div><Label>Department</Label>
              <Select value={form.department_id || undefined} onValueChange={(v) => set("department_id", v)}>
                <SelectTrigger><SelectValue placeholder="Select..." /></SelectTrigger>
                <SelectContent>{departments.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Location</Label><Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. ICU Bed 3" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Purchase Date</Label><Input type="date" value={form.purchase_date} onChange={(e) => set("purchase_date", e.target.value)} /></div>
            <div><Label>Purchase Cost (₹)</Label><Input type="number" value={form.purchase_cost} onChange={(e) => set("purchase_cost", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Warranty Expiry</Label><Input type="date" value={form.warranty_expiry} onChange={(e) => set("warranty_expiry", e.target.value)} /></div>
            <div><Label>Warranty Vendor</Label><Input value={form.warranty_vendor} onChange={(e) => set("warranty_vendor", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>AMC Vendor</Label><Input value={form.amc_vendor} onChange={(e) => set("amc_vendor", e.target.value)} /></div>
            <div><Label>AMC Cost (₹)</Label><Input type="number" value={form.amc_cost} onChange={(e) => set("amc_cost", e.target.value)} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>AMC Start</Label><Input type="date" value={form.amc_start} onChange={(e) => set("amc_start", e.target.value)} /></div>
            <div><Label>AMC Expiry</Label><Input type="date" value={form.amc_expiry} onChange={(e) => set("amc_expiry", e.target.value)} /></div>
          </div>
          {form.category === "radiation" && (
            <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <div><Label>AERB License No</Label><Input value={form.aerb_license_no} onChange={(e) => set("aerb_license_no", e.target.value)} /></div>
              <div><Label>AERB Expiry</Label><Input type="date" value={form.aerb_expiry} onChange={(e) => set("aerb_expiry", e.target.value)} /></div>
            </div>
          )}
          <div><Label>Notes</Label><Textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={2} /></div>
          <Button onClick={handleSave} disabled={saving} className="w-full">{saving ? "Saving..." : "Save Equipment"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default AddEquipmentModal;
