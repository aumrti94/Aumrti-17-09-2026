// mrr-snapshot-job — populates mrr_snapshots once a month (1st of month,
// scheduled via pg_cron). This is what lets compute_dollar_nrr() eventually
// report real dollar-weighted NRR — hospital_subscriptions only stores the
// CURRENT price, so without a running snapshot history there is no way to
// know what a hospital was paying 12 months ago. Snapshots every hospital
// with a subscription row, not just active ones: a cancelled hospital gets
// mrr_amount = 0 for that month, which is exactly what NRR's numerator
// needs to correctly reflect churn.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const now = new Date();
    const snapshotMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;

    const { data: subs } = await admin
      .from("hospital_subscriptions")
      .select("hospital_id, status, plan_id, subscription_plans(price_monthly)");

    let written = 0;
    for (const s of subs || []) {
      const mrrAmount = s.status === "active" ? Number((s as any).subscription_plans?.price_monthly) || 0 : 0;
      const { error } = await admin.from("mrr_snapshots").upsert(
        {
          hospital_id: s.hospital_id,
          snapshot_month: snapshotMonth,
          mrr_amount: mrrAmount,
          status: s.status,
          plan_id: s.plan_id,
        },
        { onConflict: "hospital_id,snapshot_month" }
      );
      if (!error) written++;
    }

    return new Response(JSON.stringify({ snapshotMonth, scanned: (subs || []).length, written }), {
      headers: { ...CORS, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("mrr-snapshot-job error:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" },
    });
  }
});
