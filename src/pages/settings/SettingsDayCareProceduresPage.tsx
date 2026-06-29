import React, { useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Plus, Search, Trash2, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useHospitalId } from "@/hooks/useHospitalId";

interface Procedure {
  id: string;
  procedure_name: string;
  procedure_code: string | null;
  specialty: string | null;
  duration_minutes: number;
  standard_rate: number;
  pmjay_code: string | null;
  pre_auth_required: boolean;
  is_active: boolean;
}

const SPECIALTIES = [
  "General Surgery", "Orthopaedics", "Ophthalmology", "ENT", "Gynaecology",
  "Urology", "Cardiology", "Gastroenterology", "Dermatology", "Oncology",
  "Neurology", "Paediatrics", "Dental", "Plastic Surgery", "Other",
];

const emptyForm = {
  procedure_name: "",
  procedure_code: "",
  specialty: "",
  duration_minutes: "60",
  standard_rate: "0",
  pmjay_code: "",
  pre_auth_required: true,
};

const SettingsDayCareProceduresPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: procedures = [], isLoading } = useQuery({
    queryKey: ["settings-day-care-procedures", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return [];
      const { data, error } = await (supabase as any)
        .from("day_care_procedures")
        .select("id, procedure_name, procedure_code, specialty, duration_minutes, standard_rate, pmjay_code, pre_auth_required, is_active")
        .eq("hospital_id", hospitalId)
        .order("procedure_name");
      if (error) throw error;
      return (data || []) as Procedure[];
    },
    enabled: !!hospitalId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["settings-day-care-procedures"] });

  const addMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("day_care_procedures").insert({
        hospital_id: hospitalId!,
        procedure_name: form.procedure_name.trim(),
        procedure_code: form.procedure_code.trim() || null,
        specialty: form.specialty || null,
        duration_minutes: Number(form.duration_minutes) || 60,
        standard_rate: Number(form.standard_rate) || 0,
        pmjay_code: form.pmjay_code.trim() || null,
        pre_auth_required: form.pre_auth_required,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setShowAdd(false);
      setForm(emptyForm);
      toast({ title: "Procedure added" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("day_care_procedures").update({
        procedure_name: form.procedure_name.trim(),
        procedure_code: form.procedure_code.trim() || null,
        specialty: form.specialty || null,
        duration_minutes: Number(form.duration_minutes) || 60,
        standard_rate: Number(form.standard_rate) || 0,
        pmjay_code: form.pmjay_code.trim() || null,
        pre_auth_required: form.pre_auth_required,
      }).eq("id", editingId!);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      toast({ title: "Procedure updated" });
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  const toggleActive = async (id: string, active: boolean) => {
    const { error } = await (supabase as any).from("day_care_procedures").update({ is_active: active }).eq("id", id);
    if (error) { toast({ title: "Update failed", variant: "destructive" }); return; }
    invalidate();
  };

  const deleteProcedure = async (id: string) => {
    const { error } = await (supabase as any).from("day_care_procedures").delete().eq("id", id);
    if (error) { toast({ title: "Delete failed", variant: "destructive" }); return; }
    invalidate();
    toast({ title: "Procedure deleted" });
  };

  const openEdit = (p: Procedure) => {
    setForm({
      procedure_name: p.procedure_name,
      procedure_code: p.procedure_code || "",
      specialty: p.specialty || "",
      duration_minutes: String(p.duration_minutes),
      standard_rate: String(p.standard_rate),
      pmjay_code: p.pmjay_code || "",
      pre_auth_required: p.pre_auth_required,
    });
    setEditingId(p.id);
  };

  const filtered = procedures.filter(p => {
    const q = search.toLowerCase();
    return !q || p.procedure_name.toLowerCase().includes(q) ||
      (p.procedure_code || "").toLowerCase().includes(q) ||
      (p.specialty || "").toLowerCase().includes(q);
  });

  return (
    <SettingsPageWrapper title="Day Care Procedures" hideSave>
      <div className="space-y-4">
        <div className="flex gap-3 items-center">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search procedures..." className="pl-9 h-9" />
          </div>
          <Button size="sm" onClick={() => { setForm(emptyForm); setShowAdd(true); }} className="gap-1">
            <Plus size={14} /> Add Procedure
          </Button>
        </div>

        <p className="text-xs text-muted-foreground">{filtered.length} procedure{filtered.length !== 1 ? "s" : ""}</p>

        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Procedure</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-28">Code</th>
                <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-32">Specialty</th>
                <th className="px-3 py-2.5 text-right text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-24">Rate (₹)</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-20">Mins</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-20">Pre-Auth</th>
                <th className="px-3 py-2.5 text-center text-[11px] font-semibold text-muted-foreground uppercase tracking-wide w-16">Active</th>
                <th className="px-3 py-2.5 w-16" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">Loading...</td></tr>
              )}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center text-sm text-muted-foreground">No procedures yet. Click <strong>+ Add Procedure</strong> to create one.</td></tr>
              )}
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5">
                    <button onClick={() => openEdit(p)} className="text-left hover:text-primary font-medium transition-colors">
                      {p.procedure_name}
                    </button>
                  </td>
                  <td className="px-3 py-2.5 font-mono text-[12px] text-muted-foreground">{p.procedure_code || "—"}</td>
                  <td className="px-3 py-2.5 text-[12px] text-muted-foreground">{p.specialty || "—"}</td>
                  <td className="px-3 py-2.5 text-right font-mono">₹{Number(p.standard_rate).toLocaleString("en-IN")}</td>
                  <td className="px-3 py-2.5 text-center text-[12px] text-muted-foreground">{p.duration_minutes}</td>
                  <td className="px-3 py-2.5 text-center">
                    {p.pre_auth_required
                      ? <span className="inline-flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-full"><ShieldCheck size={10} />Yes</span>
                      : <span className="text-[11px] text-muted-foreground">No</span>}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    <Switch checked={p.is_active} onCheckedChange={v => toggleActive(p.id, v)} />
                  </td>
                  <td className="px-3 py-2.5">
                    <button onClick={() => deleteProcedure(p.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Dialog */}
      <Dialog open={showAdd || !!editingId} onOpenChange={o => { if (!o) { setShowAdd(false); setEditingId(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Procedure" : "Add Day Care Procedure"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Procedure Name *</Label>
              <Input value={form.procedure_name} onChange={e => setForm(f => ({ ...f, procedure_name: e.target.value }))} placeholder="e.g. Cataract Surgery (Phaco)" className="mt-1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Procedure Code</Label>
                <Input value={form.procedure_code} onChange={e => setForm(f => ({ ...f, procedure_code: e.target.value }))} placeholder="e.g. DC-001" className="mt-1" />
              </div>
              <div>
                <Label>PMJAY Code</Label>
                <Input value={form.pmjay_code} onChange={e => setForm(f => ({ ...f, pmjay_code: e.target.value }))} placeholder="e.g. P-001" className="mt-1" />
              </div>
            </div>
            <div>
              <Label>Specialty</Label>
              <select
                value={form.specialty}
                onChange={e => setForm(f => ({ ...f, specialty: e.target.value }))}
                className="mt-1 w-full text-sm bg-background border border-input rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-ring"
              >
                <option value="">— Select specialty —</option>
                {SPECIALTIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Standard Rate (₹) *</Label>
                <Input type="number" value={form.standard_rate} onChange={e => setForm(f => ({ ...f, standard_rate: e.target.value }))} className="mt-1" />
              </div>
              <div>
                <Label>Duration (minutes)</Label>
                <Input type="number" value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: e.target.value }))} className="mt-1" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={form.pre_auth_required} onCheckedChange={v => setForm(f => ({ ...f, pre_auth_required: v }))} id="pre-auth" />
              <Label htmlFor="pre-auth" className="cursor-pointer">Insurance Pre-Authorisation Required</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setShowAdd(false); setEditingId(null); }}>Cancel</Button>
            <Button
              onClick={() => editingId ? updateMutation.mutate() : addMutation.mutate()}
              disabled={!form.procedure_name.trim() || addMutation.isPending || updateMutation.isPending}
            >
              {addMutation.isPending || updateMutation.isPending ? "Saving..." : editingId ? "Save Changes" : "Add Procedure"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageWrapper>
  );
};

export default SettingsDayCareProceduresPage;
