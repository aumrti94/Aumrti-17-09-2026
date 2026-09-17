/**
 * Alert escalation rules — the shape of `alert_escalation_rules`, the alert types Settings
 * exposes, and the pure mapping between the two.
 *
 * REPLACES `notificationConfig.ts`, deleted in D1 (PHASED_TEST_PLAN.md §2). That module
 * described a `hospital_settings` key which Settings › Notifications wrote and **nothing
 * ever read** — a hospital that routed Code Blue to WhatsApp got a green "saved" toast and
 * no WhatsApp message. `alert_escalation_rules` is the table the cron'd `alert-escalation`
 * edge function actually reads every five minutes, so it is the only place a routing choice
 * can have an effect. Full history and the data migration: supabase/migrations/
 * 20261106000005 and 20261106000006.
 *
 * Split out of the page component so the merge and mapping rules can be unit-tested, and so
 * anything that needs to read routing does not import a page.
 */

/** Channels the escalation function can actually dispatch on. Matches the CHECK in 20261106000005. */
export const ESCALATION_CHANNELS = ["in_app", "whatsapp", "sms", "email"] as const;
export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number];

export const CHANNEL_LABELS: Record<EscalationChannel, string> = {
  in_app: "In-App",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
};

/**
 * `clinical_alerts.severity` is CHECKed to these four (20260322092601). The retired config
 * screen offered "normal", which is not one of them — a rule carrying it filtered on a
 * severity no alert row can hold and therefore escalated nothing, silently.
 */
export const ALERT_SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface EscalationRule {
  /** Row id when persisted; absent for a rule the hospital has not saved yet. */
  id?: string;
  /** A `clinical_alerts.alert_type` value, or null meaning "every type". */
  alertType: string | null;
  severity: AlertSeverity;
  escalateAfterMinutes: number;
  channels: EscalationChannel[];
  notifyRoles: string[];
  isActive: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string;
  quietHoursEnd: string;
}

/**
 * The alert types Settings exposes, with their display names.
 *
 * Every entry MUST be a value `clinical_alerts.alert_type` can hold — the CHECK constraint
 * is at 20261008000035. A row keyed on an alert type nothing raises is a rule that can never
 * fire: it renders as configured, saves without error, and escalates nothing. That is the
 * defect class D1 exists to remove, so this list is deliberately shorter than the retired
 * screen's. "Bed Occupancy > 90%", "Drug Stockout", "Large Bill" and "New Admission" are
 * absent because no code path raises a clinical alert for them.
 */
export const ESCALATABLE_ALERT_TYPES: {
  alertType: string;
  label: string;
  severity: AlertSeverity;
}[] = [
  { alertType: "code_blue", label: "Code Blue", severity: "critical" },
  { alertType: "critical_lab_value", label: "Critical Lab Value", severity: "critical" },
  { alertType: "critical_radiology", label: "Critical Radiology Finding", severity: "critical" },
  { alertType: "sepsis_risk", label: "Sepsis Risk", severity: "critical" },
  { alertType: "high_news2", label: "NEWS2 Deterioration", severity: "high" },
  { alertType: "vitals_critical", label: "Critical Vitals", severity: "high" },
  { alertType: "drug_interaction", label: "Drug Interaction", severity: "high" },
  { alertType: "allergy_alert", label: "Allergy Conflict", severity: "high" },
  { alertType: "mar_overdue", label: "Medication Overdue", severity: "medium" },
  { alertType: "lab_tat_overdue", label: "Lab TAT Breach", severity: "medium" },
  { alertType: "radiology_report_overdue", label: "Radiology Report Overdue", severity: "medium" },
  { alertType: "discharge_delay", label: "Discharge Delay", severity: "medium" },
];

/**
 * Severities that escalate regardless of quiet hours.
 *
 * CLAUDE.md: clinical alerts "surface immediately; they are never silenced or batched".
 * The escalation function checks severity before quiet hours, so this is a mirror of that
 * behaviour for the UI — the screen must not offer a quiet-hours control that implies a
 * critical alert can be held back, because it cannot be.
 */
export function quietHoursApplicable(severity: AlertSeverity): boolean {
  return severity !== "critical";
}

export const DEFAULT_QUIET_HOURS_START = "23:00";
export const DEFAULT_QUIET_HOURS_END = "07:00";

/** Shipped default for an alert type the hospital has never configured. */
export function defaultRuleFor(entry: (typeof ESCALATABLE_ALERT_TYPES)[number]): EscalationRule {
  const critical = entry.severity === "critical";
  return {
    alertType: entry.alertType,
    severity: entry.severity,
    // Critical escalates fast; everything else gets the ward a reasonable window to act.
    escalateAfterMinutes: critical ? 5 : entry.severity === "high" ? 15 : 30,
    channels: critical ? ["in_app", "sms"] : ["in_app"],
    notifyRoles: ["doctor", "admin"],
    isActive: true,
    quietHoursEnabled: false,
    quietHoursStart: DEFAULT_QUIET_HOURS_START,
    quietHoursEnd: DEFAULT_QUIET_HOURS_END,
  };
}

/** The shape a row comes back as from `alert_escalation_rules`. */
export interface EscalationRuleRow {
  id?: string | null;
  alert_type?: string | null;
  severity?: string | null;
  escalate_after_minutes?: number | string | null;
  escalation_channels?: string[] | null;
  notify_roles?: string[] | null;
  is_active?: boolean | null;
  quiet_hours_enabled?: boolean | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}

const isChannel = (c: unknown): c is EscalationChannel =>
  typeof c === "string" && (ESCALATION_CHANNELS as readonly string[]).includes(c);

const isSeverity = (s: unknown): s is AlertSeverity =>
  typeof s === "string" && (ALERT_SEVERITIES as readonly string[]).includes(s);

/** `time` comes back as "23:00:00"; the `<input type="time">` wants "23:00". */
export function trimSeconds(t: string | null | undefined, fallback: string): string {
  if (!t) return fallback;
  const m = /^(\d{2}:\d{2})/.exec(String(t));
  return m ? m[1] : fallback;
}

/**
 * Merge stored rows over the shipped defaults, keyed by alert type.
 *
 * Merging rather than replacing means an alert type shipped in a later release still
 * appears for a hospital that saved before it existed — otherwise a newly-added critical
 * alert would silently have no escalation rule for every existing customer.
 *
 * `severity` is NOT taken from storage: whether Code Blue is critical is a product
 * decision, not a hospital preference, and it is also what decides whether quiet hours can
 * touch the rule. Letting a hospital downgrade Code Blue to "medium" would hand them a way
 * to silence it overnight through the back door.
 */
export function mergeEscalationRules(stored: unknown): EscalationRule[] {
  const rows: EscalationRuleRow[] = Array.isArray(stored) ? (stored as EscalationRuleRow[]) : [];
  const byType = new Map<string, EscalationRuleRow>();
  for (const r of rows) {
    if (r && typeof r === "object" && typeof r.alert_type === "string") byType.set(r.alert_type, r);
  }

  return ESCALATABLE_ALERT_TYPES.map((entry) => {
    const base = defaultRuleFor(entry);
    const saved = byType.get(entry.alertType);
    if (!saved) return base;

    const channels = (saved.escalation_channels ?? []).filter(isChannel);
    const minutes = Number(saved.escalate_after_minutes);
    const roles = (saved.notify_roles ?? []).filter((r): r is string => typeof r === "string");

    return {
      ...base,
      id: saved.id ?? undefined,
      // Severity stays the product's, but a stored value outside the vocabulary is worth
      // knowing about: fall back to the shipped severity rather than trusting it.
      severity: isSeverity(saved.severity) && saved.severity === base.severity ? saved.severity : base.severity,
      escalateAfterMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : base.escalateAfterMinutes,
      channels: channels.length > 0 ? channels : base.channels,
      notifyRoles: roles.length > 0 ? roles : base.notifyRoles,
      isActive: typeof saved.is_active === "boolean" ? saved.is_active : base.isActive,
      // A critical rule can never carry quiet hours, whatever the row says.
      quietHoursEnabled: quietHoursApplicable(base.severity)
        ? saved.quiet_hours_enabled === true
        : false,
      quietHoursStart: trimSeconds(saved.quiet_hours_start, base.quietHoursStart),
      quietHoursEnd: trimSeconds(saved.quiet_hours_end, base.quietHoursEnd),
    };
  });
}

/** The row shape to upsert. Inverse of mergeEscalationRules for the fields Settings owns. */
export function toEscalationRuleRow(rule: EscalationRule, hospitalId: string) {
  const quiet = quietHoursApplicable(rule.severity) && rule.quietHoursEnabled;
  return {
    hospital_id: hospitalId,
    alert_type: rule.alertType,
    severity: rule.severity,
    escalate_after_minutes: rule.escalateAfterMinutes,
    escalation_channels: rule.channels,
    notify_roles: rule.notifyRoles,
    is_active: rule.isActive,
    quiet_hours_enabled: quiet,
    // The CHECK in 20261106000005 requires both bounds when enabled, and rejects nothing
    // when disabled — so write nulls rather than leaving a stale window behind.
    quiet_hours_start: quiet ? rule.quietHoursStart : null,
    quiet_hours_end: quiet ? rule.quietHoursEnd : null,
    updated_at: new Date().toISOString(),
  };
}
