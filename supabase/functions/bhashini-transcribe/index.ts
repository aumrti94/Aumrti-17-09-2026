import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveHospitalFromJwt, recordAsrUsage, estimateAudioSeconds, assumedBitrateKbps,
} from "../_shared/asr-metering.ts";
import { BHASHINI_LANG_MAP } from "../_shared/asr-languages.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require an authenticated Supabase session, exactly as sarvam-transcribe does. This
  // function previously accepted unauthenticated calls outright, so anyone holding the
  // public anon key could burn the hospital's Bhashini quota. It now carries real fallback
  // traffic, which makes that gap load-bearing rather than theoretical.
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authError } = await authClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 1. Prefer env secrets. 2. Fall back to the GLOBAL platform_ai_keys (set at /platform → API Hub).
    let bhashiniApiKey = Deno.env.get("BHASHINI_API_KEY");
    let bhashiniUserId = Deno.env.get("BHASHINI_USER_ID");

    if (!bhashiniApiKey || !bhashiniUserId) {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const { data: configData } = await supabaseAdmin
        .from("platform_ai_keys")
        .select("config")
        .eq("service_key", "bhashini")
        .eq("is_active", true)
        .maybeSingle();
      const cfg = configData?.config as Record<string, string> | null;
      bhashiniApiKey = bhashiniApiKey || cfg?.api_key;
      bhashiniUserId = bhashiniUserId || cfg?.user_id;
    }

    if (!bhashiniApiKey || !bhashiniUserId) {
      return new Response(
        JSON.stringify({ error: "Bhashini not configured. Add the global Bhashini key (and User ID) at /platform → API Hub, or set BHASHINI_API_KEY / BHASHINI_USER_ID. Get credentials from bhashini.gov.in" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { audio_base64, language_code, audio_format, sampling_rate } = await req.json();

    if (!audio_base64 || !language_code) {
      return new Response(
        JSON.stringify({ error: "audio_base64 and language_code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Bhashini ASR has no auto-detect — its pipeline requires an explicit sourceLanguage —
    // so "auto"/"unknown" cannot be served here and must be resolved by the caller.
    if (language_code === "auto" || language_code === "unknown") {
      return new Response(
        JSON.stringify({
          error: "Bhashini ASR cannot auto-detect language. Resolve a specific language first.",
          unsupported_language: true,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Accepts either the app's canonical Sarvam code or Bhashini's own ISO-639 code, since
    // the failover chain already translates before calling. Bare codes pass through as-is.
    const bhashiniLang = BHASHINI_LANG_MAP[language_code]
      ?? (language_code.includes("-") ? null : language_code);

    if (!bhashiniLang) {
      return new Response(
        JSON.stringify({
          error: `Bhashini has no ASR route for "${language_code}".`,
          unsupported_language: true,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // MediaRecorder produces WebM/Opus, which Bhashini does NOT accept — it wants
    // WAV/FLAC/MP3. This function used to hardcode `audioFormat: "webm"`, so every Bhashini
    // request failed regardless of language. The client now converts to 16 kHz mono WAV
    // (src/lib/audioToWav.ts) and declares the real format here.
    const audioFormat = typeof audio_format === "string" ? audio_format : "wav";
    const samplingRate = Number.isFinite(sampling_rate) ? Number(sampling_rate) : 16000;

    // Step 1: Get ASR pipeline config from ULCA
    const pipelineRes = await fetch(
      "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ulcaApiKey: bhashiniApiKey,
          userID: bhashiniUserId,
        },
        body: JSON.stringify({
          pipelineTasks: [{ taskType: "asr", config: { language: { sourceLanguage: bhashiniLang } } }],
          pipelineRequestConfig: { pipelineId: "64392f96daac500b55c543cd" },
        }),
      }
    );

    if (!pipelineRes.ok) {
      // Return the reason, not just the number. The client renders this to the doctor, and
      // "Bhashini pipeline error: 502" told nobody whether the key, the language, or the
      // service was at fault.
      const errText = (await pipelineRes.text()).slice(0, 500);
      console.error("Bhashini pipeline error:", pipelineRes.status, errText);
      return new Response(
        JSON.stringify({
          error: `Bhashini pipeline ${pipelineRes.status}: ${errText || "no detail returned"}`,
          bhashini_status: pipelineRes.status,
          language_code: bhashiniLang,
        }),
        {
          status: pipelineRes.status >= 400 && pipelineRes.status < 500 ? 400 : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const pipelineData = await pipelineRes.json();
    const asrConfig = pipelineData?.pipelineResponseConfig?.[0]?.config?.[0];
    const serviceUrl = asrConfig?.serviceId
      ? pipelineData?.pipelineInferenceAPIEndPoint?.callbackUrl
      : null;
    const inferenceApiKey = pipelineData?.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value;

    if (!serviceUrl || !inferenceApiKey) {
      // ULCA answers 200 with an empty pipeline when it has no model for the language, so
      // this is the "language genuinely unavailable" case rather than a transport failure.
      return new Response(
        JSON.stringify({
          error: `Bhashini has no ASR model available for "${bhashiniLang}".`,
          language_code: bhashiniLang,
          unsupported_language: true,
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Call ASR inference
    const asrStartedAt = Date.now();
    const asrRes = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: inferenceApiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [{
          taskType: "asr",
          config: {
            language: { sourceLanguage: bhashiniLang },
            serviceId: asrConfig.serviceId,
            audioFormat,
            samplingRate,
          },
        }],
        inputData: {
          audio: [{ audioContent: audio_base64 }],
        },
      }),
    });

    if (!asrRes.ok) {
      const errText = (await asrRes.text()).slice(0, 500);
      console.error("Bhashini ASR error:", asrRes.status, errText);
      return new Response(
        JSON.stringify({
          error: `Bhashini ASR ${asrRes.status}: ${errText || "no detail returned"}`,
          bhashini_status: asrRes.status,
          language_code: bhashiniLang,
        }),
        {
          status: asrRes.status >= 400 && asrRes.status < 500 ? 400 : 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const asrData = await asrRes.json();
    const transcript = asrData?.pipelineResponse?.[0]?.output?.[0]?.source || "";

    // Meter the transcription — ASR spend was previously invisible entirely, so
    // a dictated encounter only ever counted its LLM half. Fire-and-forget: a
    // metering failure must never cost the clinician their transcript.
    void (async () => {
      const meterClient = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      const hospitalId = await resolveHospitalFromJwt(req, meterClient);
      const bitrate = await assumedBitrateKbps(meterClient, "bhashini");
      // Audio never leaves base64 in this function, so approximate the decoded
      // byte length rather than decoding a whole recording just to measure it.
      const approxBytes = Math.floor((audio_base64?.length ?? 0) * 3 / 4);
      await recordAsrUsage(meterClient, {
        hospitalId,
        provider: "bhashini",
        model: asrConfig?.serviceId || "bhashini-asr",
        seconds: estimateAudioSeconds(approxBytes, bitrate),
        estimated: true,
        latencyMs: Date.now() - asrStartedAt,
        languageCode: bhashiniLang,
        // Bhashini is the fallback leg, so an empty result here is the LAST thing that
        // happens before a language reports "no speech detected" to the doctor. Recording
        // it as a success made exactly the failures worth investigating unfindable —
        // BHASHINI_LANG_MAP claims an ASR route for all 23 languages, but ULCA does not
        // actually serve every one of them, and this row is how that becomes visible.
        success: transcript.trim().length > 0,
        errorMessage: transcript.trim().length > 0
          ? undefined
          : `empty transcript (${bhashiniLang})`,
      });
    })();

    return new Response(
      // `detected_language_code` mirrors sarvam-transcribe's shape so the client can treat
      // both engines uniformly. Bhashini does not detect — it echoes what it was told.
      JSON.stringify({ transcript, detected_language_code: bhashiniLang }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("bhashini-transcribe error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
