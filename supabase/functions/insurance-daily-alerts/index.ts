/**
 * insurance-daily-alerts — Supabase Edge Function
 *
 * Runs every day at 08:00 IST (02:30 UTC) via pg_cron:
 *
 *   SELECT cron.schedule(
 *     'insurance-daily-alerts',
 *     '30 2 * * *',
 *     $$SELECT net.http_post(
 *       url      := current_setting('app.supabase_url') || '/functions/v1/insurance-daily-alerts',
 *       headers  := '{"Content-Type":"application/json","Authorization":"Bearer <service_role_key>"}',
 *       body     := '{}'
 *     )$$
 *   );
 *
 * Checks (per active hospital):
 *   1. Overdue TPA queries         → update status + alert
 *   2. Appeal deadlines in 7 days  → alert
 *   3. Missed SLA breaches         → update pre_auth + alert
 *
 * Alert channels per hospital:
 *   • In-app   — always: INSERT into clinical_alerts
 *   • WhatsApp — if n8n_webhook_url set: POST { to, message, type }
 *                else if WATI set: sendTemplateMessage via WATI API
 */

import { serve }        from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Types ─────────────────────────────────────────────────────────────────────

interface HospitalSettings {
  hospital_id:           string;
  hospital_name:         string;
  sla_alert_channel:     string;
  whatsapp_alert_number: string | null;
  n8n_webhook_url:       string | null;
  wati_api_url:          string | null;
  wati_api_key:          string | null;
}

interface AlertResult {
  hospital_id: string;
  overdue_queries:   number;
  appeal_warnings:   number;
  sla_breaches:      number;
  whatsapp_sent:     number;
  errors:            string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const corsHeaders = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const inr = (n: number) => `₹${Number(n).toLocaleString("en-IN")}`;

// ISO date string for today / N days from now
function isoDate(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

// ── WhatsApp send ─────────────────────────────────────────────────────────────

async function sendWhatsApp(
  settings: HospitalSettings,
  phone: string,
  message: string,
  type: string,
): Promise<boolean> {
  // Priority 1: n8n webhook relay
  if (settings.n8n_webhook_url) {
    try {
      const res = await fetch(settings.n8n_webhook_url, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: phone, message, type, source: "aumrti_insurance_daily" }),
        signal: AbortSignal.timeout(8000),
      });
      return res.ok;
    } catch (e) {
      console.warn(`n8n webhook failed for ${settings.hospital_id}:`, e);
    }
  }

  // Priority 2: WATI session message
  if (settings.wati_api_url && settings.wati_api_key) {
    try {
      const e164 = phone.replace(/^\+/, "");
      const res = await fetch(
        `${settings.wati_api_url.replace(/\/$/, "")}/api/v1/sendSessionMessage/${e164}`,
        {
          method:  "POST",
          headers: {
            "Authorization": `Bearer ${settings.wati_api_key}`,
            "Content-Type":  "application/json",
          },
          body: JSON.stringify({ messageText: message }),
        },
      );
      return res.ok;
    } catch (e) {
      console.warn(`WATI send failed for ${settings.hospital_id}:`, e);
    }
  }

  return false;
}

// ── In-app alert insert ────────────────────────────────────────────────────────

async function insertClinicalAlert(
  sb: ReturnType<typeof createClient>,
  hospitalId: string,
  alertType: string,
  message: string,
  severity: "critical" | "high" | "medium",
  admissionId?: string | null,
): Promise<void> {
  await (sb as any).from("clinical_alerts").insert({
    hospital_id:     hospitalId,
    admission_id:    admissionId ?? null,
    alert_type:      alertType,
    alert_message:   message,
    severity,
    is_acknowledged: false,
  });
}

// ── Per-hospital scan ─────────────────────────────────────────────────────────

async function scanHospital(
  sb: ReturnType<typeof createClient>,
  settings: HospitalSettings,
  today: string,
  sevenDaysOut: string,
  yesterday: string,
): Promise<Omit<AlertResult, "hospital_id">> {
  const result = { overdue_queries: 0, appeal_warnings: 0, sla_breaches: 0, whatsapp_sent: 0, errors: [] as string[] };

  const useWhatsApp =
    settings.sla_alert_channel === "whatsapp" && !!settings.whatsapp_alert_number;

  // ── 1. Overdue TPA queries ─────────────────────────────────────────────────
  try {
    const { data: overdueQueries } = await (sb as any)
      .from("tpa_queries")
      .select("id, claim_id, query_text, response_deadline, insurance_claims(claim_number, tpa_config(tpa_name))")
      .eq("hospital_id", settings.hospital_id)
      .eq("status", "open")
      .lt("response_deadline", today)
      .not("response_deadline", "is", null);

    for (const q of overdueQueries ?? []) {
      const claim = (q.insurance_claims as any) ?? {};
      const claimNumber = claim.claim_number ?? q.claim_id?.slice(-6) ?? "—";
      const tpaName     = claim.tpa_config?.tpa_name ?? "TPA";
      const deadline    = q.response_deadline;
      const daysOverdue = Math.floor(
        (Date.now() - new Date(deadline).getTime()) / (1000 * 60 * 60 * 24),
      );
      const message =
        `🔴 OVERDUE: TPA query for Claim ${claimNumber} from ${tpaName} is ${daysOverdue} day${daysOverdue !== 1 ? "s" : ""} overdue. Claim at risk.`;

      // Update status to overdue
      await (sb as any)
        .from("tpa_queries")
        .update({ status: "overdue" })
        .eq("id", q.id);

      await insertClinicalAlert(sb, settings.hospital_id, "claim_query_overdue", message, "critical");

      if (useWhatsApp) {
        const sent = await sendWhatsApp(settings, settings.whatsapp_alert_number!, message, "CLAIM_QUERY_OVERDUE");
        if (sent) result.whatsapp_sent++;
      }
      result.overdue_queries++;
    }
  } catch (e: any) {
    result.errors.push(`overdue_queries: ${e.message}`);
  }

  // ── 2. Appeal deadlines approaching (7 days) ───────────────────────────────
  try {
    const { data: appealClaims } = await (sb as any)
      .from("insurance_claims")
      .select(`
        id, claim_number, appeal_deadline,
        admissions(patients(name)),
        tpa_config(tpa_name)
      `)
      .eq("hospital_id", settings.hospital_id)
      .eq("status", "denied")
      .eq("appeal_deadline", sevenDaysOut)
      .is("appeal_submitted_at", null);

    for (const claim of appealClaims ?? []) {
      const patientName = claim.admissions?.patients?.name ?? "Patient";
      const claimNumber = claim.claim_number ?? claim.id?.slice(-6) ?? "—";
      const message =
        `⏰ Appeal deadline for Claim ${claimNumber} (${patientName}) is in 7 days. File appeal now.`;

      await insertClinicalAlert(sb, settings.hospital_id, "appeal_deadline_approaching", message, "high");

      if (useWhatsApp) {
        const sent = await sendWhatsApp(settings, settings.whatsapp_alert_number!, message, "APPEAL_DEADLINE_APPROACHING");
        if (sent) result.whatsapp_sent++;
      }
      result.appeal_warnings++;
    }
  } catch (e: any) {
    result.errors.push(`appeal_deadlines: ${e.message}`);
  }

  // ── 3. Missed SLA breaches (realtime timer may have been offline) ──────────
  try {
    // Pre-auths whose deadline passed yesterday or earlier, still not marked breached
    const { data: missedBreaches } = await (sb as any)
      .from("insurance_pre_auth")
      .select(`
        id, sla_deadline,
        admissions(patients(name)),
        tpa_config(tpa_name, pre_auth_sla_minutes)
      `)
      .eq("hospital_id", settings.hospital_id)
      .eq("sla_breached", false)
      .in("status", ["pending", "submitted"])
      .not("sla_deadline", "is", null)
      .lt("sla_deadline", `${yesterday}T23:59:59Z`);

    for (const pa of missedBreaches ?? []) {
      const patientName = pa.admissions?.patients?.name ?? "Patient";
      const tpaName     = pa.tpa_config?.tpa_name ?? "TPA";
      const slaMinutes  = pa.tpa_config?.pre_auth_sla_minutes ?? 60;
      const breachedAt  = new Date(pa.sla_deadline);
      const breachMins  = Math.round((Date.now() - breachedAt.getTime()) / 60000);

      const message =
        `🚨 SLA BREACHED! Pre-auth for ${patientName} (${tpaName}) exceeded ${slaMinutes}-min IRDAI limit by ${breachMins} min. Pre-Auth ID: ${pa.id}`;

      // Mark breached and insert sla_log row
      await Promise.all([
        (sb as any)
          .from("insurance_pre_auth")
          .update({ sla_breached: true })
          .eq("id", pa.id),

        (sb as any).from("insurance_sla_log").insert({
          hospital_id:    settings.hospital_id,
          reference_type: "pre_auth",
          reference_id:   pa.id,
          patient_name:   patientName,
          tpa_name:       tpaName,
          breached_at:    new Date().toISOString(),
          breach_minutes: breachMins,
          alert_sent_at:  new Date().toISOString(),
        }),
      ]);

      await insertClinicalAlert(sb, settings.hospital_id, "sla_pre_auth_breach", message, "critical");

      if (useWhatsApp) {
        const sent = await sendWhatsApp(settings, settings.whatsapp_alert_number!, message, "SLA_PRE_AUTH_BREACH");
        if (sent) result.whatsapp_sent++;
      }
      result.sla_breaches++;
    }
  } catch (e: any) {
    result.errors.push(`sla_breaches: ${e.message}`);
  }

  return result;
}

// ── Handler ───────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // Verify caller is the pg_cron service role (or authorized admin)
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!authHeader.includes(serviceKey) && req.headers.get("x-internal-cron") !== "1") {
    return json({ error: "Unauthorized" }, 401);
  }

  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey,
    );

    const today       = isoDate(0);
    const sevenDaysOut = isoDate(7);
    const yesterday   = isoDate(-1);

    // Load all active hospitals with insurance settings + WATI credentials
    const { data: rows, error: rowsErr } = await (sb as any)
      .from("hospital_insurance_settings")
      .select(`
        hospital_id,
        sla_alert_channel,
        whatsapp_alert_number,
        n8n_webhook_url,
        hospitals!inner(id, name, is_active, wati_api_url, wati_api_key)
      `)
      .eq("hospitals.is_active", true);

    if (rowsErr) throw new Error(`hospital settings query: ${rowsErr.message}`);

    const summary: AlertResult[] = [];

    for (const row of rows ?? []) {
      const hosp = row.hospitals as any;
      const settings: HospitalSettings = {
        hospital_id:           row.hospital_id,
        hospital_name:         hosp?.name ?? "",
        sla_alert_channel:     row.sla_alert_channel   ?? "in_app",
        whatsapp_alert_number: row.whatsapp_alert_number ?? null,
        n8n_webhook_url:       row.n8n_webhook_url      ?? null,
        wati_api_url:          hosp?.wati_api_url       ?? null,
        wati_api_key:          hosp?.wati_api_key       ?? null,
      };

      try {
        const result = await scanHospital(sb, settings, today, sevenDaysOut, yesterday);
        summary.push({ hospital_id: row.hospital_id, ...result });

        const totalAlerts = result.overdue_queries + result.appeal_warnings + result.sla_breaches;
        if (totalAlerts > 0) {
          console.log(
            `[${settings.hospital_name}] ${totalAlerts} alert(s) — queries:${result.overdue_queries} appeals:${result.appeal_warnings} sla:${result.sla_breaches} wa:${result.whatsapp_sent}`,
          );
        }
      } catch (e: any) {
        console.error(`Scan failed for hospital ${row.hospital_id}:`, e);
        summary.push({
          hospital_id:     row.hospital_id,
          overdue_queries: 0,
          appeal_warnings: 0,
          sla_breaches:    0,
          whatsapp_sent:   0,
          errors:          [e.message],
        });
      }
    }

    const totals = summary.reduce(
      (acc, r) => ({
        overdue_queries: acc.overdue_queries + r.overdue_queries,
        appeal_warnings: acc.appeal_warnings + r.appeal_warnings,
        sla_breaches:    acc.sla_breaches    + r.sla_breaches,
        whatsapp_sent:   acc.whatsapp_sent   + r.whatsapp_sent,
      }),
      { overdue_queries: 0, appeal_warnings: 0, sla_breaches: 0, whatsapp_sent: 0 },
    );

    return json({
      ok:         true,
      run_date:   today,
      hospitals:  summary.length,
      ...totals,
      detail:     summary,
    });
  } catch (err: any) {
    console.error("insurance-daily-alerts fatal:", err);
    return json({ error: err.message }, 500);
  }
});
