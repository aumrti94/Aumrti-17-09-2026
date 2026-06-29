import React, { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Bell, Settings2, MessageSquare, Mail, Clock, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger,
} from "@/components/ui/sheet";
import { useHospitalId } from "@/hooks/useHospitalId";

interface Alert {
  id: string;
  alert_type: string;
  alert_message: string;
  severity: string;
  created_at: string;
  is_acknowledged: boolean;
  escalated_at: string | null;
  escalation_count: number;
}

interface EscalationRule {
  id?: string;
  escalate_after_minutes: number;
  escalation_channels: string[];
  notify_roles: string[];
  sms_numbers: string[];
  email_addresses: string[];
  is_active: boolean;
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h${hrs > 1 ? "" : ""} ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function severityDotColor(s: string) {
  if (s === "critical") return "bg-destructive";
  if (s === "high") return "bg-[hsl(24,95%,53%)]";
  if (s === "medium") return "bg-[hsl(38,92%,50%)]";
  return "bg-emerald-500";
}

const DEFAULT_RULE: EscalationRule = {
  escalate_after_minutes: 15,
  escalation_channels:    ["sms", "email"],
  notify_roles:           ["doctor", "admin"],
  sms_numbers:            [],
  email_addresses:        [],
  is_active:              true,
};

const AlertsPanel: React.FC<{ kpis?: any }> = ({ kpis }) => {
  const [alerts, setAlerts]         = useState<Alert[]>([]);
  const [loading, setLoading]       = useState(true);
  const [rule, setRule]             = useState<EscalationRule>(DEFAULT_RULE);
  const [ruleSaving, setRuleSaving] = useState(false);
  const [smsInput, setSmsInput]     = useState("");
  const [emailInput, setEmailInput] = useState("");

  const { toast }    = useToast();
  const { hospitalId } = useHospitalId();

  const fetchAlerts = useCallback(async () => {
    const { data } = await supabase
      .from("clinical_alerts")
      .select("id, alert_type, alert_message, severity, created_at, is_acknowledged, escalated_at, escalation_count")
      .eq("is_acknowledged", false)
      .order("severity", { ascending: false })     // critical first
      .order("created_at", { ascending: false })
      .limit(15);
    setAlerts((data || []) as Alert[]);
    setLoading(false);
  }, []);

  const fetchRule = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("alert_escalation_rules")
      .select("*")
      .eq("hospital_id", hospitalId)
      .eq("severity", "critical")
      .is("alert_type", null)
      .maybeSingle();
    if (data) setRule(data as EscalationRule);
  }, [hospitalId]);

  useEffect(() => { fetchAlerts(); fetchRule(); }, [fetchAlerts, fetchRule]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel("alerts-panel-rt")
      .on("postgres_changes" as any, { event: "INSERT", schema: "public", table: "clinical_alerts" }, () => fetchAlerts())
      .on("postgres_changes" as any, { event: "UPDATE", schema: "public", table: "clinical_alerts" }, () => fetchAlerts())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchAlerts]);

  const acknowledge = async (id: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from("clinical_alerts").update({
      is_acknowledged:  true,
      acknowledged_by:  user?.id,
      acknowledged_at:  new Date().toISOString(),
    }).eq("id", id);

    if (error) {
      toast({ title: "Failed to acknowledge", description: error.message, variant: "destructive" });
      return;
    }
    setAlerts(prev => prev.filter(a => a.id !== id));
    toast({ title: "Alert acknowledged" });
  };

  const acknowledgeAll = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const ids = alerts.map(a => a.id);
    if (!ids.length) return;
    await supabase.from("clinical_alerts").update({
      is_acknowledged: true,
      acknowledged_by: user?.id,
      acknowledged_at: new Date().toISOString(),
    }).in("id", ids);
    setAlerts([]);
    toast({ title: "All alerts acknowledged" });
  };

  const saveRule = async () => {
    if (!hospitalId) return;
    setRuleSaving(true);
    const payload = {
      hospital_id:            hospitalId,
      severity:               "critical",
      alert_type:             null,
      escalate_after_minutes: rule.escalate_after_minutes,
      escalation_channels:    rule.escalation_channels,
      notify_roles:           rule.notify_roles,
      sms_numbers:            rule.sms_numbers,
      email_addresses:        rule.email_addresses,
      is_active:              rule.is_active,
    };
    if ((rule as any).id) {
      await (supabase as any).from("alert_escalation_rules").update(payload).eq("id", (rule as any).id);
    } else {
      const { data } = await (supabase as any).from("alert_escalation_rules").insert(payload).select("id").maybeSingle();
      if (data) setRule(r => ({ ...r, id: data.id }));
    }
    setRuleSaving(false);
    toast({ title: "Escalation rule saved ✓" });
  };

  const criticalCount = alerts.filter(a => a.severity === "critical").length;
  const escalatedCount = alerts.filter(a => a.escalated_at).length;

  if (loading) return <div className="h-full animate-pulse bg-muted rounded-xl" />;

  return (
    <div className="flex flex-col h-full bg-card rounded-xl border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-2">
          <Bell size={14} className={cn(criticalCount > 0 ? "text-destructive animate-pulse" : "text-muted-foreground")} />
          <span className="text-[13px] font-bold text-foreground">Active Alerts</span>
          {criticalCount > 0 && (
            <span className="bg-destructive/10 text-destructive text-[10px] font-bold px-1.5 py-0.5 rounded-full">
              {criticalCount} critical
            </span>
          )}
          {escalatedCount > 0 && (
            <span className="bg-amber-50 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
              <MessageSquare size={9} /> {escalatedCount} escalated
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {alerts.length > 1 && (
            <button
              onClick={acknowledgeAll}
              className="text-[10px] text-muted-foreground hover:text-emerald-600 flex items-center gap-0.5"
              title="Acknowledge all"
            >
              <CheckCheck size={12} /> All
            </button>
          )}
          {/* Escalation settings sheet */}
          <Sheet>
            <SheetTrigger asChild>
              <button
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Escalation settings"
              >
                <Settings2 size={14} />
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[360px]">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Bell size={16} /> Alert Escalation Settings
                </SheetTitle>
              </SheetHeader>

              <div className="mt-4 space-y-4 text-sm">
                <p className="text-[12px] text-muted-foreground">
                  Unacknowledged critical alerts trigger SMS and/or email escalation after the SLA window.
                  The <code className="bg-muted px-1 rounded text-[11px]">alert-escalation</code> edge function runs every 5 minutes.
                </p>

                {/* Active toggle */}
                <div className="flex items-center justify-between">
                  <Label className="text-[13px]">Escalation active</Label>
                  <Switch
                    checked={rule.is_active}
                    onCheckedChange={v => setRule(r => ({ ...r, is_active: v }))}
                  />
                </div>

                {/* SLA */}
                <div>
                  <Label className="text-xs">Escalate after (minutes)</Label>
                  <Input
                    type="number"
                    className="mt-1 h-8 text-sm w-24"
                    value={rule.escalate_after_minutes}
                    onChange={e => setRule(r => ({ ...r, escalate_after_minutes: Number(e.target.value) }))}
                    min={5}
                  />
                </div>

                {/* Channels */}
                <div>
                  <Label className="text-xs mb-1 block">Escalation channels</Label>
                  <div className="flex gap-3">
                    {(["sms", "email"] as const).map(ch => (
                      <label key={ch} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.escalation_channels.includes(ch)}
                          onChange={e => {
                            setRule(r => ({
                              ...r,
                              escalation_channels: e.target.checked
                                ? [...r.escalation_channels, ch]
                                : r.escalation_channels.filter(c => c !== ch),
                            }));
                          }}
                          className="accent-primary"
                        />
                        <span className="text-[12px] capitalize flex items-center gap-1">
                          {ch === "sms" ? <MessageSquare size={11} /> : <Mail size={11} />} {ch.toUpperCase()}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Notify roles */}
                <div>
                  <Label className="text-xs mb-1 block">Notify roles</Label>
                  <div className="flex flex-wrap gap-2">
                    {["doctor","nurse","admin","radiologist","lab_tech","pharmacist"].map(role => (
                      <label key={role} className="flex items-center gap-1 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={rule.notify_roles.includes(role)}
                          onChange={e => {
                            setRule(r => ({
                              ...r,
                              notify_roles: e.target.checked
                                ? [...r.notify_roles, role]
                                : r.notify_roles.filter(x => x !== role),
                            }));
                          }}
                          className="accent-primary"
                        />
                        <span className="text-[11px] capitalize">{role.replace("_"," ")}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Direct SMS numbers */}
                <div>
                  <Label className="text-xs">On-call SMS numbers (override)</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      placeholder="+91XXXXXXXXXX"
                      value={smsInput}
                      onChange={e => setSmsInput(e.target.value)}
                      className="h-7 text-xs flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        if (smsInput.trim()) {
                          setRule(r => ({ ...r, sms_numbers: [...r.sms_numbers, smsInput.trim()] }));
                          setSmsInput("");
                        }
                      }}
                    >Add</Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {rule.sms_numbers.map(n => (
                      <span
                        key={n}
                        className="text-[10px] bg-muted px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer hover:bg-red-50 hover:text-red-600"
                        onClick={() => setRule(r => ({ ...r, sms_numbers: r.sms_numbers.filter(x => x !== n) }))}
                        title="Click to remove"
                      >
                        {n} ×
                      </span>
                    ))}
                  </div>
                </div>

                {/* Direct email addresses */}
                <div>
                  <Label className="text-xs">On-call email addresses (override)</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      placeholder="doctor@hospital.com"
                      value={emailInput}
                      onChange={e => setEmailInput(e.target.value)}
                      className="h-7 text-xs flex-1"
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      onClick={() => {
                        if (emailInput.trim()) {
                          setRule(r => ({ ...r, email_addresses: [...r.email_addresses, emailInput.trim()] }));
                          setEmailInput("");
                        }
                      }}
                    >Add</Button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {rule.email_addresses.map(e => (
                      <span
                        key={e}
                        className="text-[10px] bg-muted px-1.5 py-0.5 rounded flex items-center gap-1 cursor-pointer hover:bg-red-50 hover:text-red-600"
                        onClick={() => setRule(r => ({ ...r, email_addresses: r.email_addresses.filter(x => x !== e) }))}
                        title="Click to remove"
                      >
                        {e} ×
                      </span>
                    ))}
                  </div>
                </div>

                <Button className="w-full h-8 text-xs mt-2" onClick={saveRule} disabled={ruleSaving}>
                  {ruleSaving ? "Saving..." : "Save Escalation Settings"}
                </Button>

                <div className="bg-blue-50 border border-blue-200 rounded p-2 text-[11px] text-blue-700">
                  <p className="font-medium mb-1 flex items-center gap-1"><Clock size={11} /> Setup required</p>
                  <p>Configure <strong>TWILIO_ACCOUNT_SID</strong> / <strong>MSG91_API_KEY</strong> and <strong>RESEND_API_KEY</strong> in Supabase edge function secrets. The <code>alert-escalation</code> function runs every 5 minutes.</p>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Alert list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-1 py-6">
            <CheckCheck size={24} className="text-emerald-500" />
            <span className="text-[13px] font-bold text-emerald-600">All clear</span>
            <span className="text-xs text-muted-foreground">No unacknowledged alerts</span>
          </div>
        ) : (
          alerts.map((a) => (
            <div
              key={a.id}
              className="group px-3.5 py-2.5 border-b border-border/30 hover:bg-muted/40 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn(
                    "h-2 w-2 rounded-full shrink-0",
                    severityDotColor(a.severity),
                    a.severity === "critical" && !a.escalated_at && "animate-pulse"
                  )} />
                  <span className="text-xs font-bold text-foreground truncate">
                    {a.alert_type.replace(/_/g, " ")}
                  </span>
                  {a.escalated_at && (
                    <span className="text-[9px] bg-amber-100 text-amber-700 px-1 rounded shrink-0" title="Escalated via SMS/email">
                      📤 escalated
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="text-[10px] text-muted-foreground">{timeAgo(a.created_at)}</span>
                  <button
                    onClick={() => acknowledge(a.id)}
                    className="hidden group-hover:inline-flex items-center text-[10px] font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded hover:bg-emerald-200 transition-colors"
                  >
                    ✓ Ack
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                {a.alert_message}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default AlertsPanel;
