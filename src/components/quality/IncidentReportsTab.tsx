import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";

interface Incident {
  id: string;
  incident_number: string;
  incident_date: string;
  incident_time: string | null;
  incident_type: string;
  severity: string;
  description: string;
  immediate_action: string | null;
  status: string;
  department_id: string | null;
  patient_id: string | null;
  capa_id: string | null;
  created_at: string;
}

const severityColors: Record<string, string> = {
  minor: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  moderate: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  major: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  sentinel: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

const statusSteps = ["open", "under_review", "capa_raised", "closed"];
const statusLabels: Record<string, string> = {
  open: "Reported",
  under_review: "Under Review",
  capa_raised: "CAPA Raised",
  closed: "Closed",
};

interface Props {
  onFileIncident: () => void;
}

const IncidentReportsTab: React.FC<Props> = ({ onFileIncident }) => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    loadIncidents();
  }, []);

  const loadIncidents = async () => {
    const { data } = await supabase
      .from("incident_reports")
      .select("*")
      .order("incident_date", { ascending: false });
    setIncidents((data as any) || []);
    setLoading(false);
  };

  const filtered = useMemo(() => {
    let list = incidents;
    if (statusFilter !== "all") list = list.filter((i) => i.status === statusFilter);
    if (severityFilter) list = list.filter((i) => i.severity === severityFilter);
    return list;
  }, [incidents, statusFilter, severityFilter]);

  const selected = incidents.find((i) => i.id === selectedId) || null;

  const handleCloseIncident = async () => {
    if (!selected) return;
    await supabase.from("incident_reports").update({ status: "closed" }).eq("id", selected.id);
    loadIncidents();
  };

  const handleStatusChange = async (newStatus: string) => {
    if (!selected) return;
    await supabase.from("incident_reports").update({ status: newStatus }).eq("id", selected.id);
    loadIncidents();
  };

  if (loading) {
    return <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* LEFT: Incident List */}
      <div className="w-[320px] border-r border-border flex flex-col bg-card">
        {/* Status filter tabs */}
        <div className="flex border-b border-border px-2 pt-2 gap-1">
          {["all", "open", "under_review", "closed"].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={cn(
                "text-[10px] px-2.5 py-1.5 rounded-t font-medium transition-colors",
                statusFilter === s
                  ? "bg-primary/10 text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {s === "all" ? "All" : s === "under_review" ? "Under Review" : s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>

        {/* Severity filter */}
        <div className="flex gap-1 px-3 py-2 border-b border-border">
          {["sentinel", "major", "moderate", "minor"].map((s) => (
            <button
              key={s}
              onClick={() => setSeverityFilter(severityFilter === s ? null : s)}
              className={cn(
                "text-[9px] px-2 py-1 rounded-full border transition-colors capitalize",
                severityFilter === s
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground border-border hover:bg-muted/80"
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Incident cards */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((inc) => {
            const isCritical = inc.severity === "sentinel" || inc.severity === "major";
            return (
              <button
                key={inc.id}
                onClick={() => setSelectedId(inc.id)}
                className={cn(
                  "w-full text-left px-3 py-2.5 border-b border-border transition-colors",
                  selectedId === inc.id ? "bg-primary/5" : "hover:bg-muted/30",
                  isCritical && "border-l-[3px] border-l-destructive"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-[10px] font-mono font-semibold text-foreground">{inc.incident_number}</span>
                  <span className="text-[9px] text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(inc.created_at), { addSuffix: true })}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mb-1">
                  <Badge variant="secondary" className="text-[8px] px-1.5 py-0">{inc.incident_type.replace(/_/g, " ")}</Badge>
                  <Badge variant="secondary" className={`text-[8px] px-1.5 py-0 ${severityColors[inc.severity]}`}>{inc.severity}</Badge>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-2">{inc.description}</p>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground">{new Date(inc.incident_date).toLocaleDateString()}</span>
                  <Badge variant="secondary" className="text-[8px] px-1.5 py-0">{inc.status.replace(/_/g, " ")}</Badge>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-sm text-muted-foreground">No incidents found</div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-border">
          <Button size="sm" className="w-full" onClick={onFileIncident}>+ File New Incident</Button>
        </div>
      </div>

      {/* RIGHT: Incident Detail */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex-1 flex items-center justify-center h-full text-muted-foreground text-sm">
            Select an incident to view details
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {/* Header */}
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-bold text-foreground">{selected.incident_number}</h2>
                <div className="flex items-center gap-2 mt-1">
                  <Badge variant="secondary" className={`text-[9px] ${severityColors[selected.severity]}`}>{selected.severity}</Badge>
                  <Badge variant="secondary" className="text-[9px]">{selected.incident_type.replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(selected.incident_date).toLocaleDateString()}
                    {selected.incident_time && ` at ${selected.incident_time}`}
                  </span>
                </div>
              </div>
            </div>

            {/* Description */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Description</h3>
              <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3">{selected.description}</p>
            </div>

            {selected.immediate_action && (
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">Immediate Action Taken</h3>
                <p className="text-sm text-foreground bg-muted/30 rounded-lg p-3">{selected.immediate_action}</p>
              </div>
            )}

            {/* Status Timeline */}
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Status Timeline</h3>
              <div className="flex items-center gap-0">
                {statusSteps.map((step, i) => {
                  const currentIdx = statusSteps.indexOf(selected.status);
                  const isCompleted = i <= currentIdx;
                  const isCurrent = i === currentIdx;
                  return (
                    <React.Fragment key={step}>
                      <div className="flex flex-col items-center">
                        <div
                          className={cn(
                            "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors",
                            isCompleted
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-muted text-muted-foreground border-border"
                          )}
                        >
                          {isCompleted ? "✓" : i + 1}
                        </div>
                        <span className={cn(
                          "text-[9px] mt-1 text-center w-16",
                          isCurrent ? "font-semibold text-primary" : "text-muted-foreground"
                        )}>
                          {statusLabels[step]}
                        </span>
                      </div>
                      {i < statusSteps.length - 1 && (
                        <div className={cn(
                          "flex-1 h-0.5 mx-1 mt-[-16px]",
                          i < currentIdx ? "bg-primary" : "bg-border"
                        )} />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 pt-2 border-t border-border">
              {selected.status === "open" && (
                <Button size="sm" variant="outline" onClick={() => handleStatusChange("under_review")}>
                  📋 Mark Under Review
                </Button>
              )}
              {(selected.status === "open" || selected.status === "under_review") && (
                <Button size="sm" variant="outline" onClick={() => handleStatusChange("capa_raised")}>
                  📋 Raise CAPA
                </Button>
              )}
              {selected.status !== "closed" && (
                <Button size="sm" variant="outline" onClick={handleCloseIncident}>
                  ✓ Close Incident
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default IncidentReportsTab;
