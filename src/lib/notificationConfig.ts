/**
 * Notification config — the shape stored in `hospital_settings` under `notification_config`,
 * its shipped defaults, and the merge rule.
 *
 * Split out of SettingsNotificationsPage so the merge behaviour can be unit-tested and so
 * anything that needs to READ the routing (an alert dispatcher, an edge function) does not
 * have to import a page component.
 *
 * WHY NOT `notification_preferences`: that table is per-PATIENT channel booleans
 * (email/sms/whatsapp/push + quiet hours). It cannot express "per alert type, one of
 * In-App / WhatsApp / Both", which is what the hospital configures here. `hospital_settings`
 * is the existing key/value store used the same way by `discount_approval_rules` and
 * `ipd_ancillary_payment`.
 */

export const NOTIFICATION_CONFIG_KEY = "notification_config";

export interface AlertRule {
  type: string;
  severity: string;
  recipients: string[];
  channel: string;
  escalationMin: number;
  escalateTo: string;
  active: boolean;
}

export interface QuietHours {
  enabled: boolean;
  from: string;
  to: string;
}

export interface NotificationConfig {
  alerts: AlertRule[];
  quietHours: QuietHours;
}

/**
 * Shipped defaults. A hospital that has never opened the screen still gets sensible routing,
 * and these are what the first save persists.
 */
export const DEFAULT_ALERTS: AlertRule[] = [
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

export const DEFAULT_QUIET_HOURS: QuietHours = { enabled: true, from: "23:00", to: "07:00" };

/**
 * Merge stored config over the defaults, keyed by alert type.
 *
 * Merging rather than replacing means an alert type shipped in a later release still appears
 * for a hospital that saved before it existed — otherwise a new critical alert would silently
 * never fire for every existing customer. `severity` is deliberately NOT taken from storage:
 * whether Code Blue is critical is a product decision, not a hospital preference.
 */
export function mergeAlerts(stored: unknown): AlertRule[] {
  if (!Array.isArray(stored)) return DEFAULT_ALERTS;

  const byType = new Map<string | undefined, Partial<AlertRule>>(
    stored
      .filter((a): a is Partial<AlertRule> => !!a && typeof a === "object")
      .map((a) => [a.type, a]),
  );

  return DEFAULT_ALERTS.map((d) => {
    const saved = byType.get(d.type);
    return saved ? { ...d, ...saved, type: d.type, severity: d.severity } : d;
  });
}
