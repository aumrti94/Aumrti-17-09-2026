/**
 * Phase 6, Priority 3 (Statutory/external) — abdm-fhir-package.
 *
 * No bugs found writing this test. Already correctly gated by the Phase 4 isolation audit
 * (KNOWN-BUG-126) with a deliberate dual-mode gate (exact service-role secret OR a real
 * user's own verified hospital match) — and its one internal call, to fhir-export, correctly
 * uses the service-role client, which fhir-export's own action-mode fix (KNOWN-BUG-171)
 * specifically requires. Logged here as clean coverage, not a KNOWN_BUGS entry.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { localSupabaseUrl, LOCAL_SERVICE_ROLE_KEY } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
let tokenB = "";
if (runtimeUp) {
  [tokenA, tokenB] = await Promise.all([tokenFor("a", "hospital_admin"), tokenFor("b", "hospital_admin")]);
}

describe.skipIf(!runtimeUp)("abdm-fhir-package", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("abdm-fhir-package", { token: null, body: { hospital_id: HOSPITAL_A.id, source_id: "x", context_type: "OPDRecord" } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("abdm-fhir-package", { token: "garbage", body: { hospital_id: HOSPITAL_A.id, source_id: "x", context_type: "OPDRecord" } });
    expect(res.status).toBe(401);
  });

  it("3. cross-hospital: hospital B's token cannot request hospital A's bundle", async () => {
    const res = await callFunction("abdm-fhir-package", { token: tokenB, body: { hospital_id: HOSPITAL_A.id, source_id: "x", context_type: "OPDRecord" } });
    expect(res.status).toBe(403);
  });

  it("4. a hospital_id with no other resolvable identifiers is a clean 400", async () => {
    const res = await callFunction("abdm-fhir-package", { token: tokenA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("5. a genuinely nonexistent source record is a clean, generic error — never a raw stack trace", async () => {
    const res = await callFunction("abdm-fhir-package", { token: tokenA, body: { hospital_id: HOSPITAL_A.id, source_id: "00000000-0000-0000-0000-000000000000", context_type: "OPDRecord" } });
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("Internal error");
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("6. the exact service-role secret is accepted as the other legitimate internal caller identity", async () => {
    const res = await fetch(`${localSupabaseUrl()}/functions/v1/abdm-fhir-package`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${LOCAL_SERVICE_ROLE_KEY}` },
      body: JSON.stringify({ hospital_id: HOSPITAL_A.id, source_id: "00000000-0000-0000-0000-000000000000", context_type: "OPDRecord" }),
    });
    // Reaches real logic (not rejected at the auth gate) — the nonexistent source record
    // still 500s generically, same as test 5, proving the service-role identity was accepted.
    expect(res.status).toBe(500);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("abdm-fhir-package", { token: tokenA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
