import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const {
      diagnosis, icd10_code, encounter_data, patient_context,
      hospital_id, patient_id, encounter_id,
    } = await req.json();

    if (!diagnosis && !icd10_code) {
      return new Response(JSON.stringify({ error: "diagnosis or icd10_code required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Match guideline by ICD code or condition name
    let guidelineQuery = sb.from("clinical_guidelines")
      .select("*")
      .eq("is_active", true)
      .or(`hospital_id.is.null,hospital_id.eq.${hospital_id}`);

    if (icd10_code) {
      guidelineQuery = guidelineQuery.contains("icd10_codes", [icd10_code.slice(0, 3)]);
    } else {
      guidelineQuery = guidelineQuery.ilike("condition_name", `%${diagnosis}%`);
    }

    const { data: guidelines } = await guidelineQuery.limit(3);

    if (!guidelines || guidelines.length === 0) {
      return new Response(JSON.stringify({
        matched: false,
        message: "No guideline found for this condition.",
        adherence_flags: [],
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const guideline = guidelines[0];

    // Check adherence
    const investigationsOrdered: string[] = (encounter_data?.investigations || [])
      .map((i: any) => (typeof i === "string" ? i : i.name || "").toLowerCase());
    const prescribedDrugs: string[] = (encounter_data?.prescriptions || [])
      .map((p: any) => (typeof p === "string" ? p : p.drug || p.name || "").toLowerCase());

    const adherenceFlags: { type: string; severity: "critical" | "warning" | "info"; message: string }[] = [];

    // Check mandatory investigations
    for (const inv of (guideline.mandatory_investigations || [])) {
      const invLower = inv.toLowerCase();
      const ordered = investigationsOrdered.some(i =>
        i.includes(invLower.split(" ")[0]) || invLower.includes(i.split(" ")[0])
      );
      if (!ordered) {
        adherenceFlags.push({
          type: "missing_investigation",
          severity: "warning",
          message: `${guideline.guideline_source}: ${inv} is recommended for ${guideline.condition_name}.`,
        });
      }
    }

    // Check red flags in clinical data
    const clinicalNotes = `${encounter_data?.chief_complaint || ""} ${encounter_data?.examination || ""} ${encounter_data?.vitals_text || ""}`.toLowerCase();
    for (const flag of (guideline.red_flags || [])) {
      const flagLower = flag.toLowerCase();
      if (
        flagLower.includes("hba1c >") && encounter_data?.hba1c && parseFloat(encounter_data.hba1c) > 10
        || flagLower.includes("bp >") && encounter_data?.systolic_bp && encounter_data.systolic_bp > 180
        || clinicalNotes.includes(flagLower.split(" ").slice(0, 2).join(" "))
      ) {
        adherenceFlags.push({
          type: "red_flag",
          severity: "critical",
          message: `RED FLAG: ${flag}`,
        });
      }
    }

    // Check contraindications
    for (const ci of (guideline.contraindications || [])) {
      const ciLower = ci.toLowerCase();
      if (prescribedDrugs.some(d => d.includes(ciLower.split(" ")[0]))) {
        adherenceFlags.push({
          type: "contraindication",
          severity: "critical",
          message: `CONTRAINDICATION: ${ci} is listed as contraindicated per ${guideline.guideline_source}.`,
        });
      }
    }

    // Log adherence check
    if (hospital_id && patient_id) {
      await sb.from("guideline_adherence_log").insert({
        hospital_id,
        patient_id,
        encounter_id: encounter_id || null,
        guideline_id: guideline.id,
        flags_shown: adherenceFlags.map(f => f.message),
        flags_acknowledged: [],
      });
    }

    return new Response(JSON.stringify({
      matched: true,
      guideline: {
        id: guideline.id,
        condition_name: guideline.condition_name,
        source: guideline.guideline_source,
        mandatory_investigations: guideline.mandatory_investigations,
        red_flags: guideline.red_flags,
        first_line_treatment: guideline.first_line_treatment,
        monitoring_parameters: guideline.monitoring_parameters,
        review_frequency: guideline.review_frequency,
      },
      adherence_flags: adherenceFlags,
      missing_investigations: adherenceFlags
        .filter(f => f.type === "missing_investigation")
        .map(f => f.message.split(": ").slice(1).join(": ")),
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
