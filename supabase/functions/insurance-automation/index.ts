// @ts-nocheck
// Insurance Automation Engine
// Handles: auto_intimate, ai_generate_preauth, auto_bundle_and_submit_claim, check_deadlines
// Triggered by: DB triggers (admission INSERT/discharge UPDATE) and pg_cron

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ── AI call helper ────────────────────────────────────────
async function callAIProxy(
  supabaseUrl: string,
  serviceKey: string,
  hospitalId: string,
  prompt: string,
  featureKey: string,
  maxTokens = 400
): Promise<string> {
  const config = await resolveAiConfig(hospitalId, featureKey, maxTokens);
  if (!config) return "";

  try {
    return await callAiChat(config, [{ role: "user", content: prompt }], maxTokens);
  } catch (_) {
    return "";
  }
}

// ── Log automation event ──────────────────────────────────
async function logEvent(
  adminClient: any,
  hospitalId: string,
  eventType: string,
  status: "success" | "failed" | "skipped" | "pending_review",
  payload: Record<string, any> = {},
  opts: { admissionId?: string; preAuthId?: string; claimId?: string; aiUsed?: boolean; aiFeatureKey?: string } = {}
) {
  await adminClient.from("insurance_automation_log").insert({
    hospital_id: hospitalId,
    admission_id: opts.admissionId || null,
    pre_auth_id: opts.preAuthId || null,
    claim_id: opts.claimId || null,
    event_type: eventType,
    status,
    payload,
    ai_used: opts.aiUsed || false,
    ai_feature_key: opts.aiFeatureKey || null,
    triggered_by: "system",
  });
}

// ── Get automation config for hospital ────────────────────
async function getAutoConfig(adminClient: any, hospitalId: string) {
  const { data } = await adminClient
    .from("insurance_automation_config")
    .select("*")
    .eq("hospital_id", hospitalId)
    .maybeSingle();
  return data || {
    auto_intimate_enabled: true,
    auto_preauth_generate_enabled: true,
    auto_preauth_submit_enabled: false,
    auto_claim_submit_enabled: false,
    auto_claim_max_risk_score: 30,
    intimation_reminder_hours: 6,
    pre_auth_expiry_alert_days: 3,
    irdai_deadline_alert_days: 7,
    high_value_claim_threshold: 500000,
  };
}

// ─────────────────────────────────────────────────────────
// ACTION: auto_intimate
// Triggered on admission INSERT for insurance patients
// ─────────────────────────────────────────────────────────
async function handleAutoIntiimate(adminClient: any, supabaseUrl: string, serviceKey: string, body: any) {
  const { admission_id, hospital_id, patient_id, admission_type, insurance_type, insurance_id, intimation_deadline } = body;

  const autoConfig = await getAutoConfig(adminClient, hospital_id);
  if (!autoConfig.auto_intimate_enabled) {
    await logEvent(adminClient, hospital_id, "intimation_auto_sent", "skipped",
      { reason: "auto_intimate disabled in config" }, { admissionId: admission_id });
    // Mark the pending intimations row as skipped (use failed so the cron doesn't re-alert)
    await adminClient.from("insurance_intimations")
      .update({ status: "failed", failure_reason: "auto_intimate disabled in hospital config" })
      .eq("admission_id", admission_id).eq("status", "pending");
    return { skipped: true };
  }

  // Find the pending intimations row created by the DB trigger
  const { data: intimationRow } = await adminClient
    .from("insurance_intimations")
    .select("id")
    .eq("admission_id", admission_id)
    .eq("status", "pending")
    .maybeSingle();

  // Find the draft pre-auth for this admission
  const { data: preAuth } = await adminClient
    .from("insurance_pre_auth")
    .select("id, tpa_name")
    .eq("admission_id", admission_id)
    .eq("hospital_id", hospital_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!preAuth) {
    // No pre-auth yet — the admission form may have inserted the admission row
    // a moment before the pre-auth row. Mark the intimation as sent (the record
    // was created successfully) and raise a non-blocking warning so staff can
    // create the pre-auth. Do NOT fail — that would trigger a CRITICAL alert
    // and leave the intimations row in a state that the pg_cron would re-alert.
    const now = new Date().toISOString();
    if (intimationRow) {
      await adminClient.from("insurance_intimations")
        .update({ status: "sent", sent_at: now })
        .eq("id", intimationRow.id);
    }
    await logEvent(adminClient, hospital_id, "intimation_auto_sent", "success",
      { reason: "intimation recorded; pre-auth not yet created — staff must create pre-auth", is_emergency: admission_type === "emergency" },
      { admissionId: admission_id });
    // Non-critical alert (high, not critical) to prompt pre-auth creation
    await adminClient.from("clinical_alerts").insert({
      hospital_id,
      alert_type: "preauth_missing_after_intimation",
      alert_message: `Pre-auth not found for admission ${admission_id} (${insurance_type}). Intimation was recorded — please create a pre-auth request.`,
      severity: "high",
      patient_id,
    });
    return { success: true, intimation: "sent", note: "pre-auth missing" };
  }

  // Resolve TPA name if not already set
  let tpaName = preAuth.tpa_name;
  if (!tpaName || tpaName === "Insurance") {
    tpaName = await resolveTpaName(adminClient, supabaseUrl, serviceKey, hospital_id, insurance_id, insurance_type);
    if (tpaName) {
      await Promise.all([
        adminClient.from("admissions").update({ tpa_name: tpaName }).eq("id", admission_id),
        adminClient.from("insurance_pre_auth").update({ tpa_name: tpaName }).eq("id", preAuth.id),
      ]);
      await logEvent(adminClient, hospital_id, "tpa_name_auto_matched", "success",
        { tpa_name: tpaName, insurance_id }, { admissionId: admission_id, preAuthId: preAuth.id, aiUsed: !tpaName });
    }
  }

  const isEmergency = admission_type === "emergency";
  const now = new Date().toISOString();

  // Record intimation on pre-auth
  await adminClient.from("insurance_pre_auth").update({
    intimation_sent_at: now,
    intimation_method: "auto_system",
    is_emergency_admission: isEmergency,
  }).eq("id", preAuth.id);

  // Mark insurance_intimations row as sent
  if (intimationRow) {
    await adminClient.from("insurance_intimations")
      .update({ status: "sent", sent_at: now })
      .eq("id", intimationRow.id);
  }

  await logEvent(adminClient, hospital_id, "intimation_auto_sent", "success", {
    method: "auto_system",
    is_emergency: isEmergency,
    tpa_name: tpaName,
    window_hours: isEmergency ? 48 : 24,
    deadline: intimation_deadline,
  }, { admissionId: admission_id, preAuthId: preAuth.id });

  // Chain: trigger AI pre-auth generation
  if (autoConfig.auto_preauth_generate_enabled) {
    await handleAiGeneratePreauth(adminClient, supabaseUrl, serviceKey, {
      admission_id, hospital_id, patient_id, pre_auth_id: preAuth.id, is_emergency: isEmergency, auto_config: autoConfig,
    });
  }

  return { success: true, intimation: "sent", tpa: tpaName };
}

// ─────────────────────────────────────────────────────────
// TPA name resolver: match insurance_id prefix to tpa_config
// ─────────────────────────────────────────────────────────
async function resolveTpaName(
  adminClient: any, supabaseUrl: string, serviceKey: string,
  hospitalId: string, insuranceId: string | null, insuranceType: string
): Promise<string | null> {
  if (!insuranceId) return insuranceTypeToDefault(insuranceType);

  // Fetch all active TPAs for this hospital
  const { data: tpas } = await adminClient
    .from("tpa_config")
    .select("tpa_name, tpa_code")
    .eq("hospital_id", hospitalId)
    .eq("is_active", true);

  if (tpas?.length) {
    const idUpper = insuranceId.toUpperCase();
    // Prefix match against tpa_code
    for (const tpa of tpas) {
      if (tpa.tpa_code && idUpper.startsWith(tpa.tpa_code.toUpperCase())) {
        return tpa.tpa_name;
      }
    }
    // Substring match against tpa_name
    for (const tpa of tpas) {
      if (idUpper.includes(tpa.tpa_name?.split(" ")[0]?.toUpperCase() || "XX")) {
        return tpa.tpa_name;
      }
    }
  }

  // Known Indian policy ID patterns
  const patterns: [RegExp, string][] = [
    [/^STAR/i, "Star Health Insurance"],
    [/^NIA/i, "New India Assurance"],
    [/^UII/i, "United India Insurance"],
    [/^ICICI/i, "ICICI Lombard"],
    [/^HDFC/i, "HDFC ERGO"],
    [/^BAJAJ/i, "Bajaj Allianz"],
    [/^MEDI/i, "Medi Assist TPA"],
    [/^VIDAL/i, "Vidal Health TPA"],
    [/^PMJAY|^AB/i, "PMJAY / Ayushman Bharat"],
  ];
  for (const [pattern, name] of patterns) {
    if (pattern.test(insuranceId)) return name;
  }

  return insuranceTypeToDefault(insuranceType);
}

function insuranceTypeToDefault(insuranceType: string): string | null {
  const map: Record<string, string> = {
    pmjay: "PMJAY / Ayushman Bharat",
    cghs: "CGHS",
    echs: "ECHS",
    esi: "ESI",
  };
  return map[insuranceType] || null;
}

// ─────────────────────────────────────────────────────────
// ACTION: ai_generate_preauth
// ─────────────────────────────────────────────────────────
async function handleAiGeneratePreauth(adminClient: any, supabaseUrl: string, serviceKey: string, body: any) {
  const { admission_id, hospital_id, patient_id, pre_auth_id, is_emergency, auto_config } = body;

  // Fetch admission details
  const { data: admission } = await adminClient
    .from("admissions")
    .select("admitting_diagnosis, admission_type, tpa_name, insurance_id")
    .eq("id", admission_id)
    .maybeSingle();

  const { data: patient } = await adminClient
    .from("patients")
    .select("full_name, date_of_birth, gender")
    .eq("id", patient_id)
    .maybeSingle();

  const { data: ward } = await adminClient
    .from("admissions")
    .select("wards(name)")
    .eq("id", admission_id)
    .maybeSingle();

  if (!admission) {
    await logEvent(adminClient, hospital_id, "pre_auth_ai_generated", "failed",
      { reason: "admission not found" }, { admissionId: admission_id, preAuthId: pre_auth_id });
    return;
  }

  // Build AI prompt
  const age = patient?.date_of_birth
    ? Math.floor((Date.now() - new Date(patient.date_of_birth).getTime()) / (365.25 * 24 * 3600 * 1000))
    : "Unknown";

  const prompt = `You are a hospital insurance coordinator in India. Generate pre-authorization details for this admission.

Patient: ${patient?.full_name || "Unknown"}, Age: ${age}, Gender: ${patient?.gender || "Unknown"}
Admission Type: ${admission.admission_type || "planned"} (${is_emergency ? "EMERGENCY - 24h window" : "Planned - 48h window"})
Admitting Diagnosis: ${admission.admitting_diagnosis || "Not specified"}
TPA: ${admission.tpa_name || "Insurance"}
Policy ID: ${admission.insurance_id || "Not provided"}

Based on the diagnosis, generate:
1. Relevant ICD-10 diagnosis codes (2-4 codes max, most relevant first)
2. Procedure codes (NABH/clinical format, 1-3 codes based on likely treatment)
3. Estimated amount in INR (realistic Indian hospital rate, not too high/low)
4. Clinical notes paragraph (3-4 sentences justifying admission and planned treatment)

Return ONLY this JSON (no markdown):
{
  "diagnosis_codes": ["J18.9", "J96.0"],
  "procedure_codes": ["HOSP-CARE-01", "RESP-MGMT-01"],
  "estimated_amount": 85000,
  "notes": "Patient presented with..."
}`;

  const aiText = await callAIProxy(supabaseUrl, serviceKey, hospital_id, prompt, "pre_auth_ai_fill", 400);

  let updates: Record<string, any> = { ai_pre_auth_generated: true, ai_notes_generated: true };

  if (aiText) {
    try {
      const parsed = JSON.parse(aiText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      if (parsed.diagnosis_codes?.length) updates.diagnosis_codes = parsed.diagnosis_codes;
      if (parsed.procedure_codes?.length) updates.procedure_codes = parsed.procedure_codes;
      if (parsed.estimated_amount > 0) updates.estimated_amount = parsed.estimated_amount;
      if (parsed.notes) updates.notes = parsed.notes;
    } catch {
      // AI returned non-JSON; store raw as notes
      updates.notes = aiText.substring(0, 500);
    }
  }

  // Auto-submit if config says so (only for non-emergency planned admissions)
  const shouldAutoSubmit = auto_config?.auto_preauth_submit_enabled && !is_emergency;
  if (shouldAutoSubmit) {
    updates.status = "submitted";
    updates.submitted_at = new Date().toISOString();
  }

  await adminClient.from("insurance_pre_auth").update(updates).eq("id", pre_auth_id);

  await logEvent(adminClient, hospital_id,
    shouldAutoSubmit ? "pre_auth_auto_submitted" : "pre_auth_ai_generated",
    "success",
    { ai_used: !!aiText, auto_submitted: shouldAutoSubmit, fields_generated: Object.keys(updates) },
    { admissionId: admission_id, preAuthId: pre_auth_id, aiUsed: true, aiFeatureKey: "pre_auth_ai_fill" }
  );
}

// ─────────────────────────────────────────────────────────
// ACTION: auto_bundle_and_submit_claim
// Triggered on patient discharge
// ─────────────────────────────────────────────────────────
async function handleAutoBundle(adminClient: any, supabaseUrl: string, serviceKey: string, body: any) {
  const { admission_id, hospital_id, patient_id } = body;

  const autoConfig = await getAutoConfig(adminClient, hospital_id);

  // Find finalized bill for this admission
  const { data: bill } = await adminClient
    .from("bills")
    .select("id, bill_number, total_amount, bill_status")
    .eq("admission_id", admission_id)
    .in("bill_status", ["final", "draft"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!bill) {
    await logEvent(adminClient, hospital_id, "claim_auto_bundled", "skipped",
      { reason: "no bill found for admission" }, { admissionId: admission_id });
    return { skipped: true };
  }

  // Check for existing claim
  const { data: existingClaim } = await adminClient
    .from("insurance_claims")
    .select("id")
    .eq("bill_id", bill.id)
    .maybeSingle();

  if (existingClaim) {
    return { skipped: true, reason: "claim already exists" };
  }

  // Find approved pre-auth
  const { data: preAuth } = await adminClient
    .from("insurance_pre_auth")
    .select("id, tpa_name, policy_number, pre_auth_number, status, is_accident_case, mlc_number")
    .eq("admission_id", admission_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Routing decision tree
  const claimedAmount = Number(bill.total_amount) || 0;
  const riskScore = await calculateDenialRisk(adminClient, preAuth, claimedAmount);
  const reasons: string[] = [];

  let autoSubmit = autoConfig.auto_claim_submit_enabled;
  if (riskScore > autoConfig.auto_claim_max_risk_score) {
    autoSubmit = false;
    reasons.push(`denial_risk_${riskScore}_exceeds_threshold`);
  }
  if (preAuth?.is_accident_case && !preAuth?.mlc_number) {
    autoSubmit = false;
    reasons.push("accident_case_mlc_required");
  }
  if (preAuth?.status !== "approved") {
    autoSubmit = false;
    reasons.push("pre_auth_not_approved");
  }
  if (claimedAmount > autoConfig.high_value_claim_threshold) {
    autoSubmit = false;
    reasons.push(`high_value_claim_${claimedAmount}`);
  }

  const claimNumber = `CLM-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${Math.floor(Math.random() * 9000 + 1000)}`;
  const now = new Date().toISOString();

  // Create the claim record
  const { data: newClaim, error: claimError } = await adminClient
    .from("insurance_claims")
    .insert({
      hospital_id,
      bill_id: bill.id,
      patient_id,
      tpa_name: preAuth?.tpa_name || "Insurance",
      claim_number: claimNumber,
      claimed_amount: claimedAmount,
      policy_number: preAuth?.policy_number || null,
      pre_auth_id: preAuth?.id || null,
      status: autoSubmit ? "submitted" : "draft",
      submitted_at: autoSubmit ? now : null,
      ai_denial_risk_score: riskScore,
      automation_submitted: autoSubmit,
      bundle_generated_at: now,
    })
    .select("id")
    .single();

  if (claimError) {
    await logEvent(adminClient, hospital_id, "claim_auto_bundled", "failed",
      { error: claimError.message }, { admissionId: admission_id });
    return { error: claimError.message };
  }

  const eventType = autoSubmit ? "claim_auto_submitted" : "auto_skipped_high_risk";
  await logEvent(adminClient, hospital_id, eventType,
    autoSubmit ? "success" : "pending_review",
    { claim_number: claimNumber, amount: claimedAmount, risk_score: riskScore, skip_reasons: reasons },
    { admissionId: admission_id, preAuthId: preAuth?.id, claimId: newClaim?.id, aiUsed: false }
  );

  // Create alert if manual review needed
  if (!autoSubmit && reasons.length > 0) {
    await adminClient.from("clinical_alerts").insert({
      hospital_id,
      admission_id,
      alert_type: "insurance_manual_review_needed",
      message: `Insurance claim for ₹${claimedAmount.toLocaleString("en-IN")} requires manual review: ${reasons.join(", ")}`,
      severity: "warning",
    }).catch(() => {}); // non-fatal
  }

  return { success: true, claim_number: claimNumber, auto_submitted: autoSubmit, risk_score: riskScore };
}

// Simple denial risk calculation (mirrors frontend logic)
async function calculateDenialRisk(adminClient: any, preAuth: any, amount: number): Promise<number> {
  let risk = 40;
  if (preAuth?.status === "approved") risk -= 20;
  if (amount > 200000) risk += 15;
  if (preAuth?.is_accident_case) risk += 20;
  if (!preAuth?.policy_number) risk += 10;
  return Math.max(0, Math.min(100, risk));
}

// ─────────────────────────────────────────────────────────
// ACTION: check_deadlines
// Runs every 4 hours via pg_cron
// ─────────────────────────────────────────────────────────
async function handleCheckDeadlines(adminClient: any) {
  const now = new Date();
  let alertsCreated = 0;

  // Fetch all hospitals' automation configs to get per-hospital thresholds
  const { data: configs } = await adminClient
    .from("insurance_automation_config")
    .select("hospital_id, intimation_reminder_hours, pre_auth_expiry_alert_days, irdai_deadline_alert_days");

  const configMap: Record<string, any> = {};
  for (const c of configs || []) configMap[c.hospital_id] = c;

  // 1. Pre-auth expiry alerts
  const { data: expiringPreAuths } = await adminClient
    .from("insurance_pre_auth")
    .select("id, hospital_id, admission_id, valid_until, tpa_name")
    .in("status", ["approved"])
    .not("valid_until", "is", null)
    .lte("valid_until", new Date(Date.now() + 14 * 86400000).toISOString().split("T")[0]);

  for (const pa of expiringPreAuths || []) {
    const expiryDays = Math.ceil((new Date(pa.valid_until).getTime() - now.getTime()) / 86400000);
    const threshold = configMap[pa.hospital_id]?.pre_auth_expiry_alert_days ?? 3;
    if (expiryDays <= threshold && expiryDays >= 0) {
      await adminClient.from("clinical_alerts").insert({
        hospital_id: pa.hospital_id,
        admission_id: pa.admission_id,
        alert_type: "pre_auth_expiry_alert",
        message: `Pre-auth (${pa.tpa_name}) expires in ${expiryDays} day(s). Request extension now.`,
        severity: expiryDays <= 1 ? "critical" : "warning",
      }).catch(() => {});
      await logEvent(adminClient, pa.hospital_id, "pre_auth_expiry_alert", "success",
        { expiry_days: expiryDays, valid_until: pa.valid_until },
        { admissionId: pa.admission_id, preAuthId: pa.id }
      );
      alertsCreated++;
    }
  }

  // 2. IRDAI 45-day deadline alerts
  const { data: pendingClaims } = await adminClient
    .from("insurance_claims")
    .select("id, hospital_id, submitted_at, claim_number, tpa_name")
    .in("status", ["submitted", "under_review"])
    .not("submitted_at", "is", null);

  for (const claim of pendingClaims || []) {
    const deadlineDate = new Date(new Date(claim.submitted_at).getTime() + 45 * 86400000);
    const daysToDeadline = Math.ceil((deadlineDate.getTime() - now.getTime()) / 86400000);
    const threshold = configMap[claim.hospital_id]?.irdai_deadline_alert_days ?? 7;
    if (daysToDeadline <= threshold && daysToDeadline >= 0) {
      await adminClient.from("clinical_alerts").insert({
        hospital_id: claim.hospital_id,
        alert_type: "irdai_deadline_alert",
        message: `Claim ${claim.claim_number} (${claim.tpa_name}): IRDAI 45-day deadline in ${daysToDeadline} day(s). Escalate if no response.`,
        severity: daysToDeadline <= 3 ? "critical" : "warning",
      }).catch(() => {});
      await logEvent(adminClient, claim.hospital_id, "irdai_deadline_alert", "success",
        { days_to_deadline: daysToDeadline, claim_number: claim.claim_number },
        { claimId: claim.id }
      );
      alertsCreated++;
    }
  }

  // 3. Late intimation alerts (admissions where window is closing)
  const { data: unintimated } = await adminClient
    .from("insurance_pre_auth")
    .select("id, hospital_id, admission_id, is_emergency_admission, created_at")
    .is("intimation_sent_at", null)
    .in("status", ["draft", "pending"]);

  for (const pa of unintimated || []) {
    const windowHours = pa.is_emergency_admission ? 24 : 48;
    const reminderThreshold = configMap[pa.hospital_id]?.intimation_reminder_hours ?? 6;
    const hoursElapsed = (now.getTime() - new Date(pa.created_at).getTime()) / 3600000;
    const hoursRemaining = windowHours - hoursElapsed;
    if (hoursRemaining <= reminderThreshold && hoursRemaining > 0) {
      await adminClient.from("clinical_alerts").insert({
        hospital_id: pa.hospital_id,
        admission_id: pa.admission_id,
        alert_type: "intimation_deadline_alert",
        message: `TPA intimation required within ${Math.ceil(hoursRemaining)} hour(s). ${pa.is_emergency_admission ? "Emergency — 24h window" : "Planned — 48h window"}`,
        severity: hoursRemaining <= 2 ? "critical" : "warning",
      }).catch(() => {});
      await logEvent(adminClient, pa.hospital_id, "intimation_deadline_alert", "success",
        { hours_remaining: hoursRemaining, is_emergency: pa.is_emergency_admission },
        { admissionId: pa.admission_id, preAuthId: pa.id }
      );
      alertsCreated++;
    }
  }

  return { alerts_created: alertsCreated };
}

// ─────────────────────────────────────────────────────────
// Main serve handler
// ─────────────────────────────────────────────────────────
serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const adminClient = createClient(supabaseUrl, serviceKey);

  try {
    const body = await req.json();
    const { action } = body;

    switch (action) {
      case "auto_intimate":
        return json(await handleAutoIntiimate(adminClient, supabaseUrl, serviceKey, body));

      case "ai_generate_preauth":
        await handleAiGeneratePreauth(adminClient, supabaseUrl, serviceKey, body);
        return json({ success: true });

      case "auto_bundle_and_submit_claim":
        return json(await handleAutoBundle(adminClient, supabaseUrl, serviceKey, body));

      case "check_deadlines":
        return json(await handleCheckDeadlines(adminClient));

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (err) {
    console.error("insurance-automation error:", err);
    return json({ error: String(err) }, 500);
  }
});
