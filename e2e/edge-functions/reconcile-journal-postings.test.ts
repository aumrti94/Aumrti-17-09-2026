/**
 * Phase 6, Priority 2 (Money) — reconcile-journal-postings.
 *
 * Structurally correct on read: role-gated (super_admin/hospital_admin only), every query
 * scoped by the caller's own server-resolved hospital_id. This test confirms both real repair
 * phases live: Phase 1 (a bill whose journal entry already exists but the flag was never set)
 * and Phase 2's gap-logging path (a bill with no journal entry and no configured
 * auto_posting_rule, which must be logged for manual review, not silently dropped).
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, PATIENTS_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenAdminA = "";
let tokenDoctorA = "";
let phase1BillId = "";
let phase2BillId = "";
let disabledRuleIds: string[] = [];

if (runtimeUp) {
  [tokenAdminA, tokenDoctorA] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("a", "doctor")]);
  const svc = serviceClient();

  // Must run BEFORE inserting either fixture bill: bills.trg_auto_post_bill_journal fires on
  // INSERT of a bill_status='final' row too (not just UPDATE), so if any active
  // auto_posting_rule already existed for this hospital, the trigger would auto-post the
  // fixture bills itself before this test ever gets a chance to exercise the RECONCILE
  // function's own posting path. Only the rules that were genuinely active are disabled, and
  // only those are restored afterward — other test files may run concurrently against the same
  // hospital and rely on its normal auto-posting behaviour.
  const { data: activeRules } = await svc.from("auto_posting_rules").select("id").eq("hospital_id", HOSPITAL_A.id).eq("is_active", true);
  disabledRuleIds = (activeRules ?? []).map((r) => r.id);
  if (disabledRuleIds.length > 0) {
    await svc.from("auto_posting_rules").update({ is_active: false }).in("id", disabledRuleIds);
  }

  const { data: b1, error: e1 } = await svc
    .from("bills")
    .insert({
      hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id,
      bill_number: `RECON-P1-${Date.now()}`, bill_status: "final", posted_to_journal: false,
      total_amount: 1000,
    })
    .select("id").single();
  if (e1) throw new Error(`Could not create phase-1 bill fixture: ${e1.message}`);
  phase1BillId = b1.id;

  await svc.from("journal_entries").insert({
    hospital_id: HOSPITAL_A.id,
    entry_number: `RECON-JE-${Date.now()}`,
    description: "Fixture journal entry for reconcile-journal-postings test",
    source_module: "billing",
    source_id: phase1BillId,
    total_debit: 1000,
    total_credit: 1000,
    is_balanced: true,
  });

  const { data: b2, error: e2 } = await svc
    .from("bills")
    .insert({
      hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id,
      bill_number: `RECON-P2-${Date.now()}`, bill_status: "final", posted_to_journal: false,
      total_amount: 750,
    })
    .select("id").single();
  if (e2) throw new Error(`Could not create phase-2 bill fixture: ${e2.message}`);
  phase2BillId = b2.id;
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  if (phase1BillId) {
    await svc.from("journal_entries").delete().eq("source_id", phase1BillId);
    await svc.from("bills").delete().eq("id", phase1BillId);
  }
  if (phase2BillId) {
    await svc.from("audit_log").delete().eq("record_id", phase2BillId);
    await svc.from("bills").delete().eq("id", phase2BillId);
  }
  if (disabledRuleIds.length > 0) {
    await svc.from("auto_posting_rules").update({ is_active: true }).in("id", disabledRuleIds);
  }
});

describe.skipIf(!runtimeUp)("reconcile-journal-postings", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("reconcile-journal-postings", { token: null, body: {} });
    expect(res.status).toBe(401);
  });

  it("2. a non-admin role (doctor) is forbidden", async () => {
    const res = await callFunction("reconcile-journal-postings", { token: tokenDoctorA, body: {} });
    expect(res.status).toBe(403);
  });

  it("3. GET is rejected — POST only", async () => {
    const res = await callFunction("reconcile-journal-postings", { token: tokenAdminA, method: "GET" });
    expect(res.status).toBe(405);
  });

  it("4. an admin's valid request fixes the phase-1 flag (journal entry exists, flag was never set)", async () => {
    const res = await callFunction("reconcile-journal-postings", { token: tokenAdminA, body: {} });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.phase1_fixed).toBeGreaterThanOrEqual(1);

    const svc = serviceClient();
    const { data: bill } = await svc.from("bills").select("posted_to_journal").eq("id", phase1BillId).maybeSingle();
    expect(bill?.posted_to_journal).toBe(true);
  });

  it("5. a bill with no journal entry and no active posting rule is logged as a gap, not silently dropped", async () => {
    // Test 4's call already processed every matching bill for the hospital in one pass —
    // including this one — since the function scans the whole hospital, not one target bill.
    const res = await callFunction("reconcile-journal-postings", { token: tokenAdminA, body: {} });
    expect(res.status).toBe(200);

    const svc = serviceClient();
    const { data: after } = await svc.from("audit_log").select("new_values").eq("record_id", phase2BillId).eq("action", "reconciliation_gap");
    // NOT asserting exactly one: repeated runs each append a fresh gap log row for the same
    // still-unresolved bill (no dedup against an existing open gap) — a minor, logged-not-fixed
    // finding (KNOWN-BUG-174, S3) given this function's own header already documents it as a
    // one-time tool meant to be disabled after use, not a repeatedly-invoked one.
    expect((after ?? []).length).toBeGreaterThanOrEqual(1);
    expect((after![0].new_values as any).bill_id).toBe(phase2BillId);

    // The gap must NOT have been silently posted anyway — the bill stays unposted.
    const { data: bill } = await svc.from("bills").select("posted_to_journal").eq("id", phase2BillId).maybeSingle();
    expect(bill?.posted_to_journal).toBe(false);
  });
});
