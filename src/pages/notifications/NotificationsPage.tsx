import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { format } from "date-fns";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Bell, MessageSquare, Mail, Phone, Filter, CheckCircle2, XCircle, Clock, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const CHANNEL_ICONS: Record<string, JSX.Element> = {
  whatsapp: <MessageSquare size={13} className="text-green-600" />,
  sms:      <Phone size={13} className="text-blue-600" />,
  email:    <Mail size={13} className="text-violet-600" />,
  push:     <Bell size={13} className="text-amber-600" />,
  in_app:   <Bell size={13} className="text-slate-500" />,
};

const STATUS_BADGE: Record<string, string> = {
  sent:      "bg-green-50 text-green-700 border-green-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  failed:    "bg-red-50 text-red-700 border-red-200",
  pending:   "bg-amber-50 text-amber-700 border-amber-200",
};

const STATUS_ICONS: Record<string, JSX.Element> = {
  sent:      <CheckCircle2 size={11} />,
  delivered: <CheckCircle2 size={11} />,
  failed:    <XCircle size={11} />,
  pending:   <Clock size={11} />,
};

const ESCALATION_CHAIN = [
  { step: 1, channel: "WhatsApp", delay: "Immediate", icon: <MessageSquare size={16} className="text-green-600" /> },
  { step: 2, channel: "SMS via MSG91", delay: "30 min if unacknowledged", icon: <Phone size={16} className="text-blue-600" /> },
  { step: 3, channel: "Email via SendGrid", delay: "2 hrs if unacknowledged", icon: <Mail size={16} className="text-violet-600" /> },
];

export default function NotificationsPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("log");
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [channelFilter, setChannelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");

  // Hospital-level preferences
  const [prefs, setPrefs] = useState({
    whatsapp_enabled: true,
    sms_enabled: true,
    email_enabled: false,
    push_enabled: false,
    quiet_hours_start: "22:00",
    quiet_hours_end: "07:00",
  });
  const [savingPrefs, setSavingPrefs] = useState(false);

  const fetchLogs = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    let q = (supabase as any)
      .from("notification_log")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (channelFilter !== "all") q = q.eq("channel", channelFilter);
    if (statusFilter !== "all") q = q.eq("status", statusFilter);
    const { data } = await q;
    setLogs(data || []);
    setLoading(false);
  }, [hospitalId, channelFilter, statusFilter]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  const filteredLogs = search
    ? logs.filter(l =>
        (l.recipient_name || "").toLowerCase().includes(search.toLowerCase()) ||
        (l.event_type || "").toLowerCase().includes(search.toLowerCase()) ||
        (l.recipient_phone || "").includes(search))
    : logs;

  const stats = {
    total: logs.length,
    sent: logs.filter(l => l.status === "sent" || l.status === "delivered").length,
    failed: logs.filter(l => l.status === "failed").length,
    pending: logs.filter(l => l.status === "pending").length,
  };

  const savePrefs = async () => {
    if (!hospitalId) return;
    setSavingPrefs(true);
    await (supabase as any).from("notification_preferences").upsert({
      hospital_id: hospitalId,
      ...prefs,
      updated_at: new Date().toISOString(),
    }, { onConflict: "hospital_id,patient_id" });
    setSavingPrefs(false);
    toast({ title: "Notification preferences saved" });
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Notifications</h1>
        </div>
        <Button size="sm" variant="outline" onClick={fetchLogs} className="gap-1.5 h-8">
          <RefreshCw size={12} /> Refresh
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
          <TabsTrigger value="log" className="text-[13px]">Notification Log</TabsTrigger>
          <TabsTrigger value="escalation" className="text-[13px]">Escalation Chain</TabsTrigger>
          <TabsTrigger value="preferences" className="text-[13px]">Preferences</TabsTrigger>
        </TabsList>

        {/* ── Log ── */}
        <TabsContent value="log" className="flex-1 overflow-hidden flex flex-col m-0">
          {/* Stats bar */}
          <div className="flex-shrink-0 grid grid-cols-4 gap-3 p-4 bg-muted/20 border-b border-border">
            {[
              { l: "Total Sent", v: stats.total, c: "text-foreground" },
              { l: "Delivered", v: stats.sent, c: "text-green-600" },
              { l: "Failed", v: stats.failed, c: "text-red-600" },
              { l: "Pending", v: stats.pending, c: "text-amber-600" },
            ].map(s => (
              <div key={s.l} className="bg-card border border-border rounded-xl p-3 text-center">
                <p className={cn("text-[22px] font-bold", s.c)}>{s.v}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{s.l}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 border-b border-border">
            <Filter size={13} className="text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, phone, event…"
              className="h-8 text-[12px] w-56"
            />
            <Select value={channelFilter} onValueChange={setChannelFilter}>
              <SelectTrigger className="h-8 w-32 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Channels</SelectItem>
                {["whatsapp","sms","email","push","in_app"].map(c => (
                  <SelectItem key={c} value={c} className="capitalize">{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-28 text-[12px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                {["sent","delivered","failed","pending"].map(s => (
                  <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-[11px] text-muted-foreground ml-auto">{filteredLogs.length} entries</span>
          </div>

          {/* Log table */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-32">
                <Loader2 size={20} className="animate-spin text-muted-foreground" />
              </div>
            ) : filteredLogs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                <Bell size={28} className="opacity-20 mb-2" />
                <p className="text-[13px]">No notifications found.</p>
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-muted/50">
                  <tr className="border-b border-border">
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Time</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Channel</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Recipient</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Event</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredLogs.map(l => (
                    <tr key={l.id} className="border-b border-border hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-2 text-muted-foreground whitespace-nowrap">
                        {format(new Date(l.created_at), "dd/MM HH:mm")}
                      </td>
                      <td className="px-4 py-2">
                        <span className="flex items-center gap-1.5 capitalize">
                          {CHANNEL_ICONS[l.channel]}
                          {l.channel}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <p className="font-medium text-foreground">{l.recipient_name || "—"}</p>
                        <p className="text-[11px] text-muted-foreground">{l.recipient_phone || l.recipient_email || "—"}</p>
                      </td>
                      <td className="px-4 py-2">
                        <p className="text-foreground">{l.event_type}</p>
                        {l.subject && <p className="text-[11px] text-muted-foreground truncate max-w-[200px]">{l.subject}</p>}
                      </td>
                      <td className="px-4 py-2">
                        <span className={cn(
                          "inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border",
                          STATUS_BADGE[l.status] || "bg-muted text-muted-foreground"
                        )}>
                          {STATUS_ICONS[l.status]}
                          {l.status}
                        </span>
                        {l.error_message && (
                          <p className="text-[10px] text-red-500 mt-0.5 max-w-[180px] truncate" title={l.error_message}>{l.error_message}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </TabsContent>

        {/* ── Escalation Chain ── */}
        <TabsContent value="escalation" className="flex-1 overflow-auto p-6 m-0">
          <div className="max-w-xl space-y-4">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Clinical Alert Escalation Chain</h2>
              <p className="text-[12px] text-muted-foreground mt-1">
                Unacknowledged critical / high-severity alerts automatically escalate through this sequence.
              </p>
            </div>

            <div className="relative">
              {/* Vertical connector */}
              <div className="absolute left-6 top-8 bottom-8 w-0.5 bg-border" />
              <div className="space-y-3">
                {ESCALATION_CHAIN.map((e, i) => (
                  <div key={i} className="relative flex items-start gap-4 bg-card border border-border rounded-xl p-4">
                    <div className="flex-shrink-0 w-10 h-10 rounded-full bg-muted flex items-center justify-center font-bold text-[14px] text-foreground z-10">
                      {e.step}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {e.icon}
                        <p className="text-[14px] font-semibold text-foreground">{e.channel}</p>
                      </div>
                      <p className="text-[12px] text-muted-foreground mt-0.5">{e.delay}</p>
                    </div>
                    <CheckCircle2 size={16} className="text-green-500 flex-shrink-0" />
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <p className="text-[12px] text-blue-800 font-medium">Edge Function: <code className="bg-blue-100 px-1 rounded">alert-escalation</code></p>
              <p className="text-[12px] text-blue-700 mt-1">Runs every 5 minutes via pg_cron. Checks <code className="bg-blue-100 px-1 rounded">alert_escalation_rules</code> and escalates unacknowledged alerts past SLA windows.</p>
            </div>
          </div>
        </TabsContent>

        {/* ── Preferences ── */}
        <TabsContent value="preferences" className="flex-1 overflow-auto p-6 m-0">
          <div className="max-w-lg space-y-5">
            <div>
              <h2 className="text-[15px] font-semibold text-foreground">Hospital Notification Preferences</h2>
              <p className="text-[12px] text-muted-foreground mt-1">
                Channels enabled here are the default for all staff. Patients can override their individual preferences.
              </p>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-4">
              {[
                { key: "whatsapp_enabled", label: "WhatsApp (WATI)", desc: "Appointment reminders, discharge summaries", icon: <MessageSquare size={15} className="text-green-600" /> },
                { key: "sms_enabled",      label: "SMS (MSG91)",      desc: "OTP, critical alerts escalation",          icon: <Phone size={15} className="text-blue-600" /> },
                { key: "email_enabled",    label: "Email (SendGrid)", desc: "Reports, financial statements",             icon: <Mail size={15} className="text-violet-600" /> },
                { key: "push_enabled",     label: "Push (FCM)",       desc: "Mobile app notifications (Gap 14)",        icon: <Bell size={15} className="text-amber-600" /> },
              ].map(c => (
                <div key={c.key} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {c.icon}
                    <div>
                      <p className="text-[13px] font-medium text-foreground">{c.label}</p>
                      <p className="text-[11px] text-muted-foreground">{c.desc}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => setPrefs(p => ({ ...p, [c.key]: !(p as any)[c.key] }))}
                    className={cn(
                      "relative inline-flex h-5 w-9 items-center rounded-full transition-colors flex-shrink-0",
                      (prefs as any)[c.key] ? "bg-primary" : "bg-muted-foreground/30"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-3 w-3 rounded-full bg-white shadow transition-transform",
                      (prefs as any)[c.key] ? "translate-x-5" : "translate-x-1"
                    )} />
                  </button>
                </div>
              ))}
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-foreground">Quiet Hours</p>
              <p className="text-[11px] text-muted-foreground">Non-critical notifications are suppressed during these hours.</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground">Start</label>
                  <Input type="time" value={prefs.quiet_hours_start}
                    onChange={e => setPrefs(p => ({ ...p, quiet_hours_start: e.target.value }))}
                    className="h-9 mt-1 text-[12px]" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">End</label>
                  <Input type="time" value={prefs.quiet_hours_end}
                    onChange={e => setPrefs(p => ({ ...p, quiet_hours_end: e.target.value }))}
                    className="h-9 mt-1 text-[12px]" />
                </div>
              </div>
            </div>

            <Button onClick={savePrefs} disabled={savingPrefs} className="w-full gap-2">
              {savingPrefs ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Save Preferences
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
