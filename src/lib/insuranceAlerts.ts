/**
 * insuranceAlerts.ts — Insurance module alert dispatcher
 *
 * Usage pattern in components:
 *   const settings = await loadInsuranceAlertSettings(hospitalId);
 *   await alertSLARisk({ hospitalId, patientName, tpaName, timeLeft, preAuthId }, settings);
 *
 * Three channels:
 *   1. In-app  — always: inserts into clinical_alerts table
 *   2. WhatsApp — when settings.sla_alert_channel === 'whatsapp': POSTs to n8n webhook
 *   3. DB side-effects — SLA breach: updates insurance_pre_auth + inserts insurance_sla_log
 */

import { supabase } from "@/integrations/supabase/client";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AlertType =
  | "SLA_PRE_AUTH_RISK"
  | "SLA_PRE_AUTH_BREACH"
  | "SUPPLEMENTARY_PRE_AUTH_NEEDED"
  | "CLAIM_QUERY_RECEIVED"
  | "CLAIM_QUERY_OVERDUE"
  | "APPEAL_DEADLINE_APPROACHING"
  | "PAYMENT_RECEIVED";

export interface AlertData {
  hospitalId: string;
  // Patient / TPA context
  patientName?: string;
  tpaName?: string;
  admissionId?: string;
  // Pre-auth / SLA
  preAuthId?: string;
  timeLeft?: number;         // minutes remaining (negative when overdue)
  breachMinutes?: number;    // how many minutes past deadline
  // Supplementary
  currentAmount?: number;
  approvedAmount?: number;
  utilizationPct?: number;
  // Claim
  claimId?: string;
  claimNumber?: string;
  deadline?: string;         // formatted date string
  daysOverdue?: number;
  // Payment
  amount?: number;
  underpaymentAmount?: number;
}

export interface InsuranceAlertSettings {
  sla_alert_channel: "in_app" | "whatsapp" | "email" | "sms";
  whatsapp_alert_number: string | null;
  n8n_webhook_url: string | null;
  plan_tier?: string;
}

// ── Message templates ─────────────────────────────────────────────────────────

const inr = (n: number): string => `₹${n.toLocaleString("en-IN")}`;

export function formatAlertMessage(type: AlertType, data: AlertData): string {
  const p = data.patientName  ?? "Patient";
  const t = data.tpaName      ?? "TPA";
  const c = data.claimNumber  ?? data.claimId ?? "—";

  switch (type) {
    case "SLA_PRE_AUTH_RISK":
      return `⚠️ Pre-Auth SLA at risk! ${p} | ${t} | ${data.timeLeft ?? "?"} min left. Pre-Auth ID: ${data.preAuthId ?? "—"}`;

    case "SLA_PRE_AUTH_BREACH":
      return `🚨 SLA BREACHED! Pre-auth for ${p} exceeded 60-min IRDAI limit. Log: ${data.preAuthId ?? "—"}`;

    case "SUPPLEMENTARY_PRE_AUTH_NEEDED":
      return `💰 ${p}'s bill is at ${inr(data.currentAmount ?? 0)} / ${inr(data.approvedAmount ?? 0)} approved (${data.utilizationPct ?? 80}%). Submit supplementary pre-auth now.`;

    case "CLAIM_QUERY_RECEIVED":
      return `📋 New TPA query on Claim ${c} from ${t}. Respond by ${data.deadline ?? "deadline"}.`;

    case "CLAIM_QUERY_OVERDUE":
      return `🔴 OVERDUE: TPA query for Claim ${c} is ${data.daysOverdue ?? "?"} days overdue. Claim at risk.`;

    case "APPEAL_DEADLINE_APPROACHING":
      return `⏰ Appeal deadline for Claim ${c} (${p}) is in 7 days. File appeal now.`;

    case "PAYMENT_RECEIVED":
      return `✅ ${inr(data.amount ?? 0)} received from ${t} for Claim ${c}. ${
        data.underpaymentAmount && data.underpaymentAmount > 0
          ? `Underpayment of ${inr(data.underpaymentAmount)}`
          : "Fully settled"
      }.`;
  }
}

// ── Severity mapping ──────────────────────────────────────────────────────────

const SEVERITY_MAP: Record<AlertType, "critical" | "high" | "medium"> = {
  SLA_PRE_AUTH_RISK:             "high",
  SLA_PRE_AUTH_BREACH:           "critical",
  SUPPLEMENTARY_PRE_AUTH_NEEDED: "high",
  CLAIM_QUERY_RECEIVED:          "medium",
  CLAIM_QUERY_OVERDUE:           "critical",
  APPEAL_DEADLINE_APPROACHING:   "high",
  PAYMENT_RECEIVED:              "medium",
};

// ── Settings loader ───────────────────────────────────────────────────────────

/**
 * Load per-hospital alert settings. Call once in the component and cache.
 * Returns sensible defaults if no settings row exists yet.
 */
export async function loadInsuranceAlertSettings(
  hospitalId: string,
): Promise<InsuranceAlertSettings> {
  try {
    const { data } = await (supabase as any)
      .from("hospital_insurance_settings")
      .select("sla_alert_channel, whatsapp_alert_number, n8n_webhook_url, plan_tier")
      .eq("hospital_id", hospitalId)
      .maybeSingle();

    if (!data) return { sla_alert_channel: "in_app", whatsapp_alert_number: null, n8n_webhook_url: null };

    return {
      sla_alert_channel:    data.sla_alert_channel    ?? "in_app",
      whatsapp_alert_number: data.whatsapp_alert_number ?? null,
      n8n_webhook_url:      data.n8n_webhook_url       ?? null,
      plan_tier:            data.plan_tier             ?? "manual",
    };
  } catch {
    return { sla_alert_channel: "in_app", whatsapp_alert_number: null, n8n_webhook_url: null };
  }
}

// ── WhatsApp dispatcher ───────────────────────────────────────────────────────

async function dispatchWhatsApp(
  settings: InsuranceAlertSettings,
  message: string,
  type: AlertType,
): Promise<void> {
  if (
    settings.sla_alert_channel !== "whatsapp" ||
    !settings.whatsapp_alert_number ||
    !settings.n8n_webhook_url
  ) return;

  try {
    await fetch(settings.n8n_webhook_url, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to:      settings.whatsapp_alert_number,
        message,
        type,
        source:  "aumrti_hms_insurance",
      }),
      // Non-blocking: don't await a slow n8n webhook
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    // WhatsApp failures are non-fatal — log but don't throw
    console.warn("insuranceAlerts: n8n webhook failed:", e);
  }
}

// ── In-app (clinical_alerts) dispatcher ──────────────────────────────────────

async function dispatchInApp(
  type: AlertType,
  message: string,
  data: AlertData,
): Promise<void> {
  try {
    await (supabase as any).from("clinical_alerts").insert({
      hospital_id:     data.hospitalId,
      admission_id:    data.admissionId ?? null,
      alert_type:      type.toLowerCase(),
      alert_message:   message,
      severity:        SEVERITY_MAP[type],
      is_acknowledged: false,
    });
  } catch (e) {
    console.warn("insuranceAlerts: clinical_alerts insert failed:", e);
  }
}

// ── SLA breach DB side-effects ────────────────────────────────────────────────

async function recordSLABreach(data: AlertData): Promise<void> {
  if (!data.preAuthId) return;
  try {
    await Promise.all([
      (supabase as any)
        .from("insurance_pre_auth")
        .update({ sla_breached: true })
        .eq("id", data.preAuthId),

      (supabase as any).from("insurance_sla_log").insert({
        hospital_id:    data.hospitalId,
        reference_type: "pre_auth",
        reference_id:   data.preAuthId,
        patient_name:   data.patientName  ?? null,
        tpa_name:       data.tpaName      ?? null,
        breached_at:    new Date().toISOString(),
        breach_minutes: data.breachMinutes ?? (data.timeLeft ? Math.abs(data.timeLeft) : null),
        alert_sent_at:  new Date().toISOString(),
      }),
    ]);
  } catch (e) {
    console.warn("insuranceAlerts: SLA breach DB update failed:", e);
  }
}

// ── Core dispatcher ───────────────────────────────────────────────────────────

/**
 * sendInsuranceAlert — orchestrates all channels for a given alert type.
 *
 * @param type     - One of the 7 AlertType values
 * @param data     - Context data for message templating and DB writes
 * @param settings - Pre-loaded from loadInsuranceAlertSettings(); prevents repeated DB calls
 * @returns        - Formatted message string (so caller can pass to toast if needed)
 */
export async function sendInsuranceAlert(
  type: AlertType,
  data: AlertData,
  settings: InsuranceAlertSettings,
): Promise<{ message: string }> {
  const message = formatAlertMessage(type, data);

  // Always write in-app clinical alert
  await dispatchInApp(type, message, data);

  // SLA breach: update DB records
  if (type === "SLA_PRE_AUTH_BREACH") {
    await recordSLABreach(data);
  }

  // WhatsApp if configured
  await dispatchWhatsApp(settings, message, type);

  return { message };
}

// ── Named convenience wrappers ────────────────────────────────────────────────
// Used directly by SLATimer, ActiveAdmissions, PaymentReconciliation, etc.

/** SLATimer: call when sla_deadline is <30 min away */
export async function alertSLARisk(
  data: AlertData,
  settings: InsuranceAlertSettings,
): Promise<string> {
  const { message } = await sendInsuranceAlert("SLA_PRE_AUTH_RISK", data, settings);
  return message;
}

/** SLATimer / onSLABreach callback: call when deadline has passed */
export async function alertSLABreach(
  data: AlertData,
  settings: InsuranceAlertSettings,
): Promise<string> {
  const { message } = await sendInsuranceAlert("SLA_PRE_AUTH_BREACH", data, settings);
  return message;
}

/** ActiveAdmissions: call when utilization >= 80% of approved amount */
export async function alertSupplementaryNeeded(
  data: AlertData,
  settings: InsuranceAlertSettings,
): Promise<string> {
  const { message } = await sendInsuranceAlert("SUPPLEMENTARY_PRE_AUTH_NEEDED", data, settings);
  return message;
}

/** TPAQueryManager: call on Supabase realtime INSERT on tpa_queries */
export async function alertQueryReceived(
  data: AlertData,
  settings: InsuranceAlertSettings,
): Promise<string> {
  const { message } = await sendInsuranceAlert("CLAIM_QUERY_RECEIVED", data, settings);
  return message;
}

/** TPAQueryManager: call when a query deadline has passed */
export async function alertQueryOverdue(
  data: AlertData,
  settings: InsuranceAlertSettings,
): Promise<string> {
  const { message } = await sendInsuranceAlert("CLAIM_QUERY_OVERDUE", data, settings);
  return message;
}

/** ClaimsStatus: call when appeal_deadline is 7 days away */
export async function alertAppealApproaching(
  data: AlertData,
  settings: InsuranceAlertSettings,
): Promise<string> {
  const { message } = await sendInsuranceAlert("APPEAL_DEADLINE_APPROACHING", data, settings);
  return message;
}

/** PaymentReconciliation: call when a payment row is inserted */
export async function alertPaymentReceived(
  data: AlertData,
  settings: InsuranceAlertSettings,
): Promise<string> {
  const { message } = await sendInsuranceAlert("PAYMENT_RECEIVED", data, settings);
  return message;
}
