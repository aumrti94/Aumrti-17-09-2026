// @ts-nocheck
/**
 * ai-nabh-indicator-alert — Weekly NABH QI anomaly detector.
 *
 * Scheduling (choose one):
 *   A) Supabase Dashboard → Edge Functions → ai-nabh-indicator-alert → Schedule
 *      Cron expression: 0 2 * * 1   (Mondays 02:00 UTC = 07:30 IST)
 *
 *   B) pg_cron (run in Supabase SQL editor once):
 *      SELECT cron.schedule(
 *        'nabh-qi-weekly-alert',
 *        '0 2 * * 1',
 *        $$SELECT net.http_post(
 *           url := current_setting('app.supabase_functions_url') || '/ai-nabh-indicator-alert',
 *           headers := jsonb_build_object(
 *             'Content-Type','application/json',
 *             'x-cron-secret', current_setting('app.cron_secret')
 *           ),
 *           body := '{}'::jsonb
 *        )$$
 *      );
 *
 *   Set app.cron_secret in Supabase Dashboard → Settings → Secrets as CRON_SECRET.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, resolveAiConfigFromEnv, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// ─── Indicator definitions ────────────────────────────────────────────────────

interface IndicatorResult {
  key: string;
  label: string;
  currentValue: number;
  baselineValue: number;   // 4-week weekly average
  deviationPct: number;    // (current - baseline) / baseline * 100
  unit: string;
  direction: "higher_is_worse" | "lower_is_worse";
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// ─── Per-hospital indicator computation ──────────────────────────────────────

async function computeIndicators(
  sb: ReturnType<typeof createClient>,
  hospitalId: string,
): Promise<IndicatorResult[]> {
  const todayStr      = daysAgo(0);
  const week0Start    = daysAgo(7);   // current week: last 7 days
  const baseline4wEnd = daysAgo(7);   // baseline ends where current week starts
  const baseline4wStart = daysAgo(35); // 4 weeks before that

  const results: IndicatorResult[] = [];

  // ── 1. Average LOS (days) ─────────────────────────────────────────────────

  const losQuery = async (from: string, to: string) => {
    const { data } = await sb
      .from("admissions")
      .select("admission_date, discharge_date")
      .eq("hospital_id", hospitalId)
      .eq("status", "discharged")
      .gte("discharge_date", from)
      .lt("discharge_date", to);
    if (!data || data.length === 0) return null;
    const totalDays = data.reduce((sum: number, r: any) => {
      const adm = new Date(r.admission_date).getTime();
      const dis = new Date(r.discharge_date).getTime();
      return sum + Math.max(0, (dis - adm) / 86400_000);
    }, 0);
    return totalDays / data.length;
  };

  const losCurrent  = await losQuery(week0Start, todayStr);
  const losBaseline = await losQuery(baseline4wStart, baseline4wEnd);

  if (losCurrent !== null && losBaseline !== null && losBaseline > 0) {
    // Baseline is total over 4 weeks; divide by 4 to get weekly average
    const baselineWeekly = losBaseline; // Already averaged per patient, not per week
    const dev = ((losCurrent - baselineWeekly) / baselineWeekly) * 100;
    results.push({
      key: "avg_los",
      label: "Average Length of Stay",
      currentValue: Math.round(losCurrent * 10) / 10,
      baselineValue: Math.round(baselineWeekly * 10) / 10,
      deviationPct: Math.round(dev),
      unit: "days",
      direction: "higher_is_worse",
    });
  }

  // ── 2. Re-admission within 48 hrs (%) ────────────────────────────────────

  const readmitQuery = async (from: string, to: string) => {
    const { data: admissions } = await sb
      .from("admissions")
      .select("patient_id, admission_date")
      .eq("hospital_id", hospitalId)
      .gte("admission_date", from)
      .lt("admission_date", to);
    if (!admissions || admissions.length === 0) return null;

    let readmits = 0;
    const patientIds = [...new Set(admissions.map((a: any) => a.patient_id))];

    // For each patient with a new admission in this window, check if they had a
    // discharge within 48h before that admission date
    for (const adm of admissions as any[]) {
      const admDate = new Date(adm.admission_date);
      const cutoff48h = new Date(admDate.getTime() - 48 * 3_600_000).toISOString().slice(0, 10);
      const { data: priorDischarge } = await sb
        .from("admissions")
        .select("id")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", adm.patient_id)
        .eq("status", "discharged")
        .gte("discharge_date", cutoff48h)
        .lt("discharge_date", adm.admission_date)
        .limit(1);
      if (priorDischarge && priorDischarge.length > 0) readmits++;
    }
    return (readmits / admissions.length) * 100;
  };

  const readmitCurrent  = await readmitQuery(week0Start, todayStr);
  const readmitBaseline4w = await readmitQuery(baseline4wStart, baseline4wEnd);
  // Baseline is over 4 weeks — rate is already a percentage so no weekly divide needed
  if (readmitCurrent !== null && readmitBaseline4w !== null && readmitBaseline4w > 0) {
    const dev = ((readmitCurrent - readmitBaseline4w) / readmitBaseline4w) * 100;
    results.push({
      key: "readmission_48h_pct",
      label: "Re-admission within 48 hrs",
      currentValue: Math.round(readmitCurrent * 10) / 10,
      baselineValue: Math.round(readmitBaseline4w * 10) / 10,
      deviationPct: Math.round(dev),
      unit: "%",
      direction: "higher_is_worse",
    });
  }

  // ── 3. Lab TAT > 2 hrs (%) ───────────────────────────────────────────────

  const labTatQuery = async (from: string, to: string) => {
    const { data } = await sb
      .from("lab_orders")
      .select("id, created_at, resulted_at")
      .eq("hospital_id", hospitalId)
      .not("resulted_at", "is", null)
      .gte("created_at", from + "T00:00:00")
      .lt("created_at", to + "T23:59:59");
    if (!data || data.length === 0) return null;
    const breaches = data.filter((r: any) => {
      const tat = (new Date(r.resulted_at).getTime() - new Date(r.created_at).getTime()) / 3_600_000;
      return tat > 2;
    }).length;
    return (breaches / data.length) * 100;
  };

  const labTatCurrent  = await labTatQuery(week0Start, todayStr);
  const labTatBaseline = await labTatQuery(baseline4wStart, baseline4wEnd);

  if (labTatCurrent !== null && labTatBaseline !== null && labTatBaseline > 0) {
    const dev = ((labTatCurrent - labTatBaseline) / labTatBaseline) * 100;
    results.push({
      key: "lab_tat_breach_pct",
      label: "Lab TAT > 2 hrs",
      currentValue: Math.round(labTatCurrent * 10) / 10,
      baselineValue: Math.round(labTatBaseline * 10) / 10,
      deviationPct: Math.round(dev),
      unit: "%",
      direction: "higher_is_worse",
    });
  }

  // ── 4. OT cancellation (%) ───────────────────────────────────────────────

  const otCancelQuery = async (from: string, to: string) => {
    const { data } = await sb
      .from("ot_schedules")
      .select("status")
      .eq("hospital_id", hospitalId)
      .gte("scheduled_date", from)
      .lte("scheduled_date", to);
    if (!data || data.length === 0) return null;
    const cancelled = data.filter((r: any) => r.status === "cancelled").length;
    return (cancelled / data.length) * 100;
  };

  const otCancelCurrent  = await otCancelQuery(week0Start, todayStr);
  const otCancelBaseline = await otCancelQuery(baseline4wStart, baseline4wEnd);

  if (otCancelCurrent !== null && otCancelBaseline !== null && otCancelBaseline > 0) {
    const dev = ((otCancelCurrent - otCancelBaseline) / otCancelBaseline) * 100;
    results.push({
      key: "ot_cancellation_pct",
      label: "OT Cancellation Rate",
      currentValue: Math.round(otCancelCurrent * 10) / 10,
      baselineValue: Math.round(otCancelBaseline * 10) / 10,
      deviationPct: Math.round(dev),
      unit: "%",
      direction: "higher_is_worse",
    });
  }

  // ── 5. CAPA overdue (%) ──────────────────────────────────────────────────
  // Snapshot of right now vs same snapshot 7 days ago (approximated by comparing
  // total overdue vs total actions created more than 7 days ago)

  const { data: capaAll } = await sb
    .from("committee_actions")
    .select("due_date, status, created_at")
    .eq("hospital_id", hospitalId)
    .not("due_date", "is", null);

  if (capaAll && capaAll.length > 0) {
    const overdueNow = capaAll.filter((a: any) =>
      a.due_date < todayStr && !["completed", "deferred"].includes(a.status)
    ).length;
    const overdueWeekAgo = capaAll.filter((a: any) =>
      a.due_date < week0Start && !["completed", "deferred"].includes(a.status)
    ).length;
    const totalNow = capaAll.length;

    const capaPctNow     = (overdueNow / totalNow) * 100;
    const capaPctWeekAgo = overdueWeekAgo > 0 ? (overdueWeekAgo / totalNow) * 100 : null;

    if (capaPctWeekAgo !== null && capaPctWeekAgo > 0) {
      const dev = ((capaPctNow - capaPctWeekAgo) / capaPctWeekAgo) * 100;
      results.push({
        key: "capa_overdue_pct",
        label: "CAPA Overdue",
        currentValue: Math.round(capaPctNow * 10) / 10,
        baselineValue: Math.round(capaPctWeekAgo * 10) / 10,
        deviationPct: Math.round(dev),
        unit: "%",
        direction: "higher_is_worse",
      });
    }
  }

  // ── 6. Infection rate (new events per week) ──────────────────────────────

  const infectionQuery = async (from: string, to: string) => {
    const { count } = await sb
      .from("ipc_infection_events")
      .select("id", { count: "exact", head: true })
      .eq("hospital_id", hospitalId)
      .gte("onset_date", from)
      .lte("onset_date", to);
    return count ?? 0;
  };

  const infCurrent = await infectionQuery(week0Start, todayStr);
  const infBaseline4w = await infectionQuery(baseline4wStart, baseline4wEnd);
  const infBaselineWeekly = infBaseline4w / 4; // weekly average

  if (infBaselineWeekly > 0) {
    const dev = ((infCurrent - infBaselineWeekly) / infBaselineWeekly) * 100;
    results.push({
      key: "infection_rate",
      label: "New HAI Events",
      currentValue: infCurrent,
      baselineValue: Math.round(infBaselineWeekly * 10) / 10,
      deviationPct: Math.round(dev),
      unit: "events",
      direction: "higher_is_worse",
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

  const systemPrompt = `You are a NABH quality indicator expert for Indian hospitals. Generate a concise 2-sentence alert for a quality anomaly. First sentence: describe the deviation factually. Second sentence: state the most likely cause based on NABH/clinical knowledge. Be specific and actionable. No preamble.`;

  const userPrompt = `Hospital: ${hospitalName}
Indicator: ${indicator.label}
Current week value: ${indicator.currentValue} ${indicator.unit}
4-week baseline average: ${indicator.baselineValue} ${indicator.unit}
Change: ${direction} by ${absDeviation}% vs baseline

Write the 2-sentence NABH QI anomaly alert.`;

  const config = (await resolveAiConfig(hospitalId, "nabh_evidence", 200)) ?? resolveAiConfigFromEnv(200);

  if (!config) {
    // Fallback if no AI configured
    const direction2 = indicator.deviationPct > 0 ? "risen" : "fallen";
    return `${indicator.label} has ${direction2} to ${indicator.currentValue}${indicator.unit} this week, a ${Math.abs(indicator.deviationPct)}% deviation from the 4-week baseline of ${indicator.baselineValue}${indicator.unit}. Immediate review is recommended to identify contributing factors and initiate corrective action.`;
  }

  try {
    const text = await callAiChat(config, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], 200, 0.3);
    return text.trim();
  } catch (_) {
    // Fallback on error
    const direction2 = indicator.deviationPct > 0 ? "risen" : "fallen";
    return `${indicator.label} has ${direction2} to ${indicator.currentValue}${indicator.unit} this week, a ${Math.abs(indicator.deviationPct)}% deviation from the 4-week baseline of ${indicator.baselineValue}${indicator.unit}. Immediate review is recommended to identify contributing factors and initiate corrective action.`;
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
      // Manual invocation by an authenticated admin user
      const anonClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_ANON_KEY")!,
      );
      const { data: { user }, error } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
      if (!error && user) authorised = true;
    }

    if (!authorised) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optionally scope to a single hospital (for manual on-demand invocation)
    let body: { hospital_id?: string } = {};
    try { body = await req.json(); } catch (_) {}

    // Fetch hospitals to process
    let hospitalsQuery = sb.from("hospitals").select("id, name").eq("is_active", true);
    if (body.hospital_id) hospitalsQuery = hospitalsQuery.eq("id", body.hospital_id);
    const { data: hospitals, error: hErr } = await hospitalsQuery;
    if (hErr) throw hErr;

    const todayStr    = daysAgo(0);
    const week0Start  = daysAgo(7);
    const summary: { hospital: string; anomalies: number; inserted: number }[] = [];

    for (const hospital of (hospitals || []) as { id: string; name: string }[]) {
      const indicators = await computeIndicators(sb, hospital.id);

      // Keep only indicators that deviate by > 20%
      const anomalies = indicators.filter(i => Math.abs(i.deviationPct) > 20);
      let inserted = 0;

      for (const ind of anomalies) {
        // Deduplication: skip if we already inserted this indicator in the last 7 days
        const { count: existing } = await sb
          .from("clinical_alerts")
          .select("id", { count: "exact", head: true })
          .eq("hospital_id", hospital.id)
          .eq("alert_type", "nabh_qi_anomaly")
          .eq("ward_name", ind.key)
          .gte("created_at", week0Start + "T00:00:00");

        if ((existing ?? 0) > 0) continue;  // already alerted this week

        const aiMessage = await generateIndicatorAlert(ind, hospital.name, hospital.id);

        await sb.from("clinical_alerts").insert({
          hospital_id: hospital.id,
          alert_type: "nabh_qi_anomaly",
          alert_message: aiMessage,
          severity: Math.abs(ind.deviationPct) >= 40 ? "high" : "medium",
          ward_name: ind.key,           // indicator key (e.g. "avg_los")
          bed_number: JSON.stringify({   // repurposed: stores metric metadata
            label: ind.label,
            current: ind.currentValue,
            baseline: ind.baselineValue,
            deviation_pct: ind.deviationPct,
            unit: ind.unit,
          }),
          patient_id: null,
          is_acknowledged: false,
        });
        inserted++;
      }

      summary.push({ hospital: hospital.name, anomalies: anomalies.length, inserted });
    }

    return json({ ok: true, processed: (hospitals || []).length, summary });
  } catch (err) {
    console.error("ai-nabh-indicator-alert:", err);
    return json({ error: String(err) }, 500);
  }
});
