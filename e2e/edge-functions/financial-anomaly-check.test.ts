/**
 * Phase 6, Priority 2 (Money) — financial-anomaly-check.
 *
 * Auth/isolation are correctly built (server-resolved hospital_id, no cross-hospital
 * parameter accepted at all — the function only ever analyses the caller's own hospital).
 * The real bug found writing this test: `.upsert(...).catch(() => {})` directly on the
 * Supabase query-builder chain — the same non-existent-.catch() defect as KNOWN-BUG-172
 * (generate-invoice) — threw synchronously and discarded the whole response with a 500
 * exactly when the function found real anomalies to report (the entire point of the feature).
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenAdminA = "";
const journalEntryIds: string[] = [];
const REVENUE_ACCOUNT_CODE = "4001";

if (runtimeUp) {
  tokenAdminA = await tokenFor("a", "hospital_admin");
  const svc = serviceClient();

  const { data: account } = await svc
    .from("chart_of_accounts")
    .select("id, code")
    .eq("hospital_id", HOSPITAL_A.id)
    .eq("code", REVENUE_ACCOUNT_CODE)
    .maybeSingle();
  if (!account) throw new Error(`Seeded revenue account ${REVENUE_ACCOUNT_CODE} not found for HOSPITAL_A`);

  // 9 days of ~₹10,000 "normal" revenue, plus one day at ₹95,000 — a clear statistical spike
  // no threshold-tuning is needed to catch (z >= 2.5 on a tight, low-variance baseline).
  const amounts = [10000, 10200, 9800, 10100, 9900, 10050, 9950, 95000, 10000];
  for (let i = 0; i < amounts.length; i++) {
    const day = new Date(Date.now() - (amounts.length - i) * 24 * 60 * 60 * 1000);
    const dayIso = day.toISOString();

    const { data: entry, error: entryErr } = await svc
      .from("journal_entries")
      .insert({
        hospital_id: HOSPITAL_A.id,
        entry_number: `ANOMALY-JE-${Date.now()}-${i}`,
        entry_date: dayIso.slice(0, 10),
        description: "Fixture entry for financial-anomaly-check test",
        total_debit: amounts[i],
        total_credit: amounts[i],
        is_balanced: true,
        created_at: dayIso,
      })
      .select("id").single();
    if (entryErr) throw new Error(`Could not create journal entry fixture: ${entryErr.message}`);
    journalEntryIds.push(entry.id);

    const { error: lineErr } = await svc.from("journal_line_items").insert({
      hospital_id: HOSPITAL_A.id,
      journal_id: entry.id,
      account_id: account.id,
      account_code: account.code,
      account_name: "Fixture Revenue",
      debit_amount: 0,
      credit_amount: amounts[i],
      created_at: dayIso,
    });
    if (lineErr) throw new Error(`Could not create journal line item fixture: ${lineErr.message}`);
  }
}

afterAll(async () => {
  if (!runtimeUp || journalEntryIds.length === 0) return;
  const svc = serviceClient();
  await svc.from("journal_line_items").delete().in("journal_id", journalEntryIds);
  await svc.from("journal_entries").delete().in("id", journalEntryIds);
  await svc.from("financial_anomalies").delete().eq("hospital_id", HOSPITAL_A.id).gte("actual_revenue", 90000);
});

describe.skipIf(!runtimeUp)("financial-anomaly-check", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("financial-anomaly-check", { token: null, body: {} });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("financial-anomaly-check", { token: "garbage", body: {} });
    expect(res.status).toBe(401);
  });

  it("3. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("financial-anomaly-check", { token: tokenAdminA, rawBody: "{bad" });
    // This function doesn't even read the body (it only uses the caller's own hospital_id),
    // so malformed JSON should not affect it either way — asserting it never surfaces a
    // stack trace regardless.
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("4. a valid request detects the real spike day and persists it — the regression test for the .catch()-crash bug", async () => {
    const res = await callFunction("financial-anomaly-check", { token: tokenAdminA, body: {} });
    expect(res.status).toBe(200);
    expect(res.json.days_analyzed).toBeGreaterThanOrEqual(7);
    expect(res.json.anomalies.length).toBeGreaterThanOrEqual(1);
    const spike = res.json.anomalies.find((a: any) => a.direction === "spike");
    expect(spike).toBeTruthy();
    expect(spike.actual).toBe(95000);
    expect(spike.z_score).toBeGreaterThanOrEqual(2.5);

    // Before the fix, reaching this line at all (a 200 with the anomalies array intact)
    // never happened whenever anomalies.length > 0 — the persist step crashed the response.
    const svc = serviceClient();
    const { data: persisted } = await svc
      .from("financial_anomalies")
      .select("actual_revenue, direction")
      .eq("hospital_id", HOSPITAL_A.id)
      .eq("actual_revenue", 95000)
      .maybeSingle();
    expect(persisted?.direction).toBe("spike");
  });
});
