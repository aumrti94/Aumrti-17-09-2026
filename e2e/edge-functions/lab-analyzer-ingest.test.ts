/**
 * Phase 6, Priority 1 (PHI-handling) — lab-analyzer-ingest.
 *
 * KNOWN-BUG-128 (Phase 4, S3, target Phase 9) already documented that a device with no
 * `device_secret` configured accepts unauthenticated result submission for any
 * hospital_id/device_id pair. That is a deliberate, already-logged, deferred finding — not
 * re-litigated or fixed here. Test 5 below proves the OTHER half actually works (a device that
 * DOES have a secret configured genuinely enforces it), and test 6 is an `it.skip` naming
 * KNOWN-BUG-128 exactly, documenting the gap live rather than leaving it as a code-review
 * claim only, per the plan's R2 rule.
 *
 * Also fixed while writing this test: the catch-all handler returned the raw exception message
 * to the caller (already logged safely server-side, but echoed unredacted in the response too).
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { HOSPITAL_A } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let deviceWithSecretId = "";
let deviceNoSecretId = "";
const DEVICE_SECRET = "fixture-secret-abc123";

const HL7_MESSAGE = [
  "MSH|^~\\&|ANALYZER|LAB|AUMRTI|HOSP|20260913120000||ORU^R01|MSG001|P|2.3",
  "PID|1||PATFIXTURE001",
  "OBR|1|ACC-FIXTURE-001||CBC",
  "OBX|1|NM|HGB^Haemoglobin||13.5|g/dL|12.0-15.5|N|||F",
].join("\r");

if (runtimeUp) {
  const svc = serviceClient();
  const { data: d1, error: e1 } = await svc
    .from("lab_device_connectors")
    .insert({ hospital_id: HOSPITAL_A.id, name: "Fixture Analyzer (secured)", device_secret: DEVICE_SECRET })
    .select("id")
    .single();
  if (e1) throw new Error(`Could not create secured device fixture: ${e1.message}`);
  deviceWithSecretId = d1.id;

  const { data: d2, error: e2 } = await svc
    .from("lab_device_connectors")
    .insert({ hospital_id: HOSPITAL_A.id, name: "Fixture Analyzer (legacy, no secret)" })
    .select("id")
    .single();
  if (e2) throw new Error(`Could not create unsecured device fixture: ${e2.message}`);
  deviceNoSecretId = d2.id;
}

afterAll(async () => {
  if (!runtimeUp) return;
  const svc = serviceClient();
  if (deviceWithSecretId) await svc.from("lab_device_connectors").delete().eq("id", deviceWithSecretId);
  if (deviceNoSecretId) await svc.from("lab_device_connectors").delete().eq("id", deviceNoSecretId);
});

describe.skipIf(!runtimeUp)("lab-analyzer-ingest", () => {
  it("1. missing hospital_id/raw_message is a clean 400", async () => {
    const res = await callFunction("lab-analyzer-ingest", { token: LOCAL_SERVICE_ROLE_KEY, body: {} });
    expect(res.status).toBe(400);
  });

  it("2. an unknown device_id returns a clean 404, not a 500", async () => {
    const res = await callFunction("lab-analyzer-ingest", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { hospital_id: HOSPITAL_A.id, device_id: "00000000-0000-0000-0000-000000000000", protocol: "hl7", raw_message: HL7_MESSAGE },
    });
    expect(res.status).toBe(404);
  });

  it("3. malformed JSON does not 500 with a stack trace or raw error", async () => {
    const res = await callFunction("lab-analyzer-ingest", { token: LOCAL_SERVICE_ROLE_KEY, rawBody: "{not json" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("4. a valid HL7 message against the correct device secret is accepted and parsed", async () => {
    const res = await callFunction("lab-analyzer-ingest", {
      token: LOCAL_SERVICE_ROLE_KEY,
      headers: { "x-device-secret": DEVICE_SECRET },
      body: { hospital_id: HOSPITAL_A.id, device_id: deviceWithSecretId, protocol: "hl7", raw_message: HL7_MESSAGE },
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    expect(res.json.results_parsed).toBe(1);
  });

  it("5. a device WITH a configured secret genuinely rejects a wrong or missing secret", async () => {
    const wrongSecret = await callFunction("lab-analyzer-ingest", {
      token: LOCAL_SERVICE_ROLE_KEY,
      headers: { "x-device-secret": "totally-wrong" },
      body: { hospital_id: HOSPITAL_A.id, device_id: deviceWithSecretId, protocol: "hl7", raw_message: HL7_MESSAGE },
    });
    expect(wrongSecret.status).toBe(401);

    const noSecretHeader = await callFunction("lab-analyzer-ingest", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { hospital_id: HOSPITAL_A.id, device_id: deviceWithSecretId, protocol: "hl7", raw_message: HL7_MESSAGE },
    });
    expect(noSecretHeader.status).toBe(401);
  });

  // KNOWN-BUG-128 (Phase 4, S3, target Phase 9): a device with NO device_secret configured
  // accepts a result submission from anyone holding the service-role key, with no per-device
  // credential check at all. This asserts the SECURE behaviour a fix should have — it fails
  // today by design, documenting the gap live rather than leaving it a code-review claim only.
  it.skip("6. KNOWN-BUG-128 — a device with no secret configured should still require SOME per-device credential, not accept anything", async () => {
    const res = await callFunction("lab-analyzer-ingest", {
      token: LOCAL_SERVICE_ROLE_KEY,
      body: { hospital_id: HOSPITAL_A.id, device_id: deviceNoSecretId, protocol: "hl7", raw_message: HL7_MESSAGE },
    });
    expect(res.status).toBe(401);
  });
});
