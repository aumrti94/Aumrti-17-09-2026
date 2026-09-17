/**
 * `npm run e2e:seed` — seed the two tenants into local Supabase, and prove it is idempotent.
 *
 * Run directly by Node (24+ strips types natively, so no tsx/ts-node dependency). Playwright
 * calls `seedTier0` from globalSetup; this CLI exists so a developer can seed without running
 * the whole suite, and so the Phase 3 exit-gate idempotency criterion is checkable on demand
 * rather than asserted in prose.
 *
 *   npm run e2e:seed            seed once
 *   npm run e2e:seed -- --check seed twice and diff the state — the exit-gate check
 */
import { seedTier0, snapshotTier0 } from "./tier0.seed.ts";
import { serviceClient } from "./serviceClient.ts";
import { UnsafeSeedTargetError } from "./guard.ts";

async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const svc = serviceClient();

  const { error } = await svc.from("hospitals").select("id").limit(1);
  if (error) {
    console.error(
      [
        `Cannot reach local Supabase: ${error.message}`,
        "",
        "Phase 3 targets local Supabase (D4). Start it first:",
        "  supabase start        (needs Docker running)",
      ].join("\n"),
    );
    process.exit(1);
  }

  console.log("Seeding Tier-0 (two hospitals)…");
  await seedTier0(svc);

  if (!check) {
    console.log("Seed complete.");
    return;
  }

  // The exit gate: "produces byte-identical state on two consecutive runs". Asserted by
  // seeding again and diffing, because a fixture that accumulates rows breaks every
  // "exactly one" assertion on the second run — for a reason that has nothing to do with
  // the code under test, which makes it maddening to diagnose.
  const first = await snapshotTier0(svc);
  console.log("Re-seeding to verify idempotency…");
  await seedTier0(svc);
  const second = await snapshotTier0(svc);

  if (first !== second) {
    console.error("\ncheck FAILED — the seed is NOT idempotent. Two consecutive runs produced different state.");
    const a = first.split("\n");
    const b = second.split("\n");
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      if (a[i] !== b[i]) {
        console.error(`  line ${i + 1}:`);
        console.error(`    run 1: ${(a[i] ?? "<absent>").slice(0, 200)}`);
        console.error(`    run 2: ${(b[i] ?? "<absent>").slice(0, 200)}`);
        break;
      }
    }
    process.exit(1);
  }

  console.log("Seed is idempotent — two consecutive runs produced identical state.");
}

main().catch((err) => {
  if (err instanceof UnsafeSeedTargetError) {
    console.error(err.message);
    process.exit(1);
  }
  console.error(err);
  process.exit(1);
});
