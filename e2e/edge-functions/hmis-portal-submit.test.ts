/**
 * Phase 6, Priority 3 (Statutory/external) — hmis-portal-submit.
 *
 * One bug found and fixed writing this test, logged as KNOWN-BUG-190: the caller-hospital
 * lookup used `.eq("id", caller.id)` — but public.users.id and auth.users.id (what caller.id
 * is) diverged at migration 20260322111223, so this matched zero rows for any account
 * created since, and every real staff member got a false 403 "Forbidden". The Tier-0 seed
 * fixture deliberately sets auth_user_id different from id for exactly this reason (see the
 * tenant-isolation-testing skill) — a real seeded staff account catches this immediately.
 *
 * A deliberately-bogus portal_url in the fixture credentials means the outbound MoHFW IHIP
 * calls fail fast and deterministically, landing on the function's own real
 * "portal_unavailable" fallback branch — exercising the actual submission logic without
 * depending on a real government portal being reachable.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const REPORT_ID = "a0000000-0000-4000-8000-900000000030";
let tokenA = "";

if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");

  const svc = serviceClient();
  await svc.from("hmis_reports").delete().eq("id", REPORT_ID);
  await svc.from("api_configurations").delete().eq("hospital_id", HOSPITAL_A.id).eq("service_key", "hmis_portal");

  await svc.from("hmis_reports").insert({
    id: REPORT_ID,
    hospital_id: HOSPITAL_A.id,
    report_type: "monthly_hmis",
    period_year: 2026,
    period_month: 8,
    status: "draft",
    report_data: { opd_visits: 120 },
  });
  await svc.from("api_configurations").insert({
    hospital_id: HOSPITAL_A.id,
    service_name: "HMIS Portal",
    service_key: "hmis_portal",
    is_active: true,
    config: {
      hin_code: "PHASE6FIXTUREHIN",
      facility_code: "PHASE6FIXTUREFAC",
      username: "phase6-fixture",
      password: "not-a-real-secret",
      portal_url: "https://127.0.0.1:1", // deliberately unreachable — deterministic "portal_unavailable"
    },
  });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("hmis_reports").delete().eq("id", REPORT_ID);
  await svc.from("api_configurations").delete().eq("hospital_id", HOSPITAL_A.id).eq("service_key", "hmis_portal");
});

describe.skipIf(!runtimeUp)("hmis-portal-submit", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("hmis-portal-submit", { token: null, body: { reportId: REPORT_ID } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("hmis-portal-submit", { token: "garbage", body: { reportId: REPORT_ID } });
    expect(res.status).toBe(401);
  });

  it("3. missing reportId is a clean 400", async () => {
    const res = await callFunction("hmis-portal-submit", { token: tokenA, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. a real seeded staff account is correctly recognised — the regression test for the auth_user_id fix (the old code 403'd every real account here)", async () => {
    const res = await callFunction("hmis-portal-submit", { token: tokenA, body: { reportId: REPORT_ID } });
    expect(res.status).not.toBe(403);
  });

  it("5. an unreachable portal is handled honestly as portal_unavailable in the response, and the report is genuinely updated — the regression test for the trigger-rejected status value", async () => {
    const res = await callFunction("hmis-portal-submit", { token: tokenA, body: { reportId: REPORT_ID } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.status).toBe("portal_unavailable"); // API response's own descriptive value

    const svc = serviceClient();
    const { data: report } = await svc.from("hmis_reports").select("status, submitted_at").eq("id", REPORT_ID).maybeSingle();
    // The DB column only accepts draft/generated/submitted/accepted (enforced by a trigger) —
    // "generated" is what HMISPage.tsx's own filtering already treats as "still needs
    // submission," matching this outcome. Before the fix, this update always failed the
    // trigger silently and the report stayed stuck at "draft" forever.
    expect(report?.status).toBe("generated");
    expect(report?.submitted_at).toBeTruthy();
  });

  it("6. an unknown reportId is a clean 404", async () => {
    const res = await callFunction("hmis-portal-submit", { token: tokenA, body: { reportId: "00000000-0000-0000-0000-000000000000" } });
    expect(res.status).toBe(404);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("hmis-portal-submit", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
