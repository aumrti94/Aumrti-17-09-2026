import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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

    const { audio_base64, language_code } = await req.json();

    if (!audio_base64 || !language_code) {
      return new Response(
        JSON.stringify({ error: "audio_base64 and language_code are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const langMap: Record<string, string> = {
      "hi-IN": "hi", "te-IN": "te", "ta-IN": "ta", "kn-IN": "kn",
      "ml-IN": "ml", "mr-IN": "mr", "bn-IN": "bn", "gu-IN": "gu",
      "or-IN": "or", "pa-IN": "pa", "as-IN": "as", "ur-IN": "ur",
      "sa-IN": "sa", "ne-IN": "ne", "sd-IN": "sd", "ks-IN": "ks",
      "doi-IN": "doi", "kok-IN": "kok", "mai-IN": "mai", "mni-IN": "mni",
      "sat-IN": "sat", "bo-IN": "bo", "en-IN": "en",
    };

    const bhashiniLang = langMap[language_code] || language_code.split("-")[0];

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
      const errText = await pipelineRes.text();
      console.error("Bhashini pipeline error:", pipelineRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Bhashini pipeline error: ${pipelineRes.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const pipelineData = await pipelineRes.json();
    const asrConfig = pipelineData?.pipelineResponseConfig?.[0]?.config?.[0];
    const serviceUrl = asrConfig?.serviceId
      ? pipelineData?.pipelineInferenceAPIEndPoint?.callbackUrl
      : null;
    const inferenceApiKey = pipelineData?.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value;

    if (!serviceUrl || !inferenceApiKey) {
      return new Response(
        JSON.stringify({ error: "Could not resolve Bhashini ASR endpoint. Language may not be supported." }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 2: Call ASR inference
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
            audioFormat: "webm",
            samplingRate: 16000,
          },
        }],
        inputData: {
          audio: [{ audioContent: audio_base64 }],
        },
      }),
    });

    if (!asrRes.ok) {
      const errText = await asrRes.text();
      console.error("Bhashini ASR error:", asrRes.status, errText);
      return new Response(
        JSON.stringify({ error: `Bhashini ASR error: ${asrRes.status}` }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const asrData = await asrRes.json();
    const transcript = asrData?.pipelineResponse?.[0]?.output?.[0]?.source || "";

    return new Response(
      JSON.stringify({ transcript }),
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
