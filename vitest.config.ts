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
      // Phase 1 gate: only the patient-safety + revenue-critical libs are
      // measured and ratcheted. Global coverage will be widened as the suite
      // grows (Sprint 2+). Adding a file here without tests will fail CI.
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
