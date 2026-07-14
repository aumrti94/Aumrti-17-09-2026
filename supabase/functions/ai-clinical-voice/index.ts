import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, resolveAiConfigFromEnv, callAiChatWithUsage, estimateAiCostUsd } from "../_shared/ai-config.ts";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CONTEXT_PROMPTS: Record<string, string> = {
  opd_consultation: `You are a clinical documentation AI for an Indian hospital. The following is a transcript of a LIVE OPD CONSULTATION — a two-way CONVERSATION between a doctor and a patient (either or both may speak, and it may be in an Indian language). It is NOT a clean dictation of finished notes. Read the whole conversation and extract the clinical information into structured fields.

Capture clinical facts stated by EITHER speaker:
- What the PATIENT says — their complaints, symptoms, duration, severity, and any history they report (including as answers to the doctor's questions).
- What the DOCTOR says — examination findings, any lab/vital VALUES read aloud (e.g. "sugar 165", "BP 130 by 80"), advice/instructions, medications, and any diagnosis actually spoken.
- When the doctor asks a question and the patient answers (e.g. "since when is the pain?" → "3 days"), combine them into the fact (pain × 3 days).
- Spoken advice or instructions (e.g. "reduce sweets", "come back in a week") go into "plan" and/or "follow_up".
- Spoken lab/vital VALUES (e.g. blood sugar 165, BP 130/80) go into "examination_findings" and/or "investigations", recorded verbatim WITH the value (do not drop the number).

List every symptom/finding EXPLICITLY stated (do not omit a clearly-stated one), but NEVER add, infer, or invent anything that was not actually said.

Return ONLY a JSON object with this exact structure:
{
  "chief_complaint": "the presenting complaints/symptoms the patient actually stated, comma-separated, with duration if mentioned",
  "history_of_present_illness": "history based strictly on what was said — as a BULLET LIST (see FORMATTING): one point per line for each symptom, duration, severity and any aggravating/relieving factor the patient actually mentioned; do not pad with assumptions",
  "examination_findings": "clinical examination findings as a BULLET LIST — one finding per line",
  "diagnosis": "the diagnosis ONLY IF it was explicitly spoken in the conversation, else empty string — do not infer your own",
  "icd_suggestion": "ICD-10 code for a diagnosis that was actually spoken, else empty string",
  "plan": "management plan as a BULLET LIST — one action per line",
  "prescription": [
    {
      "drug_name": "drug name with strength",
      "dose": "dose",
      "route": "oral/iv/im etc",
      "frequency": "OD/BD/TDS/QID/SOS/STAT/HS",
      "duration": "number of days",
      "instructions": "special instructions if any"
    }
  ],
  "follow_up": "follow-up instructions as a BULLET LIST — one instruction per line",
  "investigations": ["test 1", "test 2"],
  "confidence": 0.85,
  "reasoning": "One sentence explaining the confidence level and key structuring decisions made"
}

FORMATTING (readability):
- For history_of_present_illness, examination_findings, plan and follow_up: return a BULLET LIST, NOT a paragraph. Put each distinct clinical point on its own line, beginning with "• " (a bullet character followed by one space). Separate lines with a newline (\n).
- Keep each bullet short and specific (one symptom / finding / action per bullet).
- If only one point exists, return a single "• " line. If the field is empty, return an empty string (no bullet).
- chief_complaint stays a single comma-separated line (do NOT bullet it).

If a field cannot be extracted, use empty string or empty array.
Prescription array should only include items clearly mentioned.
confidence should be 0-1 based on transcript clarity.`,

  ward_round: `You are a senior clinical documentation AI for an Indian hospital IPD ward round. The doctor's dictation may use a mix of English and an Indian language. Parse carefully.

IMPORTANT ABBREVIATIONS (Indian clinical shorthand):
- S/O = Subjective/Objective, SOAP = clinical note format
- BD/BID = twice daily, TDS = three times daily, QID = four times, OD = once daily, HS = night, SOS = as needed, STAT = immediately, AC = before meals, PC = after meals
- C/O = complaining of, H/O = history of, K/C/O = known case of
- BP = blood pressure (format: systolic/diastolic e.g. 120/80), PR/HR = pulse rate, RR = respiratory rate, SpO2/O2 sat = oxygen saturation, Temp = temperature
- Afebrile = no fever, Tachycardia/bradycardia = fast/slow pulse, Hypo/hypertension = low/high BP
- NBM = nil by mouth, NPO = nothing per oral, IV = intravenous, IM = intramuscular, PO = oral
- FBS/RBS/PPBS = fasting/random/post-prandial blood sugar, HbA1c = glycated haemoglobin
- USG = ultrasound, CECT = contrast CT, HRCT = high resolution CT, 2D Echo = echocardiogram
- Tab = tablet, Cap = capsule, Inj = injection, Syp = syrup, Oint = ointment, Susp = suspension

VITALS: Extract numeric values separately. If doctor says "BP 130 by 80" → bp_sys:130, bp_dia:80. Temperature in °F unless stated otherwise.

Return ONLY a valid JSON object — no markdown, no explanation:
{
  "subjective": "patient's complaints, symptoms today in 1-3 sentences",
  "objective": "general examination findings and clinical status (NOT vitals — those go in vitals_detected)",
  "assessment": "diagnosis status, clinical impression for today",
  "plan": "management plan for the day — medications, nursing, activity, diet, follow-up investigations",
  "vitals_detected": {
    "bp_sys": "",
    "bp_dia": "",
    "pulse": "",
    "temp": "",
    "spo2": "",
    "rr": "",
    "pain_score": ""
  },
  "medication_changes": [
    { "action": "add", "drug": "drug name dose route frequency duration", "note": "reason if mentioned" },
    { "action": "stop", "drug": "drug name", "note": "reason" },
    { "action": "change", "drug": "old → new", "note": "what changed" }
  ],
  "investigations_ordered": ["exact test name as would appear on lab requisition"],
  "consultant_to_call": "specialty and doctor name if referral mentioned",
  "discharge_plan": "expected discharge date or criteria if mentioned, else empty string",
  "confidence": 0.85,
  "reasoning": "One sentence: key clinical decisions in this dictation and any ambiguities"
}

Rules:
- vitals_detected: use numeric strings only (e.g. "120", "80", "98.6"). Leave empty string if not clearly stated.
- investigations_ordered: use exact Indian lab names (e.g. "CBC", "LFT", "KFT", "HbA1c", "Urine R/M", "Blood Culture & Sensitivity")
- medication_changes: only include explicitly mentioned changes, not routine medications continuing unchanged
- If the doctor says patient is "better", "improving", "stable" — capture in subjective/assessment
- If confidence < 0.6, add a note in reasoning about what was unclear`,

  emergency: `You are a clinical documentation AI. This is an emergency department case.
Extract vitals as numbers. Split history into AMPLE categories (Allergies, Medications, Past history, Last meal, Events) when possible.

Return ONLY a JSON object:
{
  "presenting_complaint": "",
  "vitals_detected": {
    "bp_systolic": "",
    "bp_diastolic": "",
    "pulse": "",
    "spo2": "",
    "gcs": ""
  },
  "ample": {
    "allergies": "",
    "medications": "",
    "past_history": "",
    "last_meal": "",
    "events": ""
  },
  "examination": "",
  "working_diagnosis": "",
  "immediate_management": "",
  "triage_category": "P1/P2/P3/P4 if mentioned",
  "investigations_ordered": [],
  "disposition": "admit/discharge/observe/refer",
  "confidence": 0.85
}

For vitals_detected, extract numeric values only (e.g. from "BP 120/80" extract bp_systolic:"120", bp_diastolic:"80").
If a field cannot be extracted, use empty string or empty array.`,

  nursing_note: `You are a clinical documentation AI. This is a nursing note dictated by a nurse.

Return ONLY a JSON object:
{
  "observation": "patient observation",
  "vitals_mentioned": { "bp": "", "pulse": "", "temp": "", "spo2": "" },
  "interventions": "nursing interventions done",
  "medications_given": [{ "drug": "", "dose": "", "time": "" }],
  "patient_response": "patient response to treatment",
  "handover_note": "important notes for next shift",
  "confidence": 0.85
}`,
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth verification
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await sb.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    const hospitalId = userData?.hospital_id as string | null;

    const { transcript, context_type, existing_data, language_code, patient_id } = await req.json();

    // Fetch the patient's known allergies/current medications (if any) up
    // front, server-side — so the safety-guard call below has real patient
    // context rather than trusting a client-supplied list. Best-effort: a
    // missing/failed lookup must not block transcription from proceeding.
    let patientAllergies: string[] = [];
    let patientCurrentMeds: string[] = [];
    if (patient_id) {
      const { data: aiContext } = await sb
        .from("patient_ai_context")
        .select("known_allergies, current_medications")
        .eq("patient_id", patient_id)
        .maybeSingle();
      patientAllergies = aiContext?.known_allergies || [];
      patientCurrentMeds = aiContext?.current_medications || [];
    }

    if (!transcript?.trim()) {
      return new Response(JSON.stringify({ error: "Transcript is required" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = hospitalId
      ? (await resolveAiConfig(hospitalId, "voice_scribe", 1200)) ?? resolveAiConfigFromEnv(1200)
      : resolveAiConfigFromEnv(1200);

    if (!config) {
      return new Response(JSON.stringify({ error: "No AI provider configured. Please go to Settings → API Hub and add an AI provider (OpenAI, Claude, or Gemini)." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const contextPrompt = CONTEXT_PROMPTS[context_type] || CONTEXT_PROMPTS.opd_consultation;

    const existingContext = existing_data
      ? `\n\nEXISTING NOTE already in the form (from an earlier recording) — you MUST MERGE, not replace:
${JSON.stringify(existing_data)}
Merge rules:
- Return the COMPLETE note: keep EVERY existing point AND add the new information from this transcript.
- For bullet-list fields, append the new bullets to the existing ones; do NOT drop or rewrite existing bullets.
- Remove exact duplicates only. Do NOT overwrite an existing value unless the new dictation EXPLICITLY corrects it.
- If this transcript adds nothing to a field, return that field's existing value unchanged.`
      : "";

    // Language instruction: the doctor may dictate in any language, but the structured
    // notes must always be returned in clear English (translated by the assigned LLM).
    // The verbatim transcript is preserved separately in the original language.
    const LANG_LABELS: Record<string, string> = {
      "hi-IN": "Hindi (हिन्दी)",
      "te-IN": "Telugu (తెలుగు)",
      "ta-IN": "Tamil (தமிழ்)",
      "kn-IN": "Kannada (ಕನ್ನಡ)",
      "ml-IN": "Malayalam (മലയാളം)",
      "mr-IN": "Marathi (मराठी)",
      "bn-IN": "Bengali (বাংলা)",
      "gu-IN": "Gujarati (ગુજરાતી)",
      "pa-IN": "Punjabi (ਪੰਜਾਬੀ)",
    };
    const langLabel = language_code ? LANG_LABELS[language_code] : null;
    const langNote = langLabel
      ? `\n\nIMPORTANT: The conversation is in ${langLabel}. TRANSLATE and return ALL text field VALUES in clear, professional English. Keep JSON keys in English. Preserve medical drug names and ICD codes exactly.`
      // No specific language given (e.g. "auto"/multilingual, or a language not in the label
      // map): the transcript is still most likely an Indian regional language, so tell the
      // model to detect it and translate — don't leave it guessing.
      : `\n\nIMPORTANT: The conversation may be in English or an Indian regional language (e.g. Telugu, Hindi, Tamil). Detect the language, then TRANSLATE and return ALL text field VALUES in clear, professional English. Keep JSON keys in English. Preserve medical drug names and ICD codes exactly.`;

    // Accuracy guardrails — applied to EVERY session type. Symptoms must be strict
    // (no fabrication); only the diagnosis fields may carry a working diagnosis,
    // derived from the described symptoms and NOT from any mis-heard disease word.
    const guardNote = `\n\nACCURACY RULES (most important):
- Use ONLY the doctor↔patient conversation as your source. NEVER invent, infer, assume, exaggerate, add, or "recommend" anything that was not actually spoken.
- For chief_complaint, history_of_present_illness and examination_findings: record ONLY symptoms/findings/values a speaker EXPLICITLY states. A clinical fact stated inside a question or an answer STILL counts — capture it (e.g. doctor "since when the fever?" + patient "3 days" → fever × 3 days). Only ignore PURE social pleasantries, filler, and unclear/garbled audio — never turn those into clinical findings. Preserve the EXACT anatomical location (e.g. lower back / waist must NOT become "abdomen"). If a symptom is genuinely ambiguous, leave it out.
- For "diagnosis" and "icd_suggestion": EXTRACT-ONLY. Fill these ONLY if a diagnosis is explicitly spoken in the conversation (by the doctor or patient). If no diagnosis is stated, leave BOTH empty ("" and ""). Do NOT derive, infer, or suggest a diagnosis of your own from the symptoms — no AI-generated working diagnosis.
- confidence: base it on how much was actually extractable. If few or no clinical facts could be captured, set confidence to 0.3 or lower and explain in "reasoning" what was missing or unclear. Do NOT report high confidence for an empty or near-empty result.`;

    const prompt = `${contextPrompt}${existingContext}${langNote}${guardNote}

Dictation transcript:
"${transcript}"`;

    const messages = [
      {
        role: "system" as const,
        content: "You are a careful clinical documentation assistant for Indian hospitals. Parse doctor voice dictations into structured medical data using standard Indian medical terminology. Extract ONLY what is explicitly stated — never invent, infer or add symptoms, findings or anatomical locations, and ignore the doctor's questions and unclear audio. Always return valid JSON only, no markdown wrapping, no text outside the JSON object.",
      },
      { role: "user" as const, content: prompt },
    ];

    const aiCallStartedAt = Date.now();
    let rawContent: string;
    try {
      const result = await callAiChatWithUsage(config, messages, 1200, 0.2);
      rawContent = result.content;
      // Real token counts and cost now — this was previously invisible to
      // ai_usage_logs entirely because this function calls the provider
      // directly instead of via ai-proxy; callAiChatWithUsage() closes that gap.
      const costUsd = estimateAiCostUsd(config.model, result.usage);
      await sb.from("ai_usage_logs").insert({
        hospital_id: hospitalId,
        feature_key: "ai-clinical-voice",
        provider: config.provider,
        model_name: config.model,
        tokens_input: result.usage.tokensInput,
        tokens_output: result.usage.tokensOutput,
        cache_creation_tokens: result.usage.cacheCreationTokens,
        cache_read_tokens: result.usage.cacheReadTokens,
        cache_hit: result.usage.cacheReadTokens > 0,
        estimated_cost_usd: costUsd,
        latency_ms: Date.now() - aiCallStartedAt,
        success: true,
        // NOTE: a supabase-js query builder is a thenable but has NO .catch() —
        // use .then(ok, err) to swallow logging failures without a TypeError.
      }).then(() => {}, () => {});
      // Roll up into the same daily-aggregate table ai-proxy feeds, so this
      // function's usage shows up on AIPerformancePage and the tenant's own
      // usage card — not just in the raw log.
      if (hospitalId) {
        await sb.rpc("upsert_ai_cost_daily", {
          p_hospital_id: hospitalId,
          p_date: new Date().toISOString().split("T")[0],
          p_feature_key: "ai-clinical-voice",
          p_provider: config.provider,
          p_tokens_input: result.usage.tokensInput,
          p_tokens_output: result.usage.tokensOutput,
          p_cache_read_tokens: result.usage.cacheReadTokens,
          p_cache_hit: result.usage.cacheReadTokens > 0,
          p_cost_usd: costUsd,
        }).then(() => {}, () => {});
      }
    } catch (callErr) {
      // Best-effort — tokens/cost are unknown on a failed call, but
      // call-volume, latency and failure rate are still worth logging.
      await sb.from("ai_usage_logs").insert({
        hospital_id: hospitalId,
        feature_key: "ai-clinical-voice",
        provider: config.provider,
        model_name: config.model,
        latency_ms: Date.now() - aiCallStartedAt,
        success: false,
        error_message: callErr instanceof Error ? callErr.message : String(callErr),
      }).then(() => {}, () => {});
      throw callErr;
    }
    console.log("AI raw response (first 500):", sanitizeForLog(rawContent.substring(0, 500)));

    const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    console.log("Cleaned content:", sanitizeForLog(cleaned.substring(0, 300)));

    let structured: Record<string, unknown>;
    try {
      structured = JSON.parse(cleaned);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Content was:", sanitizeForLog(cleaned.substring(0, 200)));
      throw new Error("Failed to parse AI response as JSON");
    }

    // Run extracted prescriptions/diagnosis through ai-safety-guard (allergy
    // cross-reactivity, dose limits, controlled-substance flags) before this
    // reaches a clinician. Best-effort — a safety-guard failure must never
    // block the transcription itself from returning.
    // patient_context is populated from patient_ai_context above when the
    // caller supplies patient_id — allergy-cross-reactivity checks now fire
    // whenever the host screen knows which patient this recording is for.
    let safetyCheck: { safe: boolean; flags: unknown[] } | null = null;
    try {
      const prescriptionList = Array.isArray((structured as any).prescription) ? (structured as any).prescription : [];
      const { data: safetyData, error: safetyErr } = await sb.functions.invoke("ai-safety-guard", {
        body: {
          feature_key: "ai-clinical-voice",
          ai_output: {
            prescriptions: prescriptionList.map((rx: any) => ({ drug: rx.drug_name, dose: rx.dose })),
            diagnosis: (structured as any).diagnosis || "",
          },
          patient_context: {
            known_allergies: patientAllergies,
            current_medications: patientCurrentMeds,
          },
          hospital_id: hospitalId,
          patient_id: patient_id || null,
        },
      });
      if (!safetyErr && safetyData) safetyCheck = safetyData as { safe: boolean; flags: unknown[] };
    } catch (safetyGuardErr) {
      console.error(
        "ai-safety-guard call failed:",
        sanitizeForLog(safetyGuardErr instanceof Error ? safetyGuardErr.message : String(safetyGuardErr))
      );
    }

    return new Response(JSON.stringify({ structured, context_type, safety_check: safetyCheck }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-clinical-voice error:", sanitizeForLog(e instanceof Error ? e.message : String(e)));
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
