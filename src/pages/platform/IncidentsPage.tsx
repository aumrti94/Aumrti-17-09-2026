import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Save, Loader2, AlertTriangle, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

interface Incident {
  id: string; title: string;
  severity: "minor" | "major" | "critical";
  status: "investigating" | "identified" | "monitoring" | "resolved";
  affected_services: string[];
  started_at: string; resolved_at: string | null;
}

interface IncidentUpdate {
  id: string; incident_id: string; message: string;
  status: Incident["status"]; created_at: string;
}

const SEVERITY_STYLE: Record<Incident["severity"], string> = {
  minor: "bg-amber-500/15 text-amber-600",
  major: "bg-orange-500/15 text-orange-600",
  critical: "bg-red-500/15 text-red-600",
};
const STATUS_STYLE: Record<Incident["status"], string> = {
  investigating: "bg-red-500/15 text-red-600",
  identified: "bg-amber-500/15 text-amber-600",
  monitoring: "bg-blue-500/15 text-blue-600",
  resolved: "bg-emerald-500/15 text-emerald-600",
};

const BLANK: { title: string; severity: Incident["severity"]; affected_services: string; message: string } = {
  title: "", severity: "minor", affected_services: "", message: "",
};

async function fetchIncidents(): Promise<Incident[]> {
  const { data } = await (supabase as any).from("platform_incidents").select("*").order("started_at", { ascending: false });
  return data || [];
}

async function fetchUpdates(incidentId: string): Promise<IncidentUpdate[]> {
  const { data } = await (supabase as any).from("platform_incident_updates")
    .select("*").eq("incident_id", incidentId).order("created_at", { ascending: false });
  return data || [];
}

export default function IncidentsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [formError, setFormError] = useState<string | null>(null);
  const [openIncident, setOpenIncident] = useState<Incident | null>(null);
  const [updateMsg, setUpdateMsg] = useState("");
  const [updateStatus, setUpdateStatus] = useState<Incident["status"]>("investigating");

  const { data = [], isLoading } = useQuery({ queryKey: ["platform-incidents"], queryFn: fetchIncidents, staleTime: 30_000 });
  const { data: updates = [] } = useQuery({
    queryKey: ["platform-incident-updates", openIncident?.id],
    queryFn: () => fetchUpdates(openIncident!.id),
    enabled: !!openIncident,
  });

  const create = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const services = form.affected_services.split(",").map((s) => s.trim()).filter(Boolean);
      const { data: incident, error } = await (supabase as any).from("platform_incidents").insert({
        title: form.title, severity: form.severity, affected_services: services,
        status: "investigating", created_by: user?.id,
      }).select("id").maybeSingle();
      if (error) throw error;
      if (!incident) throw new Error("Incident was not created — no row returned.");
      if (form.message.trim()) {
        await (supabase as any).from("platform_incident_updates").insert({
          incident_id: incident.id, message: form.message, status: "investigating", created_by: user?.id,
        });
      }
    },
    onSuccess: () => {
      setFormError(null);
      toast.success("Incident opened");
      setShowForm(false);
      setForm(BLANK);
      qc.invalidateQueries({ queryKey: ["platform-incidents"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setFormError(m); toast.error(m); },
  });

  const postUpdate = useMutation({
    mutationFn: async () => {
      if (!openIncident) return;
      const { data: { user } } = await supabase.auth.getUser();
      await (supabase as any).from("platform_incident_updates").insert({
        incident_id: openIncident.id, message: updateMsg, status: updateStatus, created_by: user?.id,
      });
      await (supabase as any).from("platform_incidents").update({
        status: updateStatus,
        updated_at: new Date().toISOString(),
        resolved_at: updateStatus === "resolved" ? new Date().toISOString() : null,
      }).eq("id", openIncident.id);
    },
    onSuccess: () => {
      toast.success("Update posted");
      setUpdateMsg("");
      qc.invalidateQueries({ queryKey: ["platform-incidents"] });
      qc.invalidateQueries({ queryKey: ["platform-incident-updates", openIncident?.id] });
      setOpenIncident(null);
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">Incidents</h1>
          <p className="text-[11px] text-muted-foreground">Public status page: <a href="/status" target="_blank" rel="noreferrer" className="text-primary inline-flex items-center gap-1">/status <ExternalLink size={10} /></a></p>
        </div>
        <button onClick={() => { setForm(BLANK); setShowForm(true); }}
          className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors">
          <Plus size={12} /> Open Incident
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
              {["Title", "Severity", "Status", "Affected", "Started", "Resolved", ""].map((h) => (
                <th key={h} className="px-5 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-xs text-muted-foreground">Loading…</td></tr>
            ) : data.length === 0 ? (
              <tr><td colSpan={7} className="px-5 py-10 text-center text-xs text-muted-foreground">No incidents — all systems operational</td></tr>
            ) : data.map((inc) => (
              <tr key={inc.id} className="border-t border-border hover:bg-muted/40 transition-colors cursor-pointer" onClick={() => { setOpenIncident(inc); setUpdateStatus(inc.status); }}>
                <td className="px-5 py-3 text-xs font-medium text-foreground">{inc.title}</td>
                <td className="px-5 py-3"><span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", SEVERITY_STYLE[inc.severity])}>{inc.severity}</span></td>
                <td className="px-5 py-3"><span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", STATUS_STYLE[inc.status])}>{inc.status}</span></td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{inc.affected_services.join(", ") || "—"}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(inc.started_at), "dd MMM, HH:mm")}</td>
                <td className="px-5 py-3 text-xs text-muted-foreground">{inc.resolved_at ? format(new Date(inc.resolved_at), "dd MMM, HH:mm") : "—"}</td>
                <td className="px-5 py-3"><span className="text-xs text-blue-600">Manage</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[440px] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Open Incident</p>
              <button onClick={() => setShowForm(false)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs text-muted-foreground">Title</label>
                <input value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  placeholder="e.g. Billing service degraded"
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Severity</label>
                <select value={form.severity} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value as Incident["severity"] }))}
                  className="w-full mt-1 h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                  <option value="minor">Minor</option>
                  <option value="major">Major</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Affected Services (comma-separated)</label>
                <input value={form.affected_services} onChange={(e) => setForm((p) => ({ ...p, affected_services: e.target.value }))}
                  placeholder="Billing, OPD"
                  className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Initial Update (shown on the public status page)</label>
                <textarea value={form.message} onChange={(e) => setForm((p) => ({ ...p, message: e.target.value }))}
                  placeholder="We're investigating reports of..."
                  className="w-full mt-1 h-16 px-3 py-2 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none" />
              </div>
            </div>
            <div className="px-5 pb-5 space-y-3">
              <FormError message={formError} />
              <button onClick={() => create.mutate()} disabled={create.isPending || !form.title.trim()}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                {create.isPending ? <Loader2 size={14} className="animate-spin" /> : <AlertTriangle size={14} />}
                Open Incident
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manage / post-update drawer */}
      {openIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[480px] max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
              <p className="text-sm font-semibold text-foreground">{openIncident.title}</p>
              <button onClick={() => setOpenIncident(null)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>
            <div className="flex-1 overflow-auto p-5 space-y-4">
              <div className="space-y-2">
                {updates.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No updates posted yet.</p>
                ) : updates.map((u) => (
                  <div key={u.id} className="border-l-2 border-border pl-3">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-[10px] font-medium px-2 py-0.5 rounded-full", STATUS_STYLE[u.status])}>{u.status}</span>
                      <span className="text-[10px] text-muted-foreground">{format(new Date(u.created_at), "dd MMM, HH:mm")}</span>
                    </div>
                    <p className="text-xs text-foreground mt-1">{u.message}</p>
                  </div>
                ))}
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <p className="text-xs font-semibold text-foreground">Post an update</p>
                <select value={updateStatus} onChange={(e) => setUpdateStatus(e.target.value as Incident["status"])}
                  className="w-full h-8 px-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary">
                  <option value="investigating">Investigating</option>
                  <option value="identified">Identified</option>
                  <option value="monitoring">Monitoring</option>
                  <option value="resolved">Resolved</option>
                </select>
                <textarea value={updateMsg} onChange={(e) => setUpdateMsg(e.target.value)}
                  placeholder="What's the latest?"
                  className="w-full h-16 px-3 py-2 text-xs bg-background border border-border rounded-lg text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary resize-none" />
                <button onClick={() => postUpdate.mutate()} disabled={postUpdate.isPending || !updateMsg.trim()}
                  className="w-full flex items-center justify-center gap-2 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50">
                  {postUpdate.isPending ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                  Post Update
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
