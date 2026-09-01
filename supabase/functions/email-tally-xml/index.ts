import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ACCOUNTS_EMAIL } from "../_shared/brand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const supabase = createClient(supabaseUrl, serviceKey);

    const {
      hospital_id,
      xml_content,
      date_start,
      date_end,
      export_type = "full_bundle",
      voucher_count = 0,
      exported_by,
    } = await req.json();

    if (!hospital_id || !xml_content) {
      return new Response(JSON.stringify({ error: "hospital_id and xml_content required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Fetch hospital billing email
    const { data: hospital } = await supabase
      .from("hospitals")
      .select("name, billing_email, email")
      .eq("id", hospital_id)
      .maybeSingle();

    const toEmail = (hospital as any)?.billing_email || hospital?.email;
    if (!toEmail) {
      return new Response(JSON.stringify({ error: "No billing email configured for this hospital" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!resendKey) {
      return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const filename = `HMS_Tally_Export_${date_start || "export"}_${date_end || ""}.xml`;
    const xmlBase64 = btoa(unescape(encodeURIComponent(xml_content)));
    const xmlSizeBytes = new TextEncoder().encode(xml_content).length;

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `HMS Accounts <${ACCOUNTS_EMAIL}>`,
        to: [toEmail],
        subject: `Tally XML Export — ${hospital?.name} (${date_start} to ${date_end})`,
        html: `<p>Dear Team,</p>
<p>Please find attached the Tally Prime export for <strong>${hospital?.name}</strong> covering <strong>${date_start} to ${date_end}</strong>.</p>
<p>This export contains <strong>${voucher_count} voucher(s)</strong> of type: <strong>${export_type.replace(/_/g, " ")}</strong>.</p>
<p><strong>Import instructions:</strong><br>
1. Open Tally Prime<br>
2. Gateway of Tally → Import → Data<br>
3. Select the attached XML file<br>
4. Vouchers will import automatically</p>
<p>Regards,<br>HMS Accounts Module — Aumrti</p>`,
        attachments: [{ filename, content: xmlBase64 }],
      }),
    });

    if (!emailRes.ok) {
      const errText = await emailRes.text();
      // Log failed attempt
      await supabase.from("tally_export_log").insert({
        hospital_id,
        export_type,
        date_from: date_start,
        date_to: date_end,
        voucher_count,
        delivery_method: "email",
        delivery_status: "failed",
        xml_size_bytes: xmlSizeBytes,
        error_message: errText.slice(0, 500),
        exported_by: exported_by || null,
      });
      return new Response(JSON.stringify({ error: "Email send failed", detail: errText }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Log successful send
    await supabase.from("tally_export_log").insert({
      hospital_id,
      export_type,
      date_from: date_start,
      date_to: date_end,
      voucher_count,
      delivery_method: "email",
      delivery_status: "sent",
      xml_size_bytes: xmlSizeBytes,
      exported_by: exported_by || null,
    });

    return new Response(JSON.stringify({ success: true, sent_to: toEmail }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("email-tally-xml error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
