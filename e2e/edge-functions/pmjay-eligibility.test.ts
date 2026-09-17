/**
 * Phase 6, Priority 3 (Statutory/external) — pmjay-eligibility.
 *
 * With no hospital_abdm_config row and no NHA_BIS_API_KEY, HOSPITAL_A takes the sandbox path
 * directly — the honest local default, same judgment call as elsewhere this phase.
 *
 * One bug found and fixed writing this test, logged as KNOWN-BUG-186 alongside the other five
 * `.catch()`-on-Postgrest-builder instances found in the same pass: the hcx_submissions audit
 * log insert inside checkEligibilityHcx() (the HCX-mode branch, reached only when a hospital
 * has feature_hcx_claims enabled AND real HCX participant credentials configured — neither
 * true for any hospital in this local environment) used `.insert(...).catch(() => {})`, the
 * same non-existent-.catch() defect as everywhere else it was found this session. Manually
 * verified the fix's surrounding control flow reaches HCX mode correctly (temporarily setting
 * feature_hcx_claims=true for HOSPITAL_A and confirming the request reaches
 * checkEligibilityHcx() rather than the outer sandbox fallback, then reverting) — the specific
 * insert line itself is only reached with real NHA/HCX participant credentials configured,
 * which cannot be established from a local test environment, so this one instance relies on
 * its mechanical identity with the five siblings that WERE independently proven fixed.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let token = "";
if (runtimeUp) {
  token = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("pmjay-eligibility", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("pmjay-eligibility", { token: null, body: { pmjay_card_number: "12345678" } });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("pmjay-eligibility", { token: "garbage", body: { pmjay_card_number: "12345678" } });
    expect(res.status).toBe(401);
  });

  it("3. missing pmjay_card_number is a clean 400", async () => {
    const res = await callFunction("pmjay-eligibility", { token, body: {} });
    expect(res.status).toBe(400);
  });

  it("4. a valid-looking card number is honestly evaluated eligible via the sandbox mock (no live NHA/HCX credentials configured locally)", async () => {
    const res = await callFunction("pmjay-eligibility", { token, body: { pmjay_card_number: "98765432109876", patient_name: "Phase6 Fixture Patient" } });
    expect(res.status).toBe(200);
    expect(res.json.mode).toBe("sandbox");
    expect(res.json.eligible).toBe(true);
    expect(res.json.beneficiary.name).toBe("Phase6 Fixture Patient");
  });

  it("5. a malformed card number honestly reports ineligible, not an error", async () => {
    const res = await callFunction("pmjay-eligibility", { token, body: { pmjay_card_number: "not-a-real-card" } });
    expect(res.status).toBe(200);
    expect(res.json.eligible).toBe(false);
    expect(res.json.beneficiary).toBeNull();
  });

  it("6. cross-hospital: naming another hospital's id without belonging to it is rejected before any HCX credential is touched", async () => {
    const res = await callFunction("pmjay-eligibility", {
      token,
      body: { pmjay_card_number: "98765432109876", hospital_id: "b0000000-0000-4000-8000-000000000002" },
    });
    expect(res.status).toBe(403);
  });

  it("7. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("pmjay-eligibility", { token, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
