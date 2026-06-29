import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Plus, Pencil, Trash2, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface StoreLocation {
  id: string;
  name: string;
  type: string;
  ward_id: string | null;
  is_active: boolean;
  ward?: { name: string } | null;
}

interface Props {
  hospitalId: string;
}

const TYPE_LABELS: Record<string, string> = {
  central: "🏭 Central Store",
  ward: "🏥 Ward Store",
  ot: "🔪 OT Store",
  icu: "🫀 ICU Store",
  pharmacy: "💊 Pharmacy",
  lab: "🧪 Lab Store",
};

const TYPE_COLORS: Record<string, string> = {
  central: "bg-blue-100 text-blue-700",
  ward: "bg-emerald-100 text-emerald-700",
  ot: "bg-orange-100 text-orange-700",
  icu: "bg-purple-100 text-purple-700",
  pharmacy: "bg-pink-100 text-pink-700",
  lab: "bg-teal-100 text-teal-700",
};

const StoreLocationsSettings: React.FC<Props> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [wards, setWards] = useState<{ id: string; name: string }[]>([]);
  const [editing, setEditing] = useState<Partial<StoreLocation> | null>(null);
  const [saving, setSaving] = useState(false);
  const [creatingDefaults, setCreatingDefaults] = useState(false);

  const fetchStores = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("store_locations")
      .select("*, ward:wards(name)")
      .eq("hospital_id", hospitalId)
      .order("type")
      .order("name");
    setStores(data || []);
  }, [hospitalId]);

  useEffect(() => {
    fetchStores();
    supabase.from("wards").select("id, name").eq("is_active", true).order("name")
      .then(({ data }) => setWards(data || []));
  }, [fetchStores]);

  const save = async () => {
    if (!editing?.name?.trim()) return;
    setSaving(true);
    const payload = {
      hospital_id: hospitalId,
      name: editing.name.trim(),
      type: editing.type || "ward",
      ward_id: editing.ward_id || null,
      is_active: editing.is_active !== false,
    };
    let error: any;
    if (editing.id) {
      ({ error } = await (supabase as any).from("store_locations").update(payload).eq("id", editing.id));
    } else {
      ({ error } = await (supabase as any).from("store_locations").insert(payload));
    }
    setSaving(false);
    if (error) { toast({ title: "Save failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: editing.id ? "Store updated" : "Store created" });
    setEditing(null);
    fetchStores();
  };

  const toggleActive = async (store: StoreLocation) => {
    await (supabase as any).from("store_locations").update({ is_active: !store.is_active }).eq("id", store.id);
    fetchStores();
  };

  const del = async (id: string) => {
    const { error } = await (supabase as any).from("store_locations").delete().eq("id", id);
    if (error) { toast({ title: "Cannot delete — store has linked indents", variant: "destructive" }); return; }
    fetchStores();
  };

  const createDefaults = async () => {
    setCreatingDefaults(true);
    const defaults = [
      { name: "Central Store", type: "central" },
      { name: "OT Store", type: "ot" },
      { name: "ICU Store", type: "icu" },
      { name: "Pharmacy", type: "pharmacy" },
    ];
    const existing = stores.map((s) => s.name.toLowerCase());
    const toCreate = defaults.filter((d) => !existing.includes(d.name.toLowerCase()));
    if (toCreate.length === 0) {
      toast({ title: "Standard stores already exist" });
      setCreatingDefaults(false);
      return;
    }
    await (supabase as any).from("store_locations").insert(
      toCreate.map((d) => ({ ...d, hospital_id: hospitalId, is_active: true }))
    );
    toast({ title: `${toCreate.length} stores created` });
    fetchStores();
    setCreatingDefaults(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-foreground">Store Locations</h3>
          <p className="text-xs text-muted-foreground">Manage Central Store, Ward Stores, OT/ICU sub-stores</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={createDefaults}
            disabled={creatingDefaults}
            className="text-[11px] px-3 py-1.5 rounded-md border border-border bg-muted text-muted-foreground hover:bg-accent transition-colors font-medium"
          >
            {creatingDefaults ? "Creating…" : "✨ Create Standard Stores"}
          </button>
          <button
            onClick={() => setEditing({ type: "ward", is_active: true })}
            className="flex items-center gap-1.5 text-[11px] px-3 py-1.5 rounded-md bg-primary text-white font-semibold hover:bg-primary/90 active:scale-95 transition-all"
          >
            <Plus size={12} /> Add Store
          </button>
        </div>
      </div>

      {/* Store list */}
      <div className="rounded-xl border border-border overflow-hidden">
        {stores.length === 0 ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">No stores configured yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">Click "Create Standard Stores" to get started</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-medium text-muted-foreground">Name</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Type</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Linked Ward</th>
                <th className="text-left px-3 py-2.5 text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {stores.map((store) => (
                <tr key={store.id} className="border-t border-border/60 hover:bg-muted/20">
                  <td className="px-4 py-2.5 font-medium text-foreground">{store.name}</td>
                  <td className="px-3 py-2.5">
                    <span className={cn("text-[10px] px-2 py-0.5 rounded-full font-medium", TYPE_COLORS[store.type] || "bg-muted text-muted-foreground")}>
                      {TYPE_LABELS[store.type] || store.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-xs text-muted-foreground">{store.ward?.name || "—"}</td>
                  <td className="px-3 py-2.5">
                    <button
                      onClick={() => toggleActive(store)}
                      className={cn(
                        "text-[10px] px-2 py-0.5 rounded-full font-medium transition-colors",
                        store.is_active ? "bg-emerald-100 text-emerald-700" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {store.is_active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 justify-end">
                      <button onClick={() => setEditing(store)} className="text-muted-foreground hover:text-primary transition-colors"><Pencil size={13} /></button>
                      <button onClick={() => del(store.id)} className="text-muted-foreground hover:text-destructive transition-colors"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Edit/Add drawer */}
      {editing !== null && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-card rounded-2xl w-full max-w-[440px] shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h3 className="text-sm font-bold">{editing.id ? "Edit Store" : "Add Store Location"}</h3>
              <button onClick={() => setEditing(null)} className="text-muted-foreground hover:text-foreground text-lg">×</button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">Store Name *</label>
                <input
                  autoFocus
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-primary"
                  placeholder="e.g. Ward A Store"
                  value={editing.name || ""}
                  onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">Type</label>
                <select
                  className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  value={editing.type || "ward"}
                  onChange={(e) => setEditing({ ...editing, type: e.target.value })}
                >
                  {Object.entries(TYPE_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              {editing.type === "ward" && (
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Linked Ward (optional)</label>
                  <select
                    className="w-full mt-1 px-3 py-2 text-sm border border-border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    value={editing.ward_id || ""}
                    onChange={(e) => setEditing({ ...editing, ward_id: e.target.value || null })}
                  >
                    <option value="">— Not linked —</option>
                    {wards.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editing.is_active !== false}
                  onChange={(e) => setEditing({ ...editing, is_active: e.target.checked })}
                  className="accent-primary"
                />
                <span className="text-sm text-foreground">Active</span>
              </label>
            </div>
            <div className="flex gap-2 px-5 pb-5 justify-end">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-xs rounded-lg border border-border text-muted-foreground hover:bg-muted transition-colors">Cancel</button>
              <button
                onClick={save}
                disabled={saving || !editing.name?.trim()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-lg bg-primary text-white font-semibold hover:bg-primary/90 active:scale-95 transition-all disabled:opacity-50"
              >
                <CheckCircle2 size={13} />
                {saving ? "Saving…" : "Save Store"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StoreLocationsSettings;
