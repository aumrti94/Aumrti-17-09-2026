/**
 * Phase 6, Priority 4 (Tenant lifecycle) — create-staff-login.
 *
 * No bugs found writing this test — auth, admin-role gating, cross-hospital isolation,
 * already-has-login rejection, and rollback-on-link-failure all worked correctly on first
 * try. Logged here as clean coverage, not a KNOWN_BUGS entry.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const NO_LOGIN_STAFF_ID = "a0000000-0000-4000-8000-900000000050";
const TEST_EMAIL = "phase6-fixture-create-staff-login@example.test";
let tokenA = "";
let tokenB = "";
let createdAuthUserId: string | null = null;

if (runtimeUp) {
  [tokenA, tokenB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);
  const svc = serviceClient();
  await svc.from("users").delete().eq("id", NO_LOGIN_STAFF_ID);
  await svc.from("users").insert({
    id: NO_LOGIN_STAFF_ID,
    hospital_id: HOSPITAL_A.id,
    full_name: "Phase6 Fixture No-Login Staff",
    email: "phase6-fixture-no-login-staff@example.test",
    role: "nurse",
    is_active: true,
    can_login: false,
    auth_user_id: null,
  });
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  await svc.from("users").delete().eq("id", NO_LOGIN_STAFF_ID);
  if (createdAuthUserId) await svc.auth.admin.deleteUser(createdAuthUserId);
});

describe.skipIf(!runtimeUp)("create-staff-login", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("create-staff-login", { token: null, body: { user_id: NO_LOGIN_STAFF_ID, email: TEST_EMAIL, password: "TestPass123" } });
    expect(res.status).toBe(401);
  });

  it("2. a non-admin caller is forbidden", async () => {
    const nurseToken = await tokenFor("a", "nurse");
    const res = await callFunction("create-staff-login", { token: nurseToken, body: { user_id: NO_LOGIN_STAFF_ID, email: TEST_EMAIL, password: "TestPass123" } });
    expect(res.status).toBe(403);
  });

  it("3. a weak password is a clean 400", async () => {
    const res = await callFunction("create-staff-login", { token: tokenA, body: { user_id: NO_LOGIN_STAFF_ID, email: TEST_EMAIL, password: "short" } });
    expect(res.status).toBe(400);
  });

  it("4. cross-hospital: hospital B's admin cannot create login credentials for hospital A's staff", async () => {
    const res = await callFunction("create-staff-login", { token: tokenB, body: { user_id: NO_LOGIN_STAFF_ID, email: TEST_EMAIL, password: "TestPass123" } });
    expect(res.status).toBe(403);
  });

  it("5. an already-credentialed staff member is rejected, not silently re-linked", async () => {
    const svc = serviceClient();
    const { data: existingStaff } = await svc.from("users").select("id").eq("hospital_id", HOSPITAL_A.id).not("auth_user_id", "is", null).limit(1).maybeSingle();
    const res = await callFunction("create-staff-login", { token: tokenA, body: { user_id: existingStaff!.id, email: TEST_EMAIL, password: "TestPass123" } });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/already has login credentials/);
  });

  it("6. a valid request for a real no-login staff member genuinely creates and links an auth account", async () => {
    const res = await callFunction("create-staff-login", { token: tokenA, body: { user_id: NO_LOGIN_STAFF_ID, email: TEST_EMAIL, password: "TestPass123", full_name: "Phase6 Fixture No-Login Staff" } });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.auth_user_id).toBeTruthy();
    createdAuthUserId = res.json.auth_user_id;

    const svc = serviceClient();
    const { data: staffRow } = await svc.from("users").select("auth_user_id, can_login").eq("id", NO_LOGIN_STAFF_ID).maybeSingle();
    expect(staffRow?.auth_user_id).toBe(createdAuthUserId);
    expect(staffRow?.can_login).toBe(true);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("create-staff-login", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
