import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkAIAllowed, resolveHospitalIdForUser } from "../_shared/ai-entitlement.ts";
import { resolveAiConfig, callAiChatWithUsage } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

    // AI entitlement floor — enforce the hospital's "AI Features" master switch (and the
    // per-feature ai_digest toggle) server-side, before spending any provider credit. The
    // request body carries only hospital_name, so resolve the hospital from the authed user.
    const adminClient = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const hospitalId = await resolveHospitalIdForUser(adminClient, user.id);
    const gate = await checkAIAllowed(adminClient, hospitalId, "ai_digest");
    if (!gate.allowed) {
      return new Response(JSON.stringify({ error: gate.reason }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { hospital_name, date, snapshot, anomalies } = await req.json();

    const prompt = `You are the AI analytics engine for ${hospital_name || "a hospital"}, a hospital in India. Write a concise daily executive digest for the CEO/Medical Director based on today's operational data.

Today's Date: ${date}

Today's Data:
${JSON.stringify(snapshot, null, 2)}

Anomalies Detected:
${JSON.stringify(anomalies || [], null, 2)}

Write exactly 5 numbered points covering:
1. Revenue performance (vs yesterday, use actual numbers in INR)
2. Clinical operations (OPD/IPD volume, bed occupancy)
3. Alerts & urgent items (critical alerts, anomalies, pending labs)
4. Staffing & quality (any issues flagged)
5. One specific recommendation or focus for today

Rules:
- Be specific with numbers (use the actual data provided)
- Flag anything concerning with ⚠️
- Keep each point to 2-3 sentences maximum
- Use Indian hospital context (INR ₹, Indian terminology)
- Tone: professional, direct, action-oriented
- Start each point with a relevant emoji

Do NOT include a title or introduction.
Start directly with "1. 📊"`;

    // Route through the platform AI provider (configured in Platform → API Hub /
    // platform_ai_keys) — the same path every other AI feature uses. This replaces the
    // old hardcoded ai.gateway.lovable.dev call, which depended on a LOVABLE_API_KEY that
    // only exists on Lovable's own hosting (so the digest failed with a 500 on any other
    // Supabase project). resolveAiConfig also re-checks the AI entitlement server-side.
    const config = await resolveAiConfig(hospitalId || "", "ai_digest", 800);
    if (!config) {
      return new Response(
        JSON.stringify({ error: "No AI provider is configured. Add one in Platform → API Hub." }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { content: digestText } = await callAiChatWithUsage(
      config,
      [
        { role: "system", content: "You are a hospital analytics AI that writes concise executive digests." },
        { role: "user", content: prompt },
      ],
      800,
      0.4,
    );

    return new Response(JSON.stringify({ digest_text: digestText }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("digest error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
