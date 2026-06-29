import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, X, Building2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const PAYER_TYPES = [
  { value: "cash", label: "Cash" },
  { value: "credit", label: "Credit / Deferred" },
  { value: "corporate", label: "Corporate" },
  { value: "tpa", label: "TPA / Insurance" },
  { value: "pmjay", label: "PMJAY / Ayushman" },
  { value: "cghs", label: "CGHS" },
  { value: "esi", label: "ESI" },
  { value: "state_scheme", label: "State Scheme" },
  { value: "other", label: "Other" },
];

const PAYER_BADGE: Record<string, string> = {
  cash: "bg-slate-100 text-slate-600",
  credit: "bg-slate-600 text-white",
  corporate: "bg-blue-600 text-white",
  tpa: "bg-purple-600 text-white",
  pmjay: "bg-green-600 text-white",
  cghs: "bg-teal-600 text-white",
  esi: "bg-orange-600 text-white",
  state_scheme: "bg-indigo-600 text-white",
  other: "bg-zinc-500 text-white",
};

interface PayerMaster {
  id: string;
  payer_type: string;
  payer_name: string;
  contact_person: string | null;
  contact_phone: string | null;
  credit_limit: number | null;
  payment_terms_days: number | null;
  tariff_class: string | null;
  is_active: boolean;
}

const emptyForm = {
  payer_type: "tpa",
  payer_name: "",
  contact_person: "",
  contact_phone: "",
  credit_limit: "",
  payment_terms_days: "30",
  tariff_class: "standard",
};

const SettingsPayerMastersPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [filterType, setFilterType] = useState("all");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });

  const getHospitalId = async () => {
    const { data } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    if (!data) throw new Error("No hospital context");
    return data.hospital_id;
  };

  const { data: payers, isLoading } = useQuery({
    queryKey: ["settings-payer-masters"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("payer_masters")
        .select("id, payer_type, payer_name, contact_person, contact_phone, credit_limit, payment_terms_days, tariff_class, is_active")
        .order("payer_type").order("payer_name");
      if (error) throw error;
      return (data ?? []) as PayerMaster[];
    },
  });

  const savePayer = useMutation({
    mutationFn: async () => {
      const hid = await getHospitalId();
      const payload = {
        payer_type: form.payer_type,
        payer_name: form.payer_name.trim(),
        contact_person: form.contact_person.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        credit_limit: form.credit_limit ? parseFloat(form.credit_limit) : null,
        payment_terms_days: form.payment_terms_days ? parseInt(form.payment_terms_days) : 30,
        tariff_class: form.tariff_class.trim() || "standard",
        is_active: true,
      };
      if (editingId) {
        const { error } = await (supabase as any).from("payer_masters").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("payer_masters").insert({ ...payload, hospital_id: hid });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: `Payer ${editingId ? "updated" : "added"}` });
      qc.invalidateQueries({ queryKey: ["settings-payer-masters"] });
      closeDrawer();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }: { id: string; active: boolean }) => {
      const { error } = await (supabase as any).from("payer_masters").update({ is_active: active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings-payer-masters"] }),
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const openDrawer = (payer?: PayerMaster) => {
    if (payer) {
      setEditingId(payer.id);
      setForm({
        payer_type: payer.payer_type,
        payer_name: payer.payer_name,
        contact_person: payer.contact_person || "",
        contact_phone: payer.contact_phone || "",
        credit_limit: payer.credit_limit != null ? String(payer.credit_limit) : "",
        payment_terms_days: payer.payment_terms_days != null ? String(payer.payment_terms_days) : "30",
        tariff_class: payer.tariff_class || "standard",
      });
    } else {
      setEditingId(null);
      setForm({ ...emptyForm });
    }
    setDrawerOpen(true);
  };

  const closeDrawer = () => { setDrawerOpen(false); setEditingId(null); };

  const filtered = (payers ?? []).filter((p) => filterType === "all" || p.payer_type === filterType);

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden relative">
      {/* HEADER */}
      <div className="flex-shrink-0 px-6 py-3 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground active:scale-95"><ArrowLeft size={18} /></button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Payer Masters</h1>
            <p className="text-xs text-muted-foreground">Settings › Payer Masters</p>
          </div>
        </div>
        <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 active:scale-[0.97]">
          <Plus size={14} /> Add Payer
        </button>
      </div>

      {/* TYPE FILTER */}
      <div className="flex-shrink-0 px-6 py-2.5 border-b border-border flex gap-1.5 overflow-x-auto">
        <button onClick={() => setFilterType("all")}
          className={cn("px-4 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors active:scale-[0.97]",
            filterType === "all" ? "bg-[hsl(222,55%,23%)] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
          All
        </button>
        {PAYER_TYPES.filter(pt => pt.value !== "cash").map((pt) => (
          <button key={pt.value} onClick={() => setFilterType(pt.value)}
            className={cn("px-4 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors active:scale-[0.97]",
              filterType === pt.value ? "bg-[hsl(222,55%,23%)] text-white" : "bg-muted text-muted-foreground hover:bg-muted/80")}>
            {pt.label}
          </button>
        ))}
      </div>

      {/* TABLE */}
      <div className="flex-1 overflow-y-auto">
        {!isLoading && filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center"><Building2 size={24} className="text-muted-foreground" /></div>
            <p className="text-sm font-medium text-foreground">No payers configured</p>
            <p className="text-xs text-muted-foreground">Add TPAs, corporate accounts, and scheme names here</p>
            <button onClick={() => openDrawer()} className="flex items-center gap-1.5 bg-[hsl(222,55%,23%)] text-white px-4 py-2 rounded-lg text-sm font-medium active:scale-[0.97]">
              <Plus size={14} /> Add First Payer
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted/50 backdrop-blur-sm z-10">
              <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                <th className="px-6 py-2.5 font-medium">Payer Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Tariff Class</th>
                <th className="px-4 py-2.5 font-medium">Contact</th>
                <th className="px-4 py-2.5 font-medium text-right">Credit Limit (₹)</th>
                <th className="px-4 py-2.5 font-medium">Terms</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && <tr><td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">Loading...</td></tr>}
              {filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-muted/20">
                  <td className="px-6 py-3 font-medium text-foreground">{p.payer_name}</td>
                  <td className="px-4 py-3">
                    <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-bold capitalize", PAYER_BADGE[p.payer_type] || "bg-muted text-muted-foreground")}>
                      {PAYER_TYPES.find(t => t.value === p.payer_type)?.label || p.payer_type}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{p.tariff_class || "standard"}</td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-foreground">{p.contact_person || "—"}</div>
                    <div className="text-[11px] text-muted-foreground">{p.contact_phone || ""}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-sm">
                    {p.credit_limit != null ? `₹${Number(p.credit_limit).toLocaleString("en-IN")}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground text-xs">
                    {p.payment_terms_days != null ? `${p.payment_terms_days} days` : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleActive.mutate({ id: p.id, active: !p.is_active })}
                      className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors",
                        p.is_active ? "bg-green-100 text-green-700 hover:bg-green-200" : "bg-muted text-muted-foreground hover:bg-muted/80")}
                    >
                      {p.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openDrawer(p)} className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-muted">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* DRAWER */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/20 z-40" onClick={closeDrawer} />
          <div className="fixed right-0 top-0 bottom-0 w-[400px] bg-card border-l border-border z-50 flex flex-col shadow-xl animate-in slide-in-from-right duration-200">
            <div className="flex-shrink-0 px-6 py-4 border-b border-border flex items-center justify-between">
              <h2 className="text-lg font-bold text-foreground">{editingId ? "Edit Payer" : "Add Payer"}</h2>
              <button onClick={closeDrawer} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Payer Type *</label>
                <select value={form.payer_type} onChange={(e) => setForm({ ...form, payer_type: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
                  {PAYER_TYPES.filter(pt => pt.value !== "cash").map((pt) => (
                    <option key={pt.value} value={pt.value}>{pt.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Payer Name *</label>
                <Input value={form.payer_name} onChange={(e) => setForm({ ...form, payer_name: e.target.value })} placeholder="e.g., Star Health Insurance, Tata Motors" className="h-10" />
              </div>
              <div>
                <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Tariff Class</label>
                <Input value={form.tariff_class} onChange={(e) => setForm({ ...form, tariff_class: e.target.value })} placeholder="standard / premium / scheme" className="h-10" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Contact Person</label>
                  <Input value={form.contact_person} onChange={(e) => setForm({ ...form, contact_person: e.target.value })} placeholder="TPA coordinator" className="h-10" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Contact Phone</label>
                  <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder="9XXXXXXXXX" className="h-10" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Credit Limit (₹)</label>
                  <Input type="number" value={form.credit_limit} onChange={(e) => setForm({ ...form, credit_limit: e.target.value })} placeholder="500000" className="h-10" />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-muted-foreground mb-1 block">Payment Terms (days)</label>
                  <Input type="number" value={form.payment_terms_days} onChange={(e) => setForm({ ...form, payment_terms_days: e.target.value })} placeholder="30" className="h-10" />
                </div>
              </div>
            </div>
            <div className="flex-shrink-0 px-6 py-4 border-t border-border flex gap-3">
              <button onClick={closeDrawer} className="flex-1 h-11 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted active:scale-[0.98]">Cancel</button>
              <button onClick={() => savePayer.mutate()} disabled={!form.payer_name.trim() || savePayer.isPending}
                className="flex-[2] h-11 rounded-lg bg-[hsl(222,55%,23%)] text-white text-sm font-semibold hover:opacity-90 active:scale-[0.97] disabled:opacity-40">
                {savePayer.isPending ? "Saving..." : "Save Payer"}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default SettingsPayerMastersPage;
