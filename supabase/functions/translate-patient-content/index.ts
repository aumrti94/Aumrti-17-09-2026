import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ISO 639-1 script hints help the model write correct script
const LANG_HINTS: Record<string, string> = {
  Hindi:     "Hindi (Devanagari script: हिन्दी)",
  Telugu:    "Telugu (Telugu script: తెలుగు)",
  Tamil:     "Tamil (Tamil script: தமிழ்)",
  Kannada:   "Kannada (Kannada script: ಕನ್ನಡ)",
  Malayalam: "Malayalam (Malayalam script: മലയാളം)",
  Marathi:   "Marathi (Devanagari script: मराठी)",
  Bengali:   "Bengali (Bengali script: বাংলা)",
  Gujarati:  "Gujarati (Gujarati script: ગુજરાતી)",
  Odia:      "Odia (Odia script: ଓଡ଼ିଆ)",
  Punjabi:   "Punjabi (Gurmukhi script: ਪੰਜਾਬੀ)",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb     = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anon   = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authErr } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get hospital_id from users table
    const { data: userRow } = await sb.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    const hospitalId = userRow?.hospital_id as string | null;

    const body = await req.json();
    const { content, target_language, context = "patient_document", patient_id } = body as {
      content: string;
      target_language: string;
      context?: string;
      patient_id?: string;
    };

    if (!content?.trim()) {
      return new Response(JSON.stringify({ error: "content is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (!target_language || target_language === "English") {
      return new Response(JSON.stringify({ translated_text: content, target_language: "English", source_language: "English" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hospitalId) {
      return new Response(JSON.stringify({ error: "Hospital not found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = await resolveAiConfig(hospitalId, "translation", 1200);
    if (!config) {
      return new Response(JSON.stringify({ error: "No AI provider configured. Go to Settings → API Hub." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const langHint = LANG_HINTS[target_language] || target_language;

    const t0 = Date.now();

    const systemPrompt = `You are a medical translator for Indian patients. Your job is to translate patient-facing health documents into Indian languages in a clear, simple way that patients with no medical background can understand.

Rules:
1. Translate the entire text to ${langHint}.
2. Keep ALL drug names, medicine names, and diagnoses in English inside parentheses after the translated term. Example: "ब्लड प्रेशर (Blood Pressure)".
3. Use simple, everyday language — avoid complex medical jargon.
4. Keep numbered lists and formatting intact.
5. Do NOT add any explanation or meta-commentary — return ONLY the translated text.`;

    const userPrompt = `Translate the following patient ${context.replace(/_/g, " ")} to ${langHint}:\n\n${content}`;

    const translatedText = await callAiChat(config, [
      { role: "system", content: systemPrompt },
      { role: "user",   content: userPrompt },
    ], 1200, 0.2);

    const latencyMs = Date.now() - t0;

    // Log to ai_feature_logs
    await (sb as any).from("ai_feature_logs").insert({
      hospital_id:    hospitalId,
      patient_id:     patient_id || null,
      module:         "translation",
      feature_key:    "translation",
      success:        true,
      input_summary:  content.slice(0, 100),
      output_summary: translatedText.slice(0, 100),
      latency_ms:     latencyMs,
    });

    return new Response(
      JSON.stringify({ translated_text: translatedText.trim(), target_language, source_language: "English" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("translate-patient-content error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Translation failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
