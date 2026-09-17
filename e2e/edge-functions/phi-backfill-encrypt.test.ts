/**
 * Phase 6, Priority 1 (PHI-handling) — phi-backfill-encrypt.
 *
 * Its own header says "Only allow service_role or aumrti_admin invocations" and "INVOKE
 * MANUALLY — never put this on a cron" — but the code only ever checked that the Authorization
 * header started with "Bearer ", never that the token was actually the service-role secret or a
 * genuine platform admin. Any garbage token, or any ordinary hospital doctor's own valid JWT,
 * passed. Since this function force-encrypts a named PHI column across every hospital when
 * hospitalId is omitted, that is a real authorization hole, not a documentation lag — found and
 * fixed while writing this test (see KNOWN_BUGS.md). Also found: its own COLUMN_MAP still named
 * the wrong Aadhaar column (aadhaar_number instead of aadhaar_id), the same wrong-name mistake
 * its own header already fixed for two other tables.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { HOSPITAL_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenDoctorA = "";
let testPatientId = "";
const FIXTURE_NAME = "PHI Backfill Fixture (e2e/edge-functions/phi-backfill-encrypt.test.ts)";
const FIXTURE_ADDRESS = "12 Test Lane, Fixture Nagar";

if (runtimeUp) {
  tokenDoctorA = await tokenFor("a", "doctor");

  const svc = serviceClient();
  await svc.from("patients").delete().eq("hospital_id", HOSPITAL_A.id).eq("full_name", FIXTURE_NAME);
  const { data, error } = await svc
    .from("patients")
    .insert({
      hospital_id: HOSPITAL_A.id,
      full_name: FIXTURE_NAME,
      uhid: `${HOSPITAL_A.uhidPrefix}-BACKFILL-${Date.now()}`,
      address: FIXTURE_ADDRESS, // plaintext — this is exactly what the function should encrypt
    })
    .select("id")
    .single();
  if (error) throw new Error(`Could not create test patient fixture: ${error.message}`);
  testPatientId = data.id;
}

afterAll(async () => {
  if (!runtimeUp || !testPatientId) return;
  await serviceClient().from("patients").delete().eq("id", testPatientId);
});

describe.skipIf(!runtimeUp)("phi-backfill-encrypt", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("phi-backfill-encrypt", {
      token: null,
      body: { table: "patients", column: "address", hospitalId: HOSPITAL_A.id },
    });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("phi-backfill-encrypt", {
      token: "not-a-real-token",
      body: { table: "patients", column: "address", hospitalId: HOSPITAL_A.id },
    });
    expect(res.status).toBe(401);
  });

  it("3. an ordinary hospital doctor's own valid JWT is FORBIDDEN, not accepted — regression test for the auth-check fix in this pass", async () => {
    const res = await callFunction("phi-backfill-encrypt", {
      token: tokenDoctorA,
      body: { table: "patients", column: "address", hospitalId: HOSPITAL_A.id },
    });
    expect(res.status).toBe(403);
  });

  it("4. malformed JSON does not 500 with a stack trace", async () => {
    const res = await callFunction("phi-backfill-encrypt", {
      token: LOCAL_SERVICE_ROLE_KEY,
      rawBody: "{ not valid",
    });
    expect(res.status).toBe(400);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("5. an unknown table/column is a clean 400, not a 500", async () => {
    const res = await callFunction("phi-backfill-encrypt", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { table: "patients", column: "not_a_real_column" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/Unknown table\/column/);
  });

  it("6. the real service-role secret succeeds and actually encrypts the targeted column, scoped to one hospital", async () => {
    const res = await callFunction("phi-backfill-encrypt", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { table: "patients", column: "address", hospitalId: HOSPITAL_A.id },
    });
    expect(res.status).toBe(200);
    expect(res.json.rowsFailed).toBe(0);
    expect(res.json.rowsEncrypted).toBeGreaterThanOrEqual(1);

    const svc = serviceClient();
    const { data: row } = await svc.from("patients").select("address_enc").eq("id", testPatientId).maybeSingle();
    expect(row?.address_enc).toBeTruthy();
    expect(row?.address_enc).not.toContain(FIXTURE_ADDRESS);
  });

  it("7. never echoes the plaintext PHI value it just encrypted back in the response", async () => {
    const svc = serviceClient();
    await svc.from("patients").update({ address_enc: null }).eq("id", testPatientId); // re-arm for a second pass

    const res = await callFunction("phi-backfill-encrypt", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { table: "patients", column: "address", hospitalId: HOSPITAL_A.id },
    });
    expect(res.text).not.toContain(FIXTURE_ADDRESS);
  });
});
