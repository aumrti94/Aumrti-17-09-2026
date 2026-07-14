import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Save, Loader2, Trash2, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { logAdminAction } from "@/lib/adminAudit";

interface CadenceRule {
  id: string;
  day_offset: number;
  attempt_number: number;
  channel: "email" | "sms" | "whatsapp";
  is_active: boolean;
}

const BLANK = { day_offset: 1, attempt_number: 1, channel: "email" as CadenceRule["channel"] };

async function fetchCadence(): Promise<CadenceRule[]> {
  const { data } = await (supabase as any)
    .from("dunning_cadence_rules")
    .select("*")
    .order("day_offset")
    .order("attempt_number");
  return data || [];
}

export default function AutomationRulesPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [formError, setFormError] = useState<string | null>(null);

  const { data = [], isLoading } = useQuery({ queryKey: ["dunning-cadence"], queryFn: fetchCadence, staleTime: 30_000 });

  const create = useMutation({
    mutationFn: async () => {
      await (supabase as any).from("dunning_cadence_rules").insert([form]);
    },
    onSuccess: () => {
      setFormError(null);
      logAdminAction("dunning_cadence_rule_added", { details: form });
      toast.success("Cadence step added");
      setShowForm(false);
      setForm(BLANK);
      qc.invalidateQueries({ queryKey: ["dunning-cadence"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setFormError(m); toast.error(m); },
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      await (supabase as any).from("dunning_cadence_rules").update({ is_active, updated_at: new Date().toISOString() }).eq("id", id);
    },
    onSuccess: (_r, vars) => {
      logAdminAction(vars.is_active ? "dunning_cadence_rule_enabled" : "dunning_cadence_rule_disabled", { details: { id: vars.id } });
      qc.invalidateQueries({ queryKey: ["dunning-cadence"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any).from("dunning_cadence_rules").delete().eq("id", id);
      return id;
    },
    onSuccess: (id: string) => {
      logAdminAction("dunning_cadence_rule_deleted", { details: { id } });
      toast.success("Cadence step removed");
      qc.invalidateQueries({ queryKey: ["dunning-cadence"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">Automation Rules</h1>
          <p className="text-[11px] text-muted-foreground">Dunning cadence — was hardcoded in the function, now admin-editable.</p>
        </div>
        <button onClick={() => { setForm(BLANK); setShowForm(true); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors">
          <Plus size={12} /> Add Cadence Step
        </button>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="bg-card border border-border rounded-xl overflow-hidden max-w-2xl">
          <table className="w-full text-sm">
            <thead className="bg-muted/40">
              <tr className="text-[10px] uppercase font-bold text-muted-foreground">
                {["Day Past-Due", "Attempt #", "Channel", "Active", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs text-muted-foreground">Loading…</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={5} className="px-5 py-10 text-center text-xs text-muted-foreground">No cadence steps configured — dunning-processor will do nothing.</td></tr>
              ) : data.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-muted/40 transition-colors">
                  <td className="px-5 py-3 text-xs font-mono text-foreground">Day {r.day_offset}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground font-mono">#{r.attempt_number}</td>
                  <td className="px-5 py-3 text-xs text-muted-foreground capitalize">{r.channel}</td>
                  <td className="px-5 py-3">
                    <button onClick={() => toggleActive.mutate({ id: r.id, is_active: !r.is_active })} className="text-muted-foreground hover:text-foreground transition-colors">
                      {r.is_active ? <ToggleRight size={18} className="text-emerald-600" /> : <ToggleLeft size={18} />}
                    </button>
                  </td>
                  <td className="px-5 py-3">
                    <button onClick={() => { if (window.confirm("Remove this cadence step?")) remove.mutate(r.id); }} className="text-muted-foreground hover:text-red-600 transition-colors">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[380px] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Add Cadence Step</p>
              <button onClick={() => setShowForm(false)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Day Past-Due</label>
                <input type="number" min={1} value={form.day_offset}
                  onChange={(e) => setForm((p) => ({ ...p, day_offset: Number(e.target.value) }))}
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Attempt Number</label>
                <input type="number" min={1} value={form.attempt_number}
                  onChange={(e) => setForm((p) => ({ ...p, attempt_number: Number(e.target.value) }))}
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Channel</label>
                <select value={form.channel} onChange={(e) => setForm((p) => ({ ...p, channel: e.target.value as CadenceRule["channel"] }))}
                  className="w-full mt-1 h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                  <option value="email">Email</option>
                  <option value="sms">SMS</option>
                  <option value="whatsapp">WhatsApp</option>
                </select>
              </div>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <FormError message={formError} />
              <button onClick={() => create.mutate()} disabled={create.isPending}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Add Step
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
