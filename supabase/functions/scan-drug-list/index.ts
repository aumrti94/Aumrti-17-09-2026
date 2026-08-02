import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { resolveAiConfig, resolveAiConfigFromEnv, callAiVision } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { base64Image, mediaType, hospital_id } = await req.json();
    if (!base64Image) throw new Error("No image provided");

    // Resolve AI config: try DB config if hospital_id provided, then env fallback
    const config = hospital_id
      ? (await resolveAiConfig(hospital_id, "document_ocr", 4000)) ?? resolveAiConfigFromEnv(4000)
      : resolveAiConfigFromEnv(4000);

    if (!config) {
      return new Response(JSON.stringify({ error: "No AI provider configured. Go to Settings → API Hub." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extractionPrompt = `This is a drug/medicine list or pharmacy price list from an Indian hospital or pharmacy.

Extract ALL drugs and return ONLY a JSON array:
[
  {
    "drug_name": "full brand/product name as written, including strength (e.g. \\"Paracetamol 500mg\\")",
    "generic_name": "generic / molecule name (INN) if visible, else null",
    "category": "therapeutic class if visible (e.g. Analgesic, Antibiotic), else null",
    "schedule_type": "one of: G, H, H1, X, OTC — Indian drug schedule. Use OTC if not visible",
    "strength": "strength with unit (e.g. 500mg, 10mg/ml), else null",
    "form": "dosage form: Tablet, Capsule, Syrup, Injection, Ointment, Drops, Inhaler — default Tablet",
    "hsn_code": "HSN code if visible, else null",
    "gst_percent": number (5/12/18 if visible, else 12)
  }
]

Rules:
- Extract EVERY drug row visible in the image
- drug_name is mandatory — skip any row where you cannot read a name
- schedule_type: narcotics/psychotropics are X; most antibiotics are H; default to OTC when unclear
- gst_percent: most medicines in India are 12%; life-saving drugs are often 5%
- If a field is not visible use null (except schedule_type=OTC, form=Tablet, gst_percent=12 as defaults)
- Return ONLY a valid JSON array — no markdown, no explanation, no other text`;

    const rawText = await callAiVision(config, base64Image, mediaType || "image/jpeg", extractionPrompt, 4000);

    const cleaned = rawText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let extracted;
    try {
      extracted = JSON.parse(cleaned);
    } catch {
      console.error("Failed to parse AI response:", rawText);
      return new Response(JSON.stringify({ error: "Could not parse drug list. Please try a clearer image.", rawText }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(extracted)) {
      return new Response(JSON.stringify({ error: "AI returned unexpected format. Please try again." }), {
        status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify(extracted), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("scan-drug-list error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
