/**
 * CI guard for the public API route registry.
 *
 * The gateway also validates the registry at start-up, but that only fails the deploy — by which
 * point the mistake is already merged. This runs in `npm run test:coverage`, which CI already
 * executes, so a route that violates the design standard fails the pull request instead.
 *
 * The rules being enforced are in docs/api/API_DESIGN_STANDARD.md. They are worth failing a build
 * over because each one, skipped once, is a defect that is invisible until it is expensive:
 * a missing tenant predicate is a cross-tenant leak; a missing PHI purpose is a DPDP finding; a
 * SELECT * is a column you can never remove again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ROUTES,
  validateRegistry,
  matchRoute,
  type RouteDef,
} from "../../supabase/functions/api-gateway/routes";
import { API_SCOPES, WEBHOOK_EVENTS } from "./apiPlatform";

describe("api route registry", () => {
  it("satisfies every rule in the design standard", () => {
    const problems = validateRegistry();
    expect(
      problems,
      `Route registry violations:\n${problems.map(p => `  ${p.method} ${p.path}: ${p.problem}`).join("\n")}`,
    ).toEqual([]);
  });

  it("only uses scopes the portal can actually grant", () => {
    // A route gated on a scope absent from the portal's chip list is unreachable: no admin can
    // issue a key that satisfies it, and the endpoint returns 403 forever with no way to fix it
    // from the UI.
    const grantable = new Set<string>(API_SCOPES);
    const orphaned = ROUTES.filter(r => !grantable.has(r.scope));
    expect(
      orphaned.map(r => `${r.method} ${r.path} → ${r.scope}`),
      "These routes require a scope that Settings → API Portal cannot grant.",
    ).toEqual([]);
  });

  it("never exposes a route without a tenant predicate", () => {
    // The single most consequential rule. The gateway runs as service role and bypasses RLS, so
    // this predicate is the only thing standing between one hospital's key and another
    // hospital's patients.
    const untenanted = ROUTES.filter(r => r.tenantColumn !== "hospital_id");
    expect(
      untenanted.map(r => `${r.method} ${r.path} → ${r.tenantColumn}`),
      "Every public route must be scoped by hospital_id taken from the authenticated key.",
    ).toEqual([]);
  });

  it("accepts no hospital_id parameter anywhere", () => {
    // If a caller could name the tenant, the tenant predicate would be advisory.
    const leaky = ROUTES.flatMap(r =>
      (r.filters ?? [])
        .filter(f => /hospital/i.test(f.param) || /hospital/i.test(f.column))
        .map(f => `${r.method} ${r.path} → ${f.param}`),
    );
    expect(leaky, "No endpoint may accept a hospital identifier from the caller.").toEqual([]);
  });

  it("declares a DPDP purpose for every PHI route", () => {
    const undocumented = ROUTES
      .filter(r => r.phi && !r.phiPurpose?.trim())
      .map(r => `${r.method} ${r.path}`);
    expect(
      undocumented,
      "DPDP Act 2023 purpose limitation: a route returning patient data must record why.",
    ).toEqual([]);
  });

  it("routes every path to exactly one handler", () => {
    const collisions: string[] = [];
    for (const r of ROUTES) {
      // A concrete path built from the pattern must match the pattern it came from — not a
      // different one that happens to have the same shape.
      const concrete = r.path.replace(/\{id\}/g, "11111111-2222-3333-4444-555555555555");
      const hit = matchRoute(r.method, concrete);
      if (!hit) collisions.push(`${r.method} ${r.path} matches nothing`);
      else if (hit.route.path !== r.path) {
        collisions.push(`${r.method} ${r.path} resolves to ${hit.route.path}`);
      }
    }
    expect(collisions).toEqual([]);
  });

  it("does not match a path belonging to no route", () => {
    expect(matchRoute("GET", "/v1/nonexistent")).toBeNull();
    expect(matchRoute("GET", "/v1/patients/extra/segments")).toBeNull();
    // Method is part of the match: an unimplemented verb must 404 rather than fall through to
    // the GET handler for the same path.
    expect(matchRoute("DELETE", "/v1/patients")).toBeNull();
    expect(matchRoute("POST", "/v1/bills")).toBeNull();
  });

  it("routes each write verb to its own handler", () => {
    expect(matchRoute("POST", "/v1/patients")?.route.write?.handler).toBe("patients.create");
    expect(matchRoute("POST", "/v1/appointments")?.route.write?.handler).toBe("table");
    expect(matchRoute("PATCH", "/v1/patients/11111111-2222-3333-4444-555555555555")?.route.method)
      .toBe("PATCH");
  });

  it("extracts path parameters", () => {
    const hit = matchRoute("GET", "/v1/patients/11111111-2222-3333-4444-555555555555");
    expect(hit?.route.path).toBe("/v1/patients/{id}");
    expect(hit?.params.id).toBe("11111111-2222-3333-4444-555555555555");
  });

  it("keeps the pagination tiebreaker available on every collection", () => {
    // buildPage() reads row.id and row[sort] to mint the next cursor. If either is missing from
    // the projection the cursor silently becomes "undefined|undefined" and paging breaks on
    // page two — long after the change that caused it.
    const broken = ROUTES
      .filter((r: RouteDef) => r.method === "GET" && !r.path.includes("{id}"))
      .filter(r => !r.select.includes("id") || !r.sort || !r.select.includes(r.sort))
      .map(r => `${r.method} ${r.path}`);
    expect(broken).toEqual([]);
  });

  it("never lets a caller choose the tenant, the id, or the UHID", () => {
    // hospital_id is assigned from the authenticated key at exactly one place in the gateway.
    // A writable hospital_id would make that assignment overridable from the request body.
    // uhid is allocated by the hospital's own atomic sequence; a caller-supplied one collides.
    const violations = ROUTES.flatMap(r =>
      (r.write?.writable ?? [])
        .filter(f => ["id", "hospital_id", "uhid", "created_at", "updated_at"].includes(f))
        .map(f => `${r.method} ${r.path} → ${f}`),
    );
    expect(violations).toEqual([]);
  });

  it("makes every bare table write justify itself", () => {
    // handler:"table" asserts the database enforces this resource's rules. The assertion has to
    // name them, so a reviewer can check the claim rather than take it on faith.
    const unjustified = ROUTES
      .filter(r => r.write?.handler === "table" && !r.write.dbEnforcedInvariants?.length)
      .map(r => `${r.method} ${r.path}`);
    expect(unjustified).toEqual([]);
  });

  it("gates every write behind a write scope", () => {
    const underGated = ROUTES
      .filter(r => r.write && !r.scope.startsWith("write:"))
      .map(r => `${r.method} ${r.path} → ${r.scope}`);
    expect(underGated).toEqual([]);
  });

  it("emits only catalogued events", () => {
    // An event the catalogue does not list is one no hospital can subscribe to, and one whose
    // name will quietly change the first time someone notices it is undocumented.
    const catalogued = new Set(WEBHOOK_EVENTS);
    const uncatalogued = ROUTES
      .filter(r => r.write?.emits && !catalogued.has(r.write.emits))
      .map(r => `${r.method} ${r.path} → ${r.write!.emits}`);
    expect(
      uncatalogued,
      "Add the event to WEBHOOK_EVENT_GROUPS in src/lib/apiPlatform.ts and to docs/api/EVENT_CATALOG.md.",
    ).toEqual([]);
  });

  it("does not expose a generic write for resources with app-layer numbering", () => {
    // bills must go through the generate_bill_number() RPC and admissions through
    // generate_admission_number(). A registry insert would bypass both and produce a document
    // with a duplicate or missing statutory number.
    const unsafe = ROUTES
      .filter(r => r.write?.handler === "table" && ["bills", "admissions"].includes(r.table))
      .map(r => `${r.method} ${r.path}`);
    expect(
      unsafe,
      "These resources allocate a statutory number via RPC — they need a delegated handler, not a table insert.",
    ).toEqual([]);
  });

  it("never paginates on a nullable column", () => {
    // Keyset pagination compares `sortColumn > cursorValue`. In Postgres every comparison against
    // NULL is NULL, so a row whose sort column is NULL matches no page and is silently
    // unreachable — the list is quietly incomplete, with no error anywhere.
    //
    // This is not hypothetical: /v1/inventory/stock originally sorted on expiry_date, which is
    // nullable, so it would have hidden exactly the items that never expire.
    //
    // Nullability is checked against the generated types: `col: string | null` in a table's Row.
    const types = readFileSync(
      resolve(__dirname, "../integrations/supabase/types.ts"), "utf8",
    );

    const nullableColumns = (table: string): Set<string> => {
      const start = types.indexOf(`\n      ${table}: {`);
      if (start < 0) return new Set();
      const rowStart = types.indexOf("Row: {", start);
      const rowEnd = types.indexOf("\n        }", rowStart);
      if (rowStart < 0 || rowEnd < 0) return new Set();
      const body = types.slice(rowStart, rowEnd);
      const nullable = new Set<string>();
      for (const m of body.matchAll(/^ {10}(\w+): .*\| null$/gm)) nullable.add(m[1]);
      return nullable;
    };

    // 20261019000006 makes created_at NOT NULL on exactly the tables the API paginates over.
    // types.ts cannot reflect that until the migration is applied and types regenerated, so the
    // tables it names are read out of the migration itself — the same technique
    // check-rls-coverage.mjs uses to see through its dynamic ALTER loop.
    const pendingNotNull = (() => {
      const named = new Set<string>();
      try {
        const sql = readFileSync(
          resolve(__dirname, "../../supabase/migrations/20261019000006_api_pagination_sort_not_null.sql"),
          "utf8",
        );
        const arr = sql.match(/v_tables\s+text\[\]\s*:=\s*ARRAY\s*\[([\s\S]*?)\]/);
        if (arr) for (const m of arr[1].matchAll(/'([a-z_]+)'/g)) named.add(m[1]);
      } catch { /* migration removed — then the guard simply enforces types.ts */ }
      return named;
    })();

    const offenders: string[] = [];
    for (const r of ROUTES) {
      if (r.method !== "GET" || r.path.includes("{id}") || !r.sort) continue;
      // A table absent from types.ts is a pending migration, not a nullability question.
      if (!types.includes(`\n      ${r.table}: {`)) continue;
      if (!nullableColumns(r.table).has(r.sort)) continue;
      // Nullable in types.ts, but a migration already fixes it.
      if (r.sort === "created_at" && pendingNotNull.has(r.table)) continue;
      offenders.push(`${r.path} sorts on ${r.table}.${r.sort}, which is nullable`);
    }

    expect(
      offenders,
      "Pick a NOT NULL column — created_at where it exists, otherwise id.",
    ).toEqual([]);
  });

  it("covers the v1 core spine", () => {
    // The agreed v1 surface. This fails if a module is dropped during a refactor — a resource
    // quietly vanishing from the public API is a breaking change for whoever integrated on it.
    const modules = new Set(ROUTES.map(r => r.module));
    for (const required of ["patients", "scheduling", "opd", "ipd", "billing", "lab", "pharmacy", "masters"]) {
      expect(modules.has(required), `v1 must expose the "${required}" module`).toBe(true);
    }
  });
});
