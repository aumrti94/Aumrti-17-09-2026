/**
 * Phase 6, Priority 4 (Tenant lifecycle) — delete-hospital.
 *
 * No bugs found writing this test — auth (aumrti_admin required), the two-phase soft-delete
 * grace window, restore, and the streamed Phase-2 purge all worked correctly on first try.
 * Logged here as clean coverage, not a KNOWN_BUGS entry — this is the second half of the
 * "full provisioning chain end-to-end including partial-failure rollback" Phase 6 exit-gate
 * requirement (register-hospital/setup-hospital cover provisioning; this covers teardown).
 *
 * SAFETY: Phase 2 (the actual irreversible purge) is exercised for real in test 8 below —
 * this is a genuinely destructive action, so it runs ONLY against a hospital this test file
 * creates for itself via direct service-role inserts, never against HOSPITAL_A/HOSPITAL_B (the
 * shared Tier-0 seed fixture every other test in this suite depends on) or any other real data.
 * The grace-period wait is bypassed by directly backdating `deleted_at`, not by waiting 7 days.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, serviceClient } from "../fixtures/serviceClient";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable, tokenFor } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const ADMIN_EMAIL = "phase6-fixture-aumrti-admin@example.test";
const ADMIN_PASSWORD = "aumrti-e2e-local-only";
let adminAuthUserId = "";
let adminToken = "";
let disposableHospitalId = "";
let tokenA = "";

async function callDeleteHospital(auth: string | null, body: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (auth !== null) headers["Authorization"] = auth;
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/delete-hospital`, { method: "POST", headers, body: JSON.stringify(body) });
  return res;
}

async function readSse(res: Response): Promise<{ event: string; data: any }[]> {
  const text = await res.text();
  const events: { event: string; data: any }[] = [];
  for (const block of text.split("\n\n")) {
    const eventLine = block.match(/^event: (.+)$/m);
    const dataLine = block.match(/^data: (.+)$/m);
    if (eventLine && dataLine) {
      events.push({ event: eventLine[1], data: JSON.parse(dataLine[1]) });
    }
  }
  return events;
}

if (runtimeUp) {
  const svc = serviceClient();

  const { data: existing } = await svc.auth.admin.listUsers();
  const stale = existing?.users?.find((u) => u.email === ADMIN_EMAIL);
  if (stale) { await svc.from("aumrti_admins").delete().eq("auth_user_id", stale.id); await svc.auth.admin.deleteUser(stale.id); }

  const { data: created } = await svc.auth.admin.createUser({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD, email_confirm: true });
  adminAuthUserId = created!.user!.id;
  await svc.from("aumrti_admins").insert({ auth_user_id: adminAuthUserId, full_name: "Phase6 Fixture Admin", email: ADMIN_EMAIL, is_active: true });

  const client = await import("../fixtures/serviceClient").then((m) => m.tenantClient(ADMIN_EMAIL, ADMIN_PASSWORD));
  const { data: { session } } = await client.auth.getSession();
  adminToken = session!.access_token;

  tokenA = await tokenFor("a", "hospital_admin");

  const { data: hosp } = await svc.from("hospitals").insert({
    name: "Phase6 Fixture Disposable Hospital", type: "clinic", country: "India", is_active: true,
  }).select("id").maybeSingle();
  disposableHospitalId = hosp!.id;
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  // Test 8 purges disposableHospitalId for real; this is a defensive best-effort cleanup only
  // in case an earlier assertion failed before the purge completed.
  await svc.from("hospitals").delete().eq("id", disposableHospitalId);
  await svc.from("aumrti_admins").delete().eq("auth_user_id", adminAuthUserId);
  if (adminAuthUserId) await svc.auth.admin.deleteUser(adminAuthUserId);
});

describe.skipIf(!runtimeUp)("delete-hospital", () => {
  it("1. preflight honestly reports admin status for a real aumrti_admin", async () => {
    const res = await callDeleteHospital(`Bearer ${adminToken}`, { action: "preflight" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.checks.admin).toBe(true);
  });

  it("2. preflight honestly reports non-admin status for an ordinary hospital staff account", async () => {
    const res = await callDeleteHospital(`Bearer ${tokenA}`, { action: "preflight" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks.admin).toBe(false);
  });

  it("3. missing Authorization header is rejected on the real (non-preflight) path", async () => {
    const res = await callDeleteHospital(null, { hospital_id: disposableHospitalId });
    expect(res.status).toBe(401);
  });

  it("4. an ordinary hospital staff account (not an aumrti_admin) is forbidden from deleting any hospital", async () => {
    const res = await callDeleteHospital(`Bearer ${tokenA}`, { hospital_id: disposableHospitalId });
    expect(res.status).toBe(403);
  });

  it("5. an unknown hospital_id is a clean 404", async () => {
    const res = await callDeleteHospital(`Bearer ${adminToken}`, { hospital_id: "00000000-0000-0000-0000-000000000000" });
    expect(res.status).toBe(404);
  });

  it("6. phase 1: marking the disposable hospital for deletion genuinely sets deleted_at and starts the grace window", async () => {
    const res = await callDeleteHospital(`Bearer ${adminToken}`, { hospital_id: disposableHospitalId });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.soft_deleted).toBe(true);

    const svc = serviceClient();
    const { data: hosp } = await svc.from("hospitals").select("deleted_at").eq("id", disposableHospitalId).maybeSingle();
    expect(hosp?.deleted_at).toBeTruthy();
  });

  it("7. calling again inside the grace window is a clean 409, not a purge — and restore genuinely clears deleted_at", async () => {
    const graceRes = await callDeleteHospital(`Bearer ${adminToken}`, { hospital_id: disposableHospitalId });
    expect(graceRes.status).toBe(409);

    const restoreRes = await callDeleteHospital(`Bearer ${adminToken}`, { hospital_id: disposableHospitalId, action: "restore" });
    expect(restoreRes.status).toBe(200);
    const restoreBody = await restoreRes.json();
    expect(restoreBody.restored).toBe(true);

    const svc = serviceClient();
    const { data: hosp } = await svc.from("hospitals").select("deleted_at").eq("id", disposableHospitalId).maybeSingle();
    expect(hosp?.deleted_at).toBeNull();
  });

  it("8. once the grace period has genuinely elapsed, the streamed purge runs to completion and the hospital is actually gone", async () => {
    const svc = serviceClient();
    // Mark for deletion, then backdate past the 7-day grace window directly — the fastest
    // honest way to reach Phase 2 without an artificial 7-day wait.
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    await svc.from("hospitals").update({ deleted_at: eightDaysAgo }).eq("id", disposableHospitalId);

    const res = await callDeleteHospital(`Bearer ${adminToken}`, { hospital_id: disposableHospitalId });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const events = await readSse(res);
    const doneEvent = events.find((e) => e.event === "done");
    expect(doneEvent).toBeTruthy();

    const { data: hosp } = await svc.from("hospitals").select("id").eq("id", disposableHospitalId).maybeSingle();
    expect(hosp).toBeNull(); // genuinely, irreversibly gone
  }, 20_000); // the purge iterates every hospital-scoped table via a separate RPC round-trip each
});
