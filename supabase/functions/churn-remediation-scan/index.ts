// churn-remediation-scan — the first automated action on ChurnRadar's
// health score, which was previously purely observational. Computes the
// same score formula as src/lib/platform-utils.ts computeHealthScore()
// server-side (duplicated deliberately — this runs in Deno via pg_cron, it
// can't import frontend TS, same cross-runtime reason record_online_bill_payment
// mirrors recordBillPayment). For any active/trial hospital scoring below
// 40 that hasn't been remediated in the last 14 days, sends a check-in
// email to its admin and logs the action.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SCORE_THRESHOLD = 40;
const DEDUP_DAYS = 14;

function computeHealthScore(
  status: string,
  createdAt: string,
  hasRecentOpd: boolean,
  hasRecentBilling: boolean
): number {
  const ageDays = (Date.now() - new Date(createdAt).getTime()) / 86400000;

  if (ageDays < 14) {
    const newBase: Record<string, number> = { active: 78, trial: 72, past_due: 30, suspended: 10 };
    return newBase[status] ?? 55;
  }

  let score = 0;
  if (hasRecentOpd) score += 30;
  if (hasRecentBilling) score += 20;

  const statusScore: Record<string, number> = {
    active: 30, trial: 20, past_due: 8, suspended: 0, cancelled: 0, no_subscription: 0,
  };
  score += statusScore[status] ?? 0;

  if (ageDays > 180) score += 20;
  else if (ageDays > 90) score += 15;
  else if (ageDays > 30) score += 10;
  else score += 5;

  return Math.min(100, score);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("FROM_EMAIL") || "success@aumrti.health";

    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
    const dedupCutoff = new Date(Date.now() - DEDUP_DAYS * 86400000).toISOString();

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
      const score = computeHealthScore(status, h.created_at, opdSet.has(h.id), billSet.has(h.id));
      if (score >= SCORE_THRESHOLD) continue;
      results.flagged++;

      const { data: recent } = await admin
        .from("churn_remediation_actions")
        .select("id")
        .eq("hospital_id", h.id)
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
        await admin.from("churn_remediation_actions").insert({
          hospital_id: h.id, score_at_trigger: score, status: "skipped_no_admin_email",
        });
        results.skipped_no_admin_email++;
        continue;
      }

      let status_: "sent" | "failed" = "failed";
      if (resendKey) {
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              from: fromEmail,
              to: [adminUser.email],
              subject: `Checking in on ${h.name}'s Aumrti setup`,
              html: `<div style="font-family:sans-serif;padding:16px;">
<p>Hi ${adminUser.full_name || "there"},</p>
<p>We noticed ${h.name} hasn't been as active on Aumrti recently, and wanted to check in. If you're running into any setup issues, or need a hand getting your team onboarded, just reply to this email — we're happy to help.</p>
<p>— The Aumrti Customer Success Team</p>
</div>`,
            }),
          });
          const d = await res.json();
          status_ = d.id ? "sent" : "failed";
        } catch {
          status_ = "failed";
        }
      }

      await admin.from("churn_remediation_actions").insert({
        hospital_id: h.id, score_at_trigger: score, recipient_email: adminUser.email, status: status_,
      });
      if (status_ === "sent") results.emailed++;
    }

    return new Response(JSON.stringify(results), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("churn-remediation-scan error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
