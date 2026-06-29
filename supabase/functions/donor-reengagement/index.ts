// Phase 6C — Donor Re-Engagement Bot
// Sends WhatsApp campaigns to eligible blood donors when inventory drops below threshold.
// Triggered manually from the Blood Bank UI or via Supabase Cron (daily at 08:00).
//
// SaMD Class A: operational communication, no clinical risk.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.103.0";

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

const fmtBloodGroup = (g: string, r: string) =>
  `${g}${r === "positive" ? "+" : "-"}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405, headers: CORS });
  }

  // Verify caller auth
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
  const { data: { user }, error: authErr } = await supabaseAdmin.auth.getUser(
    authHeader.replace("Bearer ", ""),
  );
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  let body: { hospital_id: string; threshold?: number };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Bad Request" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  const { hospital_id, threshold = 2 } = body;
  if (!hospital_id) {
    return new Response(JSON.stringify({ error: "hospital_id required" }), {
      status: 400, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }

  // ── 1. Identify critically low blood groups ──────────────────────────────
  const { data: units } = await supabaseAdmin
    .from("blood_units")
    .select("blood_group, rh_factor")
    .eq("hospital_id", hospital_id)
    .eq("status", "available")
    .eq("component", "rbc");

  const groupCounts = new Map<string, number>();
  for (const u of units || []) {
    const key = `${u.blood_group}_${u.rh_factor}`;
    groupCounts.set(key, (groupCounts.get(key) || 0) + 1);
  }

  const GROUPS = ["A", "B", "AB", "O"];
  const RH = ["positive", "negative"];
  const lowGroupKeys: string[] = [];
  for (const g of GROUPS) {
    for (const r of RH) {
      if ((groupCounts.get(`${g}_${r}`) || 0) < threshold) {
        lowGroupKeys.push(`${g}_${r}`);
      }
    }
  }

  if (lowGroupKeys.length === 0) {
    await supabaseAdmin.from("donor_campaigns").insert({
      hospital_id,
      triggered_by: null,
      campaign_type: "low_inventory",
      blood_groups_targeted: [],
      donors_contacted: 0,
      messages_sent: 0,
      status: "no_action",
      notes: `All groups at or above threshold (${threshold} units). No campaign needed.`,
    });
    return new Response(
      JSON.stringify({
        status: "no_action",
        message: `All blood groups are adequately stocked (≥${threshold} RBC units each). No campaign needed.`,
        low_groups: [],
        donors_contacted: 0,
        messages_sent: 0,
      }),
      { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
    );
  }

  // ── 2. Find eligible donors for low groups ───────────────────────────────
  const today = new Date().toISOString().split("T")[0];
  const { data: allEligibleDonors } = await supabaseAdmin
    .from("donors")
    .select("id, full_name, phone, blood_group, rh_factor")
    .eq("hospital_id", hospital_id)
    .eq("is_eligible", true)
    .not("phone", "is", null)
    .lte("next_eligible", today);

  const targetDonors = (allEligibleDonors || []).filter((d) =>
    lowGroupKeys.includes(`${d.blood_group}_${d.rh_factor}`)
  );

  // ── 3. Get hospital WhatsApp config ─────────────────────────────────────
  const { data: hospital } = await supabaseAdmin
    .from("hospitals")
    .select("name, meta_phone_number_id, meta_access_token, whatsapp_provider, wati_api_token, wati_endpoint")
    .eq("id", hospital_id)
    .maybeSingle();

  const hospitalName = hospital?.name || "our hospital";
  const lowGroupLabels = lowGroupKeys.map((k) => {
    const [g, r] = k.split("_");
    return fmtBloodGroup(g, r);
  });

  let messagesSent = 0;
  const errors: string[] = [];

  for (const donor of targetDonors) {
    const bg = fmtBloodGroup(donor.blood_group, donor.rh_factor);
    const message =
      `Dear ${donor.full_name}, 🩸 Your blood type ${bg} is critically needed at ${hospitalName}. ` +
      `You are now eligible to donate again. Please visit our Blood Bank or call us to schedule your donation. ` +
      `Every donation saves up to 3 lives. Thank you for being a life-saver! ` +
      `Reply STOP to opt out of these alerts.`;

    const phone = (donor.phone as string).replace(/\D/g, "");

    try {
      let sent = false;

      if (
        hospital?.whatsapp_provider === "meta_cloud" &&
        hospital.meta_phone_number_id &&
        hospital.meta_access_token
      ) {
        const resp = await fetch(
          `https://graph.facebook.com/v18.0/${hospital.meta_phone_number_id}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${hospital.meta_access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              messaging_product: "whatsapp",
              to: phone,
              type: "text",
              text: { body: message.slice(0, 4096) },
            }),
          },
        );
        if (resp.ok) sent = true;
        else {
          const errBody = await resp.text().catch(() => "");
          errors.push(`Meta send to ${phone}: ${resp.status} ${errBody.slice(0, 100)}`);
        }
      } else if (
        hospital?.whatsapp_provider === "wati" &&
        hospital.wati_api_token &&
        hospital.wati_endpoint
      ) {
        const resp = await fetch(
          `${hospital.wati_endpoint}/api/v1/sendSessionMessage/${phone}`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${hospital.wati_api_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ messageText: message }),
          },
        );
        if (resp.ok) sent = true;
        else {
          errors.push(`WATI send to ${phone}: ${resp.status}`);
        }
      }

      if (sent) messagesSent++;
    } catch (e) {
      errors.push(`Donor ${donor.id}: ${String(e)}`);
    }
  }

  // ── 4. Resolve triggering user's internal id ─────────────────────────────
  const { data: internalUser } = await supabaseAdmin
    .from("users")
    .select("id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  // ── 5. Log campaign ──────────────────────────────────────────────────────
  await supabaseAdmin.from("donor_campaigns").insert({
    hospital_id,
    triggered_by: internalUser?.id || null,
    campaign_type: "low_inventory",
    blood_groups_targeted: lowGroupLabels,
    donors_contacted: targetDonors.length,
    messages_sent: messagesSent,
    status: "completed",
    notes: [
      `Low groups: ${lowGroupLabels.join(", ")} (threshold ${threshold} units).`,
      targetDonors.length === 0 ? "No eligible donors found for low groups." : null,
      errors.length > 0 ? `Errors: ${errors.slice(0, 3).join("; ")}` : null,
    ].filter(Boolean).join(" "),
  });

  const whatsappConfigured = !!(
    (hospital?.meta_phone_number_id && hospital?.meta_access_token) ||
    (hospital?.wati_api_token && hospital?.wati_endpoint)
  );

  return new Response(
    JSON.stringify({
      status: "completed",
      low_groups: lowGroupLabels,
      eligible_donors_found: targetDonors.length,
      messages_sent: messagesSent,
      hospital_whatsapp_configured: whatsappConfigured,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined,
    }),
    { status: 200, headers: { ...CORS, "Content-Type": "application/json" } },
  );
});
