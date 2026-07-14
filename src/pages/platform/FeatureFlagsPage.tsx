import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Save, Loader2, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { logAdminAction } from "@/lib/adminAudit";

interface FeatureFlag {
  id: string; key: string; description: string | null;
  is_enabled: boolean; rollout_percentage: number;
}
interface FlagOverride {
  id: string; flag_id: string; hospital_id: string; is_enabled: boolean;
  hospitals: { name: string } | null;
}

const BLANK = { key: "", description: "", is_enabled: false, rollout_percentage: 0 };

async function fetchFlags(): Promise<FeatureFlag[]> {
  const { data } = await (supabase as any).from("platform_feature_flags").select("*").order("key");
  return data || [];
}

export default function FeatureFlagsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [formError, setFormError] = useState<string | null>(null);
  const [managingFlag, setManagingFlag] = useState<FeatureFlag | null>(null);
  const [overrideHospitalId, setOverrideHospitalId] = useState("");
  const [overrideEnabled, setOverrideEnabled] = useState(true);

  const { data: flags = [], isLoading } = useQuery({ queryKey: ["platform-feature-flags"], queryFn: fetchFlags, staleTime: 30_000 });

  const { data: hospitals = [] } = useQuery({
    queryKey: ["platform-hospitals-lite"],
    queryFn: async () => {
      const { data } = await (supabase as any).from("hospitals").select("id, name").eq("is_active", true).is("deleted_at", null).order("name");
      return data || [];
    },
    staleTime: 60_000,
  });

  const { data: overrides = [] } = useQuery({
    queryKey: ["platform-feature-flag-overrides", managingFlag?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("platform_feature_flag_overrides")
        .select("id, flag_id, hospital_id, is_enabled, hospitals(name)")
        .eq("flag_id", managingFlag!.id);
      return data || [];
    },
    enabled: !!managingFlag,
  });

  const create = useMutation({
    mutationFn: async () => {
      await (supabase as any).from("platform_feature_flags").insert([form]);
    },
    onSuccess: () => {
      setFormError(null);
      logAdminAction("feature_flag_created", { details: { key: form.key } });
      toast.success("Flag created");
      setShowForm(false);
      setForm(BLANK);
      qc.invalidateQueries({ queryKey: ["platform-feature-flags"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setFormError(m); toast.error(m); },
  });

  const toggleEnabled = useMutation({
    mutationFn: async ({ id, is_enabled }: { id: string; is_enabled: boolean }) => {
      await (supabase as any).from("platform_feature_flags").update({ is_enabled, updated_at: new Date().toISOString() }).eq("id", id);
    },
    onSuccess: (_r, vars) => {
      logAdminAction(vars.is_enabled ? "feature_flag_enabled" : "feature_flag_disabled", { details: { id: vars.id } });
      qc.invalidateQueries({ queryKey: ["platform-feature-flags"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  const updateRollout = useMutation({
    mutationFn: async ({ id, pct }: { id: string; pct: number }) => {
      await (supabase as any).from("platform_feature_flags").update({ rollout_percentage: pct, updated_at: new Date().toISOString() }).eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-feature-flags"] }),
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  const deleteFlag = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any).from("platform_feature_flags").delete().eq("id", id);
      return id;
    },
    onSuccess: (id: string) => {
      logAdminAction("feature_flag_deleted", { details: { id } });
      toast.success("Flag deleted");
      qc.invalidateQueries({ queryKey: ["platform-feature-flags"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  const addOverride = useMutation({
    mutationFn: async () => {
      if (!managingFlag || !overrideHospitalId) return;
      await (supabase as any).from("platform_feature_flag_overrides").upsert(
        { flag_id: managingFlag.id, hospital_id: overrideHospitalId, is_enabled: overrideEnabled },
        { onConflict: "flag_id,hospital_id" }
      );
    },
    onSuccess: () => {
      logAdminAction("feature_flag_override_set", { hospitalId: overrideHospitalId, details: { flag_key: managingFlag?.key, is_enabled: overrideEnabled } });
      toast.success("Override saved");
      setOverrideHospitalId("");
      qc.invalidateQueries({ queryKey: ["platform-feature-flag-overrides", managingFlag?.id] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  const removeOverride = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any).from("platform_feature_flag_overrides").delete().eq("id", id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-feature-flag-overrides", managingFlag?.id] }),
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">Feature Flags</h1>
          <p className="text-[11px] text-muted-foreground">Staged rollouts for our own releases — not billing/plan gating (that's Plans → module matrix).</p>
        </div>
        <button onClick={() => { setForm(BLANK); setShowForm(true); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors">
          <Plus size={12} /> New Flag
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
              {["Key", "Description", "Enabled", "Rollout %", "", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-xs text-muted-foreground">Loading…</td></tr>
            ) : flags.length === 0 ? (
              <tr><td colSpan={6} className="px-5 py-10 text-center text-xs text-muted-foreground">No flags yet</td></tr>
            ) : flags.map((f) => (
              <tr key={f.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                <td className="px-5 py-3 text-xs font-mono font-bold text-foreground">{f.key}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{f.description || "—"}</td>
                <td className="px-5 py-3">
                  <button onClick={() => toggleEnabled.mutate({ id: f.id, is_enabled: !f.is_enabled })} className="text-muted-foreground hover:text-foreground transition-colors">
                    {f.is_enabled ? <ToggleRight size={18} className="text-emerald-600" /> : <ToggleLeft size={18} />}
                  </button>
                </td>
                <td className="px-5 py-3">
                  <input
                    type="number" min={0} max={100} defaultValue={f.rollout_percentage}
                    onBlur={(e) => {
                      const pct = Math.max(0, Math.min(100, Number(e.target.value)));
                      if (pct !== f.rollout_percentage) updateRollout.mutate({ id: f.id, pct });
                    }}
                    className="w-16 h-7 px-2 text-xs bg-background border border-border rounded text-foreground focus:outline-none focus:border-primary"
                  />
                </td>
                <td className="px-5 py-3">
                  <button onClick={() => setManagingFlag(f)} className="text-xs text-blue-600 hover:text-blue-700">Overrides</button>
                </td>
                <td className="px-5 py-3">
                  <button onClick={() => { if (window.confirm(`Delete flag "${f.key}"?`)) deleteFlag.mutate(f.id); }} className="text-muted-foreground hover:text-red-600 transition-colors">
                    <Trash2 size={13} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[420px] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">New Feature Flag</p>
              <button onClick={() => setShowForm(false)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Key (snake_case, unique)</label>
                <input value={form.key} onChange={(e) => setForm((p) => ({ ...p, key: e.target.value.trim() }))}
                  placeholder="new_billing_ui"
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary font-mono" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Description</label>
                <input value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                  placeholder="What is this gating?"
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                <input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm((p) => ({ ...p, is_enabled: e.target.checked }))} />
                Enabled (master switch — off means nobody sees it regardless of rollout %)
              </label>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <FormError message={formError} />
              <button onClick={() => create.mutate()} disabled={create.isPending || !form.key}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Create Flag
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Overrides drawer */}
      {managingFlag && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[460px] max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <p className="text-sm font-semibold text-foreground font-mono">{managingFlag.key} — overrides</p>
              <button onClick={() => setManagingFlag(null)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              <div className="space-y-2">
                {overrides.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No per-hospital overrides — every hospital follows the rollout %.</p>
                ) : overrides.map((o: FlagOverride) => (
                  <div key={o.id} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                    <span className="text-xs text-foreground">{o.hospitals?.name || o.hospital_id}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${o.is_enabled ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"}`}>
                        {o.is_enabled ? "Forced ON" : "Forced OFF"}
                      </span>
                      <button onClick={() => removeOverride.mutate(o.id)} className="text-muted-foreground hover:text-red-600">
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-border pt-4 space-y-2">
                <p className="text-xs font-semibold text-foreground">Add override</p>
                <select value={overrideHospitalId} onChange={(e) => setOverrideHospitalId(e.target.value)}
                  className="w-full h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                  <option value="">Select hospital…</option>
                  {hospitals.map((h: any) => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
                <select value={overrideEnabled ? "on" : "off"} onChange={(e) => setOverrideEnabled(e.target.value === "on")}
                  className="w-full h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                  <option value="on">Force ON</option>
                  <option value="off">Force OFF</option>
                </select>
                <button onClick={() => addOverride.mutate()} disabled={!overrideHospitalId || addOverride.isPending}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                  {addOverride.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Save Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
