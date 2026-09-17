import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveAiConfig, resolveAiConfigFromEnv, callAiChatWithUsage, callAiAudio,
  callAiChatStream, supportsStreaming, recordAiUsage,
} from "../_shared/ai-config.ts";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";
import { checkAIAllowed } from "../_shared/ai-entitlement.ts";
import { translateToEnglish, recordTranslateUsage } from "../_shared/translate-text.ts";
import { loadHospitalLexicon, repairTranscript } from "../_shared/medical-lexicon.ts";
import { evaluateSafety, logSafetyFlags } from "../_shared/safety-guard.ts";

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
- FOLLOW-UP INTERVAL (frequently missed — check for this explicitly before finishing): any instruction to come back / return / be reviewed / be seen AGAIN after a period of time MUST populate "follow_up". In Indian consultations the interval is usually spoken as code-mixed English inside the local language: an English number and time unit ("five days", "one week", "10 days", "2 weeks") wrapped in a local-language phrase meaning "after" or "later". Treat ANY such number+unit near a returning/being-seen verb as a follow-up interval, in whatever language it appears. Wordings that all mean follow-up include "come see me after X", "show yourself after X", "come again after X", "come back after X", "review after X". Speech-to-text frequently mangles or flattens the imperative verb ending in Indian languages, so when the doctor mentions being seen/returning AGAIN together with a time period, record it as a follow-up (e.g. "• Review after 5 days"). Normalise the interval to digits + unit. This is recognising what WAS said — not inventing.

List every symptom/finding EXPLICITLY stated (do not omit a clearly-stated one), but NEVER add, infer, or invent anything that was not actually said.

Return ONLY a JSON object with this exact structure:
{
  "chief_complaint": "the presenting complaints/symptoms the patient actually stated, comma-separated, with duration if mentioned",
  "history_of_present_illness": "history based strictly on what was said — as a BULLET LIST (see FORMATTING): one point per line for each symptom, duration, severity and any aggravating/relieving factor the patient actually mentioned; do not pad with assumptions",
  "examination_findings": "GENERAL examination as a BULLET LIST — one finding per line. General means the whole-patient survey: consciousness, build/nourishment, febrile or afebrile, pallor, icterus, cyanosis, clubbing, oedema, lymphadenopathy, and vital signs spoken aloud.",
  "systemic_examination": "SYSTEM-BY-SYSTEM examination as a BULLET LIST — one finding per line. Systemic means findings for a named body system: cardiovascular (S1 S2, murmurs), respiratory (air entry, crepitations, wheeze), per-abdomen (soft, tender, organomegaly), central nervous system, or local examination of a specific site (e.g. a rash, a joint, a wound). Put a finding here ONLY if a system or site was named. Empty string if none.",
  "diagnosis": "the diagnosis ONLY IF it was explicitly spoken in the conversation, else empty string — do not infer your own",
  "icd_suggestion": "ICD-10 code for a diagnosis that was actually spoken, else empty string",
  "suggested_diagnosis": "OPTIONAL. Your OWN most likely working diagnosis inferred from the symptoms described, when the doctor did NOT state one. This is a SUGGESTION for the doctor to confirm — it is kept separate from "diagnosis" above, which records only what was actually said. Empty string if the findings are too non-specific to support one.",
  "suggested_icd": "ICD-10 code for suggested_diagnosis, else empty string",
  "diagnosis_basis": "one short sentence naming the findings that led to suggested_diagnosis, else empty string",
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
- For history_of_present_illness, examination_findings, systemic_examination, plan and follow_up: return a BULLET LIST, NOT a paragraph. Put each distinct clinical point on its own line, beginning with "• " (a bullet character followed by one space). Separate lines with a newline (\n).
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

  // IPDWorkspace.tsx passes sessionType="ipd_workspace". Until now there was no entry
  // here, so every inpatient dictation silently fell through to the OPD prompt — which
  // frames the audio as a doctor↔patient conversation and asks for a chief complaint,
  // neither of which fits a ward doctor dictating orders for an admitted patient.
  // The fields below mirror exactly what IPDWorkspace's fill function consumes.
  ipd_workspace: `You are a clinical documentation AI for an Indian hospital. This is a doctor dictating ORDERS for an ALREADY-ADMITTED inpatient at the bedside — medications to start or change, investigations to send, and advice for the nursing staff. It is a dictation of instructions, NOT a consultation with a patient.

The dictation may mix English with an Indian language and uses standard Indian clinical shorthand (OD/BD/TDS/QID/HS/SOS/STAT, IV/IM/PO/SC, CBC/LFT/RFT/CUE/HbA1c, USG/CECT/HRCT).

Return ONLY a JSON object with this exact structure:
{
  "prescription": [
    {
      "drug_name": "drug name with strength",
      "dose": "dose",
      "route": "Oral/IV/IM/SC/NG",
      "frequency": "OD/BD/TDS/QID/SOS/STAT/HS",
      "duration": "number of days",
      "instructions": "special instructions if any"
    }
  ],
  "investigations": ["exact Indian test/study names, e.g. CBC, LFT, KFT, Urine R/M, USG Abdomen, Chest X-ray"],
  "plan": "management plan as a BULLET LIST — one action per line, beginning with '• '",
  "advice_notes": "instructions for the ward nurses as a BULLET LIST — one per line, beginning with '• '",
  "follow_up": "review/monitoring instructions as a BULLET LIST — one per line, beginning with '• '",
  "confidence": 0.85,
  "reasoning": "One sentence explaining the confidence level and any ambiguity"
}

Rules:
- Include a drug ONLY if it was explicitly spoken. Do NOT list routine medications that were not mentioned.
- Record the route and frequency exactly as dictated; do not normalise BD into "twice daily".
- Radiology and laboratory orders both go into "investigations" — the host screen routes them.
- Monitoring instructions ("watch urine output", "repeat sugars 6th hourly") belong in "advice_notes".
- If a field cannot be extracted, use an empty string or an empty array.`,

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

    // AI entitlement floor — enforce the hospital's "AI Features" master switch (and the
    // per-feature voice_scribe toggle) server-side, before any provider call. Mirrors the
    // browser callAI() gate, which a direct invoke of this function would otherwise bypass.
    // Started BEFORE the entitlement gate so the catalogue read overlaps it, the
    // translation and the config resolution. It is a plain read with no side effects, so
    // a dangling promise on the 403 path is harmless.
    const lexiconPromise = hospitalId
      ? loadHospitalLexicon(sb, hospitalId).catch((lexErr) => {
          console.warn("Lexicon load failed (non-fatal):",
            sanitizeForLog(lexErr instanceof Error ? lexErr.message : String(lexErr)));
          return null;
        })
      : Promise.resolve(null);

    const gate = await checkAIAllowed(sb, hospitalId, "voice_scribe");
    if (!gate.allowed) {
      return new Response(JSON.stringify({ error: gate.reason }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const {
      transcript, context_type, existing_data, language_code, patient_id,
      // Set by the client when Sarvam Saaras already returned English (mode="translate").
      // Without it this function would pay for a SECOND translation of text that is
      // already English — the mayura round-trip below is billed per character.
      pre_translated_by,
      // Rescue tier (see below): re-hear ONE bad segment instead of restructuring.
      rescue_only, rescue_audio_base64, rescue_media_type, rescue_prior_text,
    } = await req.json();

    // ── Tier-2 audio rescue ────────────────────────────────────────────────
    // Sarvam is cheap and handles the great majority of a dictation, so it stays the
    // default path. But when a segment scores badly there is nothing a text-only model
    // can do: if the ASR turned a drug name into phonetic mush, the information is gone
    // from the transcript entirely. Re-hearing THAT segment with a multimodal model is
    // the only way to recover it — and doing it only for the ~10% that scored badly is
    // what keeps the token saving of the cheap path intact.
    //
    // Metered under its own feature key so the expensive tier is separable from the
    // cheap one in ai_usage_logs. Best-effort throughout: if the configured provider
    // cannot take audio at all (most cannot — see callAiAudio), the caller keeps its
    // original result and the doctor is never blocked.
    if (rescue_only) {
      if (!rescue_audio_base64) {
        return new Response(JSON.stringify({ error: "rescue_audio_base64 is required" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const rescueConfig = hospitalId
        ? (await resolveAiConfig(hospitalId, "voice_scribe_rescue", 800, { entitlement: gate })) ?? resolveAiConfigFromEnv(800)
        : resolveAiConfigFromEnv(800);
      if (!rescueConfig) {
        return new Response(JSON.stringify({ corrected_text: null, reason: "no_provider" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      let hints = "";
      if (hospitalId) {
        try {
          const lex = await loadHospitalLexicon(sb, hospitalId);
          const probe = repairTranscript(rescue_prior_text || "", lex);
          if (probe.suggestions.length > 0) {
            hints = `\n\nThis hospital's catalogue contains these similar terms, which may be what was said: ${
              probe.suggestions.slice(0, 10).flatMap(s => s.candidates).join(", ")}`;
          }
        } catch { /* hints are optional */ }
      }

      const rescuePrompt = `You are correcting a speech-to-text transcript of an Indian doctor's clinical dictation. An automatic speech recogniser produced the text below, but it is not trained on medical vocabulary and has likely mangled drug names, investigation names and clinical terms.

Listen to the audio and return a CORRECTED English transcript of what was actually said.

Rules:
- Return ONLY the corrected transcript text. No JSON, no commentary, no preamble.
- Correct medical terms, drug names and investigation names to their standard English spelling.
- Do NOT add, invent or infer any clinical content that is not spoken in the audio.
- If a passage is genuinely inaudible, omit it rather than guessing.
- Translate to English if the audio is in an Indian language.

What the speech recogniser produced:
"${rescue_prior_text || ""}"${hints}`;

      try {
        const corrected = await callAiAudio(
          rescueConfig, rescue_audio_base64, rescue_media_type || "audio/webm", rescuePrompt, 800,
        );
        return new Response(JSON.stringify({ corrected_text: corrected?.trim() || null }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (rescueErr) {
        console.warn("Audio rescue unavailable (non-fatal):",
          sanitizeForLog(rescueErr instanceof Error ? rescueErr.message : String(rescueErr)));
        return new Response(JSON.stringify({ corrected_text: null, reason: "unsupported" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Fetch the patient's known allergies/current medications (if any) up
    // front, server-side — so the safety-guard call below has real patient
    // context rather than trusting a client-supplied list. Best-effort: a
    // missing/failed lookup must not block transcription from proceeding.
    // Started here but NOT awaited until the safety check actually needs it, so this DB
    // round trip overlaps the translation, lexicon, config resolution and LLM call instead
    // of adding its latency to theirs.
    // hospitalId (resolved above from the caller's OWN session, never from
    // the request) must scope this lookup too — patient_id alone let a
    // caller at one hospital pull allergy/medication fragments belonging to
    // another hospital's patient into their own safety-check flags. Found
    // in the Phase 4 isolation audit — see KNOWN_BUGS.md.
    const patientContextPromise = patient_id && hospitalId
      ? sb.from("patient_ai_context")
          .select("known_allergies, current_medications")
          .eq("patient_id", patient_id)
          .eq("hospital_id", hospitalId)
          .maybeSingle()
          .then(({ data }: { data: { known_allergies?: string[]; current_medications?: string[] } | null }) => ({
            allergies: data?.known_allergies || [],
            meds: data?.current_medications || [],
          }), () => ({ allergies: [] as string[], meds: [] as string[] }))
      : Promise.resolve({ allergies: [] as string[], meds: [] as string[] });

    if (!transcript?.trim()) {
      return new Response(JSON.stringify({ error: "Transcript is required" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Server-side pre-translation (opt-in) ───────────────────────────────
    // When the platform has `voice_pre_translate` enabled and the dictation is
    // in an Indian language, translate the transcript to English HERE — before
    // the LLM call — to save 60-80% of input tokens. The translation runs
    // server-side inside this function, so it needs ZERO additional edge
    // function deployments (avoids the Supabase function-count plan limit).
    let transcriptForLlm = transcript;
    // When Saaras ran with mode="translate" the text ALREADY arrived in English, so the
    // "pre-translated" prompt branch applies without spending anything to get there.
    let wasPreTranslated = pre_translated_by === "sarvam_saaras";
    const isNonEnglish = language_code && language_code !== "en-IN";

    if (isNonEnglish && !wasPreTranslated) {
      try {
        // Check if pre-translate is enabled globally
        const { data: preTranslateCfg } = await sb
          .from("platform_ai_keys")
          .select("config")
          .eq("service_key", "voice_pre_translate")
          .maybeSingle();

        const ptConfig = preTranslateCfg?.config as Record<string, unknown> | null;
        if (ptConfig?.enabled) {
          // Resolve which translation provider to use
          const ptProvider = (ptConfig.provider as string) || "auto";

          // "auto" → match the ASR engine; otherwise use the explicit choice
          let translateProvider: "sarvam" | "bhashini" = "sarvam";
          if (ptProvider === "bhashini") {
            translateProvider = "bhashini";
          } else if (ptProvider === "auto") {
            const { data: asrCfg } = await sb
              .from("platform_ai_keys")
              .select("config")
              .eq("service_key", "voice_asr_engine")
              .maybeSingle();
            const asrEngine = (asrCfg?.config as Record<string, string> | null)?.engine;
            if (asrEngine === "bhashini") translateProvider = "bhashini";
          }

          // Fetch the translation API key (same key used for ASR)
          let translateApiKey: string | null = null;
          let bhashiniUserId: string | null = null;

          if (translateProvider === "sarvam") {
            translateApiKey = Deno.env.get("SARVAM_API_KEY") || null;
            if (!translateApiKey) {
              const { data: sarvamCfg } = await sb
                .from("platform_ai_keys")
                .select("config")
                .eq("service_key", "sarvam")
                .eq("is_active", true)
                .maybeSingle();
              translateApiKey = (sarvamCfg?.config as Record<string, string> | null)?.api_key || null;
            }
          } else {
            translateApiKey = Deno.env.get("BHASHINI_API_KEY") || null;
            bhashiniUserId = Deno.env.get("BHASHINI_USER_ID") || null;
            if (!translateApiKey || !bhashiniUserId) {
              const { data: bhashiniCfg } = await sb
                .from("platform_ai_keys")
                .select("config")
                .eq("service_key", "bhashini")
                .eq("is_active", true)
                .maybeSingle();
              const cfg = bhashiniCfg?.config as Record<string, string> | null;
              translateApiKey = translateApiKey || cfg?.api_key || null;
              bhashiniUserId = bhashiniUserId || cfg?.user_id || null;
            }
          }

          if (translateApiKey) {
            const translateStart = Date.now();
            const result = await translateToEnglish(
              transcript, language_code, translateProvider, translateApiKey, bhashiniUserId || undefined,
            );
            if (!result.fallback && result.translatedText) {
              transcriptForLlm = result.translatedText;
              wasPreTranslated = true;
            }
            // Meter the translation — fire-and-forget
            void recordTranslateUsage(sb, {
              hospitalId,
              provider: translateProvider,
              charactersTranslated: result.charactersTranslated,
              latencyMs: Date.now() - translateStart,
              success: !result.fallback,
              errorMessage: result.fallback ? "Translation failed — LLM will handle translation" : null,
            });
          }
        }
      } catch (translateErr) {
        // Non-fatal — if pre-translation fails for any reason, the LLM
        // handles translation as before. Log and continue.
        console.warn("Pre-translation failed (non-fatal):",
          sanitizeForLog(translateErr instanceof Error ? translateErr.message : String(translateErr)));
      }
    }

    // ── Deterministic medical-vocabulary repair (ZERO tokens) ──────────────
    // Sarvam/Bhashini are not trained on medical vocabulary, so they reliably mangle
    // exactly the words the note depends on ("paracetamol" -> "para seta mall"). The
    // hospital already knows every term it stocks; matching against its own catalogue
    // fixes the bulk of that damage before the LLM is involved, for free and auditably.
    // Strictly best-effort: a lexicon failure must never cost a clinician their note.
    let repairs: { from: string; to: string; score: number; source: string }[] = [];
    let termSuggestions: { from: string; candidates: string[]; score: number }[] = [];
    let lexiconHitRate: number | null = null;

    // Loading the catalogue and resolving the provider have no dependency on one another,
    // but used to be awaited back to back — the doctor waited for the sum instead of the max.
    // `gate` is threaded into resolveAiConfig so checkAIAllowed is not re-run: it already ran
    // above, and re-running it cost 4 more serial queries to re-answer the same boolean.
    const [lexiconResult, resolvedConfig] = await Promise.all([
      lexiconPromise,
      hospitalId
        ? resolveAiConfig(hospitalId, "voice_scribe", 1200, { entitlement: gate })
        : Promise.resolve(null),
    ]);

    if (lexiconResult) {
      try {
        const repaired = repairTranscript(transcriptForLlm, lexiconResult);
        transcriptForLlm = repaired.repairedText;
        repairs = repaired.repairs;
        termSuggestions = repaired.suggestions;
        lexiconHitRate = repaired.lexiconHitRate;
        if (repairs.length > 0) {
          console.log(`medical-lexicon: applied ${repairs.length} repair(s)`);
        }
      } catch (lexErr) {
        console.warn("Lexicon repair failed (non-fatal):",
          sanitizeForLog(lexErr instanceof Error ? lexErr.message : String(lexErr)));
      }
    }

    const config = resolvedConfig ?? resolveAiConfigFromEnv(1200);

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

    // Language instruction: when the transcript was successfully pre-translated
    // to English by Sarvam/Bhashini, skip the expensive multilingual prompt —
    // saves ~200 tokens per call. Falls back to the original multilingual
    // instruction when translation was not attempted or failed.
    let langNote: string;
    if (wasPreTranslated) {
      // Short form. The old version spent ~200 tokens describing, in prose, damage the
      // lexicon pass has now already repaired deterministically.
      langNote = `\n\nNOTE: This transcript arrived in English from an Indic speech engine, so some medical terms may still be phonetically mangled. Where the intended clinical meaning is clear, correct the term to standard English medical terminology.`;
    } else {
      // All 22 scheduled languages, not the 9 this used to cover. A language absent from the
      // map fell through to the generic branch, so two-thirds of the catalogue got a vaguer
      // prompt than the rest — a quality gap that tracked the language, not the audio.
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
        "od-IN": "Odia (ଓଡ଼ିଆ)",
        "as-IN": "Assamese (অসমীয়া)",
        "ur-IN": "Urdu (اردو)",
        "sa-IN": "Sanskrit (संस्कृतम्)",
        "ne-IN": "Nepali (नेपाली)",
        "sd-IN": "Sindhi (سنڌي)",
        "ks-IN": "Kashmiri (کٲشُر)",
        "kok-IN": "Konkani (कोंकणी)",
        "doi-IN": "Dogri (डोगरी)",
        "mai-IN": "Maithili (मैथिली)",
        "mni-IN": "Manipuri (ꯃꯤꯇꯩ ꯂꯣꯟ)",
        "sat-IN": "Santali (ᱥᱟᱱᱛᱟᱲᱤ)",
        "brx-IN": "Bodo (बड़ो)",
      };
      const langLabel = language_code ? LANG_LABELS[language_code] : null;
      langNote = langLabel
        ? `\n\nIMPORTANT: The conversation is in ${langLabel}. TRANSLATE and return ALL text field VALUES in clear, professional English. Keep JSON keys in English. Preserve medical drug names and ICD codes exactly.`
        // No example languages here on purpose: naming three of twenty-two biased the model
        // toward them when the language was genuinely unknown.
        : `\n\nIMPORTANT: The conversation may be in English or any Indian regional language. Detect the language, then TRANSLATE and return ALL text field VALUES in clear, professional English. Keep JSON keys in English. Preserve medical drug names and ICD codes exactly.`;
    }

    // Accuracy guardrails — applied to EVERY session type. Symptoms must be strict
    // (no fabrication); only the diagnosis fields may carry a working diagnosis,
    // derived from the described symptoms and NOT from any mis-heard disease word.
    const guardNote = `\n\nACCURACY RULES (most important):
- Use ONLY the doctor↔patient conversation as your source. NEVER invent, infer, assume, exaggerate, add, or "recommend" anything that was not actually spoken.
- For chief_complaint, history_of_present_illness and examination_findings: record ONLY symptoms/findings/values a speaker EXPLICITLY states. A clinical fact stated inside a question or an answer STILL counts — capture it (e.g. doctor "since when the fever?" + patient "3 days" → fever × 3 days). Only ignore PURE social pleasantries, filler, and unclear/garbled audio — never turn those into clinical findings. Preserve the EXACT anatomical location (e.g. lower back / waist must NOT become "abdomen"). If a symptom is genuinely ambiguous, leave it out.
- A consulting room may have OTHER PEOPLE talking nearby, and their words can leak into the recording. If a passage is plainly an unrelated conversation — different topic, no connection to this patient's problem, addressed to somebody else — ignore it. This does NOT apply to the patient or their attendant: the doctor↔patient exchange IS the source of the note and every clinical fact in it must be captured, however briefly stated. When you cannot tell whether a passage belongs to this consultation, KEEP it — losing something the patient said is worse than including a stray sentence.
- For "examination_findings" vs "systemic_examination": general whole-patient survey goes in the first, findings for a NAMED system or site go in the second. Never put the same finding in both. If the doctor examined nothing, leave both empty rather than inventing a normal examination.
- For "diagnosis" and "icd_suggestion": EXTRACT-ONLY. Fill these ONLY if a diagnosis is explicitly spoken in the conversation (by the doctor or patient). If no diagnosis is stated, leave BOTH empty ("" and ""). Do NOT put your own inference here — this pair records what was actually SAID.
- For "suggested_diagnosis" / "suggested_icd" / "diagnosis_basis": this is where your OWN clinical inference belongs, and ONLY here. Offer one when the described findings genuinely support a most-likely working diagnosis and the doctor did not state one. It is presented to the doctor as an unconfirmed suggestion, so it must be defensible from the findings you cite in "diagnosis_basis" — leave all three empty rather than guessing from thin or non-specific symptoms. Never repeat a diagnosis that was actually spoken (that belongs in "diagnosis").
- confidence: base it on how much was actually extractable. If few or no clinical facts could be captured, set confidence to 0.3 or lower and explain in "reasoning" what was missing or unclear. Do NOT report high confidence for an empty or near-empty result.
- ALSO return "field_confidence": an object scoring how confident you are in EACH field you filled — keys "chief_complaint", "history_of_present_illness", "examination_findings", "systemic_examination", "diagnosis", "plan", "follow_up", "prescription", "investigations", values 0-1. Use null for any field the dictation never covered. A field left empty because NOTHING WAS SAID about it must be null, NOT a low number — "not dictated" and "misheard" are different things and are shown differently to the doctor.`;

    // Terms the deterministic pass matched but was not confident enough to rewrite.
    // Offered as context, never as an instruction — the model may use clinical
    // judgement to pick one, or ignore the list entirely.
    const termNote = termSuggestions.length > 0
      ? `\n\nPOSSIBLE MEDICAL TERMS: the speech engine may have mangled these. Each entry lists what was heard and the closest matches from this hospital's own catalogue. Use one ONLY if the clinical context supports it; otherwise ignore it.\n${
          termSuggestions.slice(0, 15)
            .map(s => `- heard "${s.from}" → ${s.candidates.join(" | ")}`)
            .join("\n")
        }`
      : "";

    const prompt = `${contextPrompt}${existingContext}${langNote}${guardNote}${termNote}

Dictation transcript:
"${transcriptForLlm}"`;

    const messages = [
      {
        role: "system" as const,
        content: "You are a careful clinical documentation assistant for Indian hospitals. Parse doctor voice dictations into structured medical data using standard Indian medical terminology. Extract ONLY what is explicitly stated — never invent, infer or add symptoms, findings or anatomical locations, and ignore the doctor's questions and unclear audio. Always return valid JSON only, no markdown wrapping, no text outside the JSON object.",
      },
      { role: "user" as const, content: prompt },
    ];

    /**
     * Turn the model's raw text into the response payload: de-fence, parse, safety-check.
     * Shared by the buffered and streaming paths so the two can never diverge on what a
     * completed note contains.
     */
    const buildPayload = async (raw: string) => {
      const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      const structured: Record<string, unknown> = JSON.parse(cleaned);

      let safetyCheck: { safe: boolean; flags: unknown[] } | null = null;
      try {
        const prescriptionList = Array.isArray((structured as any).prescription) ? (structured as any).prescription : [];
        const { allergies, meds } = await patientContextPromise;
        safetyCheck = evaluateSafety(
          {
            prescriptions: prescriptionList.map((rx: any) => ({ drug: rx.drug_name, dose: rx.dose })),
            diagnosis: (structured as any).diagnosis || "",
            investigations: Array.isArray((structured as any).investigations) ? (structured as any).investigations : [],
          },
          { known_allergies: allergies, current_medications: meds },
        );
        if (safetyCheck.flags.length > 0 && hospitalId) {
          void logSafetyFlags(sb, {
            hospitalId, patientId: patient_id || null,
            featureKey: "ai-clinical-voice", flags: safetyCheck.flags as never,
          });
        }
      } catch (safetyErr) {
        console.error("safety evaluation failed (non-fatal):",
          sanitizeForLog(safetyErr instanceof Error ? safetyErr.message : String(safetyErr)));
      }

      return {
        structured,
        context_type,
        safety_check: safetyCheck,
        repairs,
        lexicon_hit_rate: lexiconHitRate,
        transcript_used: transcriptForLlm,
        pre_translated: wasPreTranslated,
      };
    };

    // ── Streaming path ─────────────────────────────────────────────────────
    // A ~1200-token note is 10-20 s of generation, and the doctor saw one spinner for all
    // of it. When the client asks for SSE and the provider can stream, deltas go out as
    // they arrive so the form fills field by field.
    //
    // The client ALWAYS retains the buffered path as a fallback, and so does this function:
    // an unsupported provider simply falls through to it below. A stream that breaks after
    // it starts is reported as an `error` event, and the client re-requests buffered.
    const wantsStream = req.headers.get("accept")?.includes("text/event-stream");
    if (wantsStream && supportsStreaming(config)) {
      const encoder = new TextEncoder();
      const streamStartedAt = Date.now();
      const body = new ReadableStream({
        async start(controller) {
          const send = (obj: unknown) =>
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
          try {
            const { content, usage } = await callAiChatStream(
              config, messages, (delta) => send({ type: "delta", text: delta }), 1200, 0.2,
            );
            // Metered here rather than inside the stream helper, so a streamed call is
            // billed exactly like a buffered one.
            if (config.meter) {
              void recordAiUsage(config.meter, config.provider, config.model, usage, Date.now() - streamStartedAt);
            }
            send({ type: "done", ...(await buildPayload(content)) });
          } catch (streamErr) {
            console.error("stream failed:",
              sanitizeForLog(streamErr instanceof Error ? streamErr.message : String(streamErr)));
            send({ type: "error", error: streamErr instanceof Error ? streamErr.message : "stream failed" });
          } finally {
            controller.close();
          }
        },
      });
      return new Response(body, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const aiCallStartedAt = Date.now();
    let rawContent: string;
    try {
      const result = await callAiChatWithUsage(config, messages, 1200, 0.2);
      rawContent = result.content;
      // Usage/cost logging deliberately REMOVED from here.
      //
      // callAiChatWithUsage() now meters every call itself, using the
      // `meter` context resolveAiConfig() attaches — so this function's manual
      // insert had become a duplicate. It was worse than redundant: the shared
      // path keys the row to the catalogue feature `voice_scribe` while this
      // block used the string "ai-clinical-voice", so the same dictation landed
      // twice under two different keys and doubled the cost recorded against
      // the one feature Phase 4 is trying to price per encounter.
      //
      // The FAILURE path below still logs by hand: the shared helper only fires
      // on success, so failed calls would otherwise disappear from call-volume
      // and error-rate stats entirely.
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

    let payload: Awaited<ReturnType<typeof buildPayload>>;
    try {
      payload = await buildPayload(rawContent);
    } catch (parseErr) {
      console.error("JSON parse error:", parseErr, "Content was:", sanitizeForLog(rawContent.substring(0, 200)));
      throw new Error("Failed to parse AI response as JSON");
    }

    // buildPayload already ran the in-process safety evaluation and assembled every signal
    // the panel needs (repairs, lexicon hit rate, the text the model actually read).
    return new Response(JSON.stringify(payload), {
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
