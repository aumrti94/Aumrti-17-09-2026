import React, { useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Plus, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const defaultProtocols = [
  { id: "1", name: "Sepsis Bundle", category: "Critical Care", desc: "Hour-1 sepsis bundle protocol", steps: ["Measure lactate", "Blood cultures before antibiotics", "Broad-spectrum antibiotics", "30ml/kg crystalloid for hypotension", "Vasopressors if MAP <65"], active: true },
  { id: "2", name: "Code Blue", category: "Emergency", desc: "Cardiac arrest response protocol", steps: ["Activate code blue team", "Begin CPR", "Attach defibrillator", "Establish IV access", "Document timeline"], active: true },
  { id: "3", name: "Fall Prevention", category: "Patient Safety", desc: "Inpatient fall risk protocol", steps: ["Assess Morse Fall Scale", "Apply fall risk band", "Bed rails up", "Non-slip footwear", "Hourly rounding"], active: true },
  { id: "4", name: "Blood Transfusion", category: "Clinical", desc: "Safe blood transfusion protocol", steps: ["Verify crossmatch", "Two-nurse verification", "Start at 2ml/min for 15 min", "Monitor vitals q15 for first hour", "Document reaction if any"], active: true },
  { id: "5", name: "Medication Error Response", category: "Patient Safety", desc: "Steps after medication error discovery", steps: ["Assess patient impact", "Notify treating doctor", "Administer corrective treatment", "File incident report", "Root cause analysis"], active: true },
];

const SettingsProtocolsPage: React.FC = () => {
  const { toast } = useToast();
  const [protocols, setProtocols] = useState(defaultProtocols);
  const [showPanel, setShowPanel] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", category: "", desc: "", steps: [""] });

  const openEdit = (p: typeof defaultProtocols[0]) => {
    setEditId(p.id);
    setForm({ name: p.name, category: p.category, desc: p.desc, steps: [...p.steps] });
    setShowPanel(true);
  };

  const handleSave = () => {
    if (editId) {
      setProtocols(protocols.map((p) => p.id === editId ? { ...p, ...form } : p));
    } else {
      setProtocols([...protocols, { id: Date.now().toString(), ...form, active: true }]);
    }
    setShowPanel(false);
    setEditId(null);
    toast({ title: "Protocol saved" });
  };

  return (
    <SettingsPageWrapper title="Clinical Protocols" hideSave>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">Standard treatment protocols and emergency procedures.</p>
          <Button size="sm" onClick={() => { setEditId(null); setForm({ name: "", category: "", desc: "", steps: [""] }); setShowPanel(true); }} className="gap-1"><Plus size={14} /> Add Protocol</Button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Protocol Name</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Category</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Steps</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Active</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
            </tr></thead>
            <tbody>
              {protocols.map((p) => (
                <tr key={p.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium text-foreground">{p.name}</td>
                  <td className="px-4 py-2.5"><Badge variant="outline">{p.category}</Badge></td>
                  <td className="px-4 py-2.5 text-muted-foreground">{p.steps.length} steps</td>
                  <td className="px-4 py-2.5"><Switch checked={p.active} onCheckedChange={(v) => setProtocols(protocols.map((x) => x.id === p.id ? { ...x, active: v } : x))} /></td>
                  <td className="px-4 py-2.5"><Button variant="ghost" size="sm" onClick={() => openEdit(p)}>View/Edit</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Sheet open={showPanel} onOpenChange={setShowPanel}>
        <SheetContent className="w-[420px] overflow-y-auto">
          <SheetHeader><SheetTitle>{editId ? "Edit" : "Add"} Protocol</SheetTitle></SheetHeader>
          <div className="space-y-4 mt-4">
            <div><Label>Name *</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" /></div>
            <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="mt-1" /></div>
            <div><Label>Description</Label><Textarea value={form.desc} onChange={(e) => setForm({ ...form, desc: e.target.value })} className="mt-1" rows={2} /></div>
            <div>
              <Label>Steps</Label>
              {form.steps.map((s, i) => (
                <div key={i} className="flex gap-2 mt-1.5">
                  <span className="text-xs text-muted-foreground mt-2.5 w-5">{i + 1}.</span>
                  <Input value={s} onChange={(e) => { const n = [...form.steps]; n[i] = e.target.value; setForm({ ...form, steps: n }); }} className="flex-1" />
                  <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}><Trash2 size={13} /></Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="mt-2 gap-1" onClick={() => setForm({ ...form, steps: [...form.steps, ""] })}><Plus size={12} /> Add Step</Button>
            </div>
            <Button onClick={handleSave} className="w-full">Save Protocol</Button>
          </div>
        </SheetContent>
      </Sheet>
    </SettingsPageWrapper>
  );
};

export default SettingsProtocolsPage;
