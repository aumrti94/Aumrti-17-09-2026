import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Declared outside the try block (and assigned as early as possible inside it) so the
  // catch-all below can actually reach the payload for the DLQ. It previously tried to read
  // it off `(err as any)._rawBody` — nothing anywhere ever set that property, so every DLQ
  // row this function has ever written has `payload: {}` and `event_type: "unknown"`,
  // regardless of what the original webhook actually contained — a dead letter queue with no
  // way to identify or replay the letter. Found via Phase 6 edge-function testing.
  let rawBody = "";

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Signature verification ────────────────────────────────────────────
    rawBody = await req.text();
    const signature = req.headers.get("x-razorpay-signature");
    const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");

    if (!webhookSecret) {
      console.error("RAZORPAY_WEBHOOK_SECRET not configured");
      return new Response(JSON.stringify({ error: "Webhook secret not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing x-razorpay-signature header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(webhookSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sigBytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(rawBody));
    const computed = Array.from(new Uint8Array(sigBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (computed !== signature) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // ─────────────────────────────────────────────────────────────────────

    const payload = JSON.parse(rawBody);
    const event = payload.event;

    // ── Webhook-level idempotency (prevents double-processing on retries) ─
    const webhookId = req.headers.get("x-razorpay-event-id");
    if (webhookId) {
      const { error: dedupError } = await supabase
        .from("razorpay_webhook_log")
        .insert({ webhook_id: webhookId, event: event ?? "unknown" });

      if (dedupError?.code === "23505") {
        // Unique violation = this webhook was already processed
        return new Response(JSON.stringify({ ok: true, skipped: "duplicate" }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }
    // ─────────────────────────────────────────────────────────────────────

    if (event !== "payment.captured" && event !== "payment_link.paid") {
      return new Response(JSON.stringify({ status: "ignored", event }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payment = payload.payload?.payment?.entity;
    if (!payment) {
      return new Response(JSON.stringify({ error: "No payment entity" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const amountInr = payment.amount / 100;
    const paymentId = payment.id;
    const notes = payment.notes || {};
    const billId = notes.bill_id;
    const hospitalId = notes.hospital_id;

    if (!billId) {
      console.log("No bill_id in payment notes, skipping auto-reconciliation");
      return new Response(JSON.stringify({ status: "no_bill_id" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Resolve hospital_id (notes carries it for payment links; fall back to the bill).
    let resolvedHospitalId = hospitalId;
    if (!resolvedHospitalId) {
      const { data: bill } = await supabase.from("bills").select("hospital_id").eq("id", billId).maybeSingle();
      resolvedHospitalId = bill?.hospital_id;
    }
    if (!resolvedHospitalId) {
      console.error("Bill not found:", billId);
      return new Response(JSON.stringify({ error: "Bill not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Razorpay payment method -> this app's payment_mode enum. Unrecognised
    // methods (wallet, emi, ...) fall back to "upi", which has a seeded
    // auto_posting_rules row, so the GL posting below never silently no-ops.
    const methodMap: Record<string, string> = { upi: "upi", card: "card", netbanking: "net_banking" };
    const paymentMode = methodMap[payment.method as string] || "upi";

    // Single atomic, GL-correct write path — inserts bill_payments, updates the
    // bill (+ admission billing_cleared), and posts the journal entry. Mirrors
    // recordBillPayment() on the browser side; this is the DB-side equivalent
    // for contexts (like this webhook) that can't import that TS module.
    const { data: result, error: rpcError } = await supabase.rpc("record_online_bill_payment", {
      p_hospital_id: resolvedHospitalId,
      p_bill_id: billId,
      p_amount: amountInr,
      p_payment_mode: paymentMode,
      p_transaction_id: paymentId,
      p_gateway_reference: paymentId,
      p_notes: "Razorpay auto-payment",
    });

    if (rpcError) {
      console.error("record_online_bill_payment failed:", rpcError);
      return new Response(JSON.stringify({ error: rpcError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Auto-reconciled ₹${amountInr} for bill ${billId}:`, result);

    return new Response(
      JSON.stringify({ ...(result as object), amount: amountInr, bill_id: billId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook error:", err instanceof Error ? err.message : String(err));
    // Persist to DLQ so the processor can retry on its next run
    try {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      let parsedPayload: Record<string, unknown> = {};
      try { parsedPayload = rawBody ? JSON.parse(rawBody) : {}; } catch { /* ignore */ }
      await supabaseAdmin.from("webhook_dlq").insert({
        source: "razorpay_payment",
        event_type: (parsedPayload as any)?.event ?? "unknown",
        payload: parsedPayload,
        error_message: err instanceof Error ? err.message : String(err),
      });
    } catch (dlqErr) {
      console.error("Failed to write to webhook_dlq:", dlqErr instanceof Error ? dlqErr.message : String(dlqErr));
    }
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
