#!/usr/bin/env node
// Aumrti test inventory — generated, never hand-maintained.
//
// Proposed in docs/testing/FULL_COVERAGE_METHODOLOGY.md, built as Phase 0 item 6 of
// docs/testing/PHASED_TEST_PLAN.md §6.
//
// WHY GENERATED. A hand-written coverage checklist is stale the moment someone adds a
// module and forgets to update it — and "forgot to update the checklist" looks exactly
// like "deliberately out of scope". Reading the code's own registries means a new module
// or edge function appears on the checklist the moment it is added to its registry, not
// when someone remembers.
//
// `npm run check:inventory` fails CI if the committed file is stale — the same pattern
// check:openapi and check:lab-catalog already use.
//
// Parsing is deliberately static text scanning, matching how check-rls-coverage.mjs and
// check-db-contract.mjs read the same sources. No TypeScript compilation, so it runs
// anywhere CI runs.

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "docs", "testing", "INVENTORY.generated.md");
const CHECK = process.argv.includes("--check");

const read = (p) => readFileSync(join(ROOT, p), "utf8");

// ── Phase and owner assignment ──────────────────────────────────────────────
//
// Encoded from PHASED_TEST_PLAN.md §7–8 rather than guessed. Phase 10's exit gate forbids
// any row reading "unassigned", so every branch below must terminate in a real phase.

/** src/lib logic introduced by Phase 0 itself — D1's replacement for the retired config. */
const PHASE_0_LIB = new Set(["alertEscalationRules.ts"]);

/** src/lib files the plan names in Phase 1 (§8, Phase 1 target table) plus D10. */
const PHASE_1_LIB = new Set([
  "drugSafetyCheck.ts", "clinicalCalculators.ts", "bloodCompatibility.ts", "bloodBagLabel.ts", "visitTypes.ts",
  "gstRules.ts", "billTotals.ts", "payerTypes.ts", "abdm-validators.ts",
  "billStatus.ts", "dayClosureTotals.ts", "ipdAncillaryGate.ts", "currency.ts",
]);

/**
 * Phase 2 consolidations (§8, Phase 2 extraction table).
 *
 * `leakageScan.ts` is absent on purpose: Phase 2 moved it to
 * `supabase/functions/_shared/` so the cron edge function and the vitest suite import one
 * file rather than two twinned copies. It is outside `src/lib/**` and so outside this
 * inventory, but it IS covered — `vitest.config.ts` names it explicitly.
 */
const PHASE_2_LIB = new Set([
  "billedServiceCheck.ts",
  "claimKpis.ts",
  "serviceCatalogSync.ts",
  "billMoney.ts",
  "gst.ts",
]);

/** The five hubs (§8, Phase 5). */
const HUB_TABLES = new Set([
  "bill_line_items", "clinical_alerts", "insurance_claims", "nabh_evidence_log", "patients",
]);

/** Adoption spine modules, journey-tested in Phase 7.5 (D7). */
const ADOPTION_SPINE = new Set(["/opd", "/pharmacy", "/lab", "/radiology"]);

/** Edge function priority order from D8. Prefix match, first hit wins. */
const EDGE_PRIORITY = [
  { phase: "6", band: "1 PHI", owner: "security-pod", match: (n) =>
      /^(upsert-patient-phi|phi-backfill-encrypt|update-patient-ai-context|export-|generate-discharge-summary|fhir-|lab-analyzer-ingest|ai-)/.test(n) },
  { phase: "6", band: "2 Money", owner: "revenue-pod", match: (n) =>
      /^(generate-invoice|gst-irn-generate|reconcile-journal-postings|email-tally-xml|financial-anomaly-check|daily-leakage-scan|create-razorpay-subscription|razorpay-subscription-webhook|change-subscription-plan|dunning-processor|razorpay-webhook|razorpay-settlement-reconcile)/.test(n) },
  { phase: "6", band: "3 Statutory", owner: "security-pod", match: (n) =>
      /^(abdm-|hcx-|submit-pre-auth-hcx|pmjay-|esi-claim-submit|cghs-eligibility|hmis-portal-submit|idsp-alert-submit)/.test(n) },
  { phase: "6", band: "4 Tenant lifecycle", owner: "platform-pod", match: (n) =>
      /^(register-hospital|setup-hospital|delete-hospital|create-staff-login|admin-impersonate-start|purge-orphaned-users)/.test(n) },
  // D8 defers the patient-payment Razorpay pair unless the pilot needs online payment.
  { phase: "10", band: "5 Deferred", owner: "platform-pod", match: (n) =>
      /^(create-razorpay-order|create-razorpay-payment-link)/.test(n) },
];

function edgePhase(name) {
  for (const p of EDGE_PRIORITY) if (p.match(name)) return p;
  return { phase: "10", band: "5 Long tail", owner: "quality-pod" };
}

function libPhase(file) {
  if (PHASE_0_LIB.has(file)) return { phase: "0", owner: "data-pod" };
  if (PHASE_1_LIB.has(file)) return { phase: "1", owner: "quality-pod" };
  if (PHASE_2_LIB.has(file)) return { phase: "2", owner: "revenue-pod" };
  // Everything else in src/lib is long-tail depth work after the breadth sweep.
  return { phase: "10", owner: "quality-pod" };
}

// ── Sources ─────────────────────────────────────────────────────────────────

function listFiles(dir, filter) {
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === "__snapshots__") continue;
        walk(p);
      } else if (filter(e.name)) {
        out.push(relative(ROOT, p).replace(/\\/g, "/"));
      }
    }
  };
  walk(join(ROOT, dir));
  return out.sort();
}

/** ALL_MODULES entries. Each is one `{ name: "…", …, route: "…", category: "…" }` line. */
function readModules() {
  const src = read("src/lib/modules.ts");
  const block = src.slice(src.indexOf("export const ALL_MODULES"));
  const body = block.slice(0, block.indexOf("\n];"));
  const out = [];
  for (const m of body.matchAll(/\{\s*name:\s*"([^"]+)"[\s\S]*?route:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"/g)) {
    out.push({ name: m[1], route: m[2], category: m[3] });
  }
  return out;
}

/** SETTINGS_CATALOG entries. */
function readSettings() {
  const src = read("src/lib/settingsCatalog.ts");
  const block = src.slice(src.indexOf("export const SETTINGS_CATALOG"));
  const out = [];
  for (const m of block.matchAll(/title:\s*"([^"]+)"[\s\S]{0,400}?route:\s*"([^"]+)"/g)) {
    out.push({ title: m[1], route: m[2] });
  }
  return out;
}

/** Route → roles. ROUTE_ROLES is built from ALL_MODULES plus explicit overrides. */
function readRoutes(modules) {
  const src = read("src/lib/routeRoles.ts");
  const routes = new Map();
  for (const m of modules) routes.set(m.route.split("?")[0], "from ALL_MODULES");
  for (const m of src.matchAll(/ROUTE_ROLES\['([^']+)'\]/g)) routes.set(m[1], "explicit override");
  return [...routes.entries()].map(([route, source]) => ({ route, source })).sort((a, b) => a.route.localeCompare(b.route));
}

/**
 * Table names from the generated Supabase types.
 *
 * types.ts declares more than one schema and `graphql_public` comes FIRST with an empty
 * `Tables: {}`. Anchoring on the first "Tables: {" therefore yields zero tables — silently,
 * since an empty list renders as a valid (and very wrong) section. Anchor on the `public`
 * schema explicitly instead.
 */
function readTables() {
  const src = read("src/integrations/supabase/types.ts");
  const publicAt = src.indexOf("\n  public: {");
  if (publicAt === -1) throw new Error("types.ts: no `public` schema block found");
  const start = src.indexOf("Tables: {", publicAt);
  const end = src.indexOf("Views: {", start);
  if (start === -1 || end === -1) throw new Error("types.ts: public Tables/Views block not found");
  const out = new Set();
  for (const m of src.slice(start, end).matchAll(/^ {6}(\w+): \{$/gm)) out.add(m[1]);
  if (out.size === 0) throw new Error("types.ts: parsed zero tables from the public schema");
  return [...out].sort();
}

function readEdgeFunctions() {
  return readdirSync(join(ROOT, "supabase", "functions"), { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("_"))
    .map((e) => e.name)
    .sort();
}

// ── Coverage probes ─────────────────────────────────────────────────────────

const unitTests = new Set(
  listFiles("src", (n) => /\.(test|spec)\.(ts|tsx)$/.test(n)).map((p) => basename(p).replace(/\.(test|spec)\.(ts|tsx)$/, "")),
);

const hasE2E = existsSync(join(ROOT, "e2e"));
const e2eText = hasE2E
  ? listFiles("e2e", (n) => /\.(ts|tsx)$/.test(n)).map((p) => read(p)).join("\n")
  : "";

const tick = (b) => (b ? "yes" : "—");
const unit = (stem) => tick(unitTests.has(stem));
/**
 * Phase 3 built `e2e/`, so this now searches real spec sources. It stays "—" for most rows
 * because Phase 3's only spec is the harness smoke test — coverage arrives in Phases 5.5+
 * and this column starts reporting on its own as specs land, with no edit here.
 */
const e2e = (needle) => tick(hasE2E && e2eText.includes(needle));

// ── Render ──────────────────────────────────────────────────────────────────

function table(header, rows) {
  return [`| ${header.join(" | ")} |`, `|${header.map(() => "---").join("|")}|`, ...rows].join("\n");
}

function build() {
  const modules = readModules();
  const settings = readSettings();
  const routes = readRoutes(modules);
  const tables = readTables();
  const edge = readEdgeFunctions();
  const libFiles = listFiles("src/lib", (n) => /\.ts$/.test(n) && !/\.(test|spec)\.ts$/.test(n));

  const byCategory = {};
  for (const m of modules) byCategory[m.category] = (byCategory[m.category] || 0) + 1;

  const sections = [];

  sections.push(`## Modules — \`ALL_MODULES\` (${modules.length})

Source: [src/lib/modules.ts](../../src/lib/modules.ts). Every module is smoke-covered in
Phase 5.5 as both tenants (D11); the adoption spine gets journey coverage in Phase 7.5 (D7).

${table(
  ["Module", "Route", "Category", "Unit", "E2E", "Phase", "Owner"],
  modules.map((m) => {
    const spine = ADOPTION_SPINE.has(m.route.split("?")[0]);
    return `| ${m.name} | \`${m.route}\` | ${m.category} | — | ${e2e(m.route)} | ${spine ? "7.5" : "5.5"} | ${spine ? "clinical-pod" : "quality-pod"} |`;
  }),
)}

Category split: ${Object.entries(byCategory).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c} ${n}`).join(", ")}.`);

  sections.push(`## Settings screens — \`SETTINGS_CATALOG\` (${settings.length})

Source: [src/lib/settingsCatalog.ts](../../src/lib/settingsCatalog.ts). Phase 5 requires each
to be behaviour-tested (seed two values, assert the configured module's runtime decision
differs) or explicitly listed as having no verified consumer.

${table(
  ["Screen", "Route", "E2E", "Phase", "Owner"],
  settings.map((s) => `| ${s.title} | \`${s.route}\` | ${e2e(s.route)} | 5 | quality-pod |`),
)}`);

  sections.push(`## Routes — \`ROUTE_ROLES\` (${routes.length})

Source: [src/lib/routeRoles.ts](../../src/lib/routeRoles.ts), generated from \`ALL_MODULES\`
plus explicit overrides. Phase 5.5 sweep 1 asserts each loads for an entitled role and is
refused for a non-entitled one.

${table(
  ["Route", "Source", "E2E", "Phase", "Owner"],
  routes.map((r) => `| \`${r.route}\` | ${r.source} | ${e2e(r.route)} | 5.5 | quality-pod |`),
)}`);

  sections.push(`## Edge functions — \`supabase/functions/\` (${edge.length})

Priority bands from D8. Four assertions each: authenticated request succeeds, missing/invalid
auth rejected, malformed payload does not 500 with a stack trace, no PHI in logs.

${table(
  ["Function", "Band", "Unit", "E2E", "Phase", "Owner"],
  edge.map((n) => {
    const p = edgePhase(n);
    return `| \`${n}\` | ${p.band} | — | ${e2e(n)} | ${p.phase} | ${p.owner} |`;
  }),
)}`);

  sections.push(`## Database tables — generated types (${tables.length})

Source: [src/integrations/supabase/types.ts](../../src/integrations/supabase/types.ts). The
five hubs carry Phase 5 reconciliation tests; every table is isolation-tested in Phase 4.

${table(
  ["Table", "Hub", "Phase", "Owner"],
  tables.map((t) => `| \`${t}\` | ${HUB_TABLES.has(t) ? "**hub**" : "—"} | ${HUB_TABLES.has(t) ? "5" : "4"} | data-pod |`),
)}`);

  sections.push(`## Business logic — \`src/lib/**\` (${libFiles.length})

Source: filesystem. This is what \`vitest.config.ts\` \`coverage.include\` targets and what the
R3 ratchet moves.

${table(
  ["File", "Unit test", "Phase", "Owner"],
  libFiles.map((f) => {
    const name = basename(f);
    const stem = name.replace(/\.ts$/, "");
    const p = libPhase(name);
    return `| [${name}](../../${f}) | ${unit(stem)} | ${p.phase} | ${p.owner} |`;
  }),
)}`);

  const libTested = libFiles.filter((f) => unitTests.has(basename(f).replace(/\.ts$/, ""))).length;

  return `# Test inventory — GENERATED, DO NOT EDIT

Regenerate with \`npm run inventory\`. \`npm run check:inventory\` fails CI if this file is
stale, so edit [scripts/generate-test-inventory.mjs](../../scripts/generate-test-inventory.mjs)
instead — any change made here is overwritten.

Every row carries where it is in [PHASED_TEST_PLAN.md](PHASED_TEST_PLAN.md). Phase 10's exit
gate requires that no row reads "unassigned"; the generator has no such value, so a surface
that does not match a rule lands in Phase 10 explicitly rather than falling off the list.

## Totals

| Layer | Source registry | Rows | Unit-tested |
|---|---|---:|---:|
| Modules | \`ALL_MODULES\` | ${modules.length} | — |
| Settings screens | \`SETTINGS_CATALOG\` | ${settings.length} | — |
| Routes | \`ROUTE_ROLES\` | ${routes.length} | — |
| Edge functions | \`supabase/functions/\` | ${edge.length} | 0 |
| Database tables | generated \`types.ts\` | ${tables.length} | — |
| Business logic | \`src/lib/**\` | ${libFiles.length} | ${libTested} |

**E2E column** is computed by searching the \`e2e/\` sources for the route or function name,
so it starts reporting on its own as specs land — no edit to the generator needed.
${hasE2E ? "`e2e/` exists (Phase 3). Its only spec so far is the harness smoke test, so the column is still `—` almost everywhere; Phases 5.5+ fill it in." : "`e2e/` does not exist yet, so the column is `—` throughout."}

${sections.join("\n\n---\n\n")}
`;
}

const generated = build();

if (CHECK) {
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";
  if (current !== generated) {
    console.error(
      "check:inventory FAILED — docs/testing/INVENTORY.generated.md is stale.\n" +
        "A registry changed (a module, settings screen, route, edge function, table or src/lib file)\n" +
        "without the inventory being regenerated. Run `npm run inventory` and commit the result.",
    );
    process.exit(1);
  }
  const lines = generated.split("\n").length;
  console.log(`check:inventory passed — INVENTORY.generated.md is current (${lines} lines).`);
} else {
  writeFileSync(OUT, generated, "utf8");
  console.log(`Wrote ${relative(ROOT, OUT)}`);
}
