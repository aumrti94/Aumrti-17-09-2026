/**
 * Phase 6, Priority 4 (Tenant lifecycle) — register-hospital.
 *
 * S1, no waiver — the single most severe functional finding of Phase 6. `users.id` has no
 * DEFAULT in the schema (confirmed directly: `id uuid not null` with no default expression),
 * so it must be generated explicitly on insert. The user-record insert here never set it,
 * so it has ALWAYS failed with `null value in column "id" of relation "users" violates
 * not-null constraint` — meaning the self-service hospital signup flow has never once
 * successfully created a hospital, ever, in this codebase's current state. Reproduced with a
 * real live call before touching any code. The surrounding rollback (delete the hospital and
 * auth user on a user-insert failure) correctly fired every time, so no orphaned data was
 * ever left behind by the failure itself — but no hospital was ever actually created.
 *
 * IMPORTANT — shared in-memory rate limiter: this function rate-limits by client IP
 * (max 5/hour) in a plain in-process `Map`, keyed on `x-forwarded-for`/`x-real-ip`, which
 * neither this test's HTTP client nor a bare `fetch` sets — every call here, and every call
 * any OTHER test or manual check makes to this function within the same edge-runtime
 * process's uptime, shares the identical "unknown" bucket. Keep this file's call count to the
 * bare minimum (2 calls total) so the suite can run more than once without the runtime being
 * restarted in between.
 */
import { describe, it, expect, afterAll } from "vitest";
import { localSupabaseUrl, serviceClient } from "../fixtures/serviceClient";
import { assertLocalTarget } from "../fixtures/guard";
import { edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

const TEST_EMAIL = "phase6-fixture-register@example.test";
let createdHospitalId: string | null = null;

async function register(body: unknown) {
  const res = await fetch(`${localSupabaseUrl()}/functions/v1/register-hospital`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

afterAll(async () => {
  if (!runtimeUp || !createdHospitalId) return;
  const svc = serviceClient();
  const { data: userRow } = await svc.from("users").select("auth_user_id").eq("hospital_id", createdHospitalId).maybeSingle();
  await svc.from("subscription_events").delete().eq("hospital_id", createdHospitalId);
  await svc.from("hospital_subscriptions").delete().eq("hospital_id", createdHospitalId);
  await svc.from("hospital_signup_consents").delete().eq("hospital_id", createdHospitalId);
  await svc.from("product_modes").delete().eq("hospital_id", createdHospitalId);
  await svc.from("users").delete().eq("hospital_id", createdHospitalId);
  await svc.from("role_permissions").delete().eq("hospital_id", createdHospitalId);
  await svc.from("chart_of_accounts").delete().eq("hospital_id", createdHospitalId);
  await svc.from("auto_posting_rules").delete().eq("hospital_id", createdHospitalId);
  await svc.from("hospitals").delete().eq("id", createdHospitalId);
  if (userRow?.auth_user_id) await svc.auth.admin.deleteUser(userRow.auth_user_id as string);
});

describe.skipIf(!runtimeUp)("register-hospital", () => {
  it("1. missing required fields is a clean 400 — does not count meaningfully toward provisioning but does spend one rate-limit slot", async () => {
    const res = await register({ hospital: {}, admin: {}, consent: {} });
    expect(res.status).toBe(400);
  });

  it("2. a genuinely complete, valid registration succeeds end-to-end — the regression test for the users.id bug: creates the hospital, the auth account, the public.users row (with id DIFFERENT from auth_user_id, matching the documented divergence), the trial subscription, and the consent record", async () => {
    const res = await register({
      hospital: { name: "Phase6 Fixture Hospital", type: "Private Hospital", bedCount: "under_30", plan: "starter", state: "Andhra Pradesh" },
      admin: { email: TEST_EMAIL, password: "TestPass123", full_name: "Phase6 Fixture Admin", phone: "9000000098" },
      consent: { terms_accepted: true, dpdp_consent: true },
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.hospitalId).toBeTruthy();
    expect(res.json.userId).toBeTruthy();
    createdHospitalId = res.json.hospitalId;

    const svc = serviceClient();
    const { data: userRow } = await svc.from("users").select("id, auth_user_id, hospital_id, role").eq("hospital_id", createdHospitalId).maybeSingle();
    expect(userRow?.role).toBe("super_admin");
    expect(userRow?.id).toBeTruthy();
    expect(userRow?.id).not.toBe(userRow?.auth_user_id); // the exact invariant the bug violated

    const { data: sub } = await svc.from("hospital_subscriptions").select("status").eq("hospital_id", createdHospitalId).maybeSingle();
    expect(sub?.status).toBe("trial");

    const { data: consentRow } = await svc.from("hospital_signup_consents").select("terms_accepted, dpdp_consent").eq("hospital_id", createdHospitalId).maybeSingle();
    expect(consentRow?.terms_accepted).toBe(true);
    expect(consentRow?.dpdp_consent).toBe(true);
  });
});
