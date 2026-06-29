// @ts-ignore: Deno HTTP imports resolved at runtime
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// @ts-ignore: Deno HTTP imports resolved at runtime
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // @ts-ignore: Deno is available in Supabase Edge Functions
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // @ts-ignore: Deno is available in Supabase Edge Functions
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const userClient = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const { payment_id, hospital_id } = await req.json();
    if (!payment_id || !hospital_id) {
      return new Response(JSON.stringify({ error: "payment_id and hospital_id are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load Razorpay credentials for this hospital
    const { data: config } = await supabase
      .from("api_configurations")
      .select("config")
      .eq("hospital_id", hospital_id)
      .eq("service_key", "razorpay")
      .eq("is_active", true)
      .maybeSingle();

    if (!config?.config) {
      return new Response(JSON.stringify({ error: "Razorpay not configured for this hospital" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const rzpConfig = config.config as Record<string, any>;
    const keyId = rzpConfig.key_id;
    const keySecret = rzpConfig.key_secret;

    if (!keyId || !keySecret) {
      return new Response(JSON.stringify({ error: "Razorpay key_id or key_secret missing" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call Razorpay API
    const credentials = btoa(`${keyId}:${keySecret}`);
    const rzpResponse = await fetch(`https://api.razorpay.com/v1/payments/${payment_id}`, {
      headers: {
        "Authorization": `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });

    if (!rzpResponse.ok) {
      const errBody = await rzpResponse.json().catch(() => ({ description: "Unknown error" }));
      return new Response(JSON.stringify({
        error: errBody?.error?.description || `Razorpay API error: ${rzpResponse.status}`,
      }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const payment = await rzpResponse.json();

    return new Response(JSON.stringify({
      payment_id: payment.id,
      amount: payment.amount / 100,
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      email: payment.email,
      contact: payment.contact,
      description: payment.description,
      order_id: payment.order_id,
      captured_at: payment.captured_at ? new Date(payment.captured_at * 1000).toISOString() : null,
      created_at: new Date(payment.created_at * 1000).toISOString(),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err?.message || "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
