/**
 * D1 (Phase 0) — the mapping layer between Settings › Notifications and the only table that
 * actually escalates an alert.
 *
 * The defect this replaces was not a crash: the old screen saved to a key nothing read, so
 * a hospital that routed Code Blue to WhatsApp got a green toast and no message. The
 * assertions below are therefore mostly about **what cannot be configured** — an alert type
 * that no code path raises, a severity no alert row can hold, or quiet hours on a critical
 * alert. Each of those would save successfully and escalate nothing.
 */
import { describe, it, expect } from "vitest";
import {
  ALERT_SEVERITIES,
  CHANNEL_LABELS,
  DEFAULT_QUIET_HOURS_END,
  DEFAULT_QUIET_HOURS_START,
  ESCALATABLE_ALERT_TYPES,
  ESCALATION_CHANNELS,
  defaultRuleFor,
  mergeEscalationRules,
  quietHoursApplicable,
  toEscalationRuleRow,
  trimSeconds,
  type EscalationRule,
} from "@/lib/alertEscalationRules";

const HOSPITAL_A = "11111111-1111-4111-8111-111111111111";

/** The vocabulary clinical_alerts.alert_type is CHECKed against (20261008000035). */
const REAL_ALERT_TYPES = new Set([
  "drug_interaction", "allergy_alert", "critical_value", "high_alert_med", "drug_override",
  "antibiotic_stewardship", "patient_safety", "payment_override",
  "high_news2", "vitals_critical", "mar_overdue", "sepsis_risk",
  "critical_lab_value", "stat_lab_order", "lab_trend", "lab_tat_overdue", "lab_tat_breach",
  "critical_radiology", "critical_incidental", "radiology_report_overdue",
  "blood_request", "specialist_consult", "code_blue",
  "escalation", "discharge_initiated", "discharge_delay",
]);

describe("the configurable vocabulary", () => {
  it("only offers alert types that something actually raises", () => {
    // THE CORE ASSERTION. A rule keyed on an alert_type no code path emits renders as
    // configured, saves without error, and escalates nothing — the exact silent-failure
    // shape D1 exists to remove. The retired screen offered five such types.
    for (const e of ESCALATABLE_ALERT_TYPES) {
      expect(REAL_ALERT_TYPES, e.alertType).toContain(e.alertType);
    }
  });

  it("does not re-offer the five types that have no alert behind them", () => {
    // KNOWN-BUG-112. Bed occupancy, drug stockout, large bill, new admission and OT
    // reminders were dropped by D1 because nothing raises a clinical alert for them. If
    // the product wants them, the alert has to be raised first.
    const labels = ESCALATABLE_ALERT_TYPES.map((e) => e.label);
    for (const dropped of ["Bed Occupancy > 90%", "Drug Stockout", "Large Bill (> ₹50,000)", "New Admission", "OT Starting in 30 min"]) {
      expect(labels, dropped).not.toContain(dropped);
    }
  });

  it("gives every alert type a unique key and a label", () => {
    const keys = ESCALATABLE_ALERT_TYPES.map((e) => e.alertType);
    expect(new Set(keys).size).toBe(keys.length);
    for (const e of ESCALATABLE_ALERT_TYPES) expect(e.label.length, e.alertType).toBeGreaterThan(0);
  });

  it("only uses severities clinical_alerts.severity can hold", () => {
    // The retired screen shipped "normal", which is not one of the four. A rule carrying it
    // filtered on a severity no alert row can have, so it matched nothing — silently.
    expect([...ALERT_SEVERITIES]).toEqual(["critical", "high", "medium", "low"]);
    for (const e of ESCALATABLE_ALERT_TYPES) {
      expect(ALERT_SEVERITIES, e.alertType).toContain(e.severity);
    }
  });

  it("only offers channels the escalation function can dispatch", () => {
    expect([...ESCALATION_CHANNELS]).toEqual(["in_app", "whatsapp", "sms", "email"]);
    for (const c of ESCALATION_CHANNELS) expect(CHANNEL_LABELS[c].length).toBeGreaterThan(0);
  });
});

describe("quiet hours can never reach a critical alert", () => {
  // CLAUDE.md: clinical alerts "surface immediately; they are never silenced or batched".
  // This is mirrored in three places — the UI, the row writer, and the edge function — so
  // it is asserted at each layer this module owns.

  it("reports critical as not quiet-hours-applicable", () => {
    expect(quietHoursApplicable("critical")).toBe(false);
    expect(quietHoursApplicable("high")).toBe(true);
    expect(quietHoursApplicable("medium")).toBe(true);
    expect(quietHoursApplicable("low")).toBe(true);
  });

  it("ships every critical alert type with quiet hours off", () => {
    for (const e of ESCALATABLE_ALERT_TYPES.filter((x) => x.severity === "critical")) {
      expect(defaultRuleFor(e).quietHoursEnabled, e.alertType).toBe(false);
    }
  });

  it("refuses to load quiet hours onto a critical rule even if the row says otherwise", () => {
    // A row written by hand, by an older client, or by a future bug must not be able to
    // silence Code Blue overnight.
    const merged = mergeEscalationRules([
      {
        alert_type: "code_blue",
        severity: "critical",
        quiet_hours_enabled: true,
        quiet_hours_start: "23:00:00",
        quiet_hours_end: "07:00:00",
      },
    ]);
    const codeBlue = merged.find((r) => r.alertType === "code_blue")!;
    expect(codeBlue.quietHoursEnabled).toBe(false);
  });

  it("refuses to write quiet hours onto a critical rule", () => {
    const rule: EscalationRule = {
      ...defaultRuleFor(ESCALATABLE_ALERT_TYPES.find((e) => e.alertType === "code_blue")!),
      quietHoursEnabled: true,
      quietHoursStart: "23:00",
      quietHoursEnd: "07:00",
    };
    const row = toEscalationRuleRow(rule, HOSPITAL_A);
    expect(row.quiet_hours_enabled).toBe(false);
    expect(row.quiet_hours_start).toBeNull();
    expect(row.quiet_hours_end).toBeNull();
  });

  it("does allow quiet hours on a non-critical rule", () => {
    const rule: EscalationRule = {
      ...defaultRuleFor(ESCALATABLE_ALERT_TYPES.find((e) => e.alertType === "mar_overdue")!),
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "06:30",
    };
    const row = toEscalationRuleRow(rule, HOSPITAL_A);
    expect(row.quiet_hours_enabled).toBe(true);
    expect(row.quiet_hours_start).toBe("22:00");
    expect(row.quiet_hours_end).toBe("06:30");
  });
});

describe("defaultRuleFor", () => {
  it("escalates critical alerts fastest", () => {
    const critical = defaultRuleFor({ alertType: "code_blue", label: "Code Blue", severity: "critical" });
    const medium = defaultRuleFor({ alertType: "mar_overdue", label: "Medication Overdue", severity: "medium" });
    expect(critical.escalateAfterMinutes).toBeLessThan(medium.escalateAfterMinutes);
  });

  it("gives every shipped rule at least one channel", () => {
    // A rule with no channel saves happily and escalates nowhere.
    for (const e of ESCALATABLE_ALERT_TYPES) {
      expect(defaultRuleFor(e).channels.length, e.alertType).toBeGreaterThan(0);
    }
  });

  it("puts critical alerts on a channel that leaves the building", () => {
    // In-app alone is not an escalation: the alert was already in-app and unacknowledged,
    // which is why it is being escalated at all.
    for (const e of ESCALATABLE_ALERT_TYPES.filter((x) => x.severity === "critical")) {
      const channels = defaultRuleFor(e).channels;
      expect(channels.some((c) => c === "sms" || c === "email" || c === "whatsapp"), e.alertType).toBe(true);
    }
  });
});

describe("mergeEscalationRules", () => {
  it("returns the shipped defaults when nothing is stored", () => {
    for (const stored of [null, undefined, [], "garbage", 42, {}]) {
      expect(mergeEscalationRules(stored)).toHaveLength(ESCALATABLE_ALERT_TYPES.length);
    }
  });

  it("keeps an alert type the hospital has never saved", () => {
    // Merging rather than replacing means a critical alert shipped in a later release still
    // gets a rule for every existing customer, instead of silently having none.
    const merged = mergeEscalationRules([{ alert_type: "mar_overdue", escalation_channels: ["email"] }]);
    expect(merged).toHaveLength(ESCALATABLE_ALERT_TYPES.length);
    expect(merged.find((r) => r.alertType === "code_blue")).toBeDefined();
  });

  it("applies stored values over the defaults", () => {
    const merged = mergeEscalationRules([
      {
        id: "row-1",
        alert_type: "mar_overdue",
        severity: "medium",
        escalate_after_minutes: 45,
        escalation_channels: ["sms", "email"],
        notify_roles: ["nurse"],
        is_active: false,
        quiet_hours_enabled: true,
        quiet_hours_start: "22:00:00",
        quiet_hours_end: "06:00:00",
      },
    ]);
    const rule = merged.find((r) => r.alertType === "mar_overdue")!;
    expect(rule).toMatchObject({
      id: "row-1",
      escalateAfterMinutes: 45,
      channels: ["sms", "email"],
      notifyRoles: ["nurse"],
      isActive: false,
      quietHoursEnabled: true,
      quietHoursStart: "22:00",
      quietHoursEnd: "06:00",
    });
  });

  it("never takes severity from storage", () => {
    // Whether Code Blue is critical is a product decision, not a hospital preference — and
    // it is also what decides whether quiet hours can touch the rule. Honouring a stored
    // downgrade would be a back door to silencing Code Blue overnight.
    const merged = mergeEscalationRules([{ alert_type: "code_blue", severity: "low" }]);
    expect(merged.find((r) => r.alertType === "code_blue")!.severity).toBe("critical");
  });

  it("drops stored channels that are not dispatchable", () => {
    const merged = mergeEscalationRules([
      { alert_type: "mar_overdue", escalation_channels: ["sms", "carrier_pigeon", "push"] },
    ]);
    expect(merged.find((r) => r.alertType === "mar_overdue")!.channels).toEqual(["sms"]);
  });

  it("falls back to the default channels rather than leaving a rule with none", () => {
    const base = defaultRuleFor(ESCALATABLE_ALERT_TYPES.find((e) => e.alertType === "code_blue")!);
    const merged = mergeEscalationRules([{ alert_type: "code_blue", escalation_channels: ["push"] }]);
    expect(merged.find((r) => r.alertType === "code_blue")!.channels).toEqual(base.channels);
  });

  it("rejects a non-positive or unparseable escalation window", () => {
    // 0 minutes would escalate every alert on the very next cron tick, before anyone could
    // acknowledge it; a NaN would compute a cutoff of Invalid Date and match nothing.
    for (const minutes of [0, -5, "abc", null, undefined]) {
      const merged = mergeEscalationRules([{ alert_type: "mar_overdue", escalate_after_minutes: minutes as never }]);
      expect(merged.find((r) => r.alertType === "mar_overdue")!.escalateAfterMinutes).toBe(30);
    }
  });

  it("ignores rows for alert types it does not offer", () => {
    const merged = mergeEscalationRules([{ alert_type: "bed_occupancy", escalation_channels: ["sms"] }]);
    expect(merged.map((r) => r.alertType)).not.toContain("bed_occupancy");
  });

  it("tolerates malformed rows without dropping the whole config", () => {
    const merged = mergeEscalationRules([null, "nope", 7, { alert_type: null }, { alert_type: "mar_overdue", escalation_channels: ["sms"] }]);
    expect(merged).toHaveLength(ESCALATABLE_ALERT_TYPES.length);
    expect(merged.find((r) => r.alertType === "mar_overdue")!.channels).toEqual(["sms"]);
  });
});

describe("trimSeconds", () => {
  it("converts a Postgres time to what <input type=\"time\"> expects", () => {
    expect(trimSeconds("23:00:00", "00:00")).toBe("23:00");
    expect(trimSeconds("06:30:00+05:30", "00:00")).toBe("06:30");
    expect(trimSeconds("07:15", "00:00")).toBe("07:15");
  });

  it("falls back when the value is missing or unparseable", () => {
    expect(trimSeconds(null, DEFAULT_QUIET_HOURS_START)).toBe(DEFAULT_QUIET_HOURS_START);
    expect(trimSeconds(undefined, DEFAULT_QUIET_HOURS_END)).toBe(DEFAULT_QUIET_HOURS_END);
    expect(trimSeconds("", "01:00")).toBe("01:00");
    expect(trimSeconds("not a time", "01:00")).toBe("01:00");
  });
});

describe("toEscalationRuleRow", () => {
  const rule = defaultRuleFor(ESCALATABLE_ALERT_TYPES.find((e) => e.alertType === "mar_overdue")!);

  it("carries the tenant on every row", () => {
    expect(toEscalationRuleRow(rule, HOSPITAL_A).hospital_id).toBe(HOSPITAL_A);
  });

  it("writes the snake_case shape the table stores", () => {
    const row = toEscalationRuleRow(rule, HOSPITAL_A);
    expect(Object.keys(row).sort()).toEqual([
      "alert_type", "escalate_after_minutes", "escalation_channels", "hospital_id",
      "is_active", "notify_roles", "quiet_hours_enabled", "quiet_hours_end",
      "quiet_hours_start", "severity", "updated_at",
    ]);
  });

  it("nulls the quiet-hours bounds when the window is off", () => {
    // The CHECK added in 20261106000005 requires both bounds when enabled. Writing nulls
    // when disabled stops a stale window sitting in the row waiting to be re-enabled.
    const row = toEscalationRuleRow({ ...rule, quietHoursEnabled: false }, HOSPITAL_A);
    expect(row.quiet_hours_start).toBeNull();
    expect(row.quiet_hours_end).toBeNull();
  });

  it("round-trips through mergeEscalationRules", () => {
    // A settings screen saves and immediately re-reads. Any field that does not survive is
    // a setting that silently reverts on the next page load.
    const edited: EscalationRule = {
      ...rule,
      escalateAfterMinutes: 12,
      channels: ["in_app", "whatsapp"],
      notifyRoles: ["nurse", "doctor"],
      isActive: false,
      quietHoursEnabled: true,
      quietHoursStart: "21:30",
      quietHoursEnd: "05:45",
    };
    const row = toEscalationRuleRow(edited, HOSPITAL_A);
    const back = mergeEscalationRules([{ ...row, id: "row-1" }]).find((r) => r.alertType === "mar_overdue")!;

    expect(back.escalateAfterMinutes).toBe(12);
    expect(back.channels).toEqual(["in_app", "whatsapp"]);
    expect(back.notifyRoles).toEqual(["nurse", "doctor"]);
    expect(back.isActive).toBe(false);
    expect(back.quietHoursEnabled).toBe(true);
    expect(back.quietHoursStart).toBe("21:30");
    expect(back.quietHoursEnd).toBe("05:45");
  });
});
