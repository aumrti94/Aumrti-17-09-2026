// razorpay-settlement-reconcile — first Razorpay Settlements-adjacent
// integration in this repo. For every subscription_invoices row with a
// razorpay_payment_id, fetches the real payment record from Razorpay
// (GET /v1/payments/{id}) and flags anything that doesn't match what our
// own DB believes was paid.
//
// Scoping note: this checks payment CAPTURE status (money taken from the
// customer, held by Razorpay), not settlement-BATCH status (money actually
// transferred to Aumrti's bank account) — Razorpay's true settlement-level
// recon is an async report API (POST /v1/settlements/recon/combined),
// not a simple GET, and matching individual payment_ids out of that report
// is materially more complex. Capture-level verification is still the
// correct thing to check first: it answers "did Razorpay actually take the
// money we think was paid," which is what makes MRR verifiable against
// real cash rather than just our own invoice records. Settlement-batch
// verification (bank-arrival timing) is a documented follow-up, not done here.
//
// Auth: inline Basic-Auth (btoa(keyId:keySecret)), matching the existing
// pattern in create-razorpay-subscription / change-subscription-plan
// rather than introducing a shared Razorpay helper.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getRazorpaySubscriptionKeys } from "../_shared/platform-razorpay-config.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // Razorpay keys: /platform-configured row first, env vars as fallback.
    const { keyId, keySecret } = await getRazorpaySubscriptionKeys(admin);

    if (!keyId || !keySecret) {
      return new Response(JSON.stringify({ error: "Razorpay keys not configured. Add them in /platform → Payments." }), {
        status: 500, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
    const auth = btoa(`${keyId}:${keySecret}`);

    // Only invoices from the last 90 days — older discrepancies aren't
    // actionable and re-checking the whole history every week is wasted
    // Razorpay API quota.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
    const { data: invoices } = await admin
      .from("subscription_invoices")
      .select("id, hospital_id, amount_inr, razorpay_payment_id, status, created_at")
      .not("razorpay_payment_id", "is", null)
      .gte("created_at", ninetyDaysAgo);

    const results = { scanned: 0, flagged: 0, resolved: 0, errors: 0 };

    for (const inv of invoices || []) {
      results.scanned++;
      let discrepancyType: string | null = null;
      let settledAmount: number | null = null;
      let razorpayStatus: string | null = null;

      try {
        const res = await fetch(`https://api.razorpay.com/v1/payments/${inv.razorpay_payment_id}`, {
          headers: { Authorization: `Basic ${auth}` },
        });
        if (res.status === 404) {
          discrepancyType = "payment_not_found";
        } else if (!res.ok) {
          results.errors++;
          continue;
        } else {
          const payment = await res.json();
          razorpayStatus = payment.status;
          settledAmount = Number(payment.amount) / 100; // paise → rupees

          if (payment.status === "refunded") {
            discrepancyType = "refunded";
          } else if (!payment.captured) {
            discrepancyType = "not_captured";
          } else if (Math.abs(settledAmount - Number(inv.amount_inr)) > 0.5) {
            discrepancyType = "amount_mismatch";
          }
        }
      } catch {
        results.errors++;
        continue;
      }

      if (discrepancyType) {
        results.flagged++;
        const { data: existing } = await admin
          .from("settlement_reconciliation_flags")
          .select("id")
          .eq("invoice_id", inv.id)
          .is("resolved_at", null)
          .maybeSingle();

        const row = {
          invoice_id: inv.id,
          hospital_id: inv.hospital_id,
          expected_amount: inv.amount_inr,
          settled_amount: settledAmount,
          discrepancy_type: discrepancyType,
          razorpay_status: razorpayStatus,
        };
        if (existing) {
          await admin.from("settlement_reconciliation_flags").update(row).eq("id", existing.id);
        } else {
          await admin.from("settlement_reconciliation_flags").insert(row);
        }
      } else {
        // No discrepancy this run — auto-resolve any previously open flag
        // for this invoice rather than leaving a stale flag visible.
        const { data: resolvedRows } = await admin
          .from("settlement_reconciliation_flags")
          .update({ resolved_at: new Date().toISOString(), resolution_note: "auto-resolved: matched on re-scan" })
          .eq("invoice_id", inv.id)
          .is("resolved_at", null)
          .select("id");
        if (resolvedRows && resolvedRows.length > 0) results.resolved++;
      }
    }

    return new Response(JSON.stringify(results), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("razorpay-settlement-reconcile error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
