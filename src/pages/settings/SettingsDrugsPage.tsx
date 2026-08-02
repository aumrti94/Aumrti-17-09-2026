import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import { ArrowLeft, Plus, Upload, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import BulkDrugImportModal from "@/components/settings/BulkDrugImportModal";

const SettingsDrugsPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hospitalId } = useHospitalId();
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const EMPTY_FORM = { drug_name: "", generic_name: "", category: "", routes: "", schedule_type: "", gst_percent: "12" };
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: drugs, isLoading } = useQuery({
    queryKey: ["settings-drugs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drug_master")
        .select("id, drug_name, generic_name, category, routes, is_active, is_ndps, schedule_type, gst_percent")
        .order("drug_name");
      if (error) throw error;
      return data;
    },
  });

  const openEdit = (d: any) => {
    setEditingId(d.id);
    setForm({
      drug_name: d.drug_name, generic_name: d.generic_name || "", category: d.category || "",
      routes: d.routes?.join(", ") || "", schedule_type: d.schedule_type || "",
      gst_percent: d.gst_percent != null ? String(d.gst_percent) : "12",
    });
    setShowForm(true);
  };

  const closeForm = () => { setShowForm(false); setEditingId(null); setForm(EMPTY_FORM); };

  const saveDrug = useMutation({
    mutationFn: async () => {
      if (!form.drug_name.trim()) throw new Error("Drug name is required.");
      const { data: me } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
      if (!me) throw new Error("No hospital context");
      // Duplicate check: same drug_name (case-insensitive) for this hospital, excluding self when editing
      let dupeQuery = (supabase as any)
        .from("drug_master")
        .select("id")
        .eq("hospital_id", me.hospital_id)
        .ilike("drug_name", form.drug_name.trim());
      if (editingId) dupeQuery = dupeQuery.neq("id", editingId);
      const { data: existing } = await dupeQuery.maybeSingle();
      if (existing) throw new Error(`"${form.drug_name.trim()}" already exists in the drug master.`);
      const isNdps = form.schedule_type === "X";
      const gstPercent = form.gst_percent !== "" ? Number(form.gst_percent) : 12;
      const payload = {
        drug_name: form.drug_name.trim(),
        generic_name: form.generic_name || null,
        category: form.category || null,
        routes: form.routes ? form.routes.split(",").map((r) => r.trim()) : null,
        schedule_type: form.schedule_type || null,
        is_ndps: isNdps,
        gst_percent: gstPercent,
      };
      if (editingId) {
        const { error } = await (supabase as any).from("drug_master").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("drug_master").insert({ hospital_id: me.hospital_id, ...payload });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: editingId ? "Drug updated" : "Drug added" });
      qc.invalidateQueries({ queryKey: ["settings-drugs"] });
      closeForm();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden">
      <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground active:scale-95"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Drug Master</h1>
            <p className="text-xs text-muted-foreground">{drugs?.length ?? 0} drugs</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowBulkImport(true)} className="flex items-center gap-1.5 border border-border bg-background text-foreground px-4 py-2 rounded-lg text-sm font-medium hover:bg-muted active:scale-[0.97]">
            <Upload size={14} /> Bulk Import
          </button>
          <button onClick={() => (showForm ? closeForm() : setShowForm(true))} className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97]">
            {showForm ? <X size={14} /> : <Plus size={14} />} {showForm ? "Cancel" : "Add Drug"}
          </button>
        </div>
      </div>

      {showForm && (
        <div className="flex-shrink-0 px-6 py-4 border-b border-border bg-muted/30">
          <div className="flex items-end gap-3 flex-wrap">
            <div className="flex-1 min-w-[160px]">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Drug Name *</label>
              <Input value={form.drug_name} onChange={(e) => setForm({ ...form, drug_name: e.target.value })} placeholder="Paracetamol 500mg" className="h-9" />
            </div>
            <div className="flex-1 min-w-[160px]">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Generic Name</label>
              <Input value={form.generic_name} onChange={(e) => setForm({ ...form, generic_name: e.target.value })} placeholder="Acetaminophen" className="h-9" />
            </div>
            <div className="w-32">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Category</label>
              <Input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Analgesic" className="h-9" />
            </div>
            <div className="w-40">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Routes (comma sep)</label>
              <Input value={form.routes} onChange={(e) => setForm({ ...form, routes: e.target.value })} placeholder="oral, IV" className="h-9" />
            </div>
            <div className="w-32">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Drug Schedule</label>
              <select value={form.schedule_type} onChange={(e) => setForm({ ...form, schedule_type: e.target.value })}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm">
                <option value="">None / OTC</option>
                <option value="G">Schedule G</option>
                <option value="H">Schedule H</option>
                <option value="H1">Schedule H1</option>
                <option value="X">Schedule X (Narcotic)</option>
                <option value="OTC">OTC</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className="w-24">
              <label className="text-[11px] font-medium text-muted-foreground mb-1 block">GST %</label>
              <Input type="number" min={0} max={100} step="0.01" value={form.gst_percent} onChange={(e) => setForm({ ...form, gst_percent: e.target.value })} placeholder="12" className="h-9" />
            </div>
            <button onClick={() => saveDrug.mutate()} disabled={!form.drug_name || saveDrug.isPending} className="bg-primary text-primary-foreground px-4 h-9 rounded-md text-sm font-medium disabled:opacity-40 active:scale-[0.97]">
              {saveDrug.isPending ? "Saving..." : editingId ? "Update" : "Save"}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            This is the drug's default GST rate. Each batch received via Receive Stock can still carry its own rate (e.g. from the vendor invoice).
          </p>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm">
            <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
              <th className="px-6 py-2.5 font-medium">Drug Name</th>
              <th className="px-4 py-2.5 font-medium">Generic</th>
              <th className="px-4 py-2.5 font-medium">Category</th>
              <th className="px-4 py-2.5 font-medium">Routes</th>
              <th className="px-4 py-2.5 font-medium">Schedule</th>
              <th className="px-4 py-2.5 font-medium">NDPS</th>
              <th className="px-4 py-2.5 font-medium text-right">GST %</th>
              <th className="px-4 py-2.5 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">Loading...</td></tr>}
            {drugs?.map((d: any) => (
              <tr key={d.id} className="border-b border-border/50 hover:bg-muted/20">
                <td className="px-6 py-3 font-medium text-foreground">{d.drug_name}</td>
                <td className="px-4 py-3 text-muted-foreground">{d.generic_name || "—"}</td>
                <td className="px-4 py-3"><span className="text-[11px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">{d.category || "—"}</span></td>
                <td className="px-4 py-3 text-muted-foreground text-xs">{d.routes?.join(", ") || "—"}</td>
                <td className="px-4 py-3">
                  {d.schedule_type ? (
                    <span className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                      d.schedule_type === "X" ? "bg-red-100 text-red-700 border-red-300" :
                      d.schedule_type === "H1" ? "bg-orange-100 text-orange-700 border-orange-300" :
                      d.schedule_type === "H" ? "bg-amber-100 text-amber-700 border-amber-300" :
                      d.schedule_type === "G" ? "bg-yellow-50 text-yellow-700 border-yellow-200" :
                      "bg-muted text-muted-foreground border-border"}`}>
                      Sch {d.schedule_type}{d.schedule_type === "H" || d.schedule_type === "H1" ? " ⚠ Rx Required" : d.schedule_type === "X" ? " 🔒 NDPS" : ""}
                    </span>
                  ) : <span className="text-[11px] text-muted-foreground">OTC</span>}
                </td>
                <td className="px-4 py-3">{d.is_ndps ? <Badge variant="destructive" className="text-[10px]">NDPS / Controlled</Badge> : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">{d.gst_percent != null ? `${d.gst_percent}%` : "—"}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => openEdit(d)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">Edit</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hospitalId && (
        <BulkDrugImportModal
          open={showBulkImport}
          onClose={() => setShowBulkImport(false)}
          hospitalId={hospitalId}
        />
      )}
    </div>
  );
};

export default SettingsDrugsPage;
