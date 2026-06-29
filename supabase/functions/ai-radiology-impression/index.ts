import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth verification
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const anonClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);
    const { data: { user }, error: authError } = await anonClient.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await sb.from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    const hospitalId = userData?.hospital_id as string | null;

    const { modality_type, study_name, clinical_history, indication, findings } = await req.json();

    if (!findings?.trim()) {
      return new Response(JSON.stringify({ error: "Findings are required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!hospitalId) {
      return new Response(JSON.stringify({ error: "Hospital not found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = await resolveAiConfig(hospitalId, "radiology_impression", 400);
    if (!config) {
      return new Response(JSON.stringify({ error: "No AI provider configured. Go to Settings → API Hub." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert radiologist writing a radiology report impression for a hospital management system.

Study type: ${modality_type || "unknown"}
Study name: ${study_name || "unknown"}
Clinical history: ${clinical_history || "Not provided"}
Indication: ${indication || "Not provided"}

Findings written by radiologist:
${findings}

Based on these findings, return ONLY a JSON object (no markdown, no preamble):
{
  "impression": "2-4 line professional radiology impression as would appear in a formal report. Start directly with the impression.",
  "confidence": 0.85,
  "reasoning": "One sentence explaining the key finding driving this impression."
}

confidence should be 0-1 based on how clearly the findings support the impression. Use standard radiology terminology.`;

    const rawContent = await callAiChat(config, [
      { role: "system", content: "You are an expert radiologist. Return only valid JSON with impression, confidence, and reasoning fields." },
      { role: "user", content: prompt },
    ], 400);

    const cleaned = rawContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

    let parsed: { impression: string; confidence: number; reasoning: string };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: treat the entire content as plain impression text
      parsed = { impression: rawContent.trim(), confidence: 0.7, reasoning: "" };
    }

    return new Response(JSON.stringify({
      impression: parsed.impression || "Unable to generate impression.",
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
      reasoning: parsed.reasoning || "",
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-radiology-impression error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
