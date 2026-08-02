// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { decode } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveHospitalFromJwt, recordAsrUsage, estimateAudioSeconds, assumedBitrateKbps,
} from "../_shared/asr-metering.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// Saaras v3 output modes (https://api.sarvam.ai/speech-to-text).
//   transcribe (Sarvam's default) — native script, NO translation
//   translate                     — Indic speech straight to English, same call, same cost
//   verbatim | translit | codemix — see docs
// We default to "translate": the structuring LLM wants English, and letting Saaras
// do the translation here is both free (it is the same request) and 3-6x cheaper in
// downstream LLM tokens than shipping native Indic script into the prompt.
const VALID_MODES = ["transcribe", "translate", "verbatim", "translit", "codemix"];
const DEFAULT_MODE = "translate";

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

    const { audio_base64, language_code, model, mode, hotwords } = await req.json();

    if (!audio_base64 || !language_code) {
      return new Response(
        JSON.stringify({ error: "audio_base64 and language_code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const resolvedModel = model || "saaras:v3";
    const resolvedMode = VALID_MODES.includes(mode) ? mode : DEFAULT_MODE;

    // Decode base64 to binary
    const audioBytes = decode(audio_base64);
    // Browser MediaRecorder always produces audio/webm (not WAV) — use correct MIME type
    const audioFile = new File([audioBytes], "audio.webm", { type: "audio/webm" });

    // Sarvam v3 API requires multipart/form-data
    const buildForm = (withHotwords: boolean): FormData => {
      const formData = new FormData();
      formData.append("file", audioFile);
      formData.append("model", resolvedModel);
      formData.append("language_code", language_code === "auto" ? "unknown" : language_code);
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
        console.error("Sarvam API error:", response.status, probeErr);
        return new Response(
          JSON.stringify({ error: `Sarvam API error: ${response.status}`, details: probeErr }),
          { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Sarvam API error:", response.status, errText);
      return new Response(
        JSON.stringify({ error: `Sarvam API error: ${response.status}`, details: errText }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const result = await response.json();

    // Meter the transcription. ASR is billed per audio-minute and was entirely
    // invisible to ai_usage_logs before this — which meant the cost of a
    // dictated encounter only ever counted its LLM half. Fire-and-forget: a
    // metering failure must never cost the clinician their transcript.
    void (async () => {
      const hospitalId = await resolveHospitalFromJwt(req, supabaseAdmin);
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
      });
    })();

    // Return the FULL signal, not just the text. `language_probability` is Sarvam's
    // confidence that it identified the spoken language correctly — a proxy for audio
    // quality, not a word-level ASR score, but the only real signal the API gives us.
    // It used to be discarded here, which is why the panel's confidence badge was
    // nothing but the structuring LLM's guess about itself.
    return new Response(
      JSON.stringify({
        transcript: result.transcript || "",
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
