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
    const { patient_id, hospital_id } = await req.json();
    if (!patient_id || !hospital_id) {
      return new Response(JSON.stringify({ error: "patient_id and hospital_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch patient record
    const { data: patient } = await sb
      .from("patients")
      .select("full_name, dob, gender, allergy_history")
      .eq("id", patient_id)
      .maybeSingle();

    // Fetch recent OPD encounters (last 5)
    const { data: encounters } = await sb
      .from("opd_encounters")
      .select("chief_complaint, diagnosis, icd10_code, soap_plan")
      .eq("patient_id", patient_id)
      .order("created_at", { ascending: false })
      .limit(5);

    // Fetch active prescriptions
    const { data: rxRows } = await sb
      .from("prescriptions")
      .select("items")
      .eq("patient_id", patient_id)
      .order("created_at", { ascending: false })
      .limit(3);

    // Fetch care plans (chronic conditions)
    const { data: carePlans } = await sb
      .from("care_plans")
      .select("condition, status")
      .eq("patient_id", patient_id)
      .eq("status", "active");

    // Fetch allergy records
    const { data: allergies } = await sb
      .from("allergy_records")
      .select("allergen, severity, reaction")
      .eq("patient_id", patient_id)
      .eq("status", "active")
      .limit(10);

    // Extract structured data
    const chronicConditions = (carePlans || []).map((c: any) => c.condition).filter(Boolean);
    const knownAllergies = (allergies || [])
      .map((a: any) => `${a.allergen}${a.severity ? ` (${a.severity})` : ""}`)
      .filter(Boolean);
    if (patient?.allergy_history && knownAllergies.length === 0) {
      knownAllergies.push(patient.allergy_history);
    }

    const currentMeds: string[] = [];
    for (const rx of (rxRows || [])) {
      const items = rx.items || [];
      for (const item of items) {
        const name = item.drug_name || item.name;
        if (name && !currentMeds.includes(name)) currentMeds.push(name);
      }
    }

    const recentDiagnoses = (encounters || [])
      .flatMap((e: any) => {
        const parts = [];
        if (e.diagnosis) parts.push(e.diagnosis);
        if (e.icd10_code) parts.push(e.icd10_code);
        return parts;
      })
      .filter(Boolean)
      .slice(0, 5);

    // Build AI context summary
    const config = await resolveAiConfig(hospital_id, "patient_context_summary", 200);
    let contextSummary = "";

    if (config) {
      const patientAge = patient?.dob
        ? Math.floor((Date.now() - new Date(patient.dob).getTime()) / 31557600000)
        : null;

      const promptData = {
        name: patient?.full_name,
        age: patientAge,
        gender: patient?.gender,
        chronicConditions,
        knownAllergies,
        currentMedications: currentMeds,
        recentDiagnoses,
        recentChiefComplaints: (encounters || []).map((e: any) => e.chief_complaint).filter(Boolean).slice(0, 3),
      };

      const messages = [
        {
          role: "system" as const,
          content: "You are a clinical summarizer. Write a 2-3 sentence concise patient context summary for AI prompts. Focus on clinically relevant facts only.",
        },
        {
          role: "user" as const,
          content: `Patient data: ${JSON.stringify(promptData)}. Summarize for AI clinical context injection.`,
        },
      ];

      contextSummary = await callAiChat(config, messages, 200, 0.3);
    } else {
      contextSummary = [
        chronicConditions.length ? `Known conditions: ${chronicConditions.join(", ")}.` : "",
        knownAllergies.length ? `Allergies: ${knownAllergies.join(", ")}.` : "",
        currentMeds.length ? `Current medications: ${currentMeds.slice(0, 3).join(", ")}.` : "",
      ].filter(Boolean).join(" ") || "No significant medical history recorded.";
    }

    // Upsert patient AI context
    const { error } = await sb.from("patient_ai_context").upsert({
      hospital_id,
      patient_id,
      chronic_conditions: chronicConditions,
      known_allergies: knownAllergies,
      current_medications: currentMeds,
      recent_diagnoses: recentDiagnoses,
      past_surgeries: [],
      risk_flags: [],
      context_summary: contextSummary,
      last_updated: new Date().toISOString(),
    }, { onConflict: "hospital_id,patient_id" });

    if (error) throw error;

    return new Response(JSON.stringify({
      success: true,
      context_summary: contextSummary,
      chronic_conditions: chronicConditions,
      known_allergies: knownAllergies,
      current_medications: currentMeds,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
