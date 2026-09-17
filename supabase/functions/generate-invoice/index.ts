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
import { splitGstInclusive } from "../_shared/platform-billing.ts";
import { buildInvoicePdf } from "../_shared/invoice-pdf.ts";
import { APP_DOMAIN, SUPPORT_EMAIL } from "../_shared/brand.ts";

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
  billing_cycle?: string | null;
  // Passed in rather than recomputed here — the caller has already produced the
  // authoritative split (and the old local `/1.18` maths could disagree with it
  // by a paisa, so the HTML and the PDF would not have matched).
  gst: { base: number; cgst: number; sgst: number; igst: number; gst: number; interState: boolean; ratePct: number };
  seller: { legal_name: string; gstin?: string | null; cin?: string | null; sac_code?: string | null };
}): string {
  const g = inv.gst;

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
      <div style="color:#6b7280;font-size:12px;">${SUPPORT_EMAIL} | ${APP_DOMAIN}</div>
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
    <div class="row"><span class="label">Plan</span><span>${inv.plan_name} — ${inv.billing_cycle === "yearly" ? "Annual" : "Monthly"} Subscription</span></div>
    ${inv.billing_period_start ? `<div class="row"><span class="label">Billing Period</span><span>${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}</span></div>` : ""}
    ${inv.razorpay_payment_id ? `<div class="row"><span class="label">Payment ID</span><span style="font-family:monospace;font-size:12px;">${inv.razorpay_payment_id}</span></div>` : ""}
  </div>

  <div class="section" style="background:#f9fafb;border-radius:8px;padding:16px;">
    <div class="row"><span class="label">Taxable Value (SAC: ${inv.seller.sac_code || "998313"})</span><span>${fmtINR(g.base)}</span></div>
    ${g.interState
      ? `<div class="row"><span class="label">IGST @ ${g.ratePct}%</span><span>${fmtINR(g.igst)}</span></div>`
      : `<div class="row"><span class="label">CGST @ ${g.ratePct / 2}%</span><span>${fmtINR(g.cgst)}</span></div>
         <div class="row"><span class="label">SGST @ ${g.ratePct / 2}%</span><span>${fmtINR(g.sgst)}</span></div>`}
    <div class="total-row"><span>Total Amount</span><span>${fmtINR(inv.amount_inr)}</span></div>
  </div>

  <div class="footer">
    This is a computer-generated invoice and does not require a signature.<br/>
    ${inv.seller.legal_name}${inv.seller.gstin ? ` · GSTIN: ${inv.seller.gstin}` : ""}${inv.seller.cin ? ` · CIN: ${inv.seller.cin}` : ""}
  </div>
</div>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(
      Deno.env.get("SUPABASE_URL")!,
      serviceKey
    );

    // ── Auth ──────────────────────────────────────────────────────────────
    // The header above already documents this as "service role only," but
    // nothing enforced it — any caller with just the public anon key could
    // insert a fabricated `status: "paid"` subscription_invoices row for a
    // hospital that never paid, generate a real tax invoice bearing that
    // hospital's own name/address/GSTIN, and email its admin a fake
    // "payment success" notice. Found in the Phase 4 isolation audit — see
    // KNOWN_BUGS.md. The only legitimate caller is razorpay-subscription-webhook,
    // invoked with its own service-role client — so this now actually
    // enforces the "service role only" the header always claimed.
    if (req.headers.get("Authorization") !== `Bearer ${serviceKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...CORS, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const {
      hospital_id,
      plan_name,
      amount_inr,
      razorpay_payment_id,
      razorpay_subscription_id,
      billing_period_start,
      billing_period_end,
      billing_cycle,
      payment_method,
      payment_method_detail,
      payment_captured_at,
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

    // ── Fetch hospital + seller identity ─────────────────────────────────────
    // Seller identity is configuration now. It used to be the literal string
    // "GST No: [YOUR-GSTIN] · CIN: [YOUR-CIN]" baked into the template, which
    // meant no invoice this system produced was a valid tax invoice.
    const [{ data: hosp }, { data: seller }] = await Promise.all([
      db.from("hospitals")
        .select("name, address, city, state, state_code, pincode, gstin")
        .eq("id", hospital_id)
        .maybeSingle(),
      db.from("platform_billing_settings").select("*").eq("id", 1).maybeSingle(),
    ]);

    // ── GST breakup ──────────────────────────────────────────────────────────
    // The amount charged is tax-INCLUSIVE, so the taxable value is back-computed
    // and the residual paisa is absorbed so base + tax === total exactly.
    const ratePct = Number(seller?.tax_rate_pct ?? 18);
    const gst = splitGstInclusive({
      total: Number(amount_inr),
      ratePct,
      sellerStateCode: seller?.state_code,
      sellerGstin: seller?.gstin,
      buyerStateCode: hosp?.state_code,
      buyerGstin: hosp?.gstin,
    });

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
      billing_cycle:        billing_cycle || null,
      gst,
      seller: {
        legal_name: seller?.legal_name ?? "Aumrti Technologies",
        gstin:      seller?.gstin,
        cin:        seller?.cin,
        sac_code:   seller?.sac_code,
      },
    });

    // ── Render the PDF tax invoice ───────────────────────────────────────────
    // Wrapped: an invoice RECORD must never fail to exist because a font fetch
    // timed out. If the PDF cannot be produced we still store the HTML and mark
    // document_format accordingly, so the download button never lies about what
    // it is handing the user.
    let pdfBytes: Uint8Array | null = null;
    try {
      pdfBytes = await buildInvoicePdf(
        {
          invoice_number: invoiceNumber,
          invoice_date: new Date().toISOString(),
          seller: {
            legal_name: seller?.legal_name ?? "Aumrti Technologies",
            gstin: seller?.gstin,
            address: [seller?.address_line1, seller?.address_line2].filter(Boolean).join(", ") || null,
            city: seller?.city,
            state: seller?.state,
            pincode: seller?.pincode,
            cin: seller?.cin,
            pan: seller?.pan,
            support_email: seller?.support_email ?? SUPPORT_EMAIL,
            website: seller?.website ?? APP_DOMAIN,
          },
          buyer: {
            name: hosp?.name ?? "",
            address: [hosp?.address, hosp?.city, hosp?.state, hosp?.pincode].filter(Boolean).join(", ") || null,
            gstin: hosp?.gstin,
            state: hosp?.state,
          },
          plan_name,
          billing_cycle: billing_cycle ?? null,
          billing_period_start: billing_period_start ?? null,
          billing_period_end: billing_period_end ?? null,
          sac_code: seller?.sac_code ?? "998313",
          total: gst.total,
          base: gst.base,
          cgst: gst.cgst,
          sgst: gst.sgst,
          igst: gst.igst,
          ratePct: gst.ratePct,
          interState: gst.interState,
          place_of_supply: gst.placeOfSupply,
          razorpay_payment_id: razorpay_payment_id ?? null,
          payment_method: payment_method ?? null,
          payment_method_detail: payment_method_detail ?? null,
          notes: seller?.invoice_notes ?? null,
        },
        // Prefer a font served from our own bucket over the CDN, so issuing an
        // invoice does not depend on a third party being up.
        async (name: string) => {
          const { data } = await db.storage.from("subscription-invoices").download(`_fonts/${name}`);
          return data ? new Uint8Array(await data.arrayBuffer()) : null;
        },
      );
    } catch (e) {
      console.error("PDF generation failed, storing HTML instead:", (e as Error).message);
    }

    // ── Upload to Storage ────────────────────────────────────────────────────
    const encoder = new TextEncoder();
    const documentFormat = pdfBytes ? "pdf" : "html";
    const storagePath = `${hospital_id}/${invoiceNumber}.${documentFormat}`;

    const { error: uploadErr } = await db.storage
      .from("subscription-invoices")
      .upload(
        storagePath,
        pdfBytes ?? encoder.encode(htmlContent),
        { contentType: pdfBytes ? "application/pdf" : "text/html", upsert: true },
      );

    if (uploadErr) {
      console.error("Storage upload error:", uploadErr);
    }

    // Keep an HTML copy alongside the PDF — it is what the notification email
    // links to for a quick in-browser preview.
    if (pdfBytes) {
      await db.storage
        .from("subscription-invoices")
        .upload(`${hospital_id}/${invoiceNumber}.html`, encoder.encode(htmlContent), {
          contentType: "text/html",
          upsert: true,
        })
        .catch(() => {});
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
      document_format:      uploadErr ? null : documentFormat,
      status:               "paid",
      invoice_type:         "tax_invoice",
      // GST breakup, stored rather than recomputed at render time so a rate
      // change never retroactively rewrites what an old invoice claimed.
      currency:             "INR",
      subtotal_inr:         gst.base,
      cgst_inr:             gst.cgst,
      sgst_inr:             gst.sgst,
      igst_inr:             gst.igst,
      tax_rate_pct:         gst.ratePct,
      place_of_supply:      gst.placeOfSupply,
      seller_gstin:         seller?.gstin ?? null,
      buyer_gstin:          hosp?.gstin ?? null,
      sac_code:             seller?.sac_code ?? "998313",
      billing_cycle:        billing_cycle ?? null,
      payment_method:       payment_method ?? null,
      payment_method_detail: payment_method_detail ?? null,
      payment_captured_at:  payment_captured_at ?? new Date().toISOString(),
    });

    // ── Log subscription event ────────────────────────────────────────────────
    // Was `.catch(() => {})` directly on the query builder — supabase-js's PostgrestBuilder is
    // thenable (implements .then()) but does not implement a real .catch(), so this threw
    // "db.from(...).insert(...).catch is not a function" on every single call, unconditionally.
    // The invoice record above was already created successfully by this point, but the request
    // still fell into the outer catch and returned 500 to razorpay-subscription-webhook — the
    // caller sees "failed" for an invoice that was actually generated, risking a webhook retry
    // and a duplicate invoice. Found via Phase 6 edge-function testing.
    try {
      await db.from("subscription_events").insert({
        hospital_id,
        event_type: "payment_success",
        new_status: "active",
        razorpay_event: "subscription.charged",
        metadata: { invoice_number: invoiceNumber, amount_inr: Number(amount_inr), plan_name },
      });
    } catch (e) {
      console.error("generate-invoice: subscription_events log failed:", e instanceof Error ? e.message : String(e));
    }

    // ── Send payment success email ────────────────────────────────────────────
    if (adminUser?.email) {
      try {
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
        });
      } catch (e) {
        console.error("generate-invoice: payment-success notification failed:", e instanceof Error ? e.message : String(e));
      }
    }

    console.log(`✓ Invoice generated: ${invoiceNumber} for hospital ${hospital_id}`);

    return new Response(
      JSON.stringify({ invoice_number: invoiceNumber, signed_url: signedUrl }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("generate-invoice error:", err instanceof Error ? err.message : String(err));
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { ...CORS, "Content-Type": "application/json" } }
    );
  }
});
