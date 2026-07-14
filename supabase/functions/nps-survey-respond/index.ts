// nps-survey-respond — public endpoint (no auth) for a patient to submit
// their NPS score after clicking the link sent by nps-survey-dispatch.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { survey_id, score, verbatim } = await req.json();

    if (!survey_id) return json({ error: "survey_id is required" }, 400);
    if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 10) {
      return json({ error: "score must be an integer between 0 and 10" }, 400);
    }

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: survey, error: surveyErr } = await admin
      .from("nps_surveys")
      .select("id, hospital_id, status")
      .eq("id", survey_id)
      .maybeSingle();
    if (surveyErr) return json({ error: surveyErr.message }, 500);
    if (!survey) return json({ error: "Survey not found" }, 404);
    if (survey.status === "responded") return json({ error: "This survey has already been answered" }, 409);

    const { error: insertErr } = await admin.from("nps_responses").insert({
      hospital_id: survey.hospital_id,
      survey_id: survey.id,
      score,
      verbatim: typeof verbatim === "string" ? verbatim.slice(0, 1000) : null,
    });
    if (insertErr) return json({ error: insertErr.message }, 500);

    await admin.from("nps_surveys").update({ status: "responded" }).eq("id", survey.id);

    return json({ success: true });
  } catch (err) {
    console.error("nps-survey-respond error:", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
