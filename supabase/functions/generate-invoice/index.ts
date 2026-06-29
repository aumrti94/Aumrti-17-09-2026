/**
 * generate-invoice
 *
 * Creates a subscription invoice record in subscription_invoices,
 * generates an HTML receipt (stored in Supabase Storage), and returns
 * a signed URL for email delivery.
 *
 * Called by: razorpay-subscription-webhook on subscription.charged event.
 *
 * Request body (service role only):
 * {
 *   hospital_id: string,
 *   plan_name: string,
 *   amount_inr: number,
 *   razorpay_payment_id?: string,
 *   razorpay_subscription_id?: string,
 *   billing_period_start?: string,  // ISO date
 *   billing_period_end?: string,    // ISO date
 * }
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function fmtINR(n: number) {
  return `₹${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

function buildInvoiceHTML(inv: {
  invoice_number: string;
  hospital_name: string;
  hospital_address: string;
  hospital_gstin: string;
  plan_name: string;
  amount_inr: number;
  billing_period_start: string | null;
  billing_period_end: string | null;
  razorpay_payment_id: string | null;
  created_at: string;
}): string {
  const gst18 = Math.round((inv.amount_inr / 1.18) * 0.18 * 100) / 100;
  const baseAmt = inv.amount_inr - gst18;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Invoice ${inv.invoice_number}</title>
<style>
  body { font-family: Inter, Arial, sans-serif; background: #f9fafb; padding: 40px; color: #111827; }
  .card { background: #fff; border-radius: 12px; padding: 40px; max-width: 680px; margin: 0 auto; box-shadow: 0 1px 3px rgba(0,0,0,.1); }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; }
  .logo { font-size: 24px; font-weight: 800; color: #1A2F5A; }
  .logo span { color: #0E7B7B; }
  .meta { text-align: right; color: #6b7280; font-size: 13px; }
  .meta strong { color: #111827; font-size: 15px; }
  .badge { display: inline-block; background: #d1fae5; color: #065f46; border-radius: 6px; padding: 2px 10px; font-size: 12px; font-weight: 600; margin-top: 4px; }
  h2 { font-size: 22px; font-weight: 700; color: #1A2F5A; margin: 0 0 4px; }
  .section { margin: 24px 0; }
  .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-size: 14px; }
  .row:last-child { border-bottom: none; }
  .label { color: #6b7280; }
  .total-row { display: flex; justify-content: space-between; padding: 14px 0; font-size: 16px; font-weight: 700; color: #1A2F5A; }
  .footer { text-align: center; color: #9ca3af; font-size: 12px; margin-top: 32px; padding-top: 20px; border-top: 1px solid #f3f4f6; }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div>
      <div class="logo">Aumrti<span>.</span></div>
      <div style="color:#6b7280;font-size:12px;margin-top:4px;">Hospital Operating System</div>
      <div style="color:#6b7280;font-size:12px;">support@aumrti.in | aumrti.in</div>
    </div>
    <div class="meta">
      <strong>${inv.invoice_number}</strong><br/>
      ${fmtDate(inv.created_at)}<br/>
      <span class="badge">PAID</span>
    </div>
  </div>

  <div class="section">
    <h2>Tax Invoice</h2>
    <div class="row"><span class="label">Billed To</span><span style="text-align:right"><strong>${inv.hospital_name}</strong><br/>${inv.hospital_address || ""}<br/>${inv.hospital_gstin ? "GSTIN: " + inv.hospital_gstin : ""}</span></div>
    <div class="row"><span class="label">Plan</span><span>${inv.plan_name} — Monthly Subscription</span></div>
    ${inv.billing_period_start ? `<div class="row"><span class="label">Billing Period</span><span>${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}</span></div>` : ""}
    ${inv.razorpay_payment_id ? `<div class="row"><span class="label">Payment ID</span><span style="font-family:monospace;font-size:12px;">${inv.razorpay_payment_id}</span></div>` : ""}
  </div>

  <div class="section" style="background:#f9fafb;border-radius:8px;padding:16px;">
    <div class="row"><span class="label">Subscription Amount (base)</span><span>${fmtINR(baseAmt)}</span></div>
    <div class="row"><span class="label">GST @ 18% (SAC: 998313)</span><span>${fmtINR(gst18)}</span></div>
    <div class="total-row"><span>Total Amount</span><span>${fmtINR(inv.amount_inr)}</span></div>
  </div>

  <div class="footer">
    This is a computer-generated invoice and does not require a signature.<br/>
    Aumrti HMS by Aumrti Technologies · GST No: [YOUR-GSTIN] · CIN: [YOUR-CIN]
  </div>
</div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();
    const {
      hospital_id,
      plan_name,
      amount_inr,
      razorpay_payment_id,
      razorpay_subscription_id,
      billing_period_start,
      billing_period_end,
    } = body;

    if (!hospital_id || !plan_name || !amount_inr) {
      return new Response(
        JSON.stringify({ error: "hospital_id, plan_name, amount_inr required" }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } }
      );
    }

    // ── Generate invoice number via DB function ───────────────────────────────
    const { data: invNumData } = await db.rpc("next_invoice_number", {
      p_hospital_id: hospital_id,
    });
    const invoiceNumber: string = invNumData || `INV-${Date.now()}`;

    // ── Fetch hospital details for invoice ───────────────────────────────────
    const { data: hosp } = await db
      .from("hospitals")
      .select("name, address, gstin")
      .eq("id", hospital_id)
      .maybeSingle();

    // ── Fetch admin email for notification ───────────────────────────────────
    const { data: adminUser } = await db
      .from("users")
      .select("email, full_name")
      .eq("hospital_id", hospital_id)
      .in("role", ["super_admin", "hospital_admin"])
      .limit(1)
      .maybeSingle();

    // ── Build HTML receipt ───────────────────────────────────────────────────
    const htmlContent = buildInvoiceHTML({
      invoice_number:       invoiceNumber,
      hospital_name:        hosp?.name || "",
      hospital_address:     hosp?.address || "",
      hospital_gstin:       hosp?.gstin || "",
      plan_name,
      amount_inr:           Number(amount_inr),
      billing_period_start: billing_period_start || null,
      billing_period_end:   billing_period_end   || null,
      razorpay_payment_id:  razorpay_payment_id  || null,
      created_at:           new Date().toISOString(),
    });

    // ── Upload HTML to Storage ───────────────────────────────────────────────
    const storagePath = `${hospital_id}/${invoiceNumber}.html`;
    const encoder = new TextEncoder();

    const { error: uploadErr } = await db.storage
      .from("subscription-invoices")
      .upload(storagePath, encoder.encode(htmlContent), {
        contentType: "text/html",
        upsert: true,
      });

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
    }

    // ── Create signed URL (7-day expiry) ─────────────────────────────────────
    let signedUrl: string | null = null;
    if (!uploadErr) {
      const { data: signData } = await db.storage
        .from("subscription-invoices")
        .createSignedUrl(storagePath, 7 * 24 * 60 * 60); // 7 days
      signedUrl = signData?.signedUrl || null;
    }

    // ── Insert invoice record ────────────────────────────────────────────────
    await db.from("subscription_invoices").insert({
      hospital_id,
      invoice_number:       invoiceNumber,
      razorpay_payment_id:  razorpay_payment_id || null,
      razorpay_subscription_id: razorpay_subscription_id || null,
      amount_inr:           Number(amount_inr),
      plan_name,
      billing_period_start: billing_period_start ? new Date(billing_period_start).toISOString().split("T")[0] : null,
      billing_period_end:   billing_period_end   ? new Date(billing_period_end).toISOString().split("T")[0]   : null,
      pdf_storage_path:     uploadErr ? null : storagePath,
      status:               "paid",
    });

    // ── Log subscription event ────────────────────────────────────────────────
    await db.from("subscription_events").insert({
      hospital_id,
      event_type: "payment_success",
      new_status: "active",
      razorpay_event: "subscription.charged",
      metadata: { invoice_number: invoiceNumber, amount_inr: Number(amount_inr), plan_name },
    }).catch(() => {});

    // ── Send payment success email ────────────────────────────────────────────
    if (adminUser?.email) {
      await db.functions.invoke("send-subscription-notification", {
        body: {
          event:          "payment_success",
          hospital_id,
          email:          adminUser.email,
          full_name:      adminUser.full_name,
          hospital_name:  hosp?.name || "",
          plan_name,
          invoice_number: invoiceNumber,
          amount_inr:     Number(amount_inr),
          invoice_url:    signedUrl || "",
        },
      }).catch(() => {});
    }

    console.log(`✓ Invoice generated: ${invoiceNumber} for hospital ${hospital_id}`);

    return new Response(
      JSON.stringify({ invoice_number: invoiceNumber, signed_url: signedUrl }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("generate-invoice error:", err);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
