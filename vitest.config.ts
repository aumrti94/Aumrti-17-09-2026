import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "html"],
      // Two-layer coverage gate for src/lib:
      //   1. `npm run check:lib-test-coverage` (scripts/check-lib-test-coverage.mjs) is the
      //      broad gate — every src/lib file needs *a* test, or a justified EXEMPT/TODO
      //      entry. Wired into CI; catches a new untested file regardless of blended %.
      //   2. The `include`/`thresholds` below are the narrow, stricter gate — a hand-picked
      //      set of patient-safety + revenue-critical libs where "has a test" isn't enough
      //      and a specific statement/branch % floor is enforced. Add a file here when it's
      //      important enough to need more than layer 1; the floor may only rise.
      include: [
        "src/lib/drugSafetyCheck.ts",
        "src/lib/gstRules.ts",
        "src/lib/billTotals.ts",
        "src/lib/clinicalCalculators.ts",
        "src/lib/currency.ts",
        "src/lib/qualityIndicators.ts",
      ],
      // Ratchet FLOORS — set just under current actuals. Coverage may only rise.
      // A regression that drops a safety/finance lib below its floor fails CI.
      thresholds: {
        "src/lib/gstRules.ts": { statements: 100, branches: 95, functions: 100, lines: 100 },
        "src/lib/currency.ts": { statements: 95, branches: 95, functions: 90, lines: 95 },
        "src/lib/clinicalCalculators.ts": { statements: 95, branches: 72, functions: 95, lines: 95 },
        "src/lib/drugSafetyCheck.ts": { statements: 88, branches: 65, functions: 90, lines: 88 },
        // billTotals stmt/line are low because the async Supabase I/O wrapper is
        // intentionally NOT unit-tested; the pure computeBillTotals() is fully
        // covered. Floor locks the pure function's tests in place.
        "src/lib/billTotals.ts": { statements: 20, branches: 80, functions: 50, lines: 20 },
        // Mirrors public.qi_attainment / qi_band_status in SQL — the NABH
        // criterion scores and the dashboard must never disagree, so this stays high.
        "src/lib/qualityIndicators.ts": { statements: 100, branches: 96, functions: 100, lines: 100 },
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
