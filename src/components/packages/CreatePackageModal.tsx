import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { useHospitalId } from '@/hooks/useHospitalId';


interface Props { open: boolean; onClose: () => void; }

interface Component { name: string; type: string; estimated_mins: number; sequence: number; }

export default function CreatePackageModal({ open, onClose }: Props) {
  const { hospitalId } = useHospitalId();
  const [form, setForm] = useState({
    package_name: "", package_code: "", package_type: "basic",
    description: "", target_gender: "both", min_age: "",
    max_age: "", price: "", estimated_hours: "",
  });
  const [components, setComponents] = useState<Component[]>([]);
  const [saving, setSaving] = useState(false);

  const addComponent = () => {
    setComponents([...components, { name: "", type: "lab_test", estimated_mins: 15, sequence: components.length + 1 }]);
  };

  const updateComponent = (idx: number, field: string, value: any) => {
    setComponents(components.map((c, i) => i === idx ? { ...c, [field]: value } : c));
  };

  const removeComponent = (idx: number) => {
    setComponents(components.filter((_, i) => i !== idx).map((c, i) => ({ ...c, sequence: i + 1 })));
  };

  const save = async () => {
    if (!form.package_name || !form.package_code || !form.price) {
      toast.error("Name, code, and price are required");
      return;
    }
    setSaving(true);
    const totalMins = components.reduce((s, c) => s + (c.estimated_mins || 0), 0);
    const { error } = await supabase.from("health_packages").insert([{
      hospital_id: hospitalId,
      package_name: form.package_name,
      package_code: form.package_code,
      package_type: form.package_type,
      description: form.description || null,
      target_gender: form.target_gender,
      min_age: form.min_age ? +form.min_age : null,
      max_age: form.max_age ? +form.max_age : null,
      price: +form.price,
      estimated_hours: form.estimated_hours ? +form.estimated_hours : totalMins > 0 ? +(totalMins / 60).toFixed(1) : null,
      components: components as any,
      total_components: components.length,
    }]);
    setSaving(false);
    if (error) { toast.error("Failed: " + error.message); return; }
    toast.success("Package created");
    onClose();
  };

  const types = ["basic", "essential", "comprehensive", "executive", "senior_citizen", "pre_marital", "corporate", "custom"];
  const compTypes = [
    { value: "lab_test", label: "Lab Test" },
    { value: "consultation", label: "Consultation" },
    { value: "radiology", label: "Radiology" },
    { value: "service", label: "Service (ECG, PFT etc.)" },
  ];

  return (
    <Dialog open={open} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Health Package</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Package Name *</Label><Input value={form.package_name} onChange={(e) => setForm({ ...form, package_name: e.target.value })} /></div>
            <div><Label>Code *</Label><Input value={form.package_code} onChange={(e) => setForm({ ...form, package_code: e.target.value })} placeholder="PKG-CUSTOM" /></div>
            <div>
              <Label>Type</Label>
              <Select value={form.package_type} onValueChange={(v) => setForm({ ...form, package_type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{types.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Gender</Label>
              <Select value={form.target_gender} onValueChange={(v) => setForm({ ...form, target_gender: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>Price (₹) *</Label><Input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            <div><Label>Estimated Hours</Label><Input type="number" step="0.5" value={form.estimated_hours} onChange={(e) => setForm({ ...form, estimated_hours: e.target.value })} /></div>
            <div><Label>Min Age</Label><Input type="number" value={form.min_age} onChange={(e) => setForm({ ...form, min_age: e.target.value })} /></div>
            <div><Label>Max Age</Label><Input type="number" value={form.max_age} onChange={(e) => setForm({ ...form, max_age: e.target.value })} /></div>
          </div>
          <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} /></div>

          {/* Components */}
          <div className="border rounded-lg p-3 space-y-3">
            <div className="flex items-center justify-between">
              <Label className="font-semibold">Components ({components.length})</Label>
              <Button size="sm" variant="outline" onClick={addComponent}><Plus className="h-3 w-3 mr-1" /> Add Component</Button>
            </div>
            {components.map((c, i) => (
              <div key={i} className="flex items-center gap-2 bg-muted/50 rounded p-2">
                <span className="text-xs font-mono w-6 text-center">{c.sequence}</span>
                <Input className="flex-1" placeholder="Component name" value={c.name} onChange={(e) => updateComponent(i, "name", e.target.value)} />
                <Select value={c.type} onValueChange={(v) => updateComponent(i, "type", v)}>
                  <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
                  <SelectContent>{compTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
                <Input className="w-16" type="number" value={c.estimated_mins} onChange={(e) => updateComponent(i, "estimated_mins", +e.target.value)} />
                <span className="text-xs text-muted-foreground">min</span>
                <Button size="icon" variant="ghost" onClick={() => removeComponent(i)}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Creating..." : "Create Package"}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
