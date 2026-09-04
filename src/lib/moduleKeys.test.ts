import { describe, it, expect } from "vitest";
import { ROUTE_TO_MODULE_KEY, CANONICAL_MODULE_KEYS } from "./moduleKeys";

describe("ROUTE_TO_MODULE_KEY — canonical route → module-key map", () => {
  it("maps the core clinical routes to their expected keys", () => {
    expect(ROUTE_TO_MODULE_KEY["/opd"]).toBe("opd");
    expect(ROUTE_TO_MODULE_KEY["/ipd"]).toBe("ipd");
    expect(ROUTE_TO_MODULE_KEY["/lab"]).toBe("lab");
    expect(ROUTE_TO_MODULE_KEY["/radiology"]).toBe("radiology");
  });

  it("maps both pharmacy modes to their distinct billable keys", () => {
    expect(ROUTE_TO_MODULE_KEY["/pharmacy"]).toBe("pharmacy");
    expect(ROUTE_TO_MODULE_KEY["/pharmacy?mode=retail"]).toBe("pharmacy_retail");
  });

  it("has no empty-string keys or values", () => {
    for (const [route, key] of Object.entries(ROUTE_TO_MODULE_KEY)) {
      expect(route.length).toBeGreaterThan(0);
      expect(key.length).toBeGreaterThan(0);
    }
  });

  it("every route path starts with a slash", () => {
    for (const route of Object.keys(ROUTE_TO_MODULE_KEY)) {
      expect(route.startsWith("/")).toBe(true);
    }
  });
});

describe("CANONICAL_MODULE_KEYS — derived, de-duplicated key list", () => {
  it("contains no duplicates, even though several routes share a key", () => {
    // /teleconsult and /telemedicine both map to "telemedicine"; /quality and
    // /nabh/compliance both map to "quality" — the Set dedup is load-bearing.
    expect(new Set(CANONICAL_MODULE_KEYS).size).toBe(CANONICAL_MODULE_KEYS.length);
  });

  it("includes every distinct value from the route map", () => {
    const routeValues = new Set(Object.values(ROUTE_TO_MODULE_KEY));
    for (const key of routeValues) {
      expect(CANONICAL_MODULE_KEYS).toContain(key);
    }
  });

  it("includes the ai_suite pseudo-module even though it has no route", () => {
    expect(CANONICAL_MODULE_KEYS).toContain("ai_suite");
    expect(Object.values(ROUTE_TO_MODULE_KEY)).not.toContain("ai_suite");
  });
});
