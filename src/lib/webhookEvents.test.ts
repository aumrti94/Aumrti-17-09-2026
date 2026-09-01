/**
 * CI guard tying the three places an event name exists into agreement:
 *
 *   1. src/lib/apiPlatform.ts       — what the portal offers as a subscription
 *   2. the outbox triggers           — what actually gets emitted
 *   3. docs/api/EVENT_CATALOG.md     — what integrators are told
 *
 * These drift silently and the failure is invisible from either end. A hospital subscribes to an
 * event the portal lists, waits, and nothing ever arrives — because no trigger emits it. Nothing
 * errors; the integration is simply dead, and the first person to notice is the partner whose
 * nightly reconciliation has been empty for a fortnight.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { WEBHOOK_EVENTS, WEBHOOK_EVENT_GROUPS } from "./apiPlatform";
import { ROUTES } from "../../supabase/functions/api-gateway/routes";

const MIGRATIONS = resolve(__dirname, "../../supabase/migrations");
const CATALOG = resolve(__dirname, "../../docs/api/EVENT_CATALOG.md");

/** Every emit_api_event(type, pathPrefix) pair across the whole migration history. */
function emitCalls(): { type: string; pathPrefix: string }[] {
  const calls: { type: string; pathPrefix: string }[] = [];
  for (const file of readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql"))) {
    const sql = readFileSync(resolve(MIGRATIONS, file), "utf8")
      // Strip comments so prose naming an event is not mistaken for a live trigger.
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/--[^\n]*/g, " ");
    for (const m of sql.matchAll(/emit_api_event\(\s*'([a-z_.]+)'\s*,\s*'([^']+)'/g)) {
      calls.push({ type: m[1], pathPrefix: m[2] });
    }
  }
  return calls;
}

function emittedEvents(): Set<string> {
  return new Set(emitCalls().map(c => c.type));
}

describe("webhook event catalogue", () => {
  it("emits every event the portal lets a hospital subscribe to", () => {
    const emitted = emittedEvents();
    const unemitted = WEBHOOK_EVENTS.filter(e => !emitted.has(e));
    expect(
      unemitted,
      "The portal offers these events but no trigger emits them. A hospital that subscribes gets " +
      "silence, with nothing anywhere reporting a fault. Either add the trigger or remove the " +
      "event from WEBHOOK_EVENT_GROUPS.",
    ).toEqual([]);
  });

  it("does not emit an event the portal cannot offer", () => {
    const offered = new Set<string>(WEBHOOK_EVENTS);
    const orphaned = [...emittedEvents()].filter(e => !offered.has(e));
    expect(
      orphaned,
      "These triggers emit an event absent from WEBHOOK_EVENT_GROUPS, so nobody can subscribe to " +
      "it and the outbox row is written for nothing.",
    ).toEqual([]);
  });

  it("points every payload's self link at a route that exists", () => {
    // The thin payload's whole design rests on this: the subscriber receives an id and a link,
    // and calls back with its own API key to get the detail. A self link pointing at a path no
    // route serves gives them a 404 from the very endpoint we told them to use — and nothing on
    // our side reports a fault, because the delivery itself succeeded.
    //
    // This is not hypothetical: the radiology and dispense triggers shipped before their routes
    // did, and emitted links to /v1/radiology/orders, /v1/radiology/reports and
    // /v1/pharmacy/dispenses while all three 404'd.
    const collectionPaths = new Set(
      ROUTES.filter(r => r.method === "GET" && !r.path.includes("{id}")).map(r => r.path),
    );
    const dangling = emitCalls()
      .filter(c => !collectionPaths.has(c.pathPrefix))
      .map(c => `${c.type} → ${c.pathPrefix}`);

    expect(
      [...new Set(dangling)],
      "These triggers build a self link to a path no route serves. Either add the route or " +
      "change the trigger's path prefix.",
    ).toEqual([]);
  });

  it("documents every event in EVENT_CATALOG.md", () => {
    const doc = readFileSync(CATALOG, "utf8");
    const undocumented = WEBHOOK_EVENTS.filter(e => !doc.includes(e));
    expect(
      undocumented,
      "An event an integrator cannot find in the catalogue is one they will never subscribe to.",
    ).toEqual([]);
  });

  it("names every event {domain}.{resource}.{past-tense-verb}", () => {
    // The domain prefix is what keeps the namespace open: Radiology and Lab both have an
    // order.placed, OT and IPD both have a procedure.completed. Renaming after partners have
    // subscribed is a breaking change with no good migration.
    const malformed = WEBHOOK_EVENTS.filter(e => !/^[a-z]+\.[a-z_]+\.[a-z_]+$/.test(e));
    expect(malformed).toEqual([]);
  });

  it("uses past tense throughout", () => {
    // A webhook reports something that has already committed. An event named "paying" describes
    // an intention, and an intention can still fail.
    const presentTense = WEBHOOK_EVENTS.filter(e => /\.(\w*ing)$/.test(e));
    expect(presentTense).toEqual([]);
  });

  it("keeps event names unique across domains", () => {
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const e of WEBHOOK_EVENTS) {
      if (seen.has(e)) duplicates.push(e);
      seen.add(e);
    }
    expect(duplicates).toEqual([]);
  });

  it("groups every event under exactly one domain", () => {
    const flat = WEBHOOK_EVENT_GROUPS.flatMap(g => g.events);
    expect(flat.length).toBe(WEBHOOK_EVENTS.length);
    for (const group of WEBHOOK_EVENT_GROUPS) {
      expect(group.events.length, `domain "${group.domain}" is empty`).toBeGreaterThan(0);
    }
  });
});
