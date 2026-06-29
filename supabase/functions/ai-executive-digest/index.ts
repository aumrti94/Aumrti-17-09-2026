import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    const { hospital_name, date, snapshot, anomalies } = await req.json();
    // WARNING: Hospital operational data is sent to ai.gateway.lovable.dev.
    // Ensure a Data Processing Agreement (DPA) covering PHI is in place with Lovable before production use.
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

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

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messages: [
          { role: "system", content: "You are a hospital analytics AI that writes concise executive digests." },
          { role: "user", content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "Rate limited, please try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "Credits exhausted. Add funds at Settings > Workspace > Usage." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const digestText = data.choices?.[0]?.message?.content || "";

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
