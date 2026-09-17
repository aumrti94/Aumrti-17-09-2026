/**
 * Phase 6, Priority 2 (Money) — daily-leakage-scan.
 *
 * Auth already fixed in Phase 4 (KNOWN-BUG-126): the no-body cron path scanned every hospital
 * on the platform with no token at all, and the body-scoped path let any authenticated user of
 * any hospital name another hospital's id. Proves that fix live, plus a new gap found and
 * fixed in this pass: the in-app clinical_alerts notification used alert_type =
 * 'leakage_detected', a value clinical_alerts_alert_type_check has never allowed (missed even
 * by this same phase's earlier KNOWN-BUG-135 fix) — the insert's error was never checked, so
 * every scan has silently failed to create the alert a hospital's own billing staff are meant
 * to see, while still reporting ok:true.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenBillingA = "";
let tokenBillingB = "";
let staleLabOrderId = "";

if (runtimeUp) {
  [tokenBillingA, tokenBillingB] = await Promise.all([tokenFor("a", "billing_executive"), tokenFor("b", "billing_executive")]);
  const svc = serviceClient();
  // 24h old — past the 12h ancillary grace window (leakageCutoffs / ANCILLARY_GRACE_HOURS),
  // so this is real, deterministic leakage the scan must find.
  const staleCreatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await svc
    .from("lab_orders")
    .insert({
      hospital_id: HOSPITAL_A.id, patient_id: PATIENTS_A[0].id,
      ordered_by: (await svc.from("users").select("id").eq("hospital_id", HOSPITAL_A.id).eq("role", "doctor").limit(1).maybeSingle()).data?.id,
      billing_status: "unbilled", created_at: staleCreatedAt,
    })
    .select("id").single();
  if (error) throw new Error(`Could not create stale lab_order fixture: ${error.message}`);
  staleLabOrderId = data.id;
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  if (staleLabOrderId) await svc.from("lab_orders").delete().eq("id", staleLabOrderId);
  await svc.from("clinical_alerts").delete().eq("hospital_id", HOSPITAL_A.id).eq("alert_type", "leakage_detected");
  await svc.from("leakage_reports").delete().eq("hospital_id", HOSPITAL_A.id);
});

describe.skipIf(!runtimeUp)("daily-leakage-scan", () => {
  it("1. a non-cron caller with no hospital_id in the body is rejected", async () => {
    const res = await callFunction("daily-leakage-scan", { token: tokenBillingA, body: {} });
    expect(res.status).toBe(401);
  });

  it("2. a non-cron caller with no Authorization at all is rejected even naming a hospital_id", async () => {
    const res = await callFunction("daily-leakage-scan", { token: null, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(401);
  });

  it("3. cross-hospital: hospital B's billing staff cannot trigger a scan naming hospital A's id", async () => {
    const res = await callFunction("daily-leakage-scan", { token: tokenBillingB, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(403);
  });

  it("4. a billing user's own hospital scan succeeds, finds the real stale lab order, and its in-app alert is now genuinely persisted", async () => {
    const res = await callFunction("daily-leakage-scan", { token: tokenBillingA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.leakage_count).toBeGreaterThanOrEqual(1);
    expect(res.json.hospitals).toHaveLength(1);
    expect(res.json.hospitals[0].hospital_id).toBe(HOSPITAL_A.id);

    // The regression test: this insert has always silently failed before this pass's fix.
    const svc = serviceClient();
    const { data: alerts } = await svc
      .from("clinical_alerts")
      .select("severity, alert_message")
      .eq("hospital_id", HOSPITAL_A.id)
      .eq("alert_type", "leakage_detected");
    expect((alerts ?? []).length).toBeGreaterThanOrEqual(1);
    expect(["high", "critical"]).toContain(alerts![0].severity);
  });

  it("5. the internal cron path (real service-role secret, no body) scans across hospitals without a user session", async () => {
    const res = await callFunction("daily-leakage-scan", { token: LOCAL_SERVICE_ROLE_KEY, rawBody: "" });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    expect(res.json.hospitals.length).toBeGreaterThanOrEqual(1);
  });
});
