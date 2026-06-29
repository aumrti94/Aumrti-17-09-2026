import React, { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  TrendingUp, TrendingDown, AlertTriangle, ShieldCheck,
  ChevronDown, ChevronUp, Loader2, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

interface QIAlert {
  id: string;
  alert_message: string;
  severity: string;
  ward_name: string | null;   // indicator key, e.g. "avg_los"
  bed_number: string | null;  // JSON: { label, current, baseline, deviation_pct, unit }
  created_at: string;
}

interface MetricMeta {
  label: string;
  current: number;
  baseline: number;
  deviation_pct: number;
  unit: string;
}

// Roles allowed to dismiss
const DISMISS_ROLES = [
  "super_admin", "hospital_admin",
  "quality_manager", "quality_officer",
  "medical_superintendent", "quality_head",
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INDICATOR_ICONS: Record<string, string> = {
  avg_los:             "🛏️",
  readmission_48h_pct: "🔄",
  lab_tat_breach_pct:  "🧪",
  ot_cancellation_pct: "🔪",
  capa_overdue_pct:    "⏰",
  infection_rate:      "🦠",
};

function parseMeta(raw: string | null): MetricMeta | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as MetricMeta; } catch { return null; }
}

function DeviationChip({ pct }: { pct: number }) {
  const abs = Math.abs(pct);
  const up  = pct > 0;
  const colour = abs >= 40
    ? "bg-red-100 text-red-700"
    : abs >= 20
    ? "bg-amber-100 text-amber-700"
    : "bg-yellow-100 text-yellow-700";
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold", colour)}>
      {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {up ? "+" : ""}{pct}%
    </span>
  );
}

// ─── Dismiss modal ────────────────────────────────────────────────────────────

interface DismissModalProps {
  alert: QIAlert;
  onConfirm: (note: string) => void;
  onCancel: () => void;
  saving: boolean;
}

const DismissModal: React.FC<DismissModalProps> = ({ alert, onConfirm, onCancel, saving }) => {
  const [note, setNote] = useState("");
  const meta = parseMeta(alert.bed_number);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-xl shadow-2xl w-full max-w-md flex flex-col gap-4 p-5">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
          <h3 className="font-bold">Dismiss QI Anomaly Alert</h3>
        </div>

        <div className="bg-muted/40 rounded-lg p-3 text-sm space-y-1">
          <p className="font-medium">{meta?.label ?? alert.ward_name?.replace(/_/g, " ")}</p>
          {meta && (
            <p className="text-xs text-muted-foreground">
              Current: <strong>{meta.current}{meta.unit}</strong> · Baseline: {meta.baseline}{meta.unit} ·{" "}
              <DeviationChip pct={meta.deviation_pct} />
            </p>
          )}
          <p className="text-xs text-muted-foreground italic mt-1 line-clamp-3">{alert.alert_message}</p>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">
            Action / Root Cause Note <span className="text-destructive">*</span>
          </label>
          <Textarea
            rows={3}
            placeholder="Describe the root cause and corrective action taken or planned…"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="resize-none text-sm"
            autoFocus
          />
          <p className="text-[11px] text-muted-foreground">
            Required before dismissal. Saved to audit log for NABH IMS evidence.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={() => onConfirm(note)}
            disabled={!note.trim() || saving}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {saving
              ? <><Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Dismissing…</>
              : <><ShieldCheck className="h-4 w-4 mr-1.5" /> Confirm Dismiss</>}
          </Button>
        </div>
      </div>
    </div>
  );
};

// ─── Main card ────────────────────────────────────────────────────────────────

interface Props {
  hospitalId: string | null;
  role: string | null;
}

const NABHQIAlertCard: React.FC<Props> = ({ hospitalId, role }) => {
  const { toast } = useToast();
  const [alerts, setAlerts] = useState<QIAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [dismissTarget, setDismissTarget] = useState<QIAlert | null>(null);
  const [dismissSaving, setDismissSaving] = useState(false);

  const canDismiss = DISMISS_ROLES.includes(role ?? "");

  const load = useCallback(async () => {
    if (!hospitalId) return;
    const { data } = await (supabase as any)
      .from("clinical_alerts")
      .select("id, alert_message, severity, ward_name, bed_number, created_at")
      .eq("hospital_id", hospitalId)
      .eq("alert_type", "nabh_qi_anomaly")
      .eq("is_acknowledged", false)
      .order("created_at", { ascending: false })
      .limit(10);
    setAlerts(data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { load(); }, [load]);

  // Realtime subscription
  useEffect(() => {
    if (!hospitalId) return;
    const channel = supabase
      .channel("nabh_qi_alerts")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "clinical_alerts",
          filter: `hospital_id=eq.${hospitalId}`,
        },
        (payload: any) => {
          if (payload.new?.alert_type === "nabh_qi_anomaly") {
            setAlerts(prev => [payload.new as QIAlert, ...prev].slice(0, 10));
          }
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [hospitalId]);

  const handleDismiss = async (note: string) => {
    if (!dismissTarget) return;
    setDismissSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();

      // Mark alert acknowledged
      const { error } = await (supabase as any)
        .from("clinical_alerts")
        .update({
          is_acknowledged: true,
          acknowledged_by: user?.id ?? null,
          acknowledged_at: new Date().toISOString(),
        })
        .eq("id", dismissTarget.id);

      if (error) throw error;

      // Log the action note to config_change_logs for NABH IMS audit trail
      await (supabase as any).from("config_change_logs").insert({
        hospital_id: hospitalId,
        config_area: "nabh_qi_alert_dismissal",
        item_id: dismissTarget.id,
        changed_by: user?.id ?? null,
        old_value: { alert_message: dismissTarget.alert_message, indicator: dismissTarget.ward_name },
        new_value: { is_acknowledged: true, action_note: note },
        reason: note,
      });

      setAlerts(prev => prev.filter(a => a.id !== dismissTarget.id));
      toast({ title: "Alert dismissed", description: "Action note saved to audit log." });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      toast({ title: "Dismiss failed", description: msg, variant: "destructive" });
    } finally {
      setDismissSaving(false);
      setDismissTarget(null);
    }
  };

  if (loading || alerts.length === 0) return null;

  return (
    <>
      <div className="rounded-xl border border-amber-200 bg-amber-50/60 dark:bg-amber-950/20 dark:border-amber-800 overflow-hidden">
        {/* Header */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-amber-100/50 dark:hover:bg-amber-900/20 transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <span className="text-sm font-bold text-amber-800 dark:text-amber-300">
              NABH QI Anomaly Alerts
            </span>
            <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0 h-4">
              {alerts.length}
            </Badge>
            {!canDismiss && (
              <span className="text-[10px] text-amber-600 font-medium">
                (Quality role required to dismiss)
              </span>
            )}
          </div>
          {expanded
            ? <ChevronUp className="h-4 w-4 text-amber-600" />
            : <ChevronDown className="h-4 w-4 text-amber-600" />}
        </button>

        {/* Alert rows */}
        {expanded && (
          <div className="divide-y divide-amber-100 dark:divide-amber-800/40">
            {alerts.map(alert => {
              const meta = parseMeta(alert.bed_number);
              const icon = INDICATOR_ICONS[alert.ward_name ?? ""] ?? "📊";
              const isHigh = alert.severity === "high";

              return (
                <div
                  key={alert.id}
                  className={cn(
                    "flex items-start gap-3 px-4 py-3",
                    isHigh && "bg-red-50/40 dark:bg-red-950/10",
                  )}
                >
                  <span className="text-lg shrink-0 mt-0.5">{icon}</span>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground">
                        {meta?.label ?? alert.ward_name?.replace(/_/g, " ") ?? "QI Indicator"}
                      </span>
                      {meta && <DeviationChip pct={meta.deviation_pct} />}
                      <Badge
                        variant="outline"
                        className={cn(
                          "text-[10px] border-0 px-1.5",
                          isHigh ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700",
                        )}
                      >
                        {isHigh ? "High" : "Medium"}
                      </Badge>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {format(new Date(alert.created_at), "d MMM, HH:mm")}
                      </span>
                    </div>
                    {meta && (
                      <p className="text-[11px] text-muted-foreground">
                        This week: <strong>{meta.current}{meta.unit}</strong>
                        {" · "}4-week avg: {meta.baseline}{meta.unit}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground leading-relaxed">{alert.alert_message}</p>
                  </div>
                  {canDismiss && (
                    <button
                      onClick={() => setDismissTarget(alert)}
                      className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground transition-colors p-1 rounded hover:bg-amber-100"
                      title="Dismiss (requires action note)"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Dismiss modal */}
      {dismissTarget && (
        <DismissModal
          alert={dismissTarget}
          onConfirm={handleDismiss}
          onCancel={() => setDismissTarget(null)}
          saving={dismissSaving}
        />
      )}
    </>
  );
};

export default NABHQIAlertCard;
