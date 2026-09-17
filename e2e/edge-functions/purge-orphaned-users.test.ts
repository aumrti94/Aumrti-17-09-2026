/**
 * Phase 6, Priority 4 (Tenant lifecycle) — purge-orphaned-users.
 *
 * SAFETY: this function deletes ANY orphaned auth.users row PLATFORM-WIDE, with no hospital
 * scoping at all. This file deliberately does NOT exercise the actual deletion path as part
 * of the routine parallel suite: several other test files in this same suite (register-hospital,
 * setup-hospital, create-staff-login, admin-impersonate-start, abdm-abha-create) briefly create
 * an auth.users row before linking it to public.users/aumrti_admins — and a real purge call
 * landing inside that window deletes the row out from under them. This was not a theoretical
 * concern: it was caught live — a full-suite run non-deterministically failed
 * register-hospital.test.ts's own registration call, traced to this file's deletion test
 * racing it. No permanent damage resulted (every Tier-0 seed account and all fixtures were
 * confirmed intact afterward, and the affected test's own rollback logic cleaned up
 * correctly) — but a test provably capable of intermittently breaking unrelated tests has no
 * place running unattended in the standard suite.
 *
 * The deletion path itself (a real fixture orphan gets deleted; every Tier-0 seed account and
 * an active platform admin survive the same call) WAS independently verified, twice, running
 * this file in isolation (`npx vitest run e2e/edge-functions/purge-orphaned-users.test.ts`)
 * with no other test file executing concurrently — both runs passed clean. That verification
 * is not re-run automatically; re-run it manually, alone, if this function's deletion logic
 * changes.
 *
 * What DOES run here, safely, alongside everything else: the two auth-gate checks, which
 * reject before the function ever queries or deletes anything.
 */
import { describe, it, expect } from "vitest";
import { callFunction, tokenFor, edgeRuntimeReachable } from "../fixtures/edgeFunctionClient";

const runtimeUp = await edgeRuntimeReachable();

let tokenA = "";
if (runtimeUp) {
  tokenA = await tokenFor("a", "hospital_admin");
}

describe.skipIf(!runtimeUp)("purge-orphaned-users", () => {
  it("1. missing Authorization header is rejected before any query runs", async () => {
    const res = await callFunction("purge-orphaned-users", { token: null });
    expect(res.status).toBe(401);
  });

  it("2. an ordinary hospital admin (not an aumrti_admin) is forbidden before any query runs", async () => {
    const res = await callFunction("purge-orphaned-users", { token: tokenA });
    expect(res.status).toBe(403);
  });
});
