/**
 * Playwright globalSetup — seed, then sign in as each tenant and save its session.
 *
 * Produces `e2e/.auth/hospital-a.json` and `e2e/.auth/hospital-b.json`, the two
 * `storageState` files the two projects in playwright.config.ts use. That is what makes the
 * Phase 3 exit gate — "a trivial smoke spec runs green **as two different hospitals**" —
 * achievable without every spec logging in through the UI.
 *
 * Signing in via the Supabase JS client rather than by driving the login form is deliberate:
 * the login UI is a thing under test in later phases, and a harness that depends on it breaks
 * every spec whenever that form changes.
 */
import type { FullConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { HOSPITAL_A, HOSPITAL_B, TEST_PASSWORD, staffEmail, type TenantKey } from "./fixtures/constants.ts";
import { assertLocalTarget } from "./fixtures/guard.ts";
import { localSupabaseUrl, serviceClient, tenantClient } from "./fixtures/serviceClient.ts";
import { seedTier0 } from "./fixtures/tier0.seed.ts";

const AUTH_DIR = resolve(process.cwd(), "e2e/.auth");

/** Where supabase-js keeps its session in localStorage. */
function storageKeyFor(supabaseUrl: string): string {
  // supabase-js derives the key from the project ref — the first hostname label.
  const ref = new URL(supabaseUrl).hostname.split(".")[0];
  return `sb-${ref}-auth-token`;
}

async function writeStorageState(tenant: TenantKey, appOrigin: string): Promise<string> {
  const url = localSupabaseUrl();
  // Sign in as the tenant's admin — the broadest role, so one state file serves specs that
  // need any screen. Specs needing a narrower role sign in themselves.
  const client = await tenantClient(staffEmail(tenant, "hospital_admin"), TEST_PASSWORD);
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error(`No session returned for tenant ${tenant} after sign-in.`);

  const state = {
    cookies: [],
    origins: [
      {
        origin: appOrigin,
        localStorage: [
          {
            name: storageKeyFor(url),
            value: JSON.stringify({
              access_token: data.session.access_token,
              refresh_token: data.session.refresh_token,
              expires_at: data.session.expires_at,
              expires_in: data.session.expires_in,
              token_type: "bearer",
              user: data.session.user,
            }),
          },
        ],
      },
    ],
  };

  const file = resolve(AUTH_DIR, `hospital-${tenant}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, 2), "utf8");
  return data.session.user.id;
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  const supabaseUrl = localSupabaseUrl();

  // Fail here, loudly, rather than letting a spec fail confusingly twenty seconds later.
  assertLocalTarget(supabaseUrl, process.env.SUPABASE_PROJECT_REF);

  const svc = serviceClient();
  const { error } = await svc.from("hospitals").select("id").limit(1);
  if (error) {
    throw new Error(
      [
        `Cannot reach local Supabase at ${supabaseUrl}: ${error.message}`,
        "",
        "Phase 3 targets local Supabase (D4). Start it first:",
        "  supabase start",
        "",
        "That needs Docker running.",
      ].join("\n"),
    );
  }

  await seedTier0(svc);

  const appOrigin = new URL(config.projects[0]?.use?.baseURL ?? "http://127.0.0.1:8080").origin;
  const uidA = await writeStorageState("a", appOrigin);
  const uidB = await writeStorageState("b", appOrigin);

  // The two state files MUST hold different sessions. If both projects ran as the same
  // tenant, every isolation assertion in Phase 4 would pass vacuously — and pass quietly,
  // which is the failure shape this whole plan is organised against.
  if (uidA === uidB) {
    throw new Error(
      "Both storageState files resolved to the same auth user. The two Playwright projects would run as one tenant and isolation assertions would pass without proving anything.",
    );
  }

  console.log(
    `Tier-0 seeded: ${HOSPITAL_A.name} (${HOSPITAL_A.id}) and ${HOSPITAL_B.name} (${HOSPITAL_B.id}).`,
  );
}
