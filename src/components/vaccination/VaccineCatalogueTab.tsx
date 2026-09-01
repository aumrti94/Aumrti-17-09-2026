import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Pencil, Trash2, Loader2, Check, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useConfigValues, useConfigLabelMap } from "@/hooks/useConfigValues";

interface Vaccine {
  id: string;
  vaccine_name: string;
  vaccine_code: string;
  type: string | null;
  route: string | null;
  dose_ml: number | null;
  site: string | null;
  storage_temp_c: string | null;
  age_given: string | null;
  is_active: boolean;
}

const BLANK: Omit<Vaccine, "id" | "is_active"> = {
  vaccine_name: "", vaccine_code: "", type: "", route: "", dose_ml: null, site: "", storage_temp_c: "", age_given: "",
};

const TYPES = [
  { value: "live_attenuated", label: "Live Attenuated" },
  { value: "inactivated", label: "Inactivated" },
  { value: "subunit", label: "Subunit" },
  { value: "toxoid", label: "Toxoid" },
  { value: "mrna", label: "mRNA" },
  { value: "conjugate", label: "Conjugate" },
  { value: "viral_vector", label: "Viral Vector" },
  { value: "combination", label: "Combination" },
  { value: "other", label: "Other" },
];

const typeLabel  = (v: string | null) => TYPES.find(t => t.value === v)?.label  ?? v ?? "—";

interface Props { hospitalId: string; }

const VaccineCatalogueTab: React.FC<Props> = ({ hospitalId }) => {
  // Vaccination has its own route vocabulary — intradermal and intranasal are not
  // drug_routes values — see configValueDefaults.ts.
  const routes         = useConfigValues("vaccine_routes");
  const routeLabelMap  = useConfigLabelMap("vaccine_routes");
  const routeLabel     = (v: string | null) => (v ? routeLabelMap[v] ?? v : "—");
  const [vaccines, setVaccines]     = useState<Vaccine[]>([]);
  const [loading, setLoading]       = useState(true);
  const [saving, setSaving]         = useState(false);
  const [showForm, setShowForm]     = useState(false);
  const [editId, setEditId]         = useState<string | null>(null);
  const [form, setForm]             = useState({ ...BLANK });
  const [search, setSearch]         = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await (supabase as any)
      .from("vaccine_master")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("vaccine_name");
    setVaccines(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  const openAdd = () => { setEditId(null); setForm({ ...BLANK }); setShowForm(true); };
  const openEdit = (v: Vaccine) => {
    setEditId(v.id);
    setForm({ vaccine_name: v.vaccine_name, vaccine_code: v.vaccine_code, type: v.type || "", route: v.route || "", dose_ml: v.dose_ml, site: v.site || "", storage_temp_c: v.storage_temp_c || "", age_given: v.age_given || "" });
    setShowForm(true);
  };

  const save = async () => {
    if (!form.vaccine_name.trim() || !form.vaccine_code.trim()) {
      toast.error("Vaccine name and code are required");
      return;
    }
    setSaving(true);
    const payload = {
      hospital_id: hospitalId,
      vaccine_name: form.vaccine_name.trim(),
      vaccine_code: form.vaccine_code.trim().toUpperCase(),
      type: form.type || null,
      route: form.route || null,
      dose_ml: form.dose_ml || null,
      site: form.site || null,
      storage_temp_c: form.storage_temp_c || null,
      age_given: form.age_given || null,
      is_active: true,
    };

    if (editId) {
      const { error } = await (supabase as any).from("vaccine_master").update(payload).eq("id", editId);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Vaccine updated");
    } else {
      const { error } = await (supabase as any).from("vaccine_master").insert(payload);
      if (error) { toast.error(error.message); setSaving(false); return; }
      toast.success("Vaccine added");
    }
    setSaving(false);
    setShowForm(false);
    load();
  };

  const toggleActive = async (v: Vaccine) => {
    await (supabase as any).from("vaccine_master").update({ is_active: !v.is_active }).eq("id", v.id);
    toast.success(v.is_active ? "Vaccine deactivated" : "Vaccine activated");
    load();
  };

  const remove = async (v: Vaccine) => {
    if (!window.confirm(`Delete "${v.vaccine_name}"? This cannot be undone.`)) return;
    const { error } = await (supabase as any).from("vaccine_master").delete().eq("id", v.id);
    if (error) { toast.error(error.message); } else { toast.success("Vaccine deleted"); load(); }
  };

  const filtered = vaccines.filter(v =>
    v.vaccine_name.toLowerCase().includes(search.toLowerCase()) ||
    v.vaccine_code.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col gap-4 py-2">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3">
        <Input
          placeholder="Search vaccines..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 text-sm max-w-xs"
        />
        <Button size="sm" onClick={openAdd} className="gap-1.5 h-8 shrink-0">
          <Plus size={13} /> Add Vaccine
        </Button>
      </div>

      {/* Add / Edit form */}
      {showForm && (
        <div className="border border-border rounded-xl bg-muted/30 p-4">
          <p className="text-[13px] font-semibold mb-3">{editId ? "Edit Vaccine" : "Add New Vaccine"}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground">Vaccine Name *</label>
              <Input value={form.vaccine_name} onChange={e => setForm(f => ({ ...f, vaccine_name: e.target.value }))} placeholder="e.g. BCG" className="h-8 mt-1 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Code *</label>
              <Input value={form.vaccine_code} onChange={e => setForm(f => ({ ...f, vaccine_code: e.target.value }))} placeholder="e.g. BCG" className="h-8 mt-1 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Dose (ml)</label>
              <Input type="number" value={form.dose_ml ?? ""} onChange={e => setForm(f => ({ ...f, dose_ml: e.target.value ? parseFloat(e.target.value) : null }))} placeholder="0.5" className="h-8 mt-1 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Type</label>
              <select value={form.type ?? ""} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full h-8 mt-1 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select…</option>
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Route</label>
              <select value={form.route ?? ""} onChange={e => setForm(f => ({ ...f, route: e.target.value }))} className="w-full h-8 mt-1 text-sm border border-input rounded px-2 bg-background">
                <option value="">Select…</option>
                {routes.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Site</label>
              <Input value={form.site ?? ""} onChange={e => setForm(f => ({ ...f, site: e.target.value }))} placeholder="e.g. Left thigh" className="h-8 mt-1 text-sm" />
            </div>
            <div>
              <label className="text-[11px] text-muted-foreground">Storage Temp (°C)</label>
              <Input value={form.storage_temp_c ?? ""} onChange={e => setForm(f => ({ ...f, storage_temp_c: e.target.value }))} placeholder="2–8°C" className="h-8 mt-1 text-sm" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] text-muted-foreground">Age / Schedule</label>
              <Input value={form.age_given ?? ""} onChange={e => setForm(f => ({ ...f, age_given: e.target.value }))} placeholder="e.g. Birth, 6 weeks, 10 years" className="h-8 mt-1 text-sm" />
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={save} disabled={saving} className="gap-1.5 h-8">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
              {editId ? "Save Changes" : "Add Vaccine"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)} className="gap-1.5 h-8">
              <X size={12} /> Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Vaccine list */}
      {loading ? (
        <div className="flex items-center justify-center py-16"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-2">
          <span className="text-3xl">💉</span>
          <p className="text-sm">{search ? "No vaccines match your search." : "No vaccines added yet. Click \"Add Vaccine\" to begin."}</p>
        </div>
      ) : (
        <div className="border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-[11px] font-semibold uppercase text-muted-foreground">
                <th className="px-3 py-2.5 text-left">Code</th>
                <th className="px-3 py-2.5 text-left">Name</th>
                <th className="px-3 py-2.5 text-left">Type</th>
                <th className="px-3 py-2.5 text-left">Route</th>
                <th className="px-3 py-2.5 text-left">Dose</th>
                <th className="px-3 py-2.5 text-left">Site</th>
                <th className="px-3 py-2.5 text-left">Schedule</th>
                <th className="px-3 py-2.5 text-center">Status</th>
                <th className="px-3 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(v => (
                <tr key={v.id} className={cn("border-t border-border hover:bg-muted/20", !v.is_active && "opacity-50")}>
                  <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{v.vaccine_code}</td>
                  <td className="px-3 py-2 font-medium">{v.vaccine_name}</td>
                  <td className="px-3 py-2 text-muted-foreground">{typeLabel(v.type)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{routeLabel(v.route)}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v.dose_ml ? `${v.dose_ml} ml` : "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v.site || "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">{v.age_given || "—"}</td>
                  <td className="px-3 py-2 text-center">
                    <Badge variant="outline" className={cn("text-[10px] cursor-pointer select-none", v.is_active ? "border-green-300 bg-green-50 text-green-700" : "border-muted text-muted-foreground")} onClick={() => toggleActive(v)}>
                      {v.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(v)}>
                        <Pencil size={12} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remove(v)}>
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">
            {filtered.length} vaccine{filtered.length !== 1 ? "s" : ""} · {vaccines.filter(v => v.is_active).length} active
          </div>
        </div>
      )}
    </div>
  );
};

export default VaccineCatalogueTab;
