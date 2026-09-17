/**
 * Phase 6, AI-function plumbing — ai-executive-digest. The last Band-1 (PHI) function to get
 * a dedicated live-HTTP test, closing out Phase 6's "100% of category 1-4 on all four
 * assertions" exit gate.
 *
 * Already correctly built: hospital_id resolved server-side from the authenticated user
 * (resolveHospitalIdForUser) rather than trusted from the request body, and the "AI Features"
 * master switch plus the per-feature ai_digest toggle both enforced (checkAIAllowed) before
 * any provider call. One minor tidy made writing this test: the catch-all previously logged
 * and returned the raw thrown error/value — this function's request body carries an aggregate
 * financial/clinical snapshot, and a stray thrown value could have echoed a fragment of it
 * into logs or the HTTP response. Now logs only the error name and returns a generic message,
 * matching every other catch-all fixed this phase. Not severe enough for its own KNOWN-BUG
 * entry (no PHI field was ever actually observed to leak this way — this closes a latent path,
 * consistent with the hygiene tidies folded into KNOWN-BUG-198/199/200's fixes).
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("ai-executive-digest", () => {
  it("1. missing Authorization header is rejected", async () => {
    const res = await callFunction("ai-executive-digest", { token: null, body: {} });
    expect(res.status).toBe(401);
  });

  it("2. a valid request reaches the real AI-config boundary honestly (no credentials configured locally) — the entitlement gate fails open on HOSPITAL_A's real local state and never falsely blocks", async () => {
    const res = await callFunction("ai-executive-digest", {
      token: tokenA,
      body: { hospital_name: "Ashwini General Hospital", date: "2026-09-13", snapshot: {}, anomalies: [] },
    });
    expect(res.status).toBe(503);
    expect(res.json.error).toMatch(/No AI provider/);
  });

  it("3. malformed JSON does not 500 with a raw stack trace or echo the thrown error", async () => {
    const res = await callFunction("ai-executive-digest", { token: tokenA, rawBody: "{bad" });
    expect(res.status).toBe(500);
    expect(res.json.error).toBe("Could not build the digest.");
    expect(res.text).not.toMatch(/at\s+\S+\s+\(.*:\d+:\d+\)/);
  });
});
