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

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // ── Signature verification ────────────────────────────────────────────
    const rawBody = await req.text();
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

    if (!billId) {
      console.log("No bill_id in payment notes, skipping auto-reconciliation");
      return new Response(JSON.stringify({ status: "no_bill_id" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get the bill
    const { data: bill, error: billError } = await supabase
      .from("bills")
      .select("id, hospital_id, paid_amount, balance_due, total_amount")
      .eq("id", billId)
      .maybeSingle();

    if (billError || !bill) {
      console.error("Bill not found:", billId);
      return new Response(JSON.stringify({ error: "Bill not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Check for duplicate payment
    const { data: existing } = await supabase
      .from("bill_payments")
      .select("id")
      .eq("transaction_id", paymentId)
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ status: "duplicate" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Insert payment
    await supabase.from("bill_payments").insert({
      hospital_id: bill.hospital_id,
      bill_id: bill.id,
      payment_mode: "upi",
      amount: amountInr,
      transaction_id: paymentId,
      gateway_reference: paymentId,
      notes: "Razorpay auto-payment",
    });

    // Update bill
    const newPaid = (bill.paid_amount || 0) + amountInr;
    const newBalance = Math.max(0, (bill.balance_due || 0) - amountInr);
    const newStatus = newBalance <= 0 ? "paid" : "partial";

    await supabase.from("bills").update({
      paid_amount: newPaid,
      balance_due: newBalance,
      payment_status: newStatus,
    }).eq("id", bill.id);

    console.log(`Auto-reconciled ₹${amountInr} for bill ${billId}`);

    return new Response(
      JSON.stringify({ status: "reconciled", amount: amountInr, bill_id: billId }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("Webhook error:", err);
    // Persist to DLQ so the processor can retry on its next run
    try {
      const supabaseAdmin = createClient(
        Deno.env.get("SUPABASE_URL")!,
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
      );
      const rawBodyText = err instanceof Error && (err as any)._rawBody ? (err as any)._rawBody : "";
      let parsedPayload: Record<string, unknown> = {};
      try { parsedPayload = rawBodyText ? JSON.parse(rawBodyText) : {}; } catch { /* ignore */ }
      await supabaseAdmin.from("webhook_dlq").insert({
        source: "razorpay_payment",
        event_type: (parsedPayload as any)?.event ?? "unknown",
        payload: parsedPayload,
        error_message: err instanceof Error ? err.message : String(err),
      });
    } catch (dlqErr) {
      console.error("Failed to write to webhook_dlq:", dlqErr);
    }
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
