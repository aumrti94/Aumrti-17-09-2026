import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface DailyRevenue {
  date: string;
  revenue: number;
}

interface Anomaly {
  date: string;
  actual: number;
  expected: number;
  z_score: number;
  deviation: number; // actual - expected in ₹
  direction: "spike" | "drop";
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const anon = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
    );

    const { data: { user }, error: authErr } = await anon.auth.getUser(
      authHeader.replace("Bearer ", ""),
    );
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userRow } = await sb
      .from("users").select("hospital_id").eq("auth_user_id", user.id).maybeSingle();
    const hospitalId = userRow?.hospital_id as string | null;
    if (!hospitalId) {
      return new Response(JSON.stringify({ error: "Hospital not found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Query last 60 days of daily revenue (revenue = credit on account codes starting with "4")
    const since60d = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    const { data: lineItems } = await sb
      .from("journal_line_items")
      .select("account_code, credit_amount, created_at")
      .eq("hospital_id", hospitalId)
      .gte("created_at", since60d)
      .not("account_code", "is", null);

    if (!lineItems || lineItems.length === 0) {
      return new Response(JSON.stringify({ anomalies: [], days_analyzed: 0, message: "No financial data found for the last 60 days." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Aggregate daily revenue (only revenue accounts: code starting with "4")
    const dailyMap: Record<string, number> = {};
    for (const item of lineItems) {
      if (!item.account_code?.startsWith("4")) continue;
      const day = item.created_at?.slice(0, 10);
      if (!day) continue;
      dailyMap[day] = (dailyMap[day] || 0) + Number(item.credit_amount || 0);
    }

    const dailyRevenues: DailyRevenue[] = Object.entries(dailyMap)
      .map(([date, revenue]) => ({ date, revenue }))
      .sort((a, b) => a.date.localeCompare(b.date));

    if (dailyRevenues.length < 7) {
      return new Response(JSON.stringify({ anomalies: [], days_analyzed: dailyRevenues.length, message: "Need at least 7 days of data to detect anomalies." }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Compute mean and std dev (population)
    const values = dailyRevenues.map(d => d.revenue);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
    const stddev = Math.sqrt(variance);

    // Flag anomalies: |z_score| > 2.5 (roughly 99th percentile)
    const THRESHOLD = 2.5;
    const anomalies: Anomaly[] = [];
    for (const d of dailyRevenues) {
      if (stddev === 0) continue;
      const z = (d.revenue - mean) / stddev;
      if (Math.abs(z) >= THRESHOLD) {
        anomalies.push({
          date: d.date,
          actual: d.revenue,
          expected: mean,
          z_score: Math.round(z * 100) / 100,
          deviation: Math.round(d.revenue - mean),
          direction: d.revenue > mean ? "spike" : "drop",
        });
      }
    }

    // Optionally persist to financial_anomalies table (best-effort, table may not exist yet).
    // Was `.upsert(...).catch(() => {})` directly on the query builder — supabase-js's
    // PostgrestBuilder is thenable (implements .then()) but does not implement a real
    // .catch(), so `X.catch` is undefined and calling it throws a TypeError SYNCHRONOUSLY,
    // before the intended "non-blocking, ignore failure" behaviour ever runs. That throw
    // propagated to this function's outer catch and returned 500 to the caller — discarding
    // the anomalies array this function had already correctly computed. The bug fired
    // precisely when the feature had something to report (anomalies.length > 0) and was
    // invisible the rest of the time (no anomalies → this branch never runs). Same root cause
    // as KNOWN-BUG-172 (generate-invoice). Found via Phase 6 edge-function testing.
    if (anomalies.length > 0) {
      try {
        const { error: upsertErr } = await (sb as any).from("financial_anomalies").upsert(
          anomalies.map(a => ({
            hospital_id: hospitalId,
            anomaly_date: a.date,
            actual_revenue: a.actual,
            expected_revenue: a.expected,
            z_score: a.z_score,
            deviation_amount: a.deviation,
            direction: a.direction,
            detected_at: new Date().toISOString(),
          })),
          { onConflict: "hospital_id,anomaly_date", ignoreDuplicates: false },
        );
        if (upsertErr) console.error("financial-anomaly-check: persisting anomalies failed:", upsertErr.message);
      } catch (e) {
        console.error("financial-anomaly-check: persisting anomalies failed:", e instanceof Error ? e.message : String(e));
      }
    }

    return new Response(
      JSON.stringify({
        anomalies,
        days_analyzed: dailyRevenues.length,
        mean_daily_revenue: Math.round(mean),
        stddev: Math.round(stddev),
        threshold_z: THRESHOLD,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (err) {
    console.error("financial-anomaly-check error:", err instanceof Error ? err.message : String(err));
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
