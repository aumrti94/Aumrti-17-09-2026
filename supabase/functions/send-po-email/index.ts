import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const resendKey = Deno.env.get("RESEND_API_KEY");
    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, vendor_name, po_number, net_amount, expected_delivery, items_summary } = await req.json();

    if (!to || !po_number) {
      return new Response(JSON.stringify({ error: "to and po_number required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const html = `
      <h2>Purchase Order Approved — ${po_number}</h2>
      <p>Dear ${vendor_name || "Vendor"},</p>
      <p>Your purchase order <strong>${po_number}</strong> has been approved and is ready for fulfillment.</p>
      <p><strong>Items:</strong> ${items_summary || "—"}</p>
      <p><strong>Total Amount:</strong> ₹${Number(net_amount || 0).toLocaleString("en-IN")}</p>
      <p><strong>Expected Delivery:</strong> ${expected_delivery || "ASAP"}</p>
      <p>Please confirm receipt of this order and arrange delivery accordingly.</p>
      <p>Regards,<br>HMS Procurement Team</p>
    `;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "HMS Procurement <procurement@aumrti.in>",
        to: [to],
        subject: `Purchase Order Approved — ${po_number}`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      return new Response(JSON.stringify({ error: "Email send failed", detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("send-po-email error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
