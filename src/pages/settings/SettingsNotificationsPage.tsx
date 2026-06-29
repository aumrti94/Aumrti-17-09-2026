import React, { useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

const alertTypes = [
  { type: "Critical Lab Value", severity: "critical", recipients: ["Doctor", "CMO"], channel: "both", escalationMin: 15, escalateTo: "CMO", active: true },
  { type: "NEWS2 Score Alert", severity: "high", recipients: ["Doctor", "Nurse"], channel: "in_app", escalationMin: 30, escalateTo: "CMO", active: true },
  { type: "Medication Due", severity: "normal", recipients: ["Nurse"], channel: "in_app", escalationMin: 30, escalateTo: "Doctor", active: true },
  { type: "Discharge TAT Alert", severity: "high", recipients: ["Doctor", "Admin"], channel: "both", escalationMin: 60, escalateTo: "CMO", active: true },
  { type: "Bed Occupancy > 90%", severity: "high", recipients: ["Admin"], channel: "whatsapp", escalationMin: 0, escalateTo: "CEO", active: true },
  { type: "Drug Stockout", severity: "high", recipients: ["Pharmacist", "Admin"], channel: "both", escalationMin: 60, escalateTo: "Admin", active: true },
  { type: "Large Bill (> ₹50,000)", severity: "normal", recipients: ["Admin"], channel: "in_app", escalationMin: 0, escalateTo: "", active: true },
  { type: "New Admission", severity: "normal", recipients: ["Nurse", "Doctor"], channel: "in_app", escalationMin: 0, escalateTo: "", active: true },
  { type: "Code Blue", severity: "critical", recipients: ["Doctor", "Nurse", "CMO"], channel: "both", escalationMin: 5, escalateTo: "CMO", active: true },
  { type: "OT Starting in 30 min", severity: "normal", recipients: ["Doctor", "Nurse"], channel: "in_app", escalationMin: 0, escalateTo: "", active: true },
];

const SettingsNotificationsPage: React.FC = () => {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [alerts, setAlerts] = useState(alertTypes);
  const [quietHours, setQuietHours] = useState({ enabled: true, from: "23:00", to: "07:00" });

  const handleSave = () => { setSaving(true); setTimeout(() => { toast({ title: "Notification config saved" }); setSaving(false); }, 500); };

  const sevColor = (s: string) => s === "critical" ? "destructive" : s === "high" ? "default" : "secondary";

  return (
    <SettingsPageWrapper title="Notification Config" onSave={handleSave} saving={saving}>
      <p className="text-sm text-muted-foreground mb-4">Configure who gets notified for each clinical event.</p>

      <div className="border border-border rounded-lg overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead><tr className="bg-muted/50 text-left">
            <th className="px-3 py-2 font-medium text-muted-foreground">Alert Type</th>
            <th className="px-3 py-2 font-medium text-muted-foreground">Severity</th>
            <th className="px-3 py-2 font-medium text-muted-foreground">Channel</th>
            <th className="px-3 py-2 font-medium text-muted-foreground">Escalation</th>
            <th className="px-3 py-2 font-medium text-muted-foreground">Active</th>
          </tr></thead>
          <tbody>
            {alerts.map((a, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 text-foreground font-medium">{a.type}</td>
                <td className="px-3 py-2"><Badge variant={sevColor(a.severity)}>{a.severity}</Badge></td>
                <td className="px-3 py-2">
                  <Select value={a.channel} onValueChange={(v) => { const n = [...alerts]; n[i].channel = v; setAlerts(n); }}>
                    <SelectTrigger className="h-7 w-28"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="in_app">In-App</SelectItem>
                      <SelectItem value="whatsapp">WhatsApp</SelectItem>
                      <SelectItem value="both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
                <td className="px-3 py-2 text-xs text-muted-foreground">
                  {a.escalationMin > 0 ? `${a.escalationMin}min → ${a.escalateTo}` : "—"}
                </td>
                <td className="px-3 py-2"><Switch checked={a.active} onCheckedChange={(v) => { const n = [...alerts]; n[i].active = v; setAlerts(n); }} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <Label>Quiet Hours</Label>
            <p className="text-xs text-muted-foreground">Suppress non-critical alerts during quiet hours</p>
          </div>
          <Switch checked={quietHours.enabled} onCheckedChange={(v) => setQuietHours({ ...quietHours, enabled: v })} />
        </div>
        {quietHours.enabled && (
          <div className="flex items-center gap-3">
            <span className="text-sm">From</span>
            <Input type="time" value={quietHours.from} onChange={(e) => setQuietHours({ ...quietHours, from: e.target.value })} className="w-28 h-8" />
            <span className="text-sm">To</span>
            <Input type="time" value={quietHours.to} onChange={(e) => setQuietHours({ ...quietHours, to: e.target.value })} className="w-28 h-8" />
          </div>
        )}
      </section>
    </SettingsPageWrapper>
  );
};

export default SettingsNotificationsPage;
