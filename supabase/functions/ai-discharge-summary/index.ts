// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, resolveAiConfigFromEnv, callAiChat } from "../_shared/ai-config.ts";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";
import { checkAIAllowed } from "../_shared/ai-entitlement.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { admission_id } = await req.json();
    if (!admission_id) {
      return new Response(JSON.stringify({ error: "admission_id is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // The caller was verified as SOME real user above, but every query below
    // used to be scoped only by admission_id, with NO hospital_id filter
    // anywhere — so any logged-in user at any hospital could name another
    // hospital's admission_id and get back its patient's name, DOB,
    // allergies, phone, vitals, labs, meds, radiology findings and ICD
    // codes, wrapped in an AI-written discharge summary. Found in the Phase
    // 4 isolation audit — see KNOWN_BUGS.md. Resolve the caller's own
    // hospital first and filter every query by it — a foreign admission_id
    // then resolves to nothing instead of another tenant's chart.
    const { data: staff } = await sb.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    if (!staff?.hospital_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const callerHospitalId = staff.hospital_id;

    // Entitlement is already enforced further down inside resolveAiConfig(..., "discharge_summary",
    // ...) — it calls checkAIAllowed internally and throws AIDisabledError on a real disabled
    // decision — but that only fires AFTER the 8-way parallel PHI fetch just below (full
    // chart: rounds, labs, meds, OT, radiology, vitals, ICD codes), and this file's outer
    // catch-all doesn't special-case AIDisabledError anyway (a disabled hospital got a
    // confusing 500, not a clean 403). Checking explicitly here — matching the SAME
    // "discharge_summary" key resolveAiConfig actually uses, not the unrelated
    // "discharge_summary_structured" the frontend happens to also send in this same request
    // body for a different purpose — fails fast before that fetch and gets the status/message
    // right; the result is threaded into resolveAiConfig's `options.entitlement` below so it
    // is not re-decided. Found via Phase 6 AI-function-plumbing testing.
    const gate = await checkAIAllowed(sb, callerHospitalId, "discharge_summary");
    if (!gate.allowed) {
      return new Response(JSON.stringify({ error: gate.reason }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch all clinical data in parallel
    const [
      admRes,
      roundsRes,
      labsRes,
      medsRes,
      otRes,
      radRes,
      vitalsRes,
      icdRes,
    ] = await Promise.all([
      sb.from("admissions")
        .select("*, patients(full_name, dob, gender, blood_group, allergies, phone, chronic_conditions)")
        .eq("id", admission_id)
        .eq("hospital_id", callerHospitalId)
        .maybeSingle(),

      (sb as any).from("ward_round_notes")
        .select("subjective, objective, assessment, plan, created_at")
        .eq("admission_id", admission_id)
        .eq("hospital_id", callerHospitalId)
        .order("created_at", { ascending: false })
        .limit(12),

      (sb as any).from("lab_order_items")
        .select("test_name, result_value, result_unit, reference_range, result_flag, result_numeric, created_at")
        .eq("admission_id", admission_id)
        .eq("hospital_id", callerHospitalId)
        .order("created_at", { ascending: false })
        .limit(40),

      (sb as any).from("ipd_medications")
        .select("drug_name, dose, frequency, route, is_active, start_date")
        .eq("admission_id", admission_id)
        .eq("hospital_id", callerHospitalId),

      (sb as any).from("ot_schedules")
        .select("surgery_name, post_op_diagnosis, anaesthesia_type, actual_start_time, actual_end_time")
        .eq("admission_id", admission_id)
        .eq("hospital_id", callerHospitalId)
        .maybeSingle(),

      (sb as any).from("radiology_reports")
        .select("impression, findings, critical_finding, is_critical, radiology_orders(study_name)")
        .eq("admission_id", admission_id)
        .eq("hospital_id", callerHospitalId)
        .limit(6),

      (sb as any).from("nursing_vitals")
        .select("bp_systolic, bp_diastolic, pulse, temperature, spo2, respiratory_rate, pain_score, recorded_at")
        .eq("admission_id", admission_id)
        .eq("hospital_id", callerHospitalId)
        .order("recorded_at", { ascending: false })
        .limit(8),

      (sb as any).from("icd_codings")
        .select("primary_icd_code, primary_icd_desc, secondary_codes, status")
        .eq("visit_id", admission_id)
        .eq("visit_type", "ipd")
        .eq("hospital_id", callerHospitalId)
        .maybeSingle(),
    ]);

    const admission = admRes.data;
    if (!admission) {
      return new Response(JSON.stringify({ error: "Admission not found" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const patient = admission.patients as any;
    const rounds = roundsRes.data || [];
    const labs = labsRes.data || [];
    const meds = medsRes.data || [];
    const ot = otRes.data;
    const radReports = radRes.data || [];
    const vitals = vitalsRes.data || [];
    const icd = icdRes.data;

    const los = admission.admitted_at
      ? Math.ceil((Date.now() - new Date(admission.admitted_at).getTime()) / 86400000)
      : 0;

    const ageYrs = patient?.dob
      ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000)
      : null;

    // Build structured clinical context strings

    // Ward round notes — one line per note, newest first
    const notesText = rounds.length > 0
      ? rounds.map((r: any) => {
          const date = r.created_at ? new Date(r.created_at).toLocaleDateString("en-IN") : "";
          const parts = [r.assessment, r.plan, r.subjective, r.objective].filter(Boolean);
          return `[${date}] ${parts.join(" | ")}`;
        }).join("\n")
      : "No ward round notes recorded.";

    // Labs — highlight abnormal/critical flags, include reference range
    const activeLabs = labs.filter((l: any) => l.result_value);
    const abnormalLabs = activeLabs.filter((l: any) => l.result_flag && l.result_flag !== "normal");
    const normalLabs = activeLabs.filter((l: any) => !l.result_flag || l.result_flag === "normal");

    const formatLab = (l: any) => {
      const flag = l.result_flag && l.result_flag !== "normal" ? ` ⚠ ${l.result_flag.toUpperCase()}` : "";
      const range = l.reference_range ? ` (ref: ${l.reference_range})` : "";
      return `${l.test_name}: ${l.result_value} ${l.result_unit || ""}${range}${flag}`;
    };

    const labText = [
      abnormalLabs.length > 0 ? "ABNORMAL:\n" + abnormalLabs.map(formatLab).join("\n") : "",
      normalLabs.length > 0 ? "NORMAL:\n" + normalLabs.slice(0, 20).map(formatLab).join("\n") : "",
    ].filter(Boolean).join("\n") || "None";

    // Medications — active only, sorted
    const activeMeds = meds.filter((m: any) => m.is_active !== false);
    const medsText = activeMeds.length > 0
      ? activeMeds.map((m: any) => `• ${m.drug_name} ${m.dose || ""} ${m.frequency || ""} ${m.route ? "(" + m.route + ")" : ""}`.trim()).join("\n")
      : "None";

    // Vitals trend
    const vitalsText = vitals.length > 0
      ? vitals.map((v: any) => {
          const date = v.recorded_at ? new Date(v.recorded_at).toLocaleDateString("en-IN") : "";
          return `${date}: BP ${v.bp_systolic || "—"}/${v.bp_diastolic || "—"} mmHg, HR ${v.pulse || "—"} bpm, Temp ${v.temperature || "—"}°C, SpO2 ${v.spo2 || "—"}%, RR ${v.respiratory_rate || "—"}/min, Pain ${v.pain_score ?? "—"}/10`;
        }).join("\n")
      : "No vitals recorded.";

    // ICD coding
    const icdText = icd && (icd.status === "coded" || icd.status === "validated" || icd.status === "billed")
      ? `Primary: ${icd.primary_icd_code || "—"} — ${icd.primary_icd_desc || "—"}` +
        (Array.isArray(icd.secondary_codes) && icd.secondary_codes.length
          ? "\nSecondary: " + icd.secondary_codes.map((s: any) => `${s.code} ${s.description || ""}`).join(", ")
          : "")
      : "Pending ICD coding";

    // Comorbidities
    const comorbiditiesText = Array.isArray(patient?.chronic_conditions) && patient.chronic_conditions.length > 0
      ? patient.chronic_conditions.join(", ")
      : "None documented";

    // OT / procedure
    const otText = ot
      ? [
          ot.surgery_name ? `Surgery: ${ot.surgery_name}` : "",
          ot.anaesthesia_type ? `Anaesthesia: ${ot.anaesthesia_type}` : "",
          ot.post_op_diagnosis ? `Post-op diagnosis: ${ot.post_op_diagnosis}` : "",
        ].filter(Boolean).join("\n")
      : "None";

    // Radiology
    const radText = radReports.length > 0
      ? radReports.map((r: any) => {
          const study = (r as any).radiology_orders?.study_name || "Study";
          const critical = r.is_critical ? " ⚠ CRITICAL FINDING" : "";
          return [
            `${study}${critical}:`,
            r.impression ? `  Impression: ${r.impression}` : "",
            r.findings ? `  Findings: ${r.findings}` : "",
            r.critical_finding ? `  Critical: ${r.critical_finding}` : "",
          ].filter(Boolean).join("\n");
        }).join("\n\n")
      : "None";

    // admission.hospital_id === callerHospitalId by construction (the query above filtered
    // on it), so the gate computed above is valid to reuse here without re-deciding it.
    const config = (await resolveAiConfig(admission.hospital_id, "discharge_summary", 2500, { entitlement: gate }))
      ?? resolveAiConfigFromEnv(2500);

    if (!config) {
      return new Response(JSON.stringify({ error: "No AI provider configured. Go to Settings → API Hub." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `Generate a comprehensive, NABH-compliant discharge summary for an Indian hospital.

PATIENT:
Name: ${patient?.full_name || "Unknown"}
Age/Gender: ${ageYrs ?? "—"} yrs / ${patient?.gender || "—"}
Blood Group: ${patient?.blood_group || "Not recorded"}
Allergies: ${patient?.allergies || "NKDA"}
Comorbidities: ${comorbiditiesText}

ADMISSION:
Type: ${admission.admission_type || "—"}
Admitting Diagnosis: ${admission.admitting_diagnosis || "Not recorded"}
Length of Stay: ${los} days
ICD-10 Coding: ${icdText}

CLINICAL COURSE (ward round notes, newest first):
${notesText}

VITAL SIGNS TREND (last ${vitals.length} readings):
${vitalsText}

KEY INVESTIGATIONS (⚠ = abnormal/critical):
${labText}

RADIOLOGY:
${radText}

SURGERY / PROCEDURE:
${otText}

CURRENT MEDICATIONS AT DISCHARGE:
${medsText}

Return ONLY valid JSON (no markdown, no explanation):
{
  "final_diagnosis": "clear primary diagnosis with any relevant secondary diagnoses, 2-3 sentences",
  "icd_codes": { "primary": "code — description or Pending", "secondary": ["code — desc"] },
  "comorbidities": ["list of active comorbidities relevant to this admission"],
  "procedures_performed": ["list of procedures/surgeries performed during admission"],
  "hospital_course": "4-6 sentence narrative covering clinical events, response to treatment, complications if any, and condition at discharge",
  "vitals_at_discharge": { "bp": "systolic/diastolic mmHg", "hr": "bpm", "spo2": "%", "temp": "°C", "rr": "/min" },
  "discharge_medications": [
    { "drug": "generic name + strength", "dose": "dose", "frequency": "OD/BD/TDS/QID/SOS", "duration": "X days", "instructions": "with food / empty stomach / etc" }
  ],
  "diet_instructions": "specific dietary advice relevant to diagnosis (e.g. low salt, diabetic diet)",
  "activity_restrictions": "specific restrictions (e.g. no heavy lifting for 6 weeks, bed rest for 2 days)",
  "follow_up_appointments": ["OPD with Dr [specialty] in X days", "Repeat [test] in X weeks"],
  "red_flag_symptoms": ["fever >38.5°C", "chest pain", "wound discharge", "breathlessness — return to ER immediately"],
  "emergency_contact_note": "For emergencies, report to casualty immediately or call hospital 24/7 helpline",
  "patient_friendly_summary": "2-3 sentences in simple English that a patient with no medical background can understand",
  "confidence": 0.85,
  "reasoning": "one sentence explaining confidence level based on completeness of clinical data"
}`;

    const content = await callAiChat(config, [
      { role: "system", content: "You are a senior clinical documentation specialist for Indian hospitals. Generate accurate, structured, NABH-compliant discharge summaries. Always return valid JSON only, no markdown." },
      { role: "user", content: prompt },
    ], 2500);

    const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let structured: Record<string, unknown>;
    try {
      structured = JSON.parse(cleaned);
    } catch {
      throw new Error("Failed to parse AI response as JSON");
    }

    return new Response(JSON.stringify({ structured, patient_name: patient?.full_name, admission_id }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-discharge-summary error:", sanitizeForLog(e instanceof Error ? e.message : String(e)));
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
