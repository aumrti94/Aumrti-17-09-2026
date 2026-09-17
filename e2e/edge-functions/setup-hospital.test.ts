/**
 * Phase 6, Priority 4 (Tenant lifecycle) — setup-hospital.
 *
 * No caller of this function exists anywhere in src/ (confirmed by grep) — it appears to be
 * provisioning infrastructure never wired to a UI flow, alongside register-hospital (the
 * function the real /register wizard actually calls). Its bugs are therefore latent, not
 * currently causing live harm, but real if this function is ever invoked directly or wired up.
 *
 * Two bugs found and fixed, logged as KNOWN-BUG-196:
 * (a) the user-record insert used `id: user.id` (the auth uid) with no `auth_user_id` set at
 *     all — every RLS policy and `get_user_hospital_id()` resolve a caller via
 *     `auth_user_id`, so a user created this way could never be resolved anywhere else in the
 *     app: the hospital and auth account would exist, but the admin would be functionally
 *     locked out immediately;
 * (b) `.rpc("seed_hospital_defaults", ...).catch(() => {})` — `.rpc()` returns the same
 *     non-Promise PostgrestBuilder as `.from()` (confirmed empirically: no real `.catch()`,
 *     unlike `.functions.invoke()`, which genuinely is a Promise) — so this crashed with a
 *     500 on every single successful call, after the hospital and user had already been
 *     created.
 *
 * Requires a genuinely fresh auth account with no existing public.users row (this function is
 * meant to be called by an already-authenticated user with no staff profile yet) — created
 * directly here rather than reusing a seeded Tier-0 account, since those already have a
 * public.users row and would hit the (correctly handled) duplicate-auth_user_id path instead.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, serviceClient, tenantClient } from "../fixtures/serviceClient";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const FRESH_EMAIL = "phase6-fixture-setup-hospital@example.test";
const FRESH_PASSWORD = "aumrti-e2e-local-only";
let freshAuthUserId = "";
let freshToken = "";
let createdHospitalId: string | null = null;

if (runtimeUp) {
  const svc = serviceClient();
  const { data: existing } = await svc.auth.admin.listUsers();
  const stale = existing?.users?.find((u) => u.email === FRESH_EMAIL);
  if (stale) await svc.auth.admin.deleteUser(stale.id);

  const { data: created, error } = await svc.auth.admin.createUser({
    email: FRESH_EMAIL, password: FRESH_PASSWORD, email_confirm: true,
  });
  if (error || !created.user) throw new Error(`Could not create fixture auth user: ${error?.message}`);
  freshAuthUserId = created.user.id;

  const client = await tenantClient(FRESH_EMAIL, FRESH_PASSWORD);
  const { data: { session } } = await client.auth.getSession();
  freshToken = session!.access_token;
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  if (createdHospitalId) {
    await svc.from("users").delete().eq("hospital_id", createdHospitalId);
    await svc.from("role_permissions").delete().eq("hospital_id", createdHospitalId);
    await svc.from("chart_of_accounts").delete().eq("hospital_id", createdHospitalId);
    await svc.from("auto_posting_rules").delete().eq("hospital_id", createdHospitalId);
    await svc.from("hospitals").delete().eq("id", createdHospitalId);
  }
  if (freshAuthUserId) await svc.auth.admin.deleteUser(freshAuthUserId);
});

describe.skipIf(!runtimeUp)("setup-hospital", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/setup-hospital`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
  });

  it("2. missing required fields is a clean 400", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/setup-hospital`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshToken}` },
      body: JSON.stringify({ hospital: {}, admin: {} }),
    });
    expect(res.status).toBe(400);
  });

  it("3. a fresh authenticated user with no existing staff profile successfully provisions a hospital — the regression test for both fixes", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/setup-hospital`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshToken}` },
      body: JSON.stringify({
        hospital: { name: "Phase6 Fixture Setup Hospital", type: "Clinic", bedCount: "under_30", plan: "starter", state: "Andhra Pradesh" },
        admin: { full_name: "Phase6 Fixture Setup Admin", phone: "9000000097" },
      }),
    });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* not JSON */ }

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    createdHospitalId = json.hospitalId;

    const svc = serviceClient();
    const { data: userRow } = await svc.from("users").select("id, auth_user_id, hospital_id, role").eq("hospital_id", createdHospitalId).maybeSingle();
    expect(userRow?.role).toBe("hospital_admin");
    expect(userRow?.auth_user_id).toBe(freshAuthUserId); // the regression test for bug (a)
    expect(userRow?.id).not.toBe(userRow?.auth_user_id);

    // The regression test for bug (b): seed_hospital_defaults ran to completion (200, not a
    // crash) and actually seeded a chart of accounts, not just avoided throwing.
    const { data: coa } = await svc.from("chart_of_accounts").select("id").eq("hospital_id", createdHospitalId).limit(1);
    expect(coa!.length).toBeGreaterThan(0);
  });

  it("4. the same already-provisioned auth account calling again hits the duplicate-profile path cleanly, and rolls back the second hospital it created", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/setup-hospital`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${freshToken}` },
      body: JSON.stringify({
        hospital: { name: "Phase6 Fixture Setup Hospital Duplicate", type: "Clinic", bedCount: "under_30", plan: "starter" },
        admin: { full_name: "Phase6 Fixture Setup Admin" },
      }),
    });
    expect(res.status).toBe(400);

    const svc = serviceClient();
    const { data: dupHospital } = await svc.from("hospitals").select("id").eq("name", "Phase6 Fixture Setup Hospital Duplicate").maybeSingle();
    expect(dupHospital).toBeNull(); // rolled back, not left orphaned
  });
});
