// lifecycle-nudge-scan — clones churn-remediation-scan's exact shape
// (single RPC call, dedup table, inline Resend email, weekly Vault-cron).
// Three triggers, checked in priority order so a hospital gets at most one
// nudge per run:
//   1. win_back            — subscription status is 'cancelled' (reachable
//      today via a failed-payment webhook path even without self-service
//      cancellation; the trigger isn't dead, just rare until that ships)
//   2. trial_reengagement   — trial hospital, 7+ days old, zero OPD/billing
//      activity ever (platform_active_hospitals(since) with since = 30 days
//      ago is equivalent to "ever" for any hospital younger than 30 days)
//   3. activation_nudge     — any hospital 3-14 days old that has never
//      created an OPD token (narrower window so this doesn't nudge forever)
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEDUP_DAYS: Record<string, number> = {
  activation_nudge: 30,
  trial_reengagement: 30,
  win_back: 3650, // effectively once
};

const EMAIL_COPY: Record<string, (hospitalName: string, adminName: string) => { subject: string; html: string }> = {
  activation_nudge: (hospitalName, adminName) => ({
    subject: `Get ${hospitalName} up and running on Aumrti`,
    html: `<div style="font-family:sans-serif;padding:16px;">
<p>Hi ${adminName},</p>
<p>We noticed ${hospitalName} hasn't logged its first OPD token yet. Setting up your first patient visit only takes a couple of minutes — if you'd like a hand getting started, just reply to this email.</p>
<p>— The Aumrti Customer Success Team</p>
</div>`,
  }),
  trial_reengagement: (hospitalName, adminName) => ({
    subject: `Still exploring Aumrti, ${adminName.split(" ")[0] || "there"}?`,
    html: `<div style="font-family:sans-serif;padding:16px;">
<p>Hi ${adminName},</p>
<p>${hospitalName}'s trial is live but we haven't seen any activity yet. If something's blocking you from getting started, or you'd like a walkthrough, we're happy to jump on a quick call.</p>
<p>— The Aumrti Customer Success Team</p>
</div>`,
  }),
  win_back: (hospitalName, adminName) => ({
    subject: `We'd love to have ${hospitalName} back`,
    html: `<div style="font-family:sans-serif;padding:16px;">
<p>Hi ${adminName},</p>
<p>We noticed ${hospitalName}'s Aumrti subscription was cancelled. If that was a mistake, or something didn't work out, we'd genuinely like to hear about it — reply to this email any time.</p>
<p>— The Aumrti Customer Success Team</p>
</div>`,
  }),
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "success@aumrti.health";

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const now = Date.now();

    const { data: hospitals } = await admin
      .from("hospitals")
      .select("id, name, created_at")
      .eq("is_active", true)
      .is("deleted_at", null);

    const { data: subs } = await admin
      .from("hospital_subscriptions")
      .select("hospital_id, status");
    const subByHospital = new Map((subs || []).map((s) => [s.hospital_id, s.status]));

    const { data: activity } = await admin.rpc("platform_active_hospitals", { since: thirtyDaysAgo });
    const opdSet = new Set((activity || []).filter((a: any) => a.has_opd).map((a: any) => a.hospital_id));
    const billSet = new Set((activity || []).filter((a: any) => a.has_billing).map((a: any) => a.hospital_id));

    const results = { scanned: 0, flagged: 0, emailed: 0, skipped_recent: 0, skipped_no_admin_email: 0 };

    for (const h of hospitals || []) {
      results.scanned++;
      const status = subByHospital.get(h.id) || "no_subscription";
      const ageDays = (now - new Date(h.created_at).getTime()) / 86400000;
      const hasOpd = opdSet.has(h.id);
      const hasBilling = billSet.has(h.id);

      let nudgeType: string | null = null;
      if (status === "cancelled") {
        nudgeType = "win_back";
      } else if (status === "trial" && ageDays >= 7 && !hasOpd && !hasBilling) {
        nudgeType = "trial_reengagement";
      } else if (ageDays >= 3 && ageDays <= 14 && !hasOpd) {
        nudgeType = "activation_nudge";
      }
      if (!nudgeType) continue;
      results.flagged++;

      const dedupCutoff = new Date(now - DEDUP_DAYS[nudgeType] * 86400000).toISOString();
      const { data: recent } = await admin
        .from("lifecycle_nudge_actions")
        .select("id")
        .eq("hospital_id", h.id)
        .eq("nudge_type", nudgeType)
        .gte("triggered_at", dedupCutoff)
        .limit(1);
      if (recent && recent.length > 0) { results.skipped_recent++; continue; }

      const { data: adminUser } = await admin
        .from("users")
        .select("email, full_name")
        .eq("hospital_id", h.id)
        .in("role", ["super_admin", "hospital_admin"])
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (!adminUser?.email) {
        await admin.from("lifecycle_nudge_actions").insert({
          hospital_id: h.id, nudge_type: nudgeType, status: "skipped_no_admin_email",
        });
        results.skipped_no_admin_email++;
        continue;
      }

      let status_: "sent" | "failed" = "failed";
      if (resendKey) {
        try {
          const { subject, html } = EMAIL_COPY[nudgeType](h.name, adminUser.full_name || "there");
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: fromEmail, to: [adminUser.email], subject, html }),
          });
          const d = await res.json();
          status_ = d.id ? "sent" : "failed";
        } catch {
          status_ = "failed";
        }
      }

      await admin.from("lifecycle_nudge_actions").insert({
        hospital_id: h.id, nudge_type: nudgeType, recipient_email: adminUser.email, status: status_,
      });
      if (status_ === "sent") results.emailed++;
    }

    return new Response(JSON.stringify(results), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("lifecycle-nudge-scan error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
