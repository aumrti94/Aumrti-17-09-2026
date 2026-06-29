import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell, MessageSquare, AlertTriangle, Check, X, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TYPE_LABELS: Record<string, string> = {
  appointment_confirmation: "Appointment",
  appointment_reminder: "Reminder",
  lab_result_ready: "Lab Report",
  bill_generated: "Bill",
  payment_received: "Payment",
  discharge_summary: "Discharge",
  prescription_ready: "Prescription",
  feedback_request: "Feedback",
  custom: "Message",
};

const NotificationCentre: React.FC<{ hospitalId: string | null }> = ({ hospitalId }) => {
  const [pending, setPending] = useState<any[]>([]);
  const [tab, setTab] = useState<"whatsapp" | "alerts">("whatsapp");
  const [alerts, setAlerts] = useState<any[]>([]);

  const fetchPending = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await supabase
      .from("whatsapp_notifications")
      .select("id, patient_id, notification_type, phone_number, whatsapp_url, created_at, patients!whatsapp_notifications_patient_id_fkey(full_name)")
      .eq("hospital_id", hospitalId)
      .is("sent_at", null)
      .order("created_at", { ascending: false })
      .limit(20);
    setPending(data || []);
  }, [hospitalId]);

  const fetchAlerts = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await supabase
      .from("clinical_alerts")
      .select("id, alert_type, alert_message, severity, created_at, is_acknowledged")
      .eq("hospital_id", hospitalId)
      .eq("is_acknowledged", false)
      .order("created_at", { ascending: false })
      .limit(10);
    setAlerts(data || []);
  }, [hospitalId]);

  useEffect(() => {
    fetchPending();
    fetchAlerts();
    const interval = setInterval(() => { fetchPending(); fetchAlerts(); }, 30000);
    return () => clearInterval(interval);
  }, [fetchPending, fetchAlerts]);

  const handleSend = async (id: string, waUrl: string) => {
    window.open(waUrl, "_blank", "noopener,noreferrer");
    await supabase.from("whatsapp_notifications").update({ sent_at: new Date().toISOString() } as any).eq("id", id);
    fetchPending();
  };

  const handleDismiss = async (id: string) => {
    await supabase.from("whatsapp_notifications").update({ sent_at: new Date().toISOString() } as any).eq("id", id);
    fetchPending();
  };

  const totalCount = pending.length + alerts.length;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="relative p-2 rounded-md hover:bg-muted transition-colors active:scale-95">
          <Bell size={20} />
          {totalCount > 0 && (
            <Badge className="absolute -top-0.5 -right-0.5 h-[18px] min-w-[18px] px-1 text-[10px] font-bold bg-destructive text-destructive-foreground border-2 border-card rounded-full flex items-center justify-center">
              {totalCount > 99 ? "99+" : totalCount}
            </Badge>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[360px] p-0">
        {/* Header */}
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm font-bold text-foreground">Notifications</p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setTab("whatsapp")}
            className={`flex-1 py-2 text-xs font-medium text-center border-b-2 transition-colors ${
              tab === "whatsapp"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <MessageSquare size={12} className="inline mr-1" />
            WhatsApp {pending.length > 0 && `(${pending.length})`}
          </button>
          <button
            onClick={() => setTab("alerts")}
            className={`flex-1 py-2 text-xs font-medium text-center border-b-2 transition-colors ${
              tab === "alerts"
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <AlertTriangle size={12} className="inline mr-1" />
            Alerts {alerts.length > 0 && `(${alerts.length})`}
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[360px] overflow-y-auto">
          {tab === "whatsapp" && (
            <>
              {pending.length === 0 ? (
                <div className="py-8 text-center">
                  <Check size={24} className="mx-auto mb-2 text-emerald-500" />
                  <p className="text-xs text-muted-foreground">All caught up ✓</p>
                </div>
              ) : (
                <>
                  <p className="px-4 py-2 text-[11px] font-bold text-amber-600">
                    {pending.length} message{pending.length !== 1 ? "s" : ""} waiting to send
                  </p>
                  {pending.map((n) => {
                    const patientName = (n.patients as any)?.full_name || "Patient";
                    const ago = getTimeAgo(n.created_at);
                    return (
                      <div key={n.id} className="px-4 py-2.5 border-b border-border last:border-b-0 hover:bg-muted/50">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ background: "#25D366" }}>
                              <MessageSquare size={12} color="white" />
                            </div>
                            <span className="text-xs font-medium text-foreground truncate">{patientName}</span>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">{ago}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground ml-8 mb-2">
                          {TYPE_LABELS[n.notification_type] || n.notification_type}
                        </p>
                        <div className="flex gap-2 ml-8">
                          <button
                            onClick={() => handleSend(n.id, n.whatsapp_url)}
                            className="flex items-center gap-1 px-2.5 py-1 rounded text-[10px] font-bold text-white"
                            style={{ background: "#25D366" }}
                          >
                            <MessageSquare size={10} /> Send
                          </button>
                          <button
                            onClick={() => handleDismiss(n.id)}
                            className="px-2 py-1 rounded text-[10px] text-muted-foreground hover:bg-muted"
                          >
                            Skip
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </>
          )}

          {tab === "alerts" && (
            <>
              {alerts.length === 0 ? (
                <div className="py-8 text-center">
                  <Check size={24} className="mx-auto mb-2 text-emerald-500" />
                  <p className="text-xs text-muted-foreground">No active alerts</p>
                </div>
              ) : (
                alerts.map((a) => (
                  <div key={a.id} className="px-4 py-2.5 border-b border-border last:border-b-0">
                    <div className="flex items-start gap-2">
                      <AlertTriangle
                        size={14}
                        className={`mt-0.5 shrink-0 ${
                          a.severity === "critical" ? "text-destructive" : "text-amber-500"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-foreground">{a.alert_message}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">{getTimeAgo(a.created_at)}</p>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default NotificationCentre;
