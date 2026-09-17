// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveHospitalFromJwt, recordAsrUsage, estimateAudioSeconds, assumedBitrateKbps,
} from "../_shared/asr-metering.ts";
import { isSarvamAsrCode, explainBadSarvamCode } from "../_shared/asr-languages.ts";
import { loadHospitalLexicon, topHotwords } from "../_shared/medical-lexicon.ts";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Saaras v3 output modes (https://api.sarvam.ai/speech-to-text).
//   transcribe (Sarvam's default) — native script, NO translation
//   translate                     — Indic speech straight to English, same call, same cost
//   verbatim | translit | codemix — see docs
// The caller chooses. `translate` is right for Indic audio — the structuring LLM wants
// English, and letting Saaras translate here is free (same request) and 3-6x cheaper in
// downstream LLM tokens than shipping native Indic script into the prompt.
//
// It is WRONG as a blanket default, which is what it used to be. `translate` runs a
// generative speech-TRANSLATION decoder: it renders meaning rather than words, so pointed
// at English it paraphrases — dropping clauses and substituting near-miss clinical terms
// ("neck pain" transcribed as "headache"). The fallback is now Sarvam's own default,
// `transcribe`, which stays anchored to the acoustics. Callers that want translation ask
// for it; see buildChain in src/lib/asrEngineChain.ts.
const VALID_MODES = ["transcribe", "translate", "verbatim", "translit", "codemix"];
const DEFAULT_MODE = "transcribe";

// Sarvam's model page advertises hotword biasing for Saaras, but the REST reference
// does not document the field. So it is sent optimistically and, the first time the
// API rejects it as an unknown parameter, permanently disabled for this instance.
// The deterministic lexicon repair in _shared/medical-lexicon.ts is the load-bearing
// fix for medical vocabulary — hotwords are upside only and must never break a call.
let hotwordsSupported = true;

const looksLikeUnknownFieldError = (status: number, body: string): boolean => {
  if (status !== 400 && status !== 422) return false;
  const lower = body.toLowerCase();
  return lower.includes("hotword") ||
    lower.includes("unexpected") ||
    lower.includes("unknown") ||
    lower.includes("not permitted") ||
    lower.includes("extra field");
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require authenticated Supabase session
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    // Use service role to bypass RLS for internal config lookups
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // 1. Prefer env secret (set via `supabase secrets set SARVAM_API_KEY=...`)
    // 2. Fall back to the GLOBAL platform_ai_keys (where the /platform API Hub stores it)
    let sarvamApiKey = Deno.env.get("SARVAM_API_KEY") || null;

    if (!sarvamApiKey) {
      const { data: configData } = await supabaseAdmin
        .from("platform_ai_keys")
        .select("config")
        .eq("service_key", "sarvam")
        .eq("is_active", true)
        .maybeSingle();

      sarvamApiKey = (configData?.config as Record<string, string> | null)?.api_key || null;
    }

    if (!sarvamApiKey) {
      return new Response(
        JSON.stringify({ error: "Sarvam API key not configured. Go to /platform → API Hub to add the global Sarvam key." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { audio_base64, language_code, model, mode, hotwords: clientHotwords } = await req.json();

    if (!audio_base64 || !language_code) {
      return new Response(
        JSON.stringify({ error: "audio_base64 and language_code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resolvedModel = model || "saaras:v3";
    const resolvedMode = VALID_MODES.includes(mode) ? mode : DEFAULT_MODE;

    // The app's "auto" is Sarvam's `unknown` auto-detect sentinel.
    const resolvedLanguage = language_code === "auto" ? "unknown" : language_code;

    // Validate BEFORE spending a round trip on audio Sarvam will refuse. An unsupported code
    // used to be forwarded verbatim and came back as an opaque upstream 400 that the client
    // reported as "no speech" — which is how `or-IN` (Odia) and `bo-IN` (Bodo) sat in the
    // dropdown for languages that could never transcribe. 400, not 502: this is the caller's
    // bug, and the distinction is what lets the client tell it apart from a provider outage.
    if (!isSarvamAsrCode(resolvedLanguage)) {
      return new Response(
        JSON.stringify({
          error: explainBadSarvamCode(resolvedLanguage),
          language_code: resolvedLanguage,
          unsupported_language: true,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    /**
     * Bias the recogniser toward this hospital's own vocabulary.
     *
     * The plumbing for this has existed since hotword support was added — `buildForm`
     * forwards the list, and the rejection guard below makes it safe — but NO CALLER EVER
     * POPULATED IT. Every dictation was transcribed with zero vocabulary bias while the
     * hospital's drug, test and complaint catalogue sat unused a function call away.
     *
     * Built here rather than shipped from the browser: the lexicon is already cached per
     * hospital for 10 minutes, so a warm instance pays nothing, and 100 terms do not ride
     * up alongside the audio on every 25-second segment.
     *
     * Best-effort throughout. A hospital that cannot be resolved, or a catalogue that
     * cannot be read, simply gets today's un-biased transcription.
     */
    const hospitalIdForLexicon = await resolveHospitalFromJwt(req, supabaseAdmin).catch(() => null);
    let hotwords: string[] = Array.isArray(clientHotwords) ? clientHotwords : [];
    if (hotwords.length === 0 && hospitalIdForLexicon) {
      try {
        const lexicon = await loadHospitalLexicon(supabaseAdmin, hospitalIdForLexicon);
        hotwords = topHotwords(lexicon);
      } catch (lexErr) {
        console.warn("hotword lexicon unavailable (non-fatal):",
          lexErr instanceof Error ? lexErr.message : String(lexErr));
      }
    }

    // Decode base64 to binary
    const audioBytes = decode(audio_base64);
    // Browser MediaRecorder always produces audio/webm (not WAV) — use correct MIME type
    const audioFile = new File([audioBytes], "audio.webm", { type: "audio/webm" });

    // Sarvam v3 API requires multipart/form-data
    const buildForm = (withHotwords: boolean): FormData => {
      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("model", resolvedModel);
      formData.append("language_code", resolvedLanguage);
      // `mode` is only honoured by saaras:v3; sending it for saarika is harmless but pointless.
      if (resolvedModel.startsWith("saaras")) {
        formData.append("mode", resolvedMode);
      }
      // NOTE: `with_timestamps` used to be sent here. It is not a parameter of this
      // endpoint (the documented field is `timestamps`) and was silently ignored.
      if (withHotwords && Array.isArray(hotwords) && hotwords.length > 0) {
        // Cap the list — this rides in the multipart body alongside the audio.
        formData.append("hotwords", JSON.stringify(hotwords.slice(0, 100)));
      }
      return formData;
    };

    const wantsHotwords = hotwordsSupported && Array.isArray(hotwords) && hotwords.length > 0;

    /**
     * Report an upstream failure so the client can act on it.
     *
     * Sarvam's own message is returned in `error`, not buried in a `details` blob nobody
     * reads. A 4xx is passed through as 400 (we sent something wrong — a bad key, an
     * unsupported language, an exhausted quota) and everything else becomes 502 (Sarvam is
     * unwell). The failover chain retries on either, but only the operator can act on the
     * difference, so it has to survive the trip.
     */
    const upstreamError = (status: number, body: string): Response => {
      let message = body;
      try {
        const parsed = JSON.parse(body);
        message = parsed?.error?.message ?? parsed?.message ?? parsed?.error ?? body;
      } catch { /* not JSON — the raw text is the best message available */ }
      // An upstream error body can echo the request — redact before it lands in logs.
      console.error("Sarvam API error:", status, sanitizeForLog(body.slice(0, 500)));
      return new Response(
        JSON.stringify({
          error: `Sarvam ${status}: ${String(message).slice(0, 400)}`,
          sarvam_status: status,
          sarvam_message: String(message).slice(0, 400),
          language_code: resolvedLanguage,
        }),
        {
          status: status >= 400 && status < 500 ? 400 : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    };

    const asrStartedAt = Date.now();
    let response = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: { "api-subscription-key": sarvamApiKey },
      body: buildForm(wantsHotwords),
    });

    // If the account/endpoint does not accept hotwords, retry once without them and
    // stop sending them. A biasing nicety must never cost a clinician their dictation.
    if (!response.ok && wantsHotwords) {
      const probeErr = await response.text();
      if (looksLikeUnknownFieldError(response.status, probeErr)) {
        console.warn("Sarvam rejected `hotwords` — disabling hotword biasing for this instance.");
        hotwordsSupported = false;
        response = await fetch("https://api.sarvam.ai/speech-to-text", {
          method: "POST",
          headers: { "api-subscription-key": sarvamApiKey },
          body: buildForm(false),
        });
      } else {
        return upstreamError(response.status, probeErr);
      }
    }

    if (!response.ok) {
      return upstreamError(response.status, await response.text());
    }

    const result = await response.json();

    // Meter the transcription. ASR is billed per audio-minute and was entirely
    // invisible to ai_usage_logs before this — which meant the cost of a
    // dictated encounter only ever counted its LLM half. Fire-and-forget: a
    // metering failure must never cost the clinician their transcript.
    const transcript = result.transcript || "";

    void (async () => {
      // Reuse the hospital resolved for the hotword lookup — it is the same JWT and the
      // same answer, and resolving it twice would add a second users-table round trip to
      // every 25-second segment of every dictation.
      const hospitalId = hospitalIdForLexicon;
      // Sarvam does not return a duration, so it is inferred from byte length
      // at the bitrate configured in asr_pricing.
      const bitrate = await assumedBitrateKbps(supabaseAdmin, "sarvam");
      await recordAsrUsage(supabaseAdmin, {
        hospitalId,
        provider: "sarvam",
        model: resolvedModel,
        seconds: estimateAudioSeconds(audioBytes.length, bitrate),
        estimated: true,
        latencyMs: Date.now() - asrStartedAt,
        languageCode: result.language_code ?? resolvedLanguage,
        mode: resolvedModel.startsWith("saaras") ? resolvedMode : null,
        // A 200 carrying no words is NOT a success. Logging it as one is why the
        // languages that never transcribe were invisible: every failed dictation in
        // Santali or Bodo looked, in the usage table, exactly like a good one in Hindi.
        // The row is still written (the audio was sent, and Sarvam bills for it) — it is
        // just written honestly.
        success: transcript.trim().length > 0,
        errorMessage: transcript.trim().length > 0
          ? undefined
          : `empty transcript (${resolvedLanguage}, mode=${resolvedMode})`,
      });
    })();

    // Return the FULL signal, not just the text. `language_probability` is Sarvam's
    // confidence that it identified the spoken language correctly — a proxy for audio
    // quality, not a word-level ASR score, but the only real signal the API gives us.
    // It used to be discarded here, which is why the panel's confidence badge was
    // nothing but the structuring LLM's guess about itself.
    return new Response(
      JSON.stringify({
        transcript,
        detected_language_code: result.language_code ?? null,
        language_probability: typeof result.language_probability === "number"
          ? result.language_probability
          : null,
        mode: resolvedMode,
        request_id: result.request_id ?? null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("sarvam-transcribe error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
