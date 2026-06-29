import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("DRUGBANK_API_KEY");
    if (!apiKey) {
      // DrugBank not configured — return empty so caller falls back to local DB
      return new Response(JSON.stringify({ interactions: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { drug_a, drug_b } = await req.json();
    if (!drug_a || !drug_b) {
      return new Response(JSON.stringify({ error: "drug_a and drug_b required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const url = `https://api.drugbankplus.com/v1/ddi?drug_name=${encodeURIComponent(drug_a)}&interacting_drug=${encodeURIComponent(drug_b)}`;
    const res = await fetch(url, {
      headers: { "Authorization": `Bearer ${apiKey}` },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ interactions: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    // Map DrugBank response to local DrugInteraction format
    const interactions = (data?.interactions || []).map((item: Record<string, unknown>) => ({
      id: String(item.id || crypto.randomUUID()),
      drug_a: String(item.drug1_name || drug_a),
      drug_b: String(item.drug2_name || drug_b),
      severity: mapSeverity(String(item.severity || "")),
      mechanism: String(item.description || ""),
      clinical_effect: String(item.effect || ""),
      recommendation: String(item.management || ""),
      source: "drugbank",
    }));

    return new Response(JSON.stringify({ interactions }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("check-drugbank-ddi error:", err);
    return new Response(JSON.stringify({ interactions: [] }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function mapSeverity(drugbankSeverity: string): string {
  const s = drugbankSeverity.toLowerCase();
  if (s.includes("contraindicated") || s.includes("avoid")) return "contraindicated";
  if (s.includes("major") || s.includes("severe") || s.includes("high")) return "major";
  if (s.includes("moderate") || s.includes("medium")) return "moderate";
  return "minor";
}
