/**
 * Alert escalation config — which unacknowledged clinical alerts get escalated, to whom,
 * on which channel, after how long, and when the ward stops being pinged at night.
 *
 * HISTORY, and why this screen was rewritten (D1)
 * -----------------------------------------------
 * Phase 2 QA found that "Save" here persisted nothing — a 500ms setTimeout behind a green
 * toast (BUG-P2-003). That was fixed by writing to a `hospital_settings` key.
 *
 * The fix made the screen save. It did not make it DO anything: that key was read by
 * nothing. The only thing that escalates an alert is the cron'd `alert-escalation` edge
 * function, and it reads `alert_escalation_rules`. So a hospital that routed Code Blue to
 * WhatsApp got a persisted setting, a green toast, and no WhatsApp message — a worse
 * failure than the no-op save, because it looked configured. Retired in D1; see
 * supabase/migrations/20261106000006 for the data migration and what it could not map.
 *
 * This screen now reads and writes `alert_escalation_rules` directly. Every control on it
 * changes something the escalation function will act on within five minutes.
 *
 * SECURITY NOTE: `alert_escalation_rules` RLS was USING-only until 20261106000005, which
 * means any authenticated user could previously INSERT a rule naming another hospital.
 * That migration adds WITH CHECK. The route guard (RG path="/settings") remains the only
 * thing restricting who reaches this page.
 */
import React, { useEffect, useState } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import {
  ESCALATION_CHANNELS,
  CHANNEL_LABELS,
  ESCALATABLE_ALERT_TYPES,
  mergeEscalationRules,
  quietHoursApplicable,
  toEscalationRuleRow,
  type EscalationChannel,
  type EscalationRule,
} from "@/lib/alertEscalationRules";

const LABEL_BY_TYPE = new Map(ESCALATABLE_ALERT_TYPES.map((e) => [e.alertType, e.label]));

const SettingsNotificationsPage: React.FC = () => {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { hospitalId } = useHospitalId();

  const [rules, setRules] = useState<EscalationRule[]>(() => mergeEscalationRules(null));

  const { data: stored } = useQuery({
    queryKey: ["alert-escalation-rules", hospitalId],
    queryFn: async () => {
      if (!hospitalId) return null;
      const { data, error } = await supabase
        .from("alert_escalation_rules")
        .select(
          "id, alert_type, severity, escalate_after_minutes, escalation_channels, notify_roles, is_active, quiet_hours_enabled, quiet_hours_start, quiet_hours_end",
        )
        .eq("hospital_id", hospitalId);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!hospitalId,
  });

  useEffect(() => {
    if (!stored) return;
    setRules(mergeEscalationRules(stored));
  }, [stored]);

  const save = useMutation({
    mutationFn: async () => {
      if (!hospitalId) throw new Error("No hospital context.");
      // One row per (hospital, alert_type, severity) — the unique index added in
      // 20261106000005. Without onConflict every save would append a duplicate rule, and
      // the escalation function iterates rules, so N saves would mean N pages per alert.
      const { error } = await supabase.from("alert_escalation_rules").upsert(
        rules.map((r) => toEscalationRuleRow(r, hospitalId)) as never,
        { onConflict: "hospital_id,alert_type,severity" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "Escalation rules saved" });
      qc.invalidateQueries({ queryKey: ["alert-escalation-rules"] });
    },
    onError: (e: Error) =>
      toast({ title: "Could not save escalation rules", description: e.message, variant: "destructive" }),
  });

  /** Immutable — the previous version mutated the array element before setState. */
  const patchRule = (index: number, patch: Partial<EscalationRule>) =>
    setRules((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const toggleChannel = (index: number, channel: EscalationChannel, on: boolean) =>
    setRules((prev) =>
      prev.map((r, i) => {
        if (i !== index) return r;
        const next = on ? [...new Set([...r.channels, channel])] : r.channels.filter((c) => c !== channel);
        return { ...r, channels: next };
      }),
    );

  const sevColor = (s: string) => (s === "critical" ? "destructive" : s === "high" ? "default" : "secondary");

  return (
    <SettingsPageWrapper title="Alert Escalation" onSave={() => save.mutate()} saving={save.isPending}>
      <p className="text-sm text-muted-foreground mb-4">
        When a clinical alert is not acknowledged within its window, escalate it on these channels.
      </p>

      <div className="border border-border rounded-lg overflow-x-auto mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 text-left">
              <th className="px-3 py-2 font-medium text-muted-foreground">Alert Type</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">Severity</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">Escalate After</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">Channels</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">Quiet Hours</th>
              <th className="px-3 py-2 font-medium text-muted-foreground">Active</th>
            </tr>
          </thead>
          <tbody>
            {rules.map((r, i) => {
              const label = LABEL_BY_TYPE.get(r.alertType ?? "") ?? r.alertType ?? "All alerts";
              const canQuiet = quietHoursApplicable(r.severity);
              return (
                <tr key={r.alertType ?? "all"} className="border-t border-border align-top">
                  <td className="px-3 py-2 text-foreground font-medium whitespace-nowrap">{label}</td>
                  <td className="px-3 py-2">
                    <Badge variant={sevColor(r.severity)}>{r.severity}</Badge>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        value={r.escalateAfterMinutes}
                        aria-label={`Escalate ${label} after minutes`}
                        onChange={(e) =>
                          patchRule(i, { escalateAfterMinutes: Math.max(1, Number(e.target.value) || 1) })
                        }
                        className="w-20 h-7"
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {ESCALATION_CHANNELS.map((c) => (
                        <label key={c} className="flex items-center gap-1 text-xs">
                          <input
                            type="checkbox"
                            checked={r.channels.includes(c)}
                            aria-label={`${CHANNEL_LABELS[c]} for ${label}`}
                            onChange={(e) => toggleChannel(i, c, e.target.checked)}
                            className="h-3.5 w-3.5"
                          />
                          {CHANNEL_LABELS[c]}
                        </label>
                      ))}
                    </div>
                    {r.channels.length === 0 && (
                      <p className="text-xs text-destructive mt-1">No channel — this alert will not escalate.</p>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {canQuiet ? (
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={r.quietHoursEnabled}
                          aria-label={`Quiet hours for ${label}`}
                          onCheckedChange={(v) => patchRule(i, { quietHoursEnabled: v })}
                        />
                        {r.quietHoursEnabled && (
                          <div className="flex items-center gap-1">
                            <Input
                              type="time"
                              aria-label={`Quiet hours from for ${label}`}
                              value={r.quietHoursStart}
                              onChange={(e) => patchRule(i, { quietHoursStart: e.target.value })}
                              className="w-24 h-7"
                            />
                            <span className="text-xs text-muted-foreground">–</span>
                            <Input
                              type="time"
                              aria-label={`Quiet hours to for ${label}`}
                              value={r.quietHoursEnd}
                              onChange={(e) => patchRule(i, { quietHoursEnd: e.target.value })}
                              className="w-24 h-7"
                            />
                          </div>
                        )}
                      </div>
                    ) : (
                      // Not a disabled control — an absent one. A greyed-out switch invites
                      // someone to ask why they cannot turn it on; this states the rule.
                      <span className="text-xs text-muted-foreground">Always escalates</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Switch
                      checked={r.isActive}
                      aria-label={`${label} active`}
                      onCheckedChange={(v) => patchRule(i, { isActive: v })}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <section className="bg-card border border-border rounded-lg p-4">
        <Label>Why critical alerts ignore quiet hours</Label>
        <p className="text-xs text-muted-foreground mt-1">
          Code Blue, critical lab values, critical radiology findings and sepsis risk escalate at any hour.
          Quiet hours suppress routine escalations only — a critical alert is never held back.
        </p>
      </section>
    </SettingsPageWrapper>
  );
};

export default SettingsNotificationsPage;
