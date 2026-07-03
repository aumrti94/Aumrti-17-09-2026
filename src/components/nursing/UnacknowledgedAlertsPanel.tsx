import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp, Bell } from "lucide-react";

interface Alert {
  id: string;
  alert_type: string;
  alert_message: string;
  severity: string;
  ward_name: string | null;
  bed_number: string | null;
  created_at: string;
}

function timeAgo(dateStr: string) {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

const sevIcon = (s: string) => (s === "critical" ? "🔴" : s === "high" ? "🟠" : s === "medium" ? "🟡" : "🟢");

/**
 * Nurse-facing critical alert acknowledgment — nursing module completion plan, Phase 6.
 * Today, nurses only ever see clinical_alerts as a transient realtime toast (see the
 * "clinical-alerts-nursing" subscription elsewhere in NursingPage.tsx, left untouched) — there
 * was no durable, actionable list and no way to acknowledge from the nursing workspace at all.
 * This reuses the exact ack pattern already proven in the admin dashboard's AlertsDrillDown.tsx.
 * Renders nothing when there's nothing to act on, to respect the zero-scroll layout.
 */
const UnacknowledgedAlertsPanel: React.FC<{ hospitalId: string | null }> = ({ hospitalId }) => {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [expanded, setExpanded] = useState(false);

  const fetchAlerts = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await supabase
      .from("clinical_alerts")
      .select("id, alert_type, alert_message, severity, ward_name, bed_number, created_at")
      .eq("hospital_id", hospitalId)
      .eq("is_acknowledged", false)
      .order("severity", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(20);
    setAlerts(data || []);
  }, [hospitalId]);

  useEffect(() => { fetchAlerts(); }, [fetchAlerts]);

  // Independent realtime refresh (separate channel from NursingPage's own toast subscription,
  // so this stays self-contained and can't interfere with it). Also refreshes on UPDATE so an
  // alert acknowledged elsewhere (e.g. the Lab module's own ack flow) drops off this list too.
  useEffect(() => {
    if (!hospitalId) return;
    const ch = supabase
      .channel("unack-alerts-panel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "clinical_alerts" }, () => fetchAlerts())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "clinical_alerts" }, () => fetchAlerts())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [hospitalId, fetchAlerts]);

  const acknowledge = async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("clinical_alerts").update({
      is_acknowledged: true,
      acknowledged_by: user?.id,
      acknowledged_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) {
      toast({ title: "Failed to acknowledge alert", description: error.message, variant: "destructive" });
      return;
    }
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  if (alerts.length === 0) return null;

  const worstSeverity = alerts.some((a) => a.severity === "critical") ? "critical" : "high";

  return (
    <div className={cn(
      "flex-shrink-0 border-b",
      worstSeverity === "critical" ? "bg-destructive/5 border-destructive/20" : "bg-amber-50 border-amber-200"
    )}>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2 text-left"
      >
        <span className={cn(
          "text-xs font-bold flex items-center gap-1.5",
          worstSeverity === "critical" ? "text-destructive" : "text-amber-700"
        )}>
          <Bell className="h-3.5 w-3.5" />
          {alerts.length} unacknowledged alert{alerts.length > 1 ? "s" : ""}
        </span>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-4 pb-2.5 space-y-1.5 max-h-48 overflow-y-auto">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-start justify-between gap-2 rounded-lg bg-card border border-border/50 px-2.5 py-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span>{sevIcon(a.severity)}</span>
                  <span className="text-[11px] font-semibold text-foreground capitalize">{a.alert_type.replace(/_/g, " ")}</span>
                  {(a.ward_name || a.bed_number) && (
                    <span className="text-[10px] text-muted-foreground">
                      {a.ward_name}{a.bed_number ? ` · Bed ${a.bed_number}` : ""}
                    </span>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto shrink-0">{timeAgo(a.created_at)}</span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{a.alert_message}</p>
              </div>
              <button
                onClick={() => acknowledge(a.id)}
                className="shrink-0 text-[10px] font-medium text-primary hover:bg-primary/10 px-2 py-1 rounded-full transition-colors"
              >
                Acknowledge
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UnacknowledgedAlertsPanel;
