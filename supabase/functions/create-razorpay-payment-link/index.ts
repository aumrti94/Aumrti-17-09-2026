import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    // ── Auth: verify caller JWT and derive hospital from profile ──────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: { user: caller }, error: authErr } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );
    if (authErr || !caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: callerProfile } = await supabase
      .from("users")
      .select("hospital_id")
      .eq("id", caller.id)
      .maybeSingle();
    if (!callerProfile?.hospital_id) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const hospital_id = callerProfile.hospital_id;
    // ─────────────────────────────────────────────────────────────────────

    const { bill_id, amount, patient_name, phone } = await req.json();

    if (!bill_id || !amount) {
      return new Response(JSON.stringify({ error: "bill_id and amount required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch hospital's Razorpay credentials from api_configurations
    const { data: apiConfig } = await supabase
      .from("api_configurations")
      .select("config")
      .eq("hospital_id", hospital_id)
      .eq("service_key", "razorpay")
      .eq("is_active", true)
      .maybeSingle();

    if (!apiConfig?.config) {
      return new Response(JSON.stringify({ error: "Razorpay not configured for this hospital" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { key_id, key_secret } = apiConfig.config as Record<string, string>;
    if (!key_id || !key_secret) {
      return new Response(JSON.stringify({ error: "Razorpay credentials incomplete" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const auth = btoa(`${key_id}:${key_secret}`);
    const expireAt = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 7 days

    const payload: Record<string, unknown> = {
      amount: Math.round(Number(amount) * 100), // paise
      currency: "INR",
      description: `Bill payment — ${bill_id.slice(0, 8).toUpperCase()}`,
      expire_by: expireAt,
      reminder_enable: true,
      notes: { bill_id, hospital_id },
    };

    if (patient_name || phone) {
      payload.customer = {
        ...(patient_name ? { name: patient_name } : {}),
        ...(phone ? { contact: phone.replace(/\D/g, "").slice(-10) } : {}),
      };
    }

    const rzpRes = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!rzpRes.ok) {
      const errText = await rzpRes.text();
      console.error("Razorpay payment link creation failed:", errText);
      return new Response(JSON.stringify({ error: "Razorpay payment link creation failed", detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const link = await rzpRes.json();

    return new Response(JSON.stringify({
      razorpay_link_id: link.id,
      razorpay_link_url: link.short_url,
      short_url: link.short_url,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Create payment link error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
