/**
 * Phase 6, AI-function plumbing — ai-nabh-indicator-alert.
 *
 * Already correctly gated by Phase 4 (KNOWN-BUG-126: cron-secret OR service-role key OR a
 * real aumrti_admin — never a bare authenticated user, since the no-hospital_id path scans
 * every tenant).
 *
 * Two bugs found and fixed writing this test:
 * (a) KNOWN-BUG-200: the resolveAiConfig() call sat outside this function's own try/catch
 *     that exists to degrade gracefully to deterministic fallback text on any AI failure, so
 *     one hospital's disabled-AI flag aborted the entire batch scan for every hospital
 *     processed after it;
 * (b) a new finding, logged as KNOWN-BUG-201: `alert_type: "nabh_qi_anomaly"` was never in
 *     clinical_alerts_alert_type_check despite being the real, actively-used vocabulary
 *     (NABHQIAlertCard.tsx filters and realtime-subscribes on this exact string) — every
 *     insert has always silently violated the CHECK constraint (the error was never
 *     checked), so this dashboard widget has never once received a real alert.
 *
 * No CRON_SECRET is configured in this local environment, so the pg_cron invocation path is
 * not independently tested here — only the service-role and real-admin paths, which are the
 * two the manual/on-demand invocation actually uses.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, LOCAL_SERVICE_ROLE_KEY, serviceClient, tenantClient } from "../fixtures/serviceClient";
import { HOSPITAL_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const ADMIN_EMAIL = "phase6-fixture-nabh-indicator-admin@example.test";
const ADMIN_PASSWORD = "aumrti-e2e-local-only";
let adminAuthUserId = "";
let adminToken = "";
let tokenA = "";

async function callAlert(auth: string | null, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/ai-nabh-indicator-alert`, {
    method: "POST", headers, body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

if (runtimeUp) {
  const svc = serviceClient();
  const { data: existing } = await svc.auth.admin.listUsers();
  const stale = existing?.users?.find((u) => u.email === ADMIN_EMAIL);
  if (stale) {
    const { data: staleRow } = await svc.from("aumrti_admins").select("id").eq("auth_user_id", stale.id).maybeSingle();
    if (staleRow) await svc.from("admin_audit_log").delete().eq("admin_id", staleRow.id);
    await svc.from("aumrti_admins").delete().eq("auth_user_id", stale.id);
    await svc.auth.admin.deleteUser(stale.id);
  }
  const { data: created, error: createErr } = await svc.auth.admin.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, email_confirm: true });
  if (createErr || !created?.user) throw new Error(`Could not create fixture admin: ${createErr?.message}`);
  adminAuthUserId = created.user.id;
  await svc.from("aumrti_admins").insert({ auth_user_id: adminAuthUserId, full_name: "Phase6 Fixture NABH Admin", email: ADMIN_EMAIL, is_active: true });

  const client = await tenantClient(ADMIN_EMAIL, ADMIN_PASSWORD);
  const { data: { session } } = await client.auth.getSession();
  adminToken = session!.access_token;

  tokenA = await tokenFor("a", "hospital_admin");

  // A genuine, sharp worsening deviation (10 -> 50, lower_is_better) so the function's own
  // detection logic — not a fabricated response — decides this is a real anomaly worth
  // alerting on, exercising the actual insert path this test is about.
  await svc.from("quality_indicators").delete().eq("hospital_id", HOSPITAL_A.id).eq("indicator_code", "PHASE6_TEST_QI");
  const currentPeriod = new Date(); currentPeriod.setDate(1);
  const rows = [0, 1, 2, 3].map((monthsAgo) => {
    const d = new Date(currentPeriod); d.setMonth(d.getMonth() - monthsAgo);
    return {
      hospital_id: HOSPITAL_A.id,
      indicator_name: "Phase6 Fixture Indicator",
      indicator_code: "PHASE6_TEST_QI",
      value: monthsAgo === 0 ? 50 : 10,
      unit: "%",
      direction: "lower_is_better",
      period: "monthly",
      period_start: d.toISOString().slice(0, 10),
    };
  });
  await svc.from("quality_indicators").insert(rows);
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("quality_indicators").delete().eq("hospital_id", HOSPITAL_A.id).eq("indicator_code", "PHASE6_TEST_QI");
  await svc.from("clinical_alerts").delete().eq("hospital_id", HOSPITAL_A.id).eq("alert_type", "nabh_qi_anomaly");
  const { data: adminRow } = await svc.from("aumrti_admins").select("id").eq("auth_user_id", adminAuthUserId).maybeSingle();
  if (adminRow) await svc.from("admin_audit_log").delete().eq("admin_id", adminRow.id);
  await svc.from("aumrti_admins").delete().eq("auth_user_id", adminAuthUserId);
  if (adminAuthUserId) await svc.auth.admin.deleteUser(adminAuthUserId);
});

describe.skipIf(!runtimeUp)("ai-nabh-indicator-alert", () => {
  it("1. no Authorization header is rejected", async () => {
    const res = await callAlert(null);
    expect(res.status).toBe(401);
  });

  it("2. an ordinary hospital staff member (not an aumrti_admin) is rejected", async () => {
    const res = await callAlert(`Bearer ${tokenA}`);
    expect(res.status).toBe(401);
  });

  it("3. the real service-role secret is accepted, genuinely detects the seeded anomaly, and now genuinely persists the alert — the regression test for both fixes (CHECK-constraint violation and the batch-aborting AIDisabledError were both silent before today)", async () => {
    const res = await callAlert(`Bearer ${LOCAL_SERVICE_ROLE_KEY}`, { hospital_id: HOSPITAL_A.id });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    const hospSummary = res.json.summary.find((s: any) => s.hospital === HOSPITAL_A.name);
    expect(hospSummary?.anomalies).toBeGreaterThan(0);
    expect(hospSummary?.inserted).toBeGreaterThan(0);

    const svc = serviceClient();
    const { data: alerts } = await svc.from("clinical_alerts").select("indicator_code, alert_message, severity").eq("hospital_id", HOSPITAL_A.id).eq("alert_type", "nabh_qi_anomaly").eq("indicator_code", "PHASE6_TEST_QI");
    expect(alerts!.length).toBeGreaterThan(0); // before the fix, this insert always violated the CHECK constraint
    expect(alerts![0].alert_message).toBeTruthy();
  });

  it("4. a real aumrti_admin is also accepted for manual invocation, and the same-period dedupe correctly skips re-alerting the indicator test 3 already raised", async () => {
    const res = await callAlert(`Bearer ${adminToken}`, { hospital_id: HOSPITAL_A.id });
    expect(res.status).toBe(200);
    expect(res.json.ok).toBe(true);
    const hospSummary = res.json.summary.find((s: any) => s.hospital === HOSPITAL_A.name);
    expect(hospSummary?.inserted).toBe(0); // already alerted this period by test 3 — correct dedupe, not a bug
  });
});
