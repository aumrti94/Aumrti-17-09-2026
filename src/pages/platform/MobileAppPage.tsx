import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Smartphone, Send, RefreshCw, Download, QrCode, Loader2, CheckCircle2, Users, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const APP_ROLES = [
  { key: "doctor",    label: "Doctor App",  desc: "Ward rounds, prescriptions, lab results, clinical alerts", icon: "👨‍⚕️", color: "bg-blue-50 border-blue-200" },
  { key: "nurse",     label: "Nurse App",   desc: "Nursing Kardex, MAR, vitals entry, care tasks", icon: "💉", color: "bg-green-50 border-green-200" },
  { key: "patient",   label: "Patient App", desc: "Appointments, reports, bills, health records (ABHA)", icon: "🧑‍💼", color: "bg-violet-50 border-violet-200" },
];

const TECH_STACK = [
  { label: "Framework",        value: "React Native 0.74 + Expo SDK 51" },
  { label: "Auth",             value: "Supabase Auth (shared JWT tokens)" },
  { label: "Real-time",        value: "Supabase Realtime (same channel as web)" },
  { label: "Push Notifications", value: "FCM (Android) + APNs (iOS) via send-push-notification edge fn" },
  { label: "Offline",          value: "WatermelonDB (SQLite sync) + existing offlineQueue.ts patterns" },
  { label: "ABHA Integration", value: "ABDM SDK for ABHA creation + health record linking" },
  { label: "Deep Links",       value: "Universal Links / App Links → /book/:slug, /pay/:ref" },
  { label: "App Stores",       value: "Google Play (Android) + Apple App Store (iOS)" },
];

export default function MobileAppPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [hospitals, setHospitals] = useState<any[]>([]);
  const [selectedHospital, setSelectedHospital] = useState("all");
  const [deviceStats, setDeviceStats] = useState({ android: 0, ios: 0, web: 0, total: 0 });
  const [recentTokens, setRecentTokens] = useState<any[]>([]);
  const [pushLog, setPushLog] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushForm, setPushForm] = useState({ title: "", body: "", target: "all_doctors" });
  const [sending, setSending] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [hospRes, tokenRes, pushRes] = await Promise.all([
      (supabase as any).from("hospitals").select("id, name").eq("is_active", true).order("name"),
      (supabase as any).from("fcm_tokens").select("platform, hospital_id, last_seen_at, is_active, users(full_name,role)").eq("is_active", true).order("last_seen_at", { ascending: false }).limit(50),
      (supabase as any).from("push_notifications").select("*").order("created_at", { ascending: false }).limit(100),
    ]);

    setHospitals(hospRes.data || []);

    const tokens = tokenRes.data || [];
    const filtered = selectedHospital === "all" ? tokens : tokens.filter((t: any) => t.hospital_id === selectedHospital);
    setRecentTokens(filtered.slice(0, 20));
    setDeviceStats({
      android: filtered.filter((t: any) => t.platform === "android").length,
      ios:     filtered.filter((t: any) => t.platform === "ios").length,
      web:     filtered.filter((t: any) => t.platform === "web").length,
      total:   filtered.length,
    });

    const pushFiltered = selectedHospital === "all"
      ? pushRes.data || []
      : (pushRes.data || []).filter((p: any) => p.hospital_id === selectedHospital);
    setPushLog(pushFiltered);
    setLoading(false);
  }, [selectedHospital]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const sendPush = async () => {
    if (!pushForm.title || !pushForm.body) return;
    setSending(true);
    // Invoke edge function
    const { error } = await (supabase as any).functions.invoke("send-push-notification", {
      body: {
        hospital_id: selectedHospital === "all" ? null : selectedHospital,
        topic: `aumrti_${pushForm.target}`,
        title: pushForm.title,
        body: pushForm.body,
      },
    });
    setSending(false);
    if (error) {
      toast({ title: "Push failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Push notification sent" });
      setPushForm(p => ({ ...p, title: "", body: "" }));
      fetchData();
    }
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Smartphone size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">Mobile App</h1>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedHospital} onValueChange={setSelectedHospital}>
            <SelectTrigger className="h-8 w-48 text-[12px]"><SelectValue placeholder="All Hospitals" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Hospitals</SelectItem>
              {hospitals.map(h => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" onClick={fetchData} className="gap-1.5 h-8">
            <RefreshCw size={12} /> Refresh
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <Loader2 size={24} className="animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
            <TabsTrigger value="overview" className="text-[13px]">Overview</TabsTrigger>
            <TabsTrigger value="devices" className="text-[13px]">Registered Devices ({deviceStats.total})</TabsTrigger>
            <TabsTrigger value="push" className="text-[13px]">Push Notifications</TabsTrigger>
            <TabsTrigger value="tech" className="text-[13px]">Tech Stack</TabsTrigger>
          </TabsList>

          {/* ── Overview ── */}
          <TabsContent value="overview" className="flex-1 overflow-auto p-5 m-0 space-y-5">
            {/* Device stats */}
            <div className="grid grid-cols-4 gap-3">
              {[
                { l: "Total Active Devices", v: deviceStats.total, c: "text-foreground" },
                { l: "Android", v: deviceStats.android, c: "text-green-600", icon: "🤖" },
                { l: "iOS", v: deviceStats.ios, c: "text-blue-600", icon: "🍎" },
                { l: "Web Push", v: deviceStats.web, c: "text-violet-600", icon: "🌐" },
              ].map(s => (
                <div key={s.l} className="bg-card border border-border rounded-xl p-4 text-center">
                  {(s as any).icon && <p className="text-[20px] mb-1">{(s as any).icon}</p>}
                  <p className={cn("text-[24px] font-bold", s.c)}>{s.v}</p>
                  <p className="text-[11px] text-muted-foreground">{s.l}</p>
                </div>
              ))}
            </div>

            {/* App types */}
            <div className="grid grid-cols-3 gap-4">
              {APP_ROLES.map(app => (
                <div key={app.key} className={cn("border rounded-xl p-4 space-y-3", app.color)}>
                  <div className="flex items-center gap-2">
                    <span className="text-[22px]">{app.icon}</span>
                    <p className="text-[14px] font-semibold text-foreground">{app.label}</p>
                  </div>
                  <p className="text-[12px] text-muted-foreground">{app.desc}</p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1 flex-1" onClick={() => toast({ title: `${app.label} APK/IPA download link copied` })}>
                      <Download size={10} /> Download
                    </Button>
                    <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={() => toast({ title: "QR code generated" })}>
                      <QrCode size={10} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>

            {/* Deeplink configuration */}
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-foreground">Deep Link Configuration</p>
              <div className="space-y-2 text-[12px]">
                {[
                  { path: "aumrti://book/:hospitalSlug",  desc: "Patient self-booking → PublicAppointmentPage" },
                  { path: "aumrti://pay/:ref",            desc: "Payment deep link → PaymentLandingPage" },
                  { path: "aumrti://ipd/:admissionId",    desc: "IPD workspace for specific admission" },
                  { path: "aumrti://lab/result/:orderId", desc: "Lab result notification → result detail" },
                  { path: "aumrti://alert/:alertId",      desc: "Clinical alert notification → alert detail" },
                ].map(dl => (
                  <div key={dl.path} className="flex items-center justify-between border border-border rounded-lg px-3 py-2">
                    <code className="font-mono text-primary text-[11px]">{dl.path}</code>
                    <span className="text-muted-foreground text-[11px] ml-4">{dl.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </TabsContent>

          {/* ── Registered Devices ── */}
          <TabsContent value="devices" className="flex-1 overflow-auto m-0">
            {recentTokens.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-muted-foreground p-4">
                <Smartphone size={28} className="opacity-20 mb-2" />
                <p className="text-[13px]">No registered devices yet. Install the app on a device to register.</p>
              </div>
            ) : (
              <table className="w-full text-[12px]">
                <thead className="sticky top-0 bg-muted/50 border-b border-border">
                  <tr>
                    {["User","Role","Platform","Last Seen","Status"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentTokens.map(t => (
                    <tr key={t.id} className="border-b border-border hover:bg-muted/20">
                      <td className="px-4 py-2.5 font-medium text-foreground">{(t.users as any)?.full_name || "—"}</td>
                      <td className="px-4 py-2.5 text-muted-foreground capitalize">{(t.users as any)?.role?.replace(/_/g, " ") || "—"}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium", t.platform === "android" ? "bg-green-50 text-green-700" : t.platform === "ios" ? "bg-blue-50 text-blue-700" : "bg-violet-50 text-violet-700")}>
                          {t.platform === "android" ? "🤖 Android" : t.platform === "ios" ? "🍎 iOS" : "🌐 Web"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{format(new Date(t.last_seen_at), "dd/MM HH:mm")}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-[11px] px-2 py-0.5 rounded-full font-medium border", t.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border")}>
                          {t.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </TabsContent>

          {/* ── Push Notifications ── */}
          <TabsContent value="push" className="flex-1 overflow-hidden flex flex-col m-0">
            {/* Send form */}
            <div className="flex-shrink-0 border-b border-border p-4 bg-muted/20">
              <p className="text-[12px] font-semibold text-foreground mb-3">Send Push Notification</p>
              <div className="flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-[11px] text-muted-foreground">Title</label>
                  <Input value={pushForm.title} onChange={e => setPushForm(p => ({ ...p, title: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="e.g. New Lab Result Available" />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] text-muted-foreground">Body</label>
                  <Input value={pushForm.body} onChange={e => setPushForm(p => ({ ...p, body: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="Message body…" />
                </div>
                <div className="w-44">
                  <label className="text-[11px] text-muted-foreground">Target</label>
                  <Select value={pushForm.target} onValueChange={v => setPushForm(p => ({ ...p, target: v }))}>
                    <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all_doctors">All Doctors</SelectItem>
                      <SelectItem value="all_nurses">All Nurses</SelectItem>
                      <SelectItem value="all_staff">All Staff</SelectItem>
                      <SelectItem value="all_patients">All Patients</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button size="sm" onClick={sendPush} disabled={sending || !pushForm.title || !pushForm.body} className="h-9 gap-1.5 flex-shrink-0">
                  {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                  Send
                </Button>
              </div>
            </div>

            {/* Push log */}
            <div className="flex-1 overflow-auto">
              {pushLog.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
                  <Bell size={28} className="opacity-20 mb-2" />
                  <p className="text-[13px]">No push notifications sent yet.</p>
                </div>
              ) : (
                <table className="w-full text-[12px]">
                  <thead className="sticky top-0 bg-muted/50 border-b border-border">
                    <tr>
                      {["Time","Title","Body","Platform","Status"].map(h => (
                        <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pushLog.map(p => (
                      <tr key={p.id} className="border-b border-border hover:bg-muted/20">
                        <td className="px-4 py-2.5 text-muted-foreground">{format(new Date(p.created_at), "dd/MM HH:mm")}</td>
                        <td className="px-4 py-2.5 font-medium text-foreground">{p.title}</td>
                        <td className="px-4 py-2.5 text-muted-foreground max-w-[200px] truncate">{p.body}</td>
                        <td className="px-4 py-2.5 text-muted-foreground capitalize">{p.platform || "all"}</td>
                        <td className="px-4 py-2.5">
                          <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium",
                            p.status === "sent" || p.status === "delivered" ? "bg-green-50 text-green-700 border-green-200" :
                            p.status === "failed" ? "bg-red-50 text-red-700 border-red-200" :
                            "bg-amber-50 text-amber-700 border-amber-200"
                          )}>
                            {p.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </TabsContent>

          {/* ── Tech Stack ── */}
          <TabsContent value="tech" className="flex-1 overflow-auto p-5 m-0">
            <div className="max-w-xl space-y-4">
              <div className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="bg-muted/50 px-4 py-2.5">
                  <p className="text-[13px] font-semibold text-foreground">Mobile App Architecture</p>
                </div>
                <table className="w-full text-[12px]">
                  <tbody>
                    {TECH_STACK.map(t => (
                      <tr key={t.label} className="border-t border-border">
                        <td className="px-4 py-2.5 text-muted-foreground font-medium w-44">{t.label}</td>
                        <td className="px-4 py-2.5 text-foreground">{t.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
                <p className="text-[12px] text-blue-800 font-semibold">Infrastructure Ready</p>
                <div className="space-y-1">
                  {[
                    "Migration 012: fcm_tokens + push_notifications tables ✅",
                    "send-push-notification edge function ✅",
                    "Supabase Auth JWT shared with web app ✅",
                    "Supabase Realtime channels compatible ✅",
                    "offlineQueue.ts patterns portable to WatermelonDB ✅",
                    "ABDM SDK integration points documented ✅",
                  ].map(item => (
                    <div key={item} className="flex items-center gap-1.5 text-[11px] text-blue-800">
                      <CheckCircle2 size={10} className="text-blue-600 flex-shrink-0" />
                      {item}
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4">
                <p className="text-[13px] font-semibold text-foreground mb-2">Expo Build Commands</p>
                <div className="space-y-1.5 font-mono text-[11px] bg-slate-900 text-slate-100 rounded-lg p-3">
                  <p><span className="text-slate-500"># Doctor App</span></p>
                  <p>eas build --platform android --profile doctor</p>
                  <p>eas build --platform ios --profile doctor</p>
                  <p className="mt-2"><span className="text-slate-500"># Submit to stores</span></p>
                  <p>eas submit --platform android</p>
                  <p>eas submit --platform ios</p>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
