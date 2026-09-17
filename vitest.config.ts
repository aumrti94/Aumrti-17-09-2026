import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // `.test.ts` is vitest's; `.spec.ts` is Playwright's. Phase 3 added `e2e/`, and the two
    // runners must not collect each other's files — a Playwright spec run under vitest fails
    // on missing globals, and a vitest file run under Playwright fails the same way in
    // reverse. Note this no longer matches `src/**/*.spec.ts`: nothing uses that extension
    // in src today, and allowing it would let a stray e2e-style spec land there and break.
    include: ["src/**/*.test.{ts,tsx}", "e2e/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "html"],
      // Phase 0 item 3 of docs/testing/PHASED_TEST_PLAN.md, ratcheted at the Phase 1
      // exit gate per R3: thresholds are raised to the number actually achieved, so
      // coverage can only fall by someone editing this file — visible in a diff.
      // `supabase/functions/_shared/leakageScan.ts` is listed explicitly, not by a wildcard
      // over `_shared/`: Phase 2 moved the leakage-scan DECISION there so the cron edge
      // function and the vitest suite import the same file rather than the repo's usual
      // "TWIN of X — keep the two in lockstep" comment. Including it here is what makes that
      // file's coverage a real gate; the rest of `_shared/` is untested and would drag the
      // directory floor down without telling anyone anything.
      include: [
        "src/lib/**",
        "supabase/functions/_shared/leakageScan.ts",
        // The seed guard (D5). It stands between a truncating seed script and production,
        // and the failure it prevents cannot be rehearsed — so it is gated like the money
        // and patient-safety surfaces rather than left as infrastructure nobody measures.
        "e2e/fixtures/guard.ts",
      ],
      thresholds: {
        // Whole-directory floor. Low because 175 of 187 src/lib files are still
        // untested; it rises at every later phase's gate. Do not lower it.
        lines: 5.2,
        statements: 5.2,
        functions: 42,
        branches: 83,

        // Per-file gates for the Phase 1 surfaces. These are the real ratchet.
        // drugSafetyCheck sits below 100 on statements/branches because FOUR defensive
        // branches are provably unreachable given the real call graph — see
        // docs/testing/PHASE_1_TEST_CASES.md §Exit gate for the original three (line 110's
        // `?? "none"` fallback in getWorstSeverity, since `worst` can never leave
        // RANK_TO_SEVERITY's 0-4 domain; line 190's empty-`unique` early return in
        // resolveAliases, since checkDrugSafety already rejects a blank newDrug before
        // calling it; line 196's `?? []` in `add()`, since every key it's ever called with was
        // already seeded into the map). KNOWN-BUG-107's fix (2026-09-14) surfaced a fourth:
        // line 261's dedup guard in markUnavailable never fires because every call site builds
        // a differently-prefixed reason string, so no two calls can ever collide. Ratcheted to
        // the number actually achieved with all four excluded, per R3 — not lowered to make a
        // failure go away.
        "src/lib/drugSafetyCheck.ts": { lines: 100, statements: 99, functions: 100, branches: 96 },
        // Added by Phase 1 remediation — the visit_type vocabulary consolidation.
        "src/lib/visitTypes.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/clinicalCalculators.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/bloodCompatibility.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/bloodBagLabel.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/gstRules.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/billTotals.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/currency.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/payerTypes.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/abdm-validators.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/billStatus.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/dayClosureTotals.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        "src/lib/ipdAncillaryGate.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        // Added by D1 in Phase 0 — new src/lib logic gets a test in the same change.
        "src/lib/alertEscalationRules.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },

        // Phase 2 — the three consolidations. Each replaced two or more competing
        // implementations of one decision, so these are the files that must not drift again.
        "src/lib/billedServiceCheck.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
        // 98 not 100: `t.total > 0` in computeTpaPerformance is unreachable — total is
        // incremented before the map is built, so it is never zero there.
        "src/lib/claimKpis.ts": { lines: 100, statements: 100, functions: 100, branches: 98 },
        "supabase/functions/_shared/leakageScan.ts": { lines: 100, statements: 100, functions: 100, branches: 100 },
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
