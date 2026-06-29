import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const CONSENT_TYPES = [
  { value: "treatment", label: "General Treatment" },
  { value: "surgical", label: "Surgical / Procedure" },
  { value: "anaesthesia", label: "Anaesthesia" },
  { value: "transfusion", label: "Blood Transfusion" },
  { value: "hiv", label: "HIV Testing" },
  { value: "lama", label: "LAMA (Against Medical Advice)" },
  { value: "dnr", label: "DNR (Do Not Resuscitate)" },
  { value: "implant", label: "Implant Consent" },
  { value: "research", label: "Research / Clinical Trial" },
  { value: "photography", label: "Photography / Videography" },
];

interface ConsentTemplate {
  id: string;
  name: string;
  consent_type: string;
  content: string | null;
  witness_required: boolean;
  is_active: boolean;
  sort_order: number;
}

const SettingsConsentFormsPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [forms, setForms] = useState<ConsentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", consent_type: "treatment", content: "", witness_required: false });

  useEffect(() => {
    if (hospitalId) loadForms();
  }, [hospitalId]);

  const loadForms = async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("consent_form_templates")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("sort_order", { ascending: true });
    setForms(data || []);
    setLoading(false);
  };

  const openEdit = (f: ConsentTemplate) => {
    setEditId(f.id);
    setForm({ name: f.name, consent_type: f.consent_type, content: f.content || "", witness_required: f.witness_required });
    setShowModal(true);
  };

  const openAdd = () => {
    setEditId(null);
    setForm({ name: "", consent_type: "treatment", content: "", witness_required: false });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !hospitalId) return;
    setSaving(true);
    if (editId) {
      const { error } = await (supabase as any)
        .from("consent_form_templates")
        .update({ name: form.name, consent_type: form.consent_type, content: form.content, witness_required: form.witness_required, updated_at: new Date().toISOString() })
        .eq("id", editId);
      if (error) {
        toast({ title: "Update failed", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    } else {
      const { error } = await (supabase as any)
        .from("consent_form_templates")
        .insert({ hospital_id: hospitalId, name: form.name, consent_type: form.consent_type, content: form.content, witness_required: form.witness_required, sort_order: forms.length });
      if (error) {
        toast({ title: "Save failed", description: error.message, variant: "destructive" });
        setSaving(false);
        return;
      }
    }
    setSaving(false);
    setShowModal(false);
    toast({ title: editId ? "Consent form updated" : "Consent form added" });
    loadForms();
  };

  const toggleActive = async (id: string, current: boolean) => {
    await (supabase as any).from("consent_form_templates").update({ is_active: !current }).eq("id", id);
    setForms(forms.map((f) => f.id === id ? { ...f, is_active: !current } : f));
  };

  const typeLabel = (type: string) => CONSENT_TYPES.find((t) => t.value === type)?.label || type;

  return (
    <SettingsPageWrapper title="Consent Forms" hideSave>
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <p className="text-sm text-muted-foreground">Manage consent form templates used across the hospital. Templates are fetched at admission.</p>
          <Button size="sm" onClick={openAdd} className="gap-1"><Plus size={14} /> Add Consent Form</Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : (
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-muted/50 text-left">
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Form Name</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Type</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Witness</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Active</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
              </tr></thead>
              <tbody>
                {forms.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground text-sm">No consent forms yet. Add your first template.</td></tr>
                )}
                {forms.map((f) => (
                  <tr key={f.id} className="border-t border-border">
                    <td className="px-4 py-2.5 font-medium text-foreground">{f.name}</td>
                    <td className="px-4 py-2.5"><Badge variant="outline">{typeLabel(f.consent_type)}</Badge></td>
                    <td className="px-4 py-2.5 text-muted-foreground">{f.witness_required ? "Yes" : "No"}</td>
                    <td className="px-4 py-2.5"><Switch checked={f.is_active} onCheckedChange={() => toggleActive(f.id, f.is_active)} /></td>
                    <td className="px-4 py-2.5">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(f)}><Pencil size={13} /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Consent Form</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Form Name *</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1" placeholder="e.g. General Consent for Treatment" />
            </div>
            <div>
              <Label>Consent Type</Label>
              <Select value={form.consent_type} onValueChange={(v) => setForm({ ...form, consent_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CONSENT_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Content</Label>
              <Textarea value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} className="mt-1" rows={6} placeholder="Full consent form text..." />
            </div>
            <label className="flex items-center gap-2">
              <Switch checked={form.witness_required} onCheckedChange={(v) => setForm({ ...form, witness_required: v })} />
              <span className="text-sm">Requires witness signature</span>
            </label>
          </div>
          <DialogFooter>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageWrapper>
  );
};

export default SettingsConsentFormsPage;
