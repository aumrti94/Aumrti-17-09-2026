/**
 * Notification config — which clinical events raise an alert, on which channel, and when
 * the ward stops being pinged at night.
 *
 * HISTORY: until Phase 2 QA this screen persisted nothing. "Save" ran a 500ms setTimeout and
 * then showed a green toast — a fake spinner in front of a no-op — so a hospital that routed
 * Critical Lab Value to WhatsApp found it back on In-App after the next reload. Logged as
 * BUG-P2-003, fixed here.
 *
 * WHY hospital_settings AND NOT notification_preferences
 * ------------------------------------------------------
 * `notification_preferences` is a per-PATIENT row of channel booleans
 * (email/sms/whatsapp/push + quiet hours). It has no way to express "per alert type, one of
 * In-App / WhatsApp / Both", which is what this screen configures. Rather than distort a
 * patient-scoped table into a hospital-scoped one, this uses the key/value
 * `hospital_settings` table that `discount_approval_rules` and `ipd_ancillary_payment`
 * already use.
 *
 * SECURITY NOTE (inherited from that pattern): hospital_settings has no per-role RLS — any
 * authenticated user of the hospital can write any key via PostgREST. The route guard
 * (RG path="/settings") is the only thing restricting this page. Locked by a Phase 2 §2K case.
 */
import React, { useEffect, useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import {
  NOTIFICATION_CONFIG_KEY, DEFAULT_ALERTS, DEFAULT_QUIET_HOURS, mergeAlerts,
  type AlertRule, type QuietHours,
} from "@/lib/notificationConfig";

const SettingsNotificationsPage: React.FC = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hospitalId } = useHospitalId();

  const [alerts, setAlerts] = useState<AlertRule[]>(DEFAULT_ALERTS);
  const [quietHours, setQuietHours] = useState<QuietHours>(DEFAULT_QUIET_HOURS);

  const { data: stored } = useQuery({
    queryKey: ["notification-config", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return null;
      const { data, error } = await supabase
        .from("hospital_settings")
        .select("value")
        .eq("hospital_id", hospitalId)
        .eq("key", NOTIFICATION_CONFIG_KEY)
        .maybeSingle();
      if (error) throw error;
      return (data?.value ?? null) as { alerts?: unknown; quietHours?: QuietHours } | null;
    },
    enabled: !!hospitalId,
  });

  useEffect(() => {
    if (!stored) return;
    setAlerts(mergeAlerts(stored.alerts));
    if (stored.quietHours) setQuietHours({ ...DEFAULT_QUIET_HOURS, ...stored.quietHours });
  }, [stored]);

  const save = useMutation({
    mutationFn: async () => {
      if (!hospitalId) throw new Error("No hospital context.");
      const { error } = await supabase.from("hospital_settings").upsert(
        {
          hospital_id: hospitalId,
          key: NOTIFICATION_CONFIG_KEY,
          value: { alerts, quietHours } as never,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "hospital_id,key" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Notification config saved" });
      qc.invalidateQueries({ queryKey: ["notification-config"] });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save notification config", description: e.message, variant: "destructive" }),
  });

  /** Immutable — the previous version mutated the array element before setState. */
  const patchAlert = (index: number, patch: Partial<AlertRule>) =>
    setAlerts((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  const sevColor = (s: string) => (s === "critical" ? "destructive" : s === "high" ? "default" : "secondary");

  return (
    <SettingsPageWrapper title="Notification Config" onSave={() => save.mutate()} saving={save.isPending}>
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
              <tr key={a.type} className="border-t border-border">
                <td className="px-3 py-2 text-foreground font-medium">{a.type}</td>
                <td className="px-3 py-2"><Badge variant={sevColor(a.severity)}>{a.severity}</Badge></td>
                <td className="px-3 py-2">
                  <Select value={a.channel} onValueChange={(v) => patchAlert(i, { channel: v })}>
                    <SelectTrigger className="h-7 w-28" aria-label={`Channel for ${a.type}`}><SelectValue /></SelectTrigger>
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
                <td className="px-3 py-2">
                  <Switch checked={a.active} aria-label={`${a.type} active`} onCheckedChange={(v) => patchAlert(i, { active: v })} />
                </td>
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
          <Switch checked={quietHours.enabled} aria-label="Quiet Hours" onCheckedChange={(v) => setQuietHours({ ...quietHours, enabled: v })} />
        </div>
        {quietHours.enabled && (
          <div className="flex items-center gap-3">
            <span className="text-sm">From</span>
            <Input type="time" aria-label="Quiet hours from" value={quietHours.from} onChange={(e) => setQuietHours({ ...quietHours, from: e.target.value })} className="w-28 h-8" />
            <span className="text-sm">To</span>
            <Input type="time" aria-label="Quiet hours to" value={quietHours.to} onChange={(e) => setQuietHours({ ...quietHours, to: e.target.value })} className="w-28 h-8" />
          </div>
        )}
      </section>
    </SettingsPageWrapper>
  );
};

export default SettingsNotificationsPage;
