import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, resolveAiConfigFromEnv, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    // Auth verification — this is SaMD Class B clinical decision support; it must only be
    // reachable by an authenticated hospital user, and billing must be attributed correctly.
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

    const { chief_complaint, vitals, examination, age, gender, history, patient_context } = await req.json();

    if (!chief_complaint) {
      return new Response(JSON.stringify({ error: "chief_complaint is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve hospital from the authenticated user — never trust hospital_id from the request body.
    const sbAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userData } = await sbAuth
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!userData) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hospital_id = userData.hospital_id;

    // Resolve AI config: the platform (global) config is DB-backed and does not
    // actually use hospital_id, so always try it first, then fall back to env.
    const config =
      (await resolveAiConfig(hospital_id || "", "differential_diagnosis", 1000)) ??
      resolveAiConfigFromEnv(1000, hospital_id || undefined, "differential_diagnosis");

    if (!config) {
      return new Response(JSON.stringify({ error: "No AI provider configured. Go to Settings → API Hub." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const patientContextStr = patient_context
      ? `\nPatient AI Context: ${patient_context}`
      : "";

    const systemPrompt = `You are an expert clinical decision support AI trained on evidence-based medicine.
Generate a ranked differential diagnosis based on the clinical presentation.
Always respond with valid JSON only — no markdown, no code blocks.${patientContextStr}`;

    const userPrompt = `Clinical Presentation:
- Chief Complaint: ${chief_complaint}
- Age: ${age || "unknown"}, Gender: ${gender || "unknown"}
- Vitals: ${JSON.stringify(vitals || {})}
- Examination: ${examination || "not provided"}
- History: ${history || "not provided"}

Generate top 4 differential diagnoses ranked by likelihood. Return JSON:
{
  "differentials": [
    {
      "rank": 1,
      "diagnosis": "string",
      "icd10": "string",
      "confidence": 0.0-1.0,
      "supporting_features": ["string"],
      "against_features": ["string"],
      "recommended_investigations": ["string"],
      "urgency": "emergent|urgent|routine"
    }
  ],
  "red_flags_detected": ["string"],
  "suggested_referral": "string or null",
  "overall_urgency": "emergent|urgent|routine"
}`;

    const content = await callAiChat(config, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ], 1000, 0.2);

    const parsed = JSON.parse(content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());

    // Run the top-ranked differential through ai-safety-guard (currently:
    // age-diagnosis plausibility — this endpoint doesn't prescribe drugs, so
    // allergy/dose-limit checks are no-ops here by design). Best-effort — a
    // safety-guard failure must never block the differential from returning.
    let safetyCheck: { safe: boolean; flags: unknown[] } | null = null;
    try {
      const topDiagnosis = parsed?.differentials?.[0]?.diagnosis || "";
      if (topDiagnosis) {
        const sb = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
        );
        const { data: safetyData, error: safetyErr } = await sb.functions.invoke("ai-safety-guard", {
          body: {
            feature_key: "ai-differential-diagnosis",
            ai_output: { diagnosis: topDiagnosis },
            patient_context: { age },
            hospital_id: hospital_id || null,
          },
        });
        if (!safetyErr && safetyData) safetyCheck = safetyData as { safe: boolean; flags: unknown[] };
      }
    } catch (safetyGuardErr) {
      console.error("ai-safety-guard call failed:", safetyGuardErr instanceof Error ? safetyGuardErr.message : String(safetyGuardErr));
    }

    return new Response(JSON.stringify({ ...parsed, safety_check: safetyCheck }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
