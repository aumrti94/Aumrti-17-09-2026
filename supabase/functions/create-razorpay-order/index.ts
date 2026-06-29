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

    const { hospitalId, packageId, amount, currency = "INR", notes = {} } = await req.json();

    if (!hospitalId || !packageId || !amount) {
      return new Response(JSON.stringify({ error: "hospitalId, packageId, amount required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch hospital's Razorpay credentials
    const { data: apiConfig } = await supabase
      .from("api_configurations")
      .select("config")
      .eq("hospital_id", hospitalId)
      .eq("service_key", "razorpay")
      .eq("is_active", true)
      .maybeSingle();

    if (!apiConfig?.config) {
      return new Response(JSON.stringify({ error: "Razorpay not configured for this hospital" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { key_id, key_secret } = apiConfig.config as Record<string, any>;
    if (!key_id || !key_secret) {
      return new Response(JSON.stringify({ error: "Razorpay credentials incomplete" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create Razorpay order
    const auth = btoa(`${key_id}:${key_secret}`);
    const orderPayload = {
      amount: Math.round(amount * 100), // paise
      currency,
      receipt: `PKG-${packageId.slice(0, 8)}-${Date.now()}`,
      notes: { hospital_id: hospitalId, package_id: packageId, ...notes },
    };

    const rzpRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(orderPayload),
    });

    if (!rzpRes.ok) {
      const errText = await rzpRes.text();
      console.error("Razorpay order creation failed:", errText);
      return new Response(JSON.stringify({ error: "Razorpay order creation failed", detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const order = await rzpRes.json();

    return new Response(JSON.stringify({
      order_id: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    console.error("Create order error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
