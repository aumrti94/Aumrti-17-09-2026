import { defineConfig, devices } from "@playwright/test";
import { LOCAL_ANON_KEY } from "./e2e/fixtures/serviceClient.ts";

/**
 * Playwright — Phase 3 of docs/testing/PHASED_TEST_PLAN.md.
 *
 * Targets LOCAL Supabase (D4), so nothing here is blocked on cloud provisioning. The chain
 * this config sits in the middle of:
 *
 *   supabase start  →  seed (two hospitals)  →  globalSetup (2 × storageState)  →  specs
 *
 * `testMatch` is `*.spec.ts` and nothing else. Vitest owns `*.test.ts`, including
 * `e2e/fixtures/guard.test.ts` — the two runners share a directory and must not collect each
 * other's files.
 */

/** Local Supabase, as bound by `supabase start` (supabase/config.toml). */
export const LOCAL_SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";

/** Vite dev server, per vite.config.ts `server.port`. */
export const APP_URL = process.env.E2E_BASE_URL ?? "http://127.0.0.1:8080";

export default defineConfig({
  testDir: "./e2e",
  // Specs only. Without this, `e2e/fixtures/guard.test.ts` — a vitest file — would be
  // collected here and fail on a missing `describe`.
  testMatch: "**/*.spec.ts",

  // Assertions go to the database, which is fast; a spec that needs more than 30s is
  // usually waiting on something that will never arrive.
  timeout: 30_000,
  expect: { timeout: 5_000 },

  // A `.only` left in a spec silently narrows CI to one test while still reporting green.
  forbidOnly: !!process.env.CI,

  // R4 (flake policy): no retries. A retry turns a real intermittent defect into a green
  // run, and this codebase's defects are already silent enough. A flaky spec is quarantined
  // and fixed, not retried.
  retries: 0,

  // Serial in CI: every spec restores the same template snapshot, so parallel workers would
  // race on one database. Phase 8 revisits this if the suite gets slow enough to need it.
  workers: process.env.CI ? 1 : undefined,
  fullyParallel: false,

  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: APP_URL,
    // Traces and screenshots only on failure — the point is diagnosing a red run, and
    // always-on artefacts make CI slow and the storage bill silly.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
    actionTimeout: 10_000,
    // The app is tablet-first at a 768px breakpoint (CLAUDE.md), so the default viewport is
    // a tablet rather than a desktop — a nurse station is the primary device.
    viewport: { width: 1024, height: 768 },
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  },

  // Seeds the two tenants and writes the two storageState files.
  globalSetup: "./e2e/global-setup.ts",

  projects: [
    {
      name: "hospital-a",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/hospital-a.json" },
    },
    {
      name: "hospital-b",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/hospital-b.json" },
      // isolation.spec.ts asserts BOTH hospitals from a single run and builds its own tenant
      // clients rather than using storageState — collecting it under this project too would
      // double-seed and race on the same fixture rows.
      testIgnore: "**/isolation.spec.ts",
    },
  ],

  // Starts the app if it is not already running. `reuseExistingServer` off in CI so a stale
  // process cannot serve a stale build to the suite.
  webServer: {
    command: "npm run dev",
    url: APP_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    // Overrides .env.local, which points at a developer's real cloud project — every dev
    // machine has one, since that is what `npm run dev` is for day to day. Without this the
    // spawned app authenticates against the cloud project while the storageState sessions
    // (minted in global-setup.ts against LOCAL Supabase) are signed by a different JWT
    // secret entirely, so nothing about the session is valid there. The symptom is not an
    // auth error — it's AuthGuard sitting in its loading state forever, which from
    // Playwright's side just looks like `page.goto` timing out with no explanation.
    // Vite/dotenv does not override an already-set process.env value with a .env.local one,
    // so setting these here beats the file for exactly this child process.
    env: {
      VITE_SUPABASE_URL: LOCAL_SUPABASE_URL,
      VITE_SUPABASE_ANON_KEY: LOCAL_ANON_KEY,
    },
  },
});
