import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveAiConfig, callAiChat } from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LeakPattern {
  issue: string;
  amount_at_risk: number;
  severity: "critical" | "high" | "medium";
  recommended_action: string;
  department: string;
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

    const sb   = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const anon = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!);

    const { data: { user }, error: authErr } = await anon.auth.getUser(authHeader.replace("Bearer ", ""));
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

    const today    = new Date().toISOString().split("T")[0];
    const week_ago = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const cutoff12h = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();

    // Gather 7-day leakage signals in parallel
    const [
      unbilledLab,
      admissionsNoBill,
      otUnbilled,
      discountsRes,
      latestLeakage,
      billsWithDiscount,
    ] = await Promise.all([
      // Unbilled lab orders older than 12 hours
      sb.from("lab_orders").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("billing_status", "unbilled")
        .lt("created_at", cutoff12h),

      // IPD admissions discharged without final bill
      sb.from("admissions").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("status", "discharged")
        .is("bill_id", null)
        .gte("discharged_at", week_ago + "T00:00:00"),

      // Completed OT cases in last 7 days
      sb.from("ot_schedules").select("id", { count: "exact", head: true })
        .eq("hospital_id", hospitalId)
        .eq("status", "completed")
        .gte("actual_end_time", week_ago + "T00:00:00"),

      // Total discounts given in last 7 days
      sb.from("bill_payments").select("discount_amount")
        .eq("hospital_id", hospitalId)
        .gte("payment_date", week_ago)
        .not("discount_amount", "is", null),

      // Latest leakage scan
      (sb as any).from("leakage_reports")
        .select("*")
        .eq("hospital_id", hospitalId)
        .order("report_date", { ascending: false })
        .limit(1)
        .maybeSingle(),

      // Total billed amount vs discounts ratio
      sb.from("bills").select("total_amount, discount_amount")
        .eq("hospital_id", hospitalId)
        .gte("bill_date", week_ago)
        .not("discount_amount", "is", null),
    ]);

    const totalDiscount = (discountsRes.data || [])
      .reduce((s, r) => s + (Number(r.discount_amount) || 0), 0);
    const totalBilled = (billsWithDiscount.data || [])
      .reduce((s, r) => s + (Number(r.total_amount) || 0), 0);
    const totalBillDiscount = (billsWithDiscount.data || [])
      .reduce((s, r) => s + (Number(r.discount_amount) || 0), 0);
    const discountRate = totalBilled > 0
      ? Math.round((totalBillDiscount / totalBilled) * 100 * 10) / 10
      : 0;
    const leakage = latestLeakage.data;

    const dataSummary = {
      period: `Last 7 days (${week_ago} to ${today})`,
      unbilled_lab_orders_over_12h: unbilledLab.count || 0,
      ipd_discharges_without_final_bill: admissionsNoBill.count || 0,
      completed_ot_cases_in_period: otUnbilled.count || 0,
      total_discounts_given_inr: Math.round(totalDiscount),
      discount_rate_pct: discountRate,
      latest_leakage_scan: leakage ? {
        date: leakage.report_date,
        lab_unbilled: leakage.lab_count,
        radiology_unbilled: leakage.radiology_count,
        pharmacy_ip_unbilled: leakage.pharmacy_count,
        ot_unbilled: leakage.ot_count,
        total_unbilled_items: leakage.total_items,
        estimated_amount_at_risk_inr: leakage.estimated_amount,
      } : null,
    };

    const config = await resolveAiConfig(hospitalId, "revenue_leakage", 700);
    if (!config) {
      return new Response(JSON.stringify({ error: "No AI provider configured. Go to Settings → API Hub." }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const t0 = Date.now();
    const raw = await callAiChat(config, [
      {
        role: "system",
        content:
          "You are a hospital revenue cycle analyst for an Indian hospital. You identify revenue leakage patterns and suggest specific, actionable corrective measures. Always respond with valid JSON only — no markdown, no preamble.",
      },
      {
        role: "user",
        content: `Analyse this hospital revenue data and identify the top 3 revenue leakage patterns.

Data:
${JSON.stringify(dataSummary, null, 2)}

Return JSON exactly as:
{
  "patterns": [
    {
      "issue": "Short title of the leakage pattern",
      "amount_at_risk": 50000,
      "severity": "high",
      "recommended_action": "Specific corrective action",
      "department": "Billing"
    }
  ],
  "total_estimated_leak": 150000,
  "summary": "One sentence overall assessment"
}

Rules:
- severity must be one of: critical, high, medium
- amount_at_risk in INR (integer)
- department options: Billing, Lab, Pharmacy, OT, OPD, Radiology
- Be specific to Indian hospital context`,
      },
    ], 700, 0.2);

    let analysisResult: { patterns: LeakPattern[]; total_estimated_leak: number; summary: string };
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      analysisResult = JSON.parse(jsonMatch?.[0] || raw);
    } catch {
      analysisResult = {
        patterns: [{
          issue: "Analysis parse error — raw data available below",
          amount_at_risk: leakage?.estimated_amount || 0,
          severity: "medium",
          recommended_action: "Re-run analysis or check leakage scanner manually",
          department: "Billing",
        }],
        total_estimated_leak: leakage?.estimated_amount || 0,
        summary: "AI analysis encountered a parsing error. Please retry.",
      };
    }

    const latencyMs = Date.now() - t0;

    await (sb as any).from("ai_feature_logs").insert({
      hospital_id:    hospitalId,
      module:         "analytics",
      feature_key:    "revenue_leak_detector",
      success:        true,
      input_summary:  JSON.stringify(dataSummary).slice(0, 100),
      output_summary: (analysisResult.summary || "").slice(0, 100),
      latency_ms:     latencyMs,
    });

    return new Response(
      JSON.stringify({ ...analysisResult, data_summary: dataSummary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("ai-revenue-leak-detector error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Analysis failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
