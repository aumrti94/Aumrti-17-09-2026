import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { CheckCircle2, AlertTriangle, AlertOctagon } from "lucide-react";
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
  id: string; incident_id: string; message: string; status: Incident["status"]; created_at: string;
}

const STATUS_LABEL: Record<Incident["status"], string> = {
  investigating: "Investigating", identified: "Identified", monitoring: "Monitoring", resolved: "Resolved",
};

async function fetchStatusData() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
  const [incRes, updRes] = await Promise.all([
    (supabase as any).from("platform_incidents").select("*").gte("started_at", thirtyDaysAgo).order("started_at", { ascending: false }),
    (supabase as any).from("platform_incident_updates").select("*").order("created_at", { ascending: false }),
  ]);
  const incidents: Incident[] = incRes.data || [];
  const updatesByIncident = new Map<string, IncidentUpdate[]>();
  for (const u of (updRes.data || []) as IncidentUpdate[]) {
    if (!updatesByIncident.has(u.incident_id)) updatesByIncident.set(u.incident_id, []);
    updatesByIncident.get(u.incident_id)!.push(u);
  }
  return { incidents, updatesByIncident };
}

const PublicStatusPage: React.FC = () => {
  const { data, isLoading } = useQuery({ queryKey: ["public-status"], queryFn: fetchStatusData, staleTime: 30_000 });

  const incidents = data?.incidents || [];
  const openIncidents = incidents.filter((i) => i.status !== "resolved");
  const isDegraded = openIncidents.some((i) => i.severity === "major" || i.severity === "critical");
  const isMinorIssue = openIncidents.length > 0 && !isDegraded;

  return (
    <div className="min-h-screen bg-muted/20 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold text-foreground">Aumrti System Status</h1>
        </div>

        {!isLoading && (
          <div
            className={cn(
              "rounded-2xl border p-5 flex items-center gap-3",
              openIncidents.length === 0
                ? "bg-green-50 border-green-200"
                : isDegraded
                ? "bg-red-50 border-red-200"
                : "bg-amber-50 border-amber-200"
            )}
          >
            {openIncidents.length === 0 ? (
              <CheckCircle2 className="text-green-600 shrink-0" size={28} />
            ) : isDegraded ? (
              <AlertOctagon className="text-red-600 shrink-0" size={28} />
            ) : (
              <AlertTriangle className="text-amber-600 shrink-0" size={28} />
            )}
            <div>
              <p className={cn("text-sm font-bold", openIncidents.length === 0 ? "text-green-800" : isDegraded ? "text-red-800" : "text-amber-800")}>
                {openIncidents.length === 0 ? "All systems operational" : isDegraded ? "Major service disruption" : "Minor issue reported"}
              </p>
              {openIncidents.length > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {openIncidents.length} active incident{openIncidents.length > 1 ? "s" : ""}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="space-y-3">
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Incident history (last 30 days)</h2>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No incidents in the last 30 days.</p>
          ) : (
            incidents.map((inc) => {
              const updates = (data?.updatesByIncident.get(inc.id) || []).slice().reverse();
              return (
                <div key={inc.id} className="bg-card border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-foreground">{inc.title}</p>
                    <span
                      className={cn(
                        "text-[10px] font-medium px-2 py-0.5 rounded-full",
                        inc.status === "resolved" ? "bg-emerald-500/15 text-emerald-600" : "bg-red-500/15 text-red-600"
                      )}
                    >
                      {STATUS_LABEL[inc.status]}
                    </span>
                  </div>
                  {inc.affected_services.length > 0 && (
                    <p className="text-xs text-muted-foreground">Affected: {inc.affected_services.join(", ")}</p>
                  )}
                  <div className="space-y-1.5 pt-1">
                    {updates.map((u) => (
                      <div key={u.id} className="text-xs text-foreground/80 flex gap-2">
                        <span className="text-muted-foreground shrink-0">{format(new Date(u.created_at), "dd MMM, HH:mm")}</span>
                        <span>{u.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default PublicStatusPage;
