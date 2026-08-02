// @ts-nocheck
// HTTP wrapper over _shared/safety-guard.ts.
//
// The checks themselves moved to the shared module so in-process callers (notably
// ai-clinical-voice, which used to invoke this function over HTTP *after* its LLM call had
// already completed) can run them in microseconds instead of paying a gateway round trip
// plus a possible cold start. This endpoint stays for callers that reach it over HTTP.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { evaluateSafety, logSafetyFlags } from "../_shared/safety-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { feature_key, ai_output, patient_context, hospital_id, patient_id } = await req.json();

    const result = evaluateSafety(ai_output, patient_context);

    if (result.flags.length > 0 && hospital_id) {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      );
      await logSafetyFlags(sb, {
        hospitalId: hospital_id,
        patientId: patient_id,
        featureKey: feature_key,
        flags: result.flags,
      });
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
