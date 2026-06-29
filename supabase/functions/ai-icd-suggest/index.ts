import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// WARNING: Clinical data (PHI) is sent to the configured AI provider.
// Ensure a Data Processing Agreement (DPA) covering PHI is in place before production use.
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

    const { visit_type, visit_id } = await req.json();
    if (!visit_type || !visit_id) {
      return new Response(JSON.stringify({ error: "visit_type, visit_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Resolve hospital from authenticated user (never trust hospital_id from request body)
    const { data: userData } = await sb
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

    let clinicalText = "";

    if (visit_type === "opd") {
      const { data: enc } = await sb.from("opd_encounters")
        .select("chief_complaint, soap_notes, diagnosis, history_of_present_illness, soap_assessment, soap_plan, examination_notes")
        .eq("id", visit_id)
        .eq("hospital_id", hospital_id)
        .maybeSingle();
      if (!enc) {
        console.warn("ai-icd-suggest: opd_encounters not found for visit_id", visit_id);
      }
      if (enc) {
        clinicalText = [
          enc.chief_complaint, enc.history_of_present_illness,
          enc.soap_assessment, enc.soap_plan,
          enc.examination_notes, enc.diagnosis, enc.soap_notes,
        ].filter(Boolean).join("\n");
      }
    } else if (visit_type === "ipd") {
      const { data: adm } = await sb.from("admissions")
        .select("admitting_diagnosis, discharge_type, status")
        .eq("id", visit_id)
        .eq("hospital_id", hospital_id)
        .maybeSingle();
      if (!adm) {
        console.warn("ai-icd-suggest: admissions not found for visit_id", visit_id);
      }

      // Also fetch ward round notes for richer clinical context
      const { data: rounds } = await sb.from("ward_round_notes")
        .select("subjective, objective, assessment, plan")
        .eq("admission_id", visit_id)
        .eq("hospital_id", hospital_id)
        .order("created_at", { ascending: false })
        .limit(3);

      const roundText = (rounds || []).map((r: any) =>
        [r.subjective, r.objective, r.assessment, r.plan].filter(Boolean).join("\n")
      ).join("\n---\n");

      clinicalText = [
        adm?.admitting_diagnosis,
        roundText,
      ].filter(Boolean).join("\n");
    }

    if (!clinicalText) {
      return new Response(JSON.stringify({ error: "No clinical notes found for this visit" }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const config = await resolveAiConfig(hospital_id, "icd_coding", 600);
    if (!config) {
      return new Response(JSON.stringify({ error: "No AI provider configured. Go to Settings → API Hub." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiContent = await callAiChat(config, [
      {
        role: "system",
        content: "You are a medical coding specialist trained in ICD-10-CM. Given clinical documentation, suggest the most appropriate primary ICD-10 code. Always respond with valid JSON only.",
      },
      {
        role: "user",
        content: `Based on this clinical documentation, suggest the most appropriate primary ICD-10 code.

Return ONLY a JSON object:
{
  "primary_code": "J18.9",
  "primary_description": "Pneumonia, unspecified organism",
  "confidence": 0.87,
  "secondary_suggestions": [
    {"code": "E11.9", "description": "Type 2 diabetes mellitus without complications"}
  ],
  "reasoning": "One sentence explaining why this code fits"
}

Clinical documentation:
${clinicalText}`,
      },
    ], 600, 0.2);

    let suggestion;
    try {
      suggestion = JSON.parse(aiContent.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
    } catch {
      return new Response(JSON.stringify({ error: "AI service error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(suggestion), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("ai-icd-suggest error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
