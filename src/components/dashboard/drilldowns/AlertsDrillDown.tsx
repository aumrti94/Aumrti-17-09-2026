import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { getCurrentUserRowId } from "@/lib/currentUser";

interface Alert {
  id: string;
  alert_type: string;
  alert_message: string;
  severity: string;
  created_at: string;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h`;
}

const AlertsDrillDown: React.FC = () => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  const fetch = useCallback(async () => {
    const { data } = await supabase
      .from("clinical_alerts")
      .select("id, alert_type, alert_message, severity, created_at")
      .eq("is_acknowledged", false)
      .order("severity", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(20);
    setAlerts(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  // Returns the ids actually written. .select() is what makes a row that RLS
  // silently refused distinguishable from a successful write — without it a
  // zero-row update looks identical to success.
  const markAcknowledged = async (ids: string[]): Promise<string[]> => {
    const { data, error } = await supabase.from("clinical_alerts").update({
      is_acknowledged: true,
      acknowledged_by: await getCurrentUserRowId(),
      acknowledged_at: new Date().toISOString(),
    }).in("id", ids).select("id");

    if (error) throw error;
    return (data || []).map((r) => r.id);
  };

  const acknowledge = async (id: string) => {
    try {
      const acked = await markAcknowledged([id]);
      if (!acked.length) {
        toast({ title: "Could not acknowledge alert", description: "The alert was not updated. Please retry.", variant: "destructive" });
        fetch();
        return;
      }
      setAlerts((prev) => prev.filter((a) => a.id !== id));
      toast({ title: "Alert acknowledged" });
    } catch (e: any) {
      console.error("Acknowledge failed:", e);
      toast({ title: "Failed to acknowledge alert", description: e.message, variant: "destructive" });
    }
  };

  const acknowledgeAll = async () => {
    const ids = alerts.map((a) => a.id);
    if (!ids.length) return;
    try {
      const acked = await markAcknowledged(ids);
      if (acked.length < ids.length) {
        toast({ title: `${ids.length - acked.length} alert(s) could not be acknowledged`, variant: "destructive" });
        fetch();
        return;
      }
      setAlerts([]);
      toast({ title: "All alerts acknowledged" });
    } catch (e: any) {
      console.error("Acknowledge all failed:", e);
      toast({ title: "Failed to acknowledge alerts", description: e.message, variant: "destructive" });
      fetch();
    }
  };

  const sevIcon = (s: string) => {
    if (s === "critical") return "🔴";
    if (s === "high") return "🟠";
    if (s === "medium") return "🟡";
    return "🟢";
  };

  const sevBg = (s: string, age: number) => {
    if (s === "critical" && age > 30) return "bg-destructive/5 border-l-[3px] border-l-destructive animate-pulse";
    if (s === "critical") return "bg-destructive/5";
    if (s === "high") return "bg-[hsl(var(--accent))]/5";
    return "";
  };

  if (loading) {
    return <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded-lg" />)}</div>;
  }

  return (
    <div className="space-y-3">
      <h4 className="text-[11px] font-bold uppercase text-muted-foreground tracking-wider">Active Alerts</h4>
      {alerts.length === 0 ? (
        <div className="text-center py-6">
          <span className="text-2xl">✅</span>
          <p className="text-xs text-[hsl(var(--success))] font-medium mt-1">All clear — no pending alerts</p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            {alerts.map((a) => {
              const ageMins = Math.floor((Date.now() - new Date(a.created_at).getTime()) / 60000);
              return (
                <div key={a.id} className={cn("rounded-lg px-3 py-2.5 border border-border/50", sevBg(a.severity, ageMins))}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{sevIcon(a.severity)}</span>
                      <span className="text-xs font-medium text-foreground capitalize">{a.alert_type.replace(/_/g, " ")}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{timeAgo(a.created_at)}</span>
                      <button
                        onClick={() => acknowledge(a.id)}
                        className="text-[10px] font-medium text-primary hover:bg-primary/10 px-2 py-0.5 rounded-full transition-colors"
                      >
                        Acknowledge →
                      </button>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{a.alert_message}</p>
                </div>
              );
            })}
          </div>
          <Button variant="outline" size="sm" className="w-full text-xs" onClick={acknowledgeAll}>
            Acknowledge All ({alerts.length})
          </Button>
        </>
      )}
    </div>
  );
};

export default AlertsDrillDown;
