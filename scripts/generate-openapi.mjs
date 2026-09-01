#!/usr/bin/env node
// Writes the public API's OpenAPI 3.1 spec to docs/api/openapi.json.
//
// The spec is GENERATED, never hand-maintained. A hand-written spec drifts from behaviour the
// first time someone adds a filter and forgets the docs, and the drift is invisible because
// nothing compares the two.
//
// This script builds nothing itself: the spec builder lives in
// supabase/functions/api-gateway/openapi.ts, which the gateway ALSO imports to serve
// /v1/openapi.json at runtime. One implementation, two consumers — a second copy here would
// reintroduce exactly the drift the generation is meant to eliminate.
//
//   node scripts/generate-openapi.mjs           # write the spec
//   node scripts/generate-openapi.mjs --check   # CI: fail if the committed file is stale
//
// The builder is Deno TypeScript, so esbuild bundles it to a temp module before import.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = process.cwd();
const ENTRY = join(ROOT, "supabase", "functions", "api-gateway", "openapi.ts");
const OUTPUT = join(ROOT, "docs", "api", "openapi.json");
const TMP = join(ROOT, "node_modules", ".cache", "aumrti-openapi", "spec.mjs");

const checkOnly = process.argv.includes("--check");

async function loadBuilder() {
  mkdirSync(dirname(TMP), { recursive: true });
  await build({
    // A virtual entry re-exporting both modules, rather than making openapi.ts re-export the
    // registry it merely consumes. Bundling is required either way: Node cannot resolve a `.ts`
    // specifier, and these are Deno modules that import each other with explicit extensions.
    stdin: {
      contents:
        `export { buildOpenApiSpec } from "./openapi.ts";\n` +
        `export { ROUTES, validateRegistry } from "./routes.ts";\n`,
      resolveDir: dirname(ENTRY),
      sourcefile: "openapi-entry.ts",
      loader: "ts",
    },
    outfile: TMP,
    format: "esm",
    platform: "neutral",
    bundle: true,
    logLevel: "silent",
  });
  try {
    return await import(pathToFileURL(TMP).href + `?t=${Date.now()}`);
  } finally {
    rmSync(TMP, { force: true });
  }
}

const { buildOpenApiSpec, ROUTES, validateRegistry } = await loadBuilder();

// Generating documentation from an invalid registry would publish a contract the gateway will
// refuse to start against.
const problems = validateRegistry(ROUTES);
if (problems.length) {
  console.error("generate-openapi: the registry is invalid; refusing to generate a spec from it:");
  for (const p of problems) console.error(`  ${p.method} ${p.path}: ${p.problem}`);
  process.exit(1);
}

const spec = JSON.stringify(buildOpenApiSpec(ROUTES), null, 2) + "\n";

if (checkOnly) {
  let committed = null;
  try { committed = readFileSync(OUTPUT, "utf8"); } catch { /* never generated */ }

  if (committed !== spec) {
    console.error(
      "generate-openapi --check FAILED: docs/api/openapi.json is stale.\n\n" +
      "The registry has changed since the spec was generated, so the published documentation no\n" +
      "longer describes the API. Run `npm run api:openapi` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`generate-openapi --check passed — spec matches the registry (${ROUTES.length} routes).`);
} else {
  mkdirSync(dirname(OUTPUT), { recursive: true });
  writeFileSync(OUTPUT, spec, "utf8");
  const paths = new Set(ROUTES.map(r => r.path)).size;
  console.log(`generate-openapi wrote docs/api/openapi.json — ${ROUTES.length} operations across ${paths} paths.`);
}
