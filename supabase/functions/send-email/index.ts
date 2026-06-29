// send-email — Standalone email dispatch via Resend (consistent with send-po-email pattern).
// Callable from any module that needs to send a transactional email.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );
    const { data: { user }, error: authErr } = await anonClient.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: userData } = await svc
      .from("users")
      .select("hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!userData?.hospital_id) return json({ error: "User record not found" }, 404);
    const hospitalId: string = userData.hospital_id;

    // Fetch hospital name for "From" display name
    const { data: hospital } = await svc
      .from("hospitals")
      .select("name")
      .eq("id", hospitalId)
      .maybeSingle();
    const hospitalName: string = (hospital as any)?.name || "Aumrti HMS";

    const body = await req.json();
    const to: string = String(body.to ?? "").trim();
    if (!to || !to.includes("@")) return json({ error: "Valid 'to' email is required" }, 400);

    const subject: string = String(body.subject ?? "").trim();
    if (!subject) return json({ error: "subject is required" }, 400);

    const bodyHtml: string = String(body.body_html ?? "").trim();
    const bodyText: string = String(body.body_text ?? body.body_html ?? "").replace(/<[^>]+>/g, " ").trim();
    if (!bodyHtml && !bodyText) return json({ error: "body_html or body_text is required" }, 400);

    const fromName: string = body.from_name ?? hospitalName;
    const notificationId: string | null = body.notification_id ?? null;
    const fromEmail: string = Deno.env.get("FROM_EMAIL") || "notifications@aumrti.health";

    const resendKey = Deno.env.get("RESEND_API_KEY");
    let status = "failed";
    let messageId: string | null = null;
    let errorText: string | null = null;

    if (!resendKey) {
      errorText = "RESEND_API_KEY not configured. Set it as a Supabase secret.";
      console.error(`send-email: ${errorText}`);
    } else {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${fromName} <${fromEmail}>`,
            to: [to],
            subject,
            html: bodyHtml || `<p>${bodyText}</p>`,
            text: bodyText || undefined,
          }),
        });
        const d = await res.json();
        status = d.id ? "sent" : "failed";
        messageId = d.id ?? null;
        if (!d.id) errorText = JSON.stringify(d);
      } catch (e: any) {
        errorText = e?.message ?? "Resend error";
      }
    }

    await svc.from("email_notifications").insert({
      hospital_id: hospitalId,
      to_email: to,
      subject,
      body_html: bodyHtml || null,
      provider: "resend",
      message_id: messageId,
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      error_text: errorText,
      notification_id: notificationId,
    });

    return json({ success: status === "sent", provider: "resend", message_id: messageId, error: errorText });

  } catch (err: any) {
    console.error("send-email error:", err);
    return json({ error: err.message }, 500);
  }
});
