import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

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

  const acknowledge = async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("clinical_alerts").update({
      is_acknowledged: true,
      acknowledged_by: user?.id,
      acknowledged_at: new Date().toISOString(),
    }).eq("id", id);

    if (error) {
      console.error("Acknowledge failed:", error);
      toast({ title: "Failed to acknowledge alert", description: error.message, variant: "destructive" });
      return;
    }
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    toast({ title: "Alert acknowledged" });
  };

  const acknowledgeAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    let failCount = 0;
    for (const a of alerts) {
      const { error } = await supabase.from("clinical_alerts").update({
        is_acknowledged: true,
        acknowledged_by: user?.id,
        acknowledged_at: new Date().toISOString(),
      }).eq("id", a.id);
      if (error) failCount++;
    }
    if (failCount > 0) {
      toast({ title: `${failCount} alert(s) failed to acknowledge`, variant: "destructive" });
      fetch();
      return;
    }
    setAlerts([]);
    toast({ title: "All alerts acknowledged" });
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
