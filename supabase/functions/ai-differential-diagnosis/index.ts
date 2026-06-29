import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveAiConfig, resolveAiConfigFromEnv, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { chief_complaint, vitals, examination, age, gender, history, patient_context, hospital_id } = await req.json();

    if (!chief_complaint) {
      return new Response(JSON.stringify({ error: "chief_complaint is required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve AI config: the platform (global) config is DB-backed and does not
    // actually use hospital_id, so always try it first, then fall back to env.
    const config =
      (await resolveAiConfig(hospital_id || "", "differential_diagnosis", 1000)) ??
      resolveAiConfigFromEnv(1000);

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

    return new Response(JSON.stringify(parsed), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
