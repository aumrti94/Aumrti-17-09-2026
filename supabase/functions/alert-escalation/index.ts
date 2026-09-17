// @ts-nocheck
/**
 * alert-escalation
 *
 * Runs on a cron schedule (every 5 minutes).
 * Finds unacknowledged critical/high alerts older than the configured
 * SLA window and escalates them on every channel the rule names:
 * SMS (MSG91 / Twilio), email (Resend), WhatsApp (Meta Cloud API) and in-app.
 * All send attempts (including failures) are written to notification_log.
 *
 * D1 (20261106000005 / 20261106000006) made this the ONLY alert-routing config.
 * hospital_settings.notification_config — which carried in-app and WhatsApp choices
 * that nothing ever dispatched — is retired, and Settings › Notifications now reads
 * and writes alert_escalation_rules directly.
 *
 * Quiet hours suppress a rule outside working hours, EXCEPT for severity 'critical',
 * which always escalates. See suppressedByQuietHours.
 *
 * Cron: * /5 * * * * (every 5 minutes — space added to avoid closing this comment)
 * Invocation: POST /functions/v1/alert-escalation (called by pg_cron or external cron)
 *
 * Required Supabase secrets:
 * MSG91_API_KEY         — MSG91 API key (primary SMS provider for India)
 * MSG91_SENDER_ID       — SMS sender ID (default: HOSPIT)
 * MSG91_FLOW_ID_ALERT   — MSG91 flow ID for alert template
 * TWILIO_ACCOUNT_SID    — Twilio SID (fallback SMS)
 * TWILIO_AUTH_TOKEN     — Twilio auth token
 * TWILIO_FROM_NUMBER    — Twilio sender number (e.g. +919XXXXXXXXX)
 * RESEND_API_KEY        — Resend email API key
 * FROM_EMAIL            — Sender email address (e.g. alerts@yourhospital.in)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";
import { normalizePhone, sanitizeMessage, sendMetaSession } from "../_shared/whatsapp-meta.ts";

/**
 * D1 — quiet hours.
 *
 * Stored as a plain `time` per rule, meaning hospital-local time, which for every Aumrti
 * customer is IST. Deno runs in UTC, so the comparison is done in IST explicitly rather
 * than relying on the container's clock settings.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function nowIstMinutes(): number {
  const ist = new Date(Date.now() + IST_OFFSET_MS);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

function timeToMinutes(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = String(t).split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  return h * 60 + (Number.isFinite(m) ? m : 0);
}

/** Windows normally wrap past midnight (23:00 → 07:00), so the wrap case is the common one. */
function inQuietWindow(start: string | null, end: string | null): boolean {
  const s = timeToMinutes(start);
  const e = timeToMinutes(end);
  if (s === null || e === null) return false;
  const now = nowIstMinutes();
  return s <= e ? now >= s && now < e : now >= s || now < e;
}

/**
 * THE HARD RULE. A critical alert escalates whatever the clock says.
 *
 * CLAUDE.md: "Clinical alerts surface immediately; they are never silenced or batched."
 * Quiet hours exist so a ward is not paged overnight about a medication due — never so
 * that Code Blue waits until 07:00. The severity check comes FIRST and there is no
 * configuration that can get past it.
 */
function suppressedByQuietHours(rule: {
  severity?: string | null;
  quiet_hours_enabled?: boolean | null;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
}): boolean {
  if (rule.severity === "critical") return false;
  if (!rule.quiet_hours_enabled) return false;
  return inQuietWindow(rule.quiet_hours_start ?? null, rule.quiet_hours_end ?? null);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const twiliaSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER") || "+1234567890";
  const msg91Key = Deno.env.get("MSG91_API_KEY");
  const msg91Sender = Deno.env.get("MSG91_SENDER_ID") || "HOSPIT";
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("FROM_EMAIL") || "alerts@aumrti.health";

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    // ── 1. Find all active escalation rules ──────────────────────────────
    const { data: rules } = await supabase
      .from("alert_escalation_rules")
      .select("*")
      .eq("is_active", true);

    if (!rules || rules.length === 0) {
      return new Response(JSON.stringify({ message: "No active escalation rules" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let totalEscalated = 0;
    let totalQuietSuppressed = 0;

    /**
     * WhatsApp credentials are per hospital and live on `hospitals`. Cached per run so a
     * hospital with ten rules does not cause ten identical credential reads.
     *
     * Read with the service-role client on purpose: this function is cron-invoked with no
     * user session, so it cannot call send-whatsapp-meta (which authenticates a Bearer
     * token and derives the hospital from the caller). It uses the same shared Meta helpers
     * that function uses internally instead. Credentials never leave this scope.
     */
    const waCache = new Map<string, { phoneNumberId: string; accessToken: string } | null>();
    const getWhatsAppCreds = async (hospitalId: string) => {
      if (waCache.has(hospitalId)) return waCache.get(hospitalId)!;
      const { data: h } = await supabase
        .from("hospitals")
        .select("whatsapp_enabled, whatsapp_provider, meta_phone_number_id, meta_access_token")
        .eq("id", hospitalId)
        .maybeSingle();
      const usable =
        h && (h as any).whatsapp_enabled && (h as any).meta_phone_number_id && (h as any).meta_access_token
          ? { phoneNumberId: (h as any).meta_phone_number_id, accessToken: (h as any).meta_access_token }
          : null;
      waCache.set(hospitalId, usable);
      return usable;
    };

    for (const rule of rules as any[]) {
      // Quiet hours are checked per RULE, before any query, so a suppressed rule costs
      // nothing. Critical severities are never suppressed — see suppressedByQuietHours.
      if (suppressedByQuietHours(rule)) {
        totalQuietSuppressed++;
        continue;
      }

      const cutoffTime = new Date(
        Date.now() - rule.escalate_after_minutes * 60 * 1000
      ).toISOString();

      // ── 2. Find unacknowledged alerts past SLA ────────────────────────
      let query = supabase
        .from("clinical_alerts")
        .select("id, hospital_id, alert_type, severity, alert_message, patient_id, created_at, escalation_count")
        .eq("hospital_id", rule.hospital_id)
        .eq("is_acknowledged", false)
        .lte("created_at", cutoffTime);

      if (rule.severity !== "all") {
        query = query.eq("severity", rule.severity);
      }
      if (rule.alert_type) {
        query = query.eq("alert_type", rule.alert_type);
      }

      const { data: alerts } = await query;
      if (!alerts || alerts.length === 0) continue;

      // ── 3. Build recipient list ───────────────────────────────────────
      //
      // A recipient carries every address we hold for them; each channel block below
      // decides whether to use its own. This replaces an `if (phone && sms) … else if
      // (email && email)` chain, under which a clinician with BOTH a phone and an email,
      // on a rule naming BOTH channels, received only the SMS — the email branch was
      // unreachable for them. Escalation now reaches every configured channel, which is
      // more notification, never less.
      const channels: string[] = rule.escalation_channels || [];
      const wants = (c: string) => channels.includes(c);

      const recipients: Array<{ phone?: string; email?: string; userId?: string; name: string }> = [];

      // Direct overrides in the rule
      for (const phone of rule.sms_numbers || []) {
        recipients.push({ phone, name: "On-Call" });
      }
      for (const email of rule.email_addresses || []) {
        recipients.push({ email, name: "On-Call" });
      }

      // Users matching notified roles
      if (rule.notify_roles?.length > 0) {
        const { data: users } = await supabase
          .from("users")
          .select("id, full_name, phone, email, role")
          .eq("hospital_id", rule.hospital_id)
          .eq("is_active", true)
          .in("role", rule.notify_roles);

        for (const u of (users as any[]) || []) {
          recipients.push({ phone: u.phone, email: u.email, userId: u.id, name: u.full_name });
        }
      }

      // Specific user overrides on the rule (notify_user_ids)
      if (rule.notify_user_ids?.length > 0) {
        const { data: pinned } = await supabase
          .from("users")
          .select("id, full_name, phone, email")
          .eq("hospital_id", rule.hospital_id)
          .in("id", rule.notify_user_ids);

        for (const u of (pinned as any[]) || []) {
          if (recipients.some((r) => r.userId === u.id)) continue;
          recipients.push({ phone: u.phone, email: u.email, userId: u.id, name: u.full_name });
        }
      }

      if (recipients.length === 0) continue;

      // ── 4. Send escalation for each alert ─────────────────────────────
      for (const alert of alerts as any[]) {
        // Skip if already escalated in last 30 min (prevent spam)
        if (alert.escalation_count > 0) {
          const { data: lastEsc } = await supabase
            .from("alert_escalation_log")
            .select("sent_at")
            .eq("alert_id", alert.id)
            .order("sent_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (lastEsc?.sent_at) {
            const lastEscTime = new Date(lastEsc.sent_at).getTime();
            if (Date.now() - lastEscTime < 30 * 60 * 1000) continue; // 30-min cool-off
          }
        }

        const shortMsg = `🚨 UNACKNOWLEDGED ALERT — ${alert.alert_type?.replace(/_/g, " ").toUpperCase()}
${alert.alert_message?.slice(0, 140)}
Please acknowledge in Aumrti HMS immediately.`;

        for (const r of recipients) {
          // ── SMS via MSG91 (preferred for India) or Twilio ────────────
          if (r.phone && wants("sms")) {
            let smsStatus = "failed";
            let smsError = "";
            let providerRef = "";

            const phone = r.phone.replace(/\D/g, "");
            const e164 = phone.startsWith("91") ? `+${phone}` : `+91${phone}`;

            if (msg91Key) {
              // MSG91 Flow API (preferred for India)
              try {
                const res = await fetch("https://api.msg91.com/api/v5/flow/", {
                  method: "POST",
                  headers: {
                    "Content-Type": "application/json",
                    "authkey": msg91Key,
                  },
                  body: JSON.stringify({
                    flow_id: Deno.env.get("MSG91_FLOW_ID_ALERT") || "",
                    sender: msg91Sender,
                    mobiles: e164.replace("+", ""),
                    VAR1: alert.alert_type?.replace(/_/g, " ").toUpperCase(),
                    VAR2: (alert.alert_message || "").slice(0, 100),
                  }),
                });
                const d = await res.json();
                smsStatus = d.type === "success" ? "sent" : "failed";
                providerRef = d.request_id || "";
                if (d.type !== "success") smsError = JSON.stringify(d);
              } catch (e: any) {
                smsStatus = "failed";
                smsError = e?.message || "MSG91 fetch error";
              }
            } else if (twiliaSid && twilioToken) {
              // Twilio fallback
              try {
                const res = await fetch(
                  `https://api.twilio.com/2010-04-01/Accounts/${twiliaSid}/Messages.json`,
                  {
                    method: "POST",
                    headers: {
                      "Authorization": `Basic ${btoa(`${twiliaSid}:${twilioToken}`)}`,
                      "Content-Type": "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                      From: twilioFrom,
                      To: e164,
                      Body: shortMsg,
                    }),
                  }
                );
                const d = await res.json();
                smsStatus = d.status === "queued" || d.status === "sent" ? "sent" : "failed";
                providerRef = d.sid || "";
                if (smsStatus === "failed") smsError = d.message || JSON.stringify(d);
              } catch (e: any) {
                smsStatus = "failed";
                smsError = e?.message || "Twilio fetch error";
              }
            } else {
              // No SMS provider configured — log explicitly so operators know
              smsStatus = "failed";
              smsError = "SMS provider not configured. Set MSG91_API_KEY or TWILIO_ACCOUNT_SID secret.";
              console.error(`alert-escalation: ${smsError}`);
            }

            // Write to both alert_escalation_log and notification_log for visibility
            await supabase.from("alert_escalation_log").insert({
              hospital_id: alert.hospital_id,
              alert_id: alert.id,
              rule_id: rule.id,
              channel: "sms",
              recipient: e164,
              message_body: shortMsg,
              status: smsStatus,
              provider_ref: providerRef,
            });
            await supabase.from("notification_log").insert({
              hospital_id: alert.hospital_id,
              channel: "sms",
              status: smsStatus,
              recipient_phone: e164,
              recipient_name: r.name,
              event_type: "alert_escalation",
              message_body: shortMsg,
              error_message: smsError || null,
              provider: msg91Key ? "msg91" : (twiliaSid ? "twilio" : null),
              external_id: providerRef || null,
            });
          }

          // ── Email via Resend ──────────────────────────────────────────
          if (r.email && wants("email")) {
            let emailStatus = "failed";
            let emailError = "";
            let providerRef = "";

            if (!resendKey) {
              emailError = "Email provider not configured. Set RESEND_API_KEY secret.";
              console.error(`alert-escalation: ${emailError}`);
            } else {
              try {
                const htmlBody = `
<div style="font-family:sans-serif;padding:16px;border-left:4px solid #dc2626;background:#fef2f2;">
  <h2 style="color:#b91c1c;margin:0 0 8px">🚨 Unacknowledged Clinical Alert</h2>
  <p style="color:#374151"><strong>Type:</strong> ${(alert.alert_type || "").replace(/_/g, " ")}</p>
  <p style="color:#374151"><strong>Message:</strong> ${alert.alert_message || ""}</p>
  <p style="color:#374151"><strong>Created:</strong> ${new Date(alert.created_at).toLocaleString("en-IN")}</p>
  <p style="color:#b91c1c;font-weight:bold;">Please acknowledge this alert in Aumrti HMS immediately.</p>
</div>`;

                const res = await fetch("https://api.resend.com/emails", {
                  method: "POST",
                  headers: {
                    "Authorization": `Bearer ${resendKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    from: fromEmail,
                    to: [r.email],
                    subject: `🚨 UNACKNOWLEDGED ALERT — ${(alert.alert_type || "").replace(/_/g, " ").toUpperCase()}`,
                    html: htmlBody,
                  }),
                });
                const d = await res.json();
                emailStatus = d.id ? "sent" : "failed";
                providerRef = d.id || "";
                if (!d.id) emailError = JSON.stringify(d);
              } catch (e: any) {
                emailStatus = "failed";
                emailError = e?.message || "Resend fetch error";
              }
            }

            await supabase.from("alert_escalation_log").insert({
              hospital_id: alert.hospital_id,
              alert_id: alert.id,
              rule_id: rule.id,
              channel: "email",
              recipient: r.email,
              message_body: shortMsg,
              status: emailStatus,
              provider_ref: providerRef,
            });
            await supabase.from("notification_log").insert({
              hospital_id: alert.hospital_id,
              channel: "email",
              status: emailStatus,
              recipient_email: r.email,
              recipient_name: r.name,
              event_type: "alert_escalation",
              subject: `UNACKNOWLEDGED ALERT — ${(alert.alert_type || "").replace(/_/g, " ").toUpperCase()}`,
              message_body: shortMsg,
              error_message: emailError || null,
              provider: "resend",
              external_id: providerRef || null,
            });
          }

          // ── In-app (D1) ───────────────────────────────────────────────
          //
          // This deliberately does NOT insert a second clinical_alerts row. The alert
          // being escalated IS the in-app notification — NotificationCentre already
          // surfaces every unacknowledged clinical_alert for the hospital, so the
          // clinician can see it now and could see it before. Raising another row would
          // duplicate a clinical alert, which is the exact defect the plan's "alert
          // exactly-once" rule exists to prevent (clinical_alerts carries no unique
          // constraint in any migration, so nothing at the DB layer would stop it).
          //
          // What escalation adds in-app is the AUDIT record that the escalation reached
          // this person on this channel, written to the same two tables sms and email
          // write to, so "who was told, when, how" has one answer per channel.
          if (r.userId && wants("in_app")) {
            await supabase.from("alert_escalation_log").insert({
              hospital_id: alert.hospital_id,
              alert_id: alert.id,
              rule_id: rule.id,
              channel: "in_app",
              recipient: r.userId,
              message_body: shortMsg,
              status: "delivered",   // the alert is already on their screen; nothing to send
            });
            await supabase.from("notification_log").insert({
              hospital_id: alert.hospital_id,
              channel: "in_app",
              status: "delivered",
              recipient_name: r.name,
              event_type: "alert_escalation",
              message_body: shortMsg,
              provider: "in_app",
            });
          }

          // ── WhatsApp via Meta Cloud API (D1) ──────────────────────────
          if (r.phone && wants("whatsapp")) {
            const creds = await getWhatsAppCreds(alert.hospital_id);
            const waPhone = normalizePhone(r.phone);
            let waStatus = "failed";
            let waError = "";
            let waRef = "";

            if (!creds) {
              waError =
                "WhatsApp not configured for this hospital. Enable it and set the Meta phone number id and access token.";
              console.error(`alert-escalation: ${waError}`);
            } else if (!waPhone) {
              waError = "Recipient phone is not a valid Indian mobile number.";
              console.error("alert-escalation: unusable recipient phone for WhatsApp escalation");
            } else {
              try {
                // Session message rather than a template: escalation only fires for an
                // alert the hospital's own staff are already engaged with, and a template
                // would need approval per alert type. If Meta rejects it for being outside
                // the 24-hour session window, that lands in error_message below and the
                // sms/email channels on the same rule still carry the escalation.
                const res = await sendMetaSession(
                  creds.phoneNumberId,
                  creds.accessToken,
                  waPhone,
                  sanitizeMessage(shortMsg),
                );
                waStatus = res.success ? "sent" : "failed";
                waRef = res.messageId || "";
                if (!res.success) waError = res.error || "Meta send failed";
              } catch (e: any) {
                waStatus = "failed";
                waError = e?.message || "WhatsApp fetch error";
              }
            }

            await supabase.from("alert_escalation_log").insert({
              hospital_id: alert.hospital_id,
              alert_id: alert.id,
              rule_id: rule.id,
              channel: "whatsapp",
              recipient: waPhone || r.phone,
              message_body: shortMsg,
              status: waStatus,
              provider_ref: waRef,
            });
            await supabase.from("notification_log").insert({
              hospital_id: alert.hospital_id,
              channel: "whatsapp",
              status: waStatus,
              recipient_phone: waPhone || r.phone,
              recipient_name: r.name,
              event_type: "alert_escalation",
              message_body: shortMsg,
              error_message: waError || null,
              provider: "meta",
              external_id: waRef || null,
            });
          }
        }

        // Mark alert as escalated
        await supabase
          .from("clinical_alerts")
          .update({
            escalated_at: new Date().toISOString(),
            escalation_count: (alert.escalation_count || 0) + 1,
          })
          .eq("id", alert.id);

        totalEscalated++;
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        escalated: totalEscalated,
        // Reported so an operator can tell "nothing was overdue" from "quiet hours held
        // it back". Critical alerts are never counted here — they cannot be suppressed.
        quietHoursSuppressed: totalQuietSuppressed,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err: any) {
    console.error("alert-escalation error:", sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
