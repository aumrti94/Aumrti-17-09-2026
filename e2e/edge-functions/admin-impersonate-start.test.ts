/**
 * Phase 6, Priority 4 (Tenant lifecycle) — admin-impersonate-start.
 *
 * One bug found and fixed, logged as KNOWN-BUG-197: the "fall back to the hospital's oldest
 * active user when no super_admin exists" path ordered candidates by `role` (alphabetically),
 * not `created_at` — so the actual fallback selection had nothing to do with tenure, contrary
 * to both the code's own comment and this function's design-note header. Lower severity than
 * most findings this session (it changes WHICH staff account is impersonated, not whether
 * impersonation itself is authorised or audited correctly, both of which were already right).
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, serviceClient, tenantClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const ADMIN_EMAIL = "phase6-fixture-impersonate-admin@example.test";
const ADMIN_PASSWORD = "aumrti-e2e-local-only";
let adminAuthUserId = "";
let adminToken = "";
let tokenA = "";

async function callImpersonateStart(auth: string | null, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/admin-impersonate-start`, { method: "POST", headers, body: JSON.stringify(body) });
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
    const { data: staleAdminRow } = await svc.from("aumrti_admins").select("id").eq("auth_user_id", stale.id).maybeSingle();
    if (staleAdminRow) await svc.from("admin_audit_log").delete().eq("admin_id", staleAdminRow.id);
    await svc.from("aumrti_admins").delete().eq("auth_user_id", stale.id);
    await svc.auth.admin.deleteUser(stale.id);
  }

  const { data: created, error: createErr } = await svc.auth.admin.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, email_confirm: true });
  if (createErr || !created?.user) throw new Error(`Could not create fixture admin auth user: ${createErr?.message}`);
  adminAuthUserId = created.user.id;
  await svc.from("aumrti_admins").insert({ auth_user_id: adminAuthUserId, full_name: "Phase6 Fixture Impersonate Admin", email: ADMIN_EMAIL, is_active: true });

  const client = await tenantClient(ADMIN_EMAIL, ADMIN_PASSWORD);
  const { data: { session } } = await client.auth.getSession();
  adminToken = session!.access_token;

  tokenA = await tokenFor("a", "hospital_admin");
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  const { data: adminRow } = await svc.from("aumrti_admins").select("id").eq("auth_user_id", adminAuthUserId).maybeSingle();
  if (adminRow) await svc.from("admin_audit_log").delete().eq("admin_id", adminRow.id); // FK's to aumrti_admins.id
  await svc.from("aumrti_admins").delete().eq("auth_user_id", adminAuthUserId);
  if (adminAuthUserId) await svc.auth.admin.deleteUser(adminAuthUserId);
});

describe.skipIf(!runtimeUp)("admin-impersonate-start", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callImpersonateStart(null, { hospital_id: HOSPITAL_A.id });
    expect(res.status).toBe(401);
  });

  it("2. an ordinary hospital admin (not an aumrti_admin) is forbidden", async () => {
    const res = await callImpersonateStart(`Bearer ${tokenA}`, { hospital_id: HOSPITAL_A.id });
    expect(res.status).toBe(403);
  });

  it("3. missing hospital_id is a clean 400", async () => {
    const res = await callImpersonateStart(`Bearer ${adminToken}`, {});
    expect(res.status).toBe(400);
  });

  it("4. an unknown hospital_id is a clean 404", async () => {
    const res = await callImpersonateStart(`Bearer ${adminToken}`, { hospital_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("5. a real aumrti_admin genuinely starts an impersonation session against the hospital's genuinely-oldest active staff account (the Tier-0 seed has no super_admin, only hospital_admin — this exercises the fallback path directly) — the regression test for the ordering fix: alphabetical-by-role would have picked 'billing_executive' over the actually-oldest 'hospital_admin'", async () => {
    const res = await callImpersonateStart(`Bearer ${adminToken}`, { hospital_id: HOSPITAL_A.id });
    expect(res.status).toBe(200);
    expect(res.json.hashed_token).toBeTruthy();
    expect(res.json.impersonated_role).toBe("hospital_admin");
    expect(res.json.hospital_name).toBe(HOSPITAL_A.name);

    const svc = serviceClient();
    const { data: auditRows } = await svc
      .from("admin_audit_log")
      .select("action, target_hospital_id, details")
      .eq("action", "impersonation_start")
      .eq("target_hospital_id", HOSPITAL_A.id)
      .order("created_at", { ascending: false })
      .limit(1);
    expect(auditRows!.length).toBeGreaterThan(0);
    expect((auditRows![0].details as any).impersonated_role).toBe("hospital_admin");
  });

  it("6. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/admin-impersonate-start`, {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` }, body: "{bad",
    });
    expect(res.status).not.toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
