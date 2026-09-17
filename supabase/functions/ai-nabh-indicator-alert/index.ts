// @ts-nocheck
/**
 * ai-nabh-indicator-alert — NABH QI anomaly detector.
 *
 * This function READS the persisted indicator set and narrates anomalies. It no
 * longer computes indicators itself.
 *
 * It used to run its own six queries against source tables, four of which
 * referenced columns and tables that do not exist (admissions.admission_date /
 * discharge_date, lab_orders.resulted_at, committee_actions), and one of which
 * issued an HTTP round trip per admission to test readmission. All indicator
 * arithmetic now lives in public.run_quality_indicator_collection(); this
 * function's only jobs are the LLM narration and the alert row, which SQL cannot
 * do.
 *
 * Scheduling is now a migration, not a comment: see
 * supabase/migrations/20261011000060_schedule_nabh_qi_alert.sql
 * (job `aumrti-nabh-qi-weekly-alert`, Mondays 02:00 UTC). Before that migration
 * there was no cron.schedule for this function anywhere, so it had never run.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, resolveAiConfigFromEnv, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

/** Only flag movements this large, in the worsening direction. */
const DEVIATION_THRESHOLD_PCT = 20;
/** How many prior monthly periods form the baseline. */
const BASELINE_PERIODS = 3;

interface IndicatorResult {
  key: string;            // indicator_code
  label: string;
  currentValue: number;
  baselineValue: number;
  deviationPct: number;   // signed: (current - baseline) / |baseline| * 100
  unit: string;
  worsening: boolean;
}

function monthStart(offsetMonths: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - offsetMonths);
  return d.toISOString().slice(0, 10);
}

/**
 * Read the current period and the trailing baseline periods for one hospital,
 * and return only the indicators that have moved materially for the worse.
 */
async function readIndicatorAnomalies(
  sb: ReturnType<typeof createClient>,
  hospitalId: string,
): Promise<IndicatorResult[]> {
  const currentPeriod = monthStart(0);
  const earliestPeriod = monthStart(BASELINE_PERIODS);

  const { data, error } = await sb
    .from("quality_indicators")
    .select("indicator_code, indicator_name, value, unit, direction, period_start")
    .eq("hospital_id", hospitalId)
    .eq("period", "monthly")
    .gte("period_start", earliestPeriod)
    .not("value", "is", null);

  if (error) throw error;

  const byCode = new Map<string, any[]>();
  for (const row of data || []) {
    if (!byCode.has(row.indicator_code)) byCode.set(row.indicator_code, []);
    byCode.get(row.indicator_code)!.push(row);
  }

  const results: IndicatorResult[] = [];

  for (const [code, rows] of byCode) {
    const current = rows.find((r) => r.period_start === currentPeriod);
    if (!current) continue;

    // 'neutral' indicators (volume metrics) have no worse direction to alert on.
    if (current.direction === "neutral") continue;

    const baselineRows = rows.filter((r) => r.period_start !== currentPeriod);
    if (baselineRows.length === 0) continue;

    const baseline =
      baselineRows.reduce((sum, r) => sum + Number(r.value), 0) / baselineRows.length;
    if (baseline === 0) continue; // no meaningful percentage change from zero

    const currentValue = Number(current.value);
    const deviationPct = Math.round(((currentValue - baseline) / Math.abs(baseline)) * 1000) / 10;

    // A 30% improvement is not an anomaly worth waking anyone for.
    const worsening =
      current.direction === "lower_is_better" ? deviationPct > 0 : deviationPct < 0;

    if (!worsening || Math.abs(deviationPct) < DEVIATION_THRESHOLD_PCT) continue;

    results.push({
      key: code,
      label: current.indicator_name,
      currentValue,
      baselineValue: Math.round(baseline * 100) / 100,
      deviationPct,
      unit: current.unit,
      worsening,
    });
  }

  return results;
}

// ─── AI call using shared helper ─────────────────────────────────────────────

async function generateIndicatorAlert(
  indicator: IndicatorResult,
  hospitalName: string,
  hospitalId: string,
): Promise<string> {
  const direction = indicator.deviationPct > 0 ? "increased" : "decreased";
  const absDeviation = Math.abs(indicator.deviationPct);

  const fallback = () =>
    `${indicator.label} has ${indicator.deviationPct > 0 ? "risen" : "fallen"} to ` +
    `${indicator.currentValue}${indicator.unit} this period, a ${absDeviation}% deviation from the ` +
    `${BASELINE_PERIODS}-period baseline of ${indicator.baselineValue}${indicator.unit}. ` +
    `Immediate review is recommended to identify contributing factors and initiate corrective action.`;

  const systemPrompt = `You are a NABH quality indicator expert for Indian hospitals. Generate a concise 2-sentence alert for a quality anomaly. First sentence: describe the deviation factually. Second sentence: state the most likely cause based on NABH/clinical knowledge. Be specific and actionable. No preamble.`;

  const userPrompt = `Hospital: ${hospitalName}
Indicator: ${indicator.label}
Current period value: ${indicator.currentValue} ${indicator.unit}
${BASELINE_PERIODS}-period baseline average: ${indicator.baselineValue} ${indicator.unit}
Change: ${direction} by ${absDeviation}% vs baseline (this is the WORSENING direction for this indicator)

Write the 2-sentence NABH QI anomaly alert.`;

  // resolveAiConfig() throws AIDisabledError (not returns null) when the hospital's AI
  // switch withholds this feature — it was previously called OUTSIDE this try/catch, so a
  // disabled hospital's AIDisabledError propagated up through this function and out of the
  // per-hospital loop that calls it, aborting the whole batch scan for every hospital
  // processed after the disabled one, rather than gracefully degrading to the deterministic
  // fallback() text the way every other failure mode here already does. Found via Phase 6
  // AI-function-plumbing testing.
  try {
    const config = (await resolveAiConfig(hospitalId, "nabh_evidence", 200)) ?? resolveAiConfigFromEnv(200);
    if (!config) return fallback();

    const text = await callAiChat(config, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], 200, 0.3);
    return text.trim();
  } catch (_) {
    return fallback();
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    // Auth: accept either a cron secret (for scheduled runs) or a user Bearer token
    const cronSecret = Deno.env.get("CRON_SECRET");
    const incomingCronSecret = req.headers.get("x-cron-secret");
    const authHeader = req.headers.get("Authorization");

    let authorised = false;

    if (cronSecret && incomingCronSecret === cronSecret) {
      authorised = true;  // pg_cron / scheduled invocation
    } else if (authHeader?.startsWith("Bearer ")) {
      // Manual invocation by an authenticated admin user, or the service-role key
      // used by the pg_cron job created in 20261011000060.
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const token = authHeader.replace("Bearer ", "");
      if (serviceKey && token === serviceKey) {
        authorised = true;
      } else {
        // Previously any authenticated bearer token was accepted here — not
        // just an admin, despite the comment's own stated intent — so any
        // logged-in staff member of any hospital could trigger a scan of
        // (or, with no hospital_id, ALL hospitals') NABH anomalies, writing
        // real clinical_alerts rows into that hospital's stream and reading
        // back its anomaly counts. Found in the Phase 4 isolation audit —
        // see KNOWN_BUGS.md. Manual invocation is genuinely admin-only (the
        // no-hospital_id path scans every tenant), so this now requires
        // aumrti_admins, the same check every other admin-gated function in
        // this repo uses — never a hospital_id comparison.
        const anonClient = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_ANON_KEY")!,
        );
        const { data: { user }, error } = await anonClient.auth.getUser(token);
        if (!error && user) {
          const adminCheckClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
          );
          const { data: adminRow } = await adminCheckClient
            .from("aumrti_admins")
            .select("id")
            .eq("auth_user_id", user.id)
            .eq("is_active", true)
            .maybeSingle();
          if (adminRow) authorised = true;
        }
      }
    }

    if (!authorised) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optionally scope to a single hospital (for manual on-demand invocation)
    let body: { hospital_id?: string } = {};
    try { body = await req.json(); } catch (_) { /* no/invalid JSON body — run across all hospitals */ }

    let hospitalsQuery = sb.from("hospitals").select("id, name").eq("is_active", true);
    if (body.hospital_id) hospitalsQuery = hospitalsQuery.eq("id", body.hospital_id);
    const { data: hospitals, error: hErr } = await hospitalsQuery;
    if (hErr) throw hErr;

    const dedupeSince = monthStart(0);
    const summary: { hospital: string; anomalies: number; inserted: number }[] = [];

    for (const hospital of (hospitals || []) as { id: string; name: string }[]) {
      let anomalies: IndicatorResult[] = [];
      try {
        anomalies = await readIndicatorAnomalies(sb, hospital.id);
      } catch (e) {
        // One tenant's data must not abort the run for everyone else.
        console.error(`readIndicatorAnomalies failed for ${hospital.id}:`, e instanceof Error ? e.message : String(e));
        summary.push({ hospital: hospital.name, anomalies: 0, inserted: 0 });
        continue;
      }

      let inserted = 0;

      for (const ind of anomalies) {
        // Deduplicate on the indicator_code column rather than the repurposed
        // ward_name, so one alert per indicator per period.
        const { count: existing } = await sb
          .from("clinical_alerts")
          .select("id", { count: "exact", head: true })
          .eq("hospital_id", hospital.id)
          .eq("alert_type", "nabh_qi_anomaly")
          .eq("indicator_code", ind.key)
          .gte("created_at", dedupeSince + "T00:00:00");

        if ((existing ?? 0) > 0) continue;

        const aiMessage = await generateIndicatorAlert(ind, hospital.name, hospital.id);

        const metric = {
          label: ind.label,
          current: ind.currentValue,
          baseline: ind.baselineValue,
          deviation_pct: ind.deviationPct,
          unit: ind.unit,
        };

        // `alert_type: "nabh_qi_anomaly"` was never in clinical_alerts_alert_type_check
        // despite being the real, actively-used vocabulary (NABHQIAlertCard.tsx filters and
        // realtime-subscribes on this exact string) — every insert has always violated the
        // CHECK constraint, silently, since the error was never checked. Fixed via migration
        // 20261106000028 plus this error check. Found via Phase 6 edge-function testing.
        const { error: alertErr } = await sb.from("clinical_alerts").insert({
          hospital_id: hospital.id,
          alert_type: "nabh_qi_anomaly",
          alert_message: aiMessage,
          severity: Math.abs(ind.deviationPct) >= 40 ? "high" : "medium",
          indicator_code: ind.key,
          metric_json: metric,
          // Legacy mirrors, written for one release so already-deployed readers
          // keep working. NABHQIAlertCard prefers the columns above.
          ward_name: ind.key,
          bed_number: JSON.stringify(metric),
          patient_id: null,
          is_acknowledged: false,
        });
        if (alertErr) {
          console.error(`ai-nabh-indicator-alert: clinical_alerts insert failed for ${hospital.id}/${ind.key}:`, alertErr.message);
          continue;
        }
        inserted++;
      }

      summary.push({ hospital: hospital.name, anomalies: anomalies.length, inserted });
    }

    return json({ ok: true, processed: (hospitals || []).length, summary });
  } catch (err) {
    console.error("ai-nabh-indicator-alert:", err instanceof Error ? err.message : String(err));
    return json({ error: "Internal error" }, 500);
  }
});
