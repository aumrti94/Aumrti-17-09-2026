/**
 * Guards for the Settings hub catalog + module-aware search.
 *
 * The load-bearing test here is "no settings page is missing": it reads App.tsx and fails
 * the moment someone ships a /settings route without a catalog entry. Six pages had already
 * drifted out of the old hardcoded card list that way (modules, templates, api-portal, hl7,
 * white-label, product-mode) and were unreachable by browsing OR search.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  SETTINGS_CATALOG,
  SEARCHABLE_MODULE_KEYS,
  MODULE_ALIASES,
  SETTINGS_GROUP_ORDER,
  searchSettings,
  resolveModuleQuery,
  entryRoute,
  crossCuttingHint,
  moduleLabel,
  moduleShortLabel,
} from "./settingsCatalog";

const routesOf = (entries: { route: string }[]) => entries.map((e) => e.route);
const bare = (route: string) => route.split("?")[0];

/** Every /settings/* (and settings-owned /admin, /ims) route declared in the router. */
function routerSettingsRoutes(): string[] {
  const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
  const found = new Set<string>();
  for (const m of app.matchAll(/<Route\s+path="([^"]+)"/g)) {
    const path = m[1];
    if (path === "/settings") continue; // the hub itself
    if (path.startsWith("/settings/")) found.add(path);
  }
  return [...found];
}

describe("catalog integrity", () => {
  it("has an entry for every settings route declared in App.tsx", () => {
    const missing = routerSettingsRoutes().filter(
      (r) => !SETTINGS_CATALOG.some((e) => bare(e.route) === r),
    );
    expect(missing).toEqual([]);
  });

  it("only points at routes that actually exist", () => {
    const real = new Set(routerSettingsRoutes());
    const dangling = SETTINGS_CATALOG.map((e) => bare(e.route))
      .filter((r) => r.startsWith("/settings/"))
      .filter((r) => !real.has(r));
    expect(dangling).toEqual([]);
  });

  it("uses only known module keys and known display groups", () => {
    const known = new Set(SEARCHABLE_MODULE_KEYS);
    for (const e of SETTINGS_CATALOG) {
      for (const m of e.modules) {
        expect(known.has(m), `${e.title} tagged with unknown module "${m}"`).toBe(true);
      }
      expect(SETTINGS_GROUP_ORDER).toContain(e.group as never);
      for (const key of Object.keys(e.moduleDeepLinks ?? {})) {
        expect(known.has(key), `${e.title} deep-links unknown module "${key}"`).toBe(true);
      }
    }
  });

  it("has no duplicate title+route pairs", () => {
    const seen = SETTINGS_CATALOG.map((e) => `${e.title}::${e.route}`);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("aliases only reference real modules", () => {
    const known = new Set(SEARCHABLE_MODULE_KEYS);
    expect(Object.keys(MODULE_ALIASES).filter((k) => !known.has(k))).toEqual([]);
  });
});

describe("every module is searchable", () => {
  // `settings` is the hub itself; every other module must lead somewhere.
  const modules = SEARCHABLE_MODULE_KEYS.filter((k) => k !== "settings");

  it.each(modules)("%s resolves and returns at least one settings page", (key) => {
    expect(resolveModuleQuery(key)).toContain(key);
    expect(searchSettings(key).direct.length).toBeGreaterThan(0);
  });

  it.each(modules)("%s is reachable by its display label", (key) => {
    const res = searchSettings(moduleLabel(key));
    expect(res.direct.length + res.crossCutting.length).toBeGreaterThan(0);
  });
});

describe("pharmacy — the reported case", () => {
  const res = searchSettings("pharmacy");

  it("resolves to the pharmacy modules", () => {
    expect(res.moduleKeys).toContain("pharmacy");
  });

  it("surfaces the pages that directly configure pharmacy", () => {
    expect(routesOf(res.direct)).toEqual(
      expect.arrayContaining([
        "/settings/drugs",
        "/settings/inventory",
        "/settings/services",
        "/settings/gst",
        "/settings/ipd-ancillary-payment",
      ]),
    );
  });

  it("surfaces the cross-cutting pages that also configure pharmacy", () => {
    expect(routesOf(res.crossCutting)).toEqual(
      expect.arrayContaining([
        "/settings/staff",
        "/settings/config-values",
        "/settings/roles",
        "/admin/data-migration",
      ]),
    );
  });

  it("does not return unrelated pages", () => {
    const direct = routesOf(res.direct);
    expect(direct).not.toContain("/settings/ot-checklist");
    expect(direct).not.toContain("/settings/abdm");
    expect(direct).not.toContain("/settings/branding");
    expect(direct).not.toContain("/settings/doctor-schedules");
  });
});

describe("ranking and match precision", () => {
  it("puts the page the module is primarily about first", () => {
    expect(searchSettings("pharmacy").direct[0].title).toBe("Drug Formulary");
    expect(searchSettings("lab").direct[0].title).toBe("Lab Test Master");
    expect(searchSettings("radiology").direct[0].title).toBe("Radiology Modalities");
    expect(searchSettings("insurance").direct[0].title).toBe("Payer Masters");
  });

  it("matches on word starts, not mid-word substrings", () => {
    // "hr" must not drag in T-hr-esholds / C-hr-onic Disease.
    const titles = searchSettings("hr").direct.map((e) => e.title);
    expect(titles).not.toContain("Alert Thresholds");
    expect(titles).toContain("Shifts");
  });

  it("drops the system acronym from headings", () => {
    expect(moduleShortLabel("lab")).toBe("Laboratory");
    expect(moduleShortLabel("radiology")).toBe("Radiology");
    expect(moduleShortLabel("pharmacy")).toBe("Pharmacy");
  });
});

describe("no unrelated results for other modules", () => {
  const cases: Array<[string, string[]]> = [
    ["lab",       ["/settings/drugs", "/settings/ot-checklist", "/settings/branding"]],
    ["ot",        ["/settings/drugs", "/settings/abdm", "/settings/language"]],
    ["hr",        ["/settings/lab-tests", "/settings/radiology", "/settings/abdm"]],
    ["radiology", ["/settings/drugs", "/settings/lab-tests", "/settings/branding"]],
    ["billing",   ["/settings/ot-checklist", "/settings/abdm", "/settings/branding"]],
  ];

  it.each(cases)("%s excludes unrelated pages", (query, forbidden) => {
    const direct = routesOf(searchSettings(query).direct);
    for (const f of forbidden) expect(direct).not.toContain(f);
  });

  it("lab returns its own pages", () => {
    expect(routesOf(searchSettings("lab").direct)).toEqual(
      expect.arrayContaining(["/settings/lab-tests"]),
    );
  });
});

describe("aliases people actually type", () => {
  const cases: Array<[string, string]> = [
    ["pathology", "lab"],
    ["lims", "lab"],
    ["theatre", "ot"],
    ["surgery", "ot"],
    ["x-ray", "radiology"],
    ["imaging", "radiology"],
    ["chemist", "pharmacy"],
    ["medicine", "pharmacy"],
    ["tpa", "insurance"],
    ["payroll", "hr"],
    ["ayushman", "pmjay"],
    ["nabh", "quality"],
    ["abha", "abdm"],
    ["stock", "inventory"],
  ];

  it.each(cases)("%s → %s", (query, key) => {
    expect(resolveModuleQuery(query)).toContain(key);
    expect(searchSettings(query).direct.length).toBeGreaterThan(0);
  });

  it("short keys still work exactly", () => {
    expect(resolveModuleQuery("ot")).toContain("ot");
    expect(resolveModuleQuery("hr")).toContain("hr");
  });
});

describe("plain-text queries keep working", () => {
  it.each([
    ["gst", "/settings/gst"],
    ["backup", "/settings/backup"],
    ["razorpay", "/settings/razorpay"],
    ["consent", "/settings/consent-forms"],
    ["shift", "/settings/shifts"],
  ])("%s finds %s", (query, route) => {
    expect(routesOf(searchSettings(query).direct)).toContain(route);
  });

  it("an unknown term returns nothing at all", () => {
    const res = searchSettings("zzzznotathing");
    expect(res.direct).toEqual([]);
    expect(res.crossCutting).toEqual([]);
  });

  it("an empty query returns nothing", () => {
    expect(searchSettings("   ").direct).toEqual([]);
  });
});

describe("deep links and hints", () => {
  it("sends a pharmacy dropdown search straight to drug routes", () => {
    const dropdowns = SETTINGS_CATALOG.find((e) => e.route === "/settings/config-values")!;
    expect(entryRoute(dropdowns, "pharmacy")).toBe("/settings/config-values?cat=drug_routes");
    expect(entryRoute(dropdowns)).toBe("/settings/config-values");
  });

  it("explains why a cross-cutting page matched", () => {
    const staff = SETTINGS_CATALOG.find((e) => e.route === "/settings/staff")!;
    expect(crossCuttingHint(staff, "pharmacy")).toMatch(/staff/i);
    expect(crossCuttingHint(staff, undefined)).toBeUndefined();
  });
});
