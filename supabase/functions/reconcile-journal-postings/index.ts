/**
 * reconcile-journal-postings
 *
 * ONE-TIME data cleanup. Run once after deploying the posted_to_journal column,
 * then disable by removing the function or restricting invocation to no roles.
 *
 * Phases:
 *   Phase 1 — Find final bills whose journal entry already exists (source_id match)
 *             but posted_to_journal is still false. Update the flag.
 *   Phase 2 — Find final bills with no journal entry at all. Try to create one
 *             using auto_posting_rules with trigger_event = 'bill_finalized_opd'
 *             as a generic fallback. If no rule is configured for the hospital,
 *             log to reconciliation_gaps for manual review.
 *
 * Returns a JSON report: { phase1_fixed, phase2_posted, phase2_gaps, errors }
 *
 * Caller must be super_admin or hospital_admin. Uses service role for writes.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY     = Deno.env.get("SUPABASE_ANON_KEY")!;

// Ordered list of trigger events to try when creating a missing journal entry.
// More specific events take precedence; generic OPD is the final fallback.
const FALLBACK_TRIGGER_EVENTS = [
  "bill_finalized_lab",
  "bill_finalized_radiology",
  "bill_finalized_pharmacy",
  "bill_finalized_ot",
  "bill_finalized_dialysis",
  "bill_finalized_dental",
  "bill_finalized_vaccination",
  "bill_finalized_physio",
  "bill_finalized_oncology",
  "bill_finalized_blood_bank",
  "bill_finalized_ayush",
  "bill_finalized_ipd",
  "bill_finalized_opd",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response("Missing Authorization header", { status: 401, headers: corsHeaders });

    const anonClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Auth + role check
    const { data: { user }, error: authErr } = await anonClient.auth.getUser();
    if (authErr || !user) return new Response("Unauthenticated", { status: 401, headers: corsHeaders });

    const { data: userData } = await admin.from("users")
      .select("id, hospital_id, role")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!userData) return new Response("User record not found", { status: 403, headers: corsHeaders });
    if (!["super_admin", "hospital_admin"].includes(userData.role)) {
      return new Response("Forbidden — super_admin or hospital_admin required", { status: 403, headers: corsHeaders });
    }

    const hospitalId = userData.hospital_id;
    const postedBy   = userData.id;
    const year       = new Date().getFullYear();

    const report = {
      phase1_fixed: 0,
      phase2_posted: 0,
      phase2_gaps: 0,
      errors: [] as string[],
    };

    // ── Phase 1: Bills where journal entry already exists ─────────────────────
    // These were posted in-session but the flag was never written.
    // Match: journal_entries.source_id = bills.id (UUID uniqueness ensures safety).

    const { data: alreadyPostedBills } = await admin
      .from("bills")
      .select("id")
      .eq("hospital_id", hospitalId)
      .eq("bill_status", "final")
      .eq("posted_to_journal", false);

    if (alreadyPostedBills && alreadyPostedBills.length > 0) {
      const ids = alreadyPostedBills.map((b: any) => b.id);

      // Find which of these ids have a matching journal entry
      const { data: matchedEntries } = await admin
        .from("journal_entries")
        .select("source_id")
        .eq("hospital_id", hospitalId)
        .in("source_id", ids);

      const matchedIds = new Set((matchedEntries || []).map((e: any) => e.source_id));

      if (matchedIds.size > 0) {
        const { error: flagErr } = await admin
          .from("bills")
          .update({ posted_to_journal: true })
          .eq("hospital_id", hospitalId)
          .in("id", [...matchedIds]);

        if (flagErr) {
          report.errors.push(`Phase 1 flag update failed: ${flagErr.message}`);
        } else {
          report.phase1_fixed = matchedIds.size;
        }
      }

      // Bills with no journal entry — Phase 2 candidates
      const unmatchedIds = ids.filter((id: string) => !matchedIds.has(id));

      if (unmatchedIds.length > 0) {
        // ── Phase 2: Try to create missing journal entries ────────────────────
        // Find the first active auto_posting_rule for this hospital across our
        // fallback trigger event list.

        const { data: rules } = await admin
          .from("auto_posting_rules")
          .select(`
            trigger_event,
            debit_account_id,
            credit_account_id,
            debit_account:chart_of_accounts!auto_posting_rules_debit_account_id_fkey(id, code, name),
            credit_account:chart_of_accounts!auto_posting_rules_credit_account_id_fkey(id, code, name)
          `)
          .eq("hospital_id", hospitalId)
          .eq("is_active", true)
          .in("trigger_event", FALLBACK_TRIGGER_EVENTS);

        // Pick the highest-priority rule available
        let rule: any = null;
        for (const event of FALLBACK_TRIGGER_EVENTS) {
          rule = (rules || []).find((r: any) => r.trigger_event === event);
          if (rule) break;
        }

        // Fetch the unmatched bills with their amounts
        const { data: unmatchedBills } = await admin
          .from("bills")
          .select("id, bill_number, total_amount")
          .eq("hospital_id", hospitalId)
          .in("id", unmatchedIds);

        for (const bill of (unmatchedBills || [])) {
          if (!rule) {
            // No auto_posting_rule configured — log gap for manual review
            await admin.from("audit_log").insert({
              table_name: "bills",
              record_id: bill.id,
              action: "reconciliation_gap",
              new_values: {
                bill_id: bill.id,
                bill_number: bill.bill_number,
                amount: bill.total_amount,
                reason: "No auto_posting_rule configured for this hospital",
              },
              changed_by: user.id,
              hospital_id: hospitalId,
            }).then(() => {});

            report.phase2_gaps++;
            continue;
          }

          try {
            // Generate entry number
            const { data: seqData } = await admin.rpc("next_seq", {
              p_hospital_id: hospitalId,
              p_type: "journal",
            });
            const entryNumber = `JE-${year}-${String(seqData ?? 1).padStart(4, "0")}`;

            // Create journal entry
            const { data: entry, error: entryErr } = await admin
              .from("journal_entries")
              .insert({
                hospital_id: hospitalId,
                entry_number: entryNumber,
                entry_date: new Date().toISOString().split("T")[0],
                description: `Reconciliation: ${bill.bill_number} — auto-posted by reconcile-journal-postings`,
                entry_type: `auto_reconciliation`,
                source_module: "reconciliation",
                source_id: bill.id,
                total_debit: bill.total_amount,
                total_credit: bill.total_amount,
                is_balanced: true,
                posted_by: postedBy,
              })
              .select()
              .maybeSingle();

            if (entryErr || !entry) {
              report.errors.push(`Bill ${bill.bill_number}: journal entry creation failed — ${entryErr?.message}`);
              continue;
            }

            // Create line items
            await admin.from("journal_line_items").insert([
              {
                hospital_id: hospitalId,
                journal_id: entry.id,
                account_id: rule.debit_account_id,
                account_code: rule.debit_account?.code || "",
                account_name: rule.debit_account?.name || "",
                debit_amount: bill.total_amount,
                credit_amount: 0,
                description: `Reconciliation: ${bill.bill_number}`,
              },
              {
                hospital_id: hospitalId,
                journal_id: entry.id,
                account_id: rule.credit_account_id,
                account_code: rule.credit_account?.code || "",
                account_name: rule.credit_account?.name || "",
                debit_amount: 0,
                credit_amount: bill.total_amount,
                description: `Reconciliation: ${bill.bill_number}`,
              },
            ]);

            // Mark posted
            await admin.from("bills")
              .update({ posted_to_journal: true })
              .eq("id", bill.id);

            report.phase2_posted++;
          } catch (billErr: any) {
            report.errors.push(`Bill ${bill.bill_number}: ${billErr.message}`);
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, ...report }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("reconcile-journal-postings fatal:", err);
    return new Response(JSON.stringify({ ok: false, error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
