/**
 * Phase 6, Priority 2 (Money) — email-tally-xml.
 *
 * Already fixed in Phase 4 (KNOWN-BUG-126): "any request naming a hospital_id could make the
 * platform's own Resend account email attacker-controlled xml_content to that hospital's real
 * billing/accounts inbox." Proves that fix live. New gap found and fixed in this pass: the
 * hospital lookup selected a "billing_email" column that has never existed, so the whole
 * select failed unchecked and this function has always returned "No billing email configured"
 * for every hospital, regardless of whether one was actually set.
 *
 * No RESEND_API_KEY is configured in this local environment (an external paid service), so
 * these tests exercise everything up to that boundary — including confirming the fix reaches
 * the RESEND_API_KEY check at all now, rather than stopping one step earlier at the
 * mis-diagnosed "no email configured" error.
 */
import { describe, it, expect, afterAll } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";
import { serviceClient } from "../fixtures/serviceClient";
import { HOSPITAL_A, HOSPITAL_B } from "../fixtures/constants";
import { assertLocalTarget } from "../fixtures/guard";

assertLocalTarget(process.env.SUPABASE_URL ?? "http://127.0.0.1:54321", process.env.SUPABASE_PROJECT_REF);
const runtimeUp = await edgeRuntimeReachable();

let tokenBillingA = "";
let tokenBillingB = "";

if (runtimeUp) {
  [tokenBillingA, tokenBillingB] = await Promise.all([tokenFor("a", "billing_executive"), tokenFor("b", "billing_executive")]);
  await serviceClient().from("hospitals").update({ email: "accounts-fixture@example.test" }).eq("id", HOSPITAL_A.id);
}

afterAll(async () => {
  if (!runtimeUp) return;
  await serviceClient().from("hospitals").update({ email: null }).eq("id", HOSPITAL_A.id);
});

describe.skipIf(!runtimeUp)("email-tally-xml", () => {
  it("1. missing Authorization header is rejected — the regression test for the unauthenticated-email-relay fix", async () => {
    const res = await callFunction("email-tally-xml", {
      token: null,
      body: { hospital_id: HOSPITAL_A.id, xml_content: "<TALLYMESSAGE/>", date_start: "2026-01-01", date_end: "2026-01-31" },
    });
    expect(res.status).toBe(401);
  });

  it("2. a garbage bearer token is rejected", async () => {
    const res = await callFunction("email-tally-xml", {
      token: "garbage",
      body: { hospital_id: HOSPITAL_A.id, xml_content: "<TALLYMESSAGE/>" },
    });
    expect(res.status).toBe(401);
  });

  it("3. malformed JSON does not 500 with a raw stack trace", async () => {
    const res = await callFunction("email-tally-xml", { token: tokenBillingA, rawBody: "{bad" });
    expect(res.status).not.toBe(200);
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });

  it("4. missing hospital_id/xml_content is a clean 400", async () => {
    const res = await callFunction("email-tally-xml", { token: tokenBillingA, body: { hospital_id: HOSPITAL_A.id } });
    expect(res.status).toBe(400);
  });

  it("5. cross-hospital: hospital B's billing staff cannot email an export to hospital A's inbox naming hospital A's id", async () => {
    const res = await callFunction("email-tally-xml", {
      token: tokenBillingB,
      body: { hospital_id: HOSPITAL_A.id, xml_content: "<TALLYMESSAGE/>", date_start: "2026-01-01", date_end: "2026-01-31" },
    });
    expect(res.status).toBe(403);
  });

  it("6. a hospital with a real configured email now correctly reaches the send step (RESEND_API_KEY boundary), not the misdiagnosed 'no email configured' error — the regression test for the column-name fix", async () => {
    const res = await callFunction("email-tally-xml", {
      token: tokenBillingA,
      body: { hospital_id: HOSPITAL_A.id, xml_content: "<TALLYMESSAGE/>", date_start: "2026-01-01", date_end: "2026-01-31" },
    });
    // Before the fix this was always 400 "No billing email configured for this hospital",
    // even though HOSPITAL_A genuinely has one set. It must now get past that check.
    expect(res.json.error).not.toMatch(/No billing email configured/);
    // No RESEND_API_KEY locally, so the next real boundary is this explicit, honest 500 —
    // never a raw stack trace, never a false "success".
    expect(res.status).toBe(500);
    expect(res.json.error).toMatch(/RESEND_API_KEY not configured/);
  });

  it("7. a hospital with no email configured at all still gets the correct, honest error", async () => {
    const res = await callFunction("email-tally-xml", {
      token: tokenBillingB,
      body: { hospital_id: HOSPITAL_B.id, xml_content: "<TALLYMESSAGE/>", date_start: "2026-01-01", date_end: "2026-01-31" },
    });
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/No billing email configured/);
  });
});
