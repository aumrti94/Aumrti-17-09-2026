// nps-survey-dispatch — real patient-eligibility lookup + SMS dispatch for
// the 30/90/180-day NPS surveys triggered from CustomerSuccessPage.
//
// Replaces the previous "Send survey" buttons, which faked a 1.5s delay and
// a success toast with no DB write and nothing actually sent.
//
// Eligibility: a patient discharged from IPD between trigger_day and
// trigger_day+7 days ago (a rolling week-wide catch window, since this is
// admin-triggered rather than a strict daily cron), excluding deceased
// discharges, who hasn't already been sent a survey at that trigger_day.
//
// SMS transport: Twilio (free-text body — no pre-approved DLT template
// required, unlike MSG91's Flow/OTP APIs used elsewhere in this codebase).
// If Twilio isn't configured, eligible patients are still counted and
// reported, but no nps_surveys row is created for them (so the next
// dispatch attempt will retry them) — this avoids inserting a "sent" row
// for something that wasn't actually sent.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { APP_URL } from "../_shared/brand.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const VALID_TRIGGER_DAYS = [30, 90, 180];

async function sendSms(phone: string, body: string): Promise<{ ok: boolean; error?: string }> {
  const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const twilioToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const twilioFrom = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!twilioSid || !twilioToken || !twilioFrom) {
    return { ok: false, error: "No SMS provider configured (TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM_NUMBER)" };
  }
  const digits = phone.replace(/\D/g, "");
  const e164 = digits.startsWith("91") ? `+${digits}` : `+91${digits}`;
  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${twilioSid}:${twilioToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: twilioFrom, To: e164, Body: body }),
    });
    if (!res.ok) return { ok: false, error: `Twilio ${res.status}: ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const { data: adminRow } = await admin
      .from("aumrti_admins")
      .select("id")
      .eq("auth_user_id", user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (!adminRow) return json({ error: "Forbidden: aumrti_admin role required" }, 403);

    const { trigger_day, hospital_id } = await req.json();
    if (!VALID_TRIGGER_DAYS.includes(trigger_day)) {
      return json({ error: `trigger_day must be one of ${VALID_TRIGGER_DAYS.join(", ")}` }, 400);
    }

    const now = Date.now();
    const windowStart = new Date(now - (trigger_day + 7) * 86400000).toISOString();
    const windowEnd = new Date(now - trigger_day * 86400000).toISOString();

    let admissionsQuery = admin
      .from("admissions")
      .select("id, hospital_id, patient_id, discharged_at")
      .not("discharged_at", "is", null)
      .gte("discharged_at", windowStart)
      .lt("discharged_at", windowEnd)
      .neq("discharge_type", "expired");
    if (hospital_id) admissionsQuery = admissionsQuery.eq("hospital_id", hospital_id);

    const { data: candidates, error: candErr } = await admissionsQuery;
    if (candErr) return json({ error: `Eligibility lookup failed: ${candErr.message}` }, 500);
    if (!candidates || candidates.length === 0) {
      return json({ eligible: 0, sent: 0, skipped_no_provider: 0, already_surveyed: 0, no_phone: 0 });
    }

    const patientIds = [...new Set(candidates.map((c) => c.patient_id).filter(Boolean))];

    // Exclude patients already surveyed at this trigger_day
    const { data: existing } = await admin
      .from("nps_surveys")
      .select("patient_id")
      .eq("trigger_day", trigger_day)
      .in("patient_id", patientIds);
    const alreadySurveyed = new Set((existing || []).map((r) => r.patient_id));

    const toSurvey = candidates.filter((c) => c.patient_id && !alreadySurveyed.has(c.patient_id));
    const dedupedByPatient = new Map(toSurvey.map((c) => [c.patient_id, c])); // one survey per patient per trigger_day

    const { data: patients } = await admin
      .from("patients")
      .select("id, phone, full_name")
      .in("id", [...dedupedByPatient.keys()]);
    const phoneByPatient = new Map((patients || []).map((p) => [p.id, p]));

    let sent = 0, skippedNoProvider = 0, noPhone = 0;
    // A link, not "reply with a number" — an inbound-SMS-reply flow would need
    // a Twilio webhook pointed at this project from the Twilio console, which
    // isn't something this session can configure. A link to our own page
    // needs no inbound SMS setup at all.
    const appUrl = (Deno.env.get("APP_PUBLIC_URL") || APP_URL).replace(/\/$/, "");
    const surveyMessage = (hospitalName: string, surveyId: string) =>
      `We hope your recent visit to ${hospitalName || "our hospital"} went well. Please rate your experience (30 seconds): ${appUrl}/survey/${surveyId}`;

    // Look up hospital names for the SMS copy (best-effort, small set)
    const hospitalIds = [...new Set([...dedupedByPatient.values()].map((c) => c.hospital_id))];
    const { data: hospitals } = await admin.from("hospitals").select("id, name").in("id", hospitalIds);
    const hospitalNameById = new Map((hospitals || []).map((h) => [h.id, h.name]));

    for (const [patientId, candidate] of dedupedByPatient) {
      const patient = phoneByPatient.get(patientId);
      if (!patient?.phone) { noPhone++; continue; }

      // Create the survey row FIRST so we have an id for the link, then only
      // keep it if the SMS actually sends — otherwise this patient stays
      // eligible for the next dispatch attempt instead of a dead link existing.
      const { data: surveyRow, error: insertErr } = await admin
        .from("nps_surveys")
        .insert({
          hospital_id: candidate.hospital_id,
          trigger_day,
          patient_id: patientId,
          patient_phone: patient.phone,
          status: "sent",
        })
        .select("id")
        .single();
      if (insertErr || !surveyRow) { skippedNoProvider++; continue; }

      const result = await sendSms(patient.phone, surveyMessage(hospitalNameById.get(candidate.hospital_id) || "", surveyRow.id));
      if (!result.ok) {
        await admin.from("nps_surveys").delete().eq("id", surveyRow.id);
        skippedNoProvider++;
        continue;
      }
      sent++;
    }

    return json({
      eligible: dedupedByPatient.size,
      sent,
      skipped_no_provider: skippedNoProvider,
      already_surveyed: alreadySurveyed.size,
      no_phone: noPhone,
    });
  } catch (err) {
    console.error("nps-survey-dispatch error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
