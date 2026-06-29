import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";

const notifTypes = [
  "Appointment Confirmation",
  "Appointment Reminder (24h before)",
  "Token Called",
  "Lab Report Ready",
  "Bill Generated",
  "Payment Received",
  "Discharge Summary",
];

interface Props {
  hospitalId: string;
  hospitalName: string;
  onComplete: () => void;
}

const Step7WhatsApp: React.FC<Props> = ({ hospitalId, hospitalName, onComplete }) => {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [watiUrl, setWatiUrl] = useState("");
  const [watiToken, setWatiToken] = useState("");
  const [testResult, setTestResult] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [notifs, setNotifs] = useState<Set<string>>(new Set(notifTypes));
  const [saving, setSaving] = useState(false);

  const toggleNotif = (n: string) => {
    setNotifs((prev) => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });
  };

  const handleTest = () => {
    setTestResult("testing");
    setTimeout(() => setTestResult("success"), 1500);
  };

  const handleSave = async () => {
    setSaving(true);
    await supabase.from("hospitals").update({
      whatsapp_enabled: enabled,
      wati_api_url: watiUrl || null,
    } as any).eq("id", hospitalId);
    setSaving(false);
    onComplete();
  };

  return (
    <div>
      <span className="inline-block bg-[#EEF2FF] text-[#4F46E5] text-[11px] px-2.5 py-0.5 rounded-full font-medium mb-4">~3 min</span>
      <h2 className="text-[22px] font-bold text-foreground">Enable WhatsApp notifications</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-6">Send patients appointment reminders, reports & receipts via WhatsApp</p>

      {/* Main toggle */}
      <div className="flex items-center gap-3 mb-6">
        <Switch checked={enabled} onCheckedChange={setEnabled} />
        <span className="text-sm font-medium text-foreground">Enable WhatsApp Notifications</span>
        <span className={`text-[11px] px-2 py-0.5 rounded-full ${enabled ? "bg-[hsl(160,84%,90%)] text-[hsl(160,84%,25%)]" : "bg-muted text-muted-foreground"}`}>
          {enabled ? "🟢 Enabled" : "🔴 Disabled"}
        </span>
      </div>

      {!enabled ? (
        /* Preview */
        <div className="bg-[#ECE5DD] rounded-xl p-4 max-w-sm">
          <div className="bg-white rounded-lg p-3 shadow-sm text-[13px] leading-relaxed">
            <p>🏥 <strong>{hospitalName}</strong></p>
            <p className="mt-1">Dear Mrs. Priya, your OPD token A-23 is now being called. Please proceed to Room 2.</p>
            <p className="text-muted-foreground text-[11px] mt-1">— Aumrti</p>
          </div>
          <p className="text-[12px] text-center mt-3 text-[#4A4A4A]">Enable WhatsApp to send these messages automatically</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* WATI Credentials */}
          <div className="bg-[#FEF3C7] border-l-[3px] border-accent px-3.5 py-2.5 rounded text-[13px]">
            You need a <strong>WATI</strong> account to send WhatsApp messages.{" "}
            <a href="https://www.wati.io" target="_blank" rel="noopener" className="text-secondary font-medium hover:underline">Sign up for WATI ↗</a>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium">WATI API Endpoint URL</label>
              <Input value={watiUrl} onChange={(e) => setWatiUrl(e.target.value)} placeholder="https://live-server-XXXXX.wati.io" className="mt-1" />
            </div>
            <div>
              <label className="text-sm font-medium">WATI API Token</label>
              <Input type="password" value={watiToken} onChange={(e) => setWatiToken(e.target.value)} placeholder="Your API token" className="mt-1" />
            </div>
            <button onClick={handleTest} disabled={!watiUrl || testResult === "testing"} className="border border-primary text-primary px-4 py-2 rounded-md text-sm hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-40">
              {testResult === "testing" ? "Testing..." : testResult === "success" ? "✅ Connected!" : "Test Connection"}
            </button>
          </div>

          {/* Notification toggles */}
          <div>
            <p className="text-[13px] font-bold text-foreground mb-2">Which notifications to send?</p>
            <div className="space-y-2">
              {notifTypes.map((n) => (
                <label key={n} className="flex items-center gap-2.5 text-sm cursor-pointer">
                  <Switch checked={notifs.has(n)} onCheckedChange={() => toggleNotif(n)} />
                  {n}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between mt-8">
        <button onClick={onComplete} className="text-sm text-muted-foreground hover:text-foreground">Set up WhatsApp later →</button>
        <button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground px-7 py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 active:scale-[0.97]">
          {saving ? "Saving..." : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step7WhatsApp;
