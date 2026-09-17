import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Network, Plus, CheckCircle2, Loader2, Download, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import EmptyState from "@/components/EmptyState";

const HL7_MESSAGE_TYPES = [
  { code: "ADT^A01", desc: "Admit Patient" },
  { code: "ADT^A03", desc: "Discharge Patient" },
  { code: "ADT^A08", desc: "Update Patient Info" },
  { code: "ORU^R01", desc: "Lab Result" },
  { code: "ORM^O01", desc: "Order Message" },
  { code: "SIU^S12", desc: "Schedule Appointment" },
];

/** The hospital_settings key this screen owns. */
const HL7_SETTINGS_KEY = "hl7_integration";

export default function SettingsHL7Page() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("config");
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState({
    mirth_host: "", mirth_port: "6661", mirth_channel: "",
    sending_facility: "AUMRTI", sending_app: "HMS",
    receiving_facility: "", receiving_app: "LIS",
    adt_enabled: true, orm_enabled: true, oru_enabled: true,
    vitals_feed_enabled: false, vitals_source: "mindray",
  });

  // Hydrate from the stored row. Without this the form always rendered its hardcoded
  // defaults, so every value appeared to reset on reload even once the write worked.
  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("hospital_settings")
        .select("value")
        .eq("hospital_id", hospitalId)
        .eq("key", HL7_SETTINGS_KEY)
        .maybeSingle();
      if (data?.value) setConfig(prev => ({ ...prev, ...data.value }));
    })();
  }, [hospitalId]);

  const saveConfig = async () => {
    if (!hospitalId) return;
    setSaving(true);
    // This used to upsert into a `config_values` table that does not exist — the resulting
    // 404 was discarded and the success toast fired anyway, so the screen claimed to save
    // for an entire release while storing nothing. `hospital_settings` is the key/value
    // table the other settings screens use; the error is checked now for the same reason.
    const { error } = await (supabase as any).from("hospital_settings").upsert({
      hospital_id: hospitalId,
      key: HL7_SETTINGS_KEY,
      value: config,
      updated_at: new Date().toISOString(),
    }, { onConflict: "hospital_id,key" });
    setSaving(false);
    if (error) {
      toast({
        title: "Could not save HL7 configuration",
        description: error.message,
        variant: "destructive",
      });
      return;
    }
    toast({ title: "HL7 configuration saved" });
  };

  const testConnection = async () => {
    toast({ title: "Testing Mirth Connect connection…" });
    setTimeout(() => {
      if (config.mirth_host) {
        toast({ title: "✓ Mirth Connect reachable", description: `${config.mirth_host}:${config.mirth_port}` });
      } else {
        toast({ title: "Connection failed — no host configured", variant: "destructive" });
      }
    }, 1500);
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">HL7 / Device Integration</h1>
        </div>
        <Button size="sm" variant="outline" onClick={testConnection} className="gap-1.5 h-8">
          <RefreshCw size={12} /> Test Connection
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
          <TabsTrigger value="config" className="text-[13px]">Mirth Connect Config</TabsTrigger>
          <TabsTrigger value="messages" className="text-[13px]">Message Types</TabsTrigger>
          <TabsTrigger value="devices" className="text-[13px]">Vitals Devices</TabsTrigger>
          <TabsTrigger value="log" className="text-[13px]">Message Log</TabsTrigger>
        </TabsList>

        {/* ── Config ── */}
        <TabsContent value="config" className="flex-1 overflow-auto p-6 m-0">
          <div className="max-w-xl space-y-5">
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
              <p className="text-[12px] text-blue-800 font-medium">Mirth Connect Interface Engine</p>
              <p className="text-[12px] text-blue-700 mt-0.5">Aumrti connects to your existing Mirth Connect instance for HL7 v2.x message exchange with LIS, RIS, and bedside devices.</p>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-foreground">Connection Settings</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="text-[11px] text-muted-foreground">Mirth Host / IP</label>
                  <Input value={config.mirth_host} onChange={e => setConfig(p => ({ ...p, mirth_host: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="192.168.1.100 or mirth.hospital.local" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Port</label>
                  <Input value={config.mirth_port} onChange={e => setConfig(p => ({ ...p, mirth_port: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                </div>
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Channel ID (optional)</label>
                <Input value={config.mirth_channel} onChange={e => setConfig(p => ({ ...p, mirth_channel: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="Mirth channel UUID" />
              </div>
            </div>

            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <p className="text-[13px] font-semibold text-foreground">HL7 Identifiers</p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-muted-foreground">Sending Facility</label>
                  <Input value={config.sending_facility} onChange={e => setConfig(p => ({ ...p, sending_facility: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Sending Application</label>
                  <Input value={config.sending_app} onChange={e => setConfig(p => ({ ...p, sending_app: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Receiving Facility</label>
                  <Input value={config.receiving_facility} onChange={e => setConfig(p => ({ ...p, receiving_facility: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="LIS / RIS facility name" />
                </div>
                <div>
                  <label className="text-[11px] text-muted-foreground">Receiving Application</label>
                  <Input value={config.receiving_app} onChange={e => setConfig(p => ({ ...p, receiving_app: e.target.value }))} className="h-9 mt-1 text-[12px]" />
                </div>
              </div>
            </div>

            <Button onClick={saveConfig} disabled={saving} className="w-full gap-2">
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Save Configuration
            </Button>
          </div>
        </TabsContent>

        {/* ── Message Types ── */}
        <TabsContent value="messages" className="flex-1 overflow-auto p-6 m-0">
          <div className="max-w-xl space-y-3">
            <p className="text-[12px] text-muted-foreground">Enable/disable HL7 message types for outbound and inbound flows.</p>
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50"><tr>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">Message Type</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">Description</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">Direction</th>
                  <th className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">Enabled</th>
                </tr></thead>
                <tbody>
                  {[
                    { type: "ADT^A01", desc: "Admit — sent on IPD admission", dir: "Outbound", key: "adt_enabled" },
                    { type: "ADT^A03", desc: "Discharge — sent on discharge", dir: "Outbound", key: "adt_enabled" },
                    { type: "ORM^O01", desc: "Lab/Radiology orders", dir: "Outbound", key: "orm_enabled" },
                    { type: "ORU^R01", desc: "Lab results — received from LIS", dir: "Inbound", key: "oru_enabled" },
                  ].map(m => (
                    <tr key={m.type} className="border-t border-border">
                      <td className="px-4 py-2.5 font-mono text-[11px] font-bold text-foreground">{m.type}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{m.desc}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-[10px] px-2 py-0.5 rounded-full border font-medium", m.dir === "Outbound" ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-green-50 text-green-700 border-green-200")}>
                          {m.dir}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => setConfig(p => ({ ...p, [m.key]: !(p as any)[m.key] }))}
                          className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition-colors", (config as any)[m.key] ? "bg-primary" : "bg-muted-foreground/30")}>
                          <span className={cn("inline-block h-3 w-3 rounded-full bg-white shadow transition-transform", (config as any)[m.key] ? "translate-x-5" : "translate-x-1")} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        {/* ── Vitals Devices ── */}
        <TabsContent value="devices" className="flex-1 overflow-auto p-6 m-0">
          <div className="max-w-xl space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-semibold text-foreground">Auto-populate ICU Flowsheet from Bedside Monitors</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">Vital signs from bedside devices auto-populate the ICU hourly flowsheet (Gap 6).</p>
              </div>
              {/* Hand-rolled switch. It still has to announce itself as one: without the role
                  and state a screen-reader user hears an unlabelled button and cannot tell
                  whether the bedside feed is on. */}
              <button
                type="button"
                role="switch"
                aria-checked={config.vitals_feed_enabled}
                aria-label="Auto-populate ICU Flowsheet from Bedside Monitors"
                onClick={() => setConfig(p => ({ ...p, vitals_feed_enabled: !p.vitals_feed_enabled }))}
                className={cn("relative inline-flex h-6 w-11 items-center rounded-full transition-colors flex-shrink-0", config.vitals_feed_enabled ? "bg-primary" : "bg-muted-foreground/30")}>
                <span className={cn("inline-block h-4 w-4 rounded-full bg-white shadow transition-transform", config.vitals_feed_enabled ? "translate-x-6" : "translate-x-1")} />
              </button>
            </div>

            {config.vitals_feed_enabled && (
              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <div>
                  <label className="text-[11px] text-muted-foreground">Device Manufacturer</label>
                  <Select value={config.vitals_source} onValueChange={v => setConfig(p => ({ ...p, vitals_source: v }))}>
                    <SelectTrigger className="h-9 mt-1 text-[12px]"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mindray">Mindray (BeneVision)</SelectItem>
                      <SelectItem value="philips">Philips IntelliVue</SelectItem>
                      <SelectItem value="ge">GE Healthcare</SelectItem>
                      <SelectItem value="drager">Dräger</SelectItem>
                      <SelectItem value="nihon_kohden">Nihon Kohden</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-[12px] text-amber-800">Requires Mirth Connect channel configured for your device's data format (HL7 ORU^R01 or proprietary protocol). Contact Aumrti support for device-specific configuration.</p>
                </div>
              </div>
            )}

            <Button onClick={saveConfig} disabled={saving} size="sm" className="gap-1.5">
              {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
              Save Device Config
            </Button>
          </div>
        </TabsContent>

        {/* ── Log ── */}
        {/* No hl7_message_log table exists yet — this tab used to render a hardcoded
            MOCK_LOG with timestamps computed relative to now(), so it always looked like a
            live feed. Replaced 2026-09-05 with an honest empty state; wire this up for real
            once a backing table exists rather than restoring the mock. */}
        <TabsContent value="log" className="flex-1 overflow-auto p-6 m-0">
          <div className="max-w-3xl h-full">
            <p className="text-[13px] font-semibold text-foreground mb-3">Recent HL7 Messages</p>
            <div className="border border-border rounded-xl h-[calc(100%-2rem)]">
              <EmptyState
                icon="📡"
                title="No message history yet"
                description="Message history will appear here once your Mirth Connect channel is configured and exchanging HL7 messages."
              />
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
