import { describe, it, expect } from "vitest";
import { ALL_MODULES, CATEGORY_COLORS, ModuleCategory } from "./modules";

describe("ALL_MODULES — the /modules grid catalogue", () => {
  it("has a unique route for every tile — two tiles can never collide on click", () => {
    const routes = ALL_MODULES.map((m) => m.route);
    expect(new Set(routes).size).toBe(routes.length);
  });

  it("gives every module a non-empty name, description, icon, and route", () => {
    for (const m of ALL_MODULES) {
      expect(m.name.length).toBeGreaterThan(0);
      expect(m.desc.length).toBeGreaterThan(0);
      expect(m.icon.length).toBeGreaterThan(0);
      expect(m.route.startsWith("/")).toBe(true);
    }
  });

  it("assigns every module a category that has a defined color", () => {
    for (const m of ALL_MODULES) {
      expect(CATEGORY_COLORS[m.category]).toBeDefined();
    }
  });

  it("gives every module at least one role that can access it — an unreachable module is a bug", () => {
    for (const m of ALL_MODULES) {
      expect(m.roles.length).toBeGreaterThan(0);
    }
  });

  it("grants super_admin access to every module — the platform override role", () => {
    const missing = ALL_MODULES.filter((m) => !m.roles.includes("super_admin"));
    expect(missing).toEqual([]);
  });

  it("matches the canonical tile count recorded in docs/product/FACT_BASE.md", () => {
    // Regenerate docs/product/MODULE_CATALOGUE.md (npm run docs:modules) if this
    // count is meant to change — the fact base is generated from this file, not
    // the other way around, so a mismatch here means the docs are stale, not this test.
    expect(ALL_MODULES.length).toBe(67);
  });
});

describe("CATEGORY_COLORS", () => {
  it("defines a color for every ModuleCategory", () => {
    const categories: ModuleCategory[] = [
      "Clinical", "Diagnostics", "Surgical", "Pharmacy", "Finance",
      "Operations", "Specialized", "Patient", "Analytics", "Settings",
    ];
    for (const c of categories) {
      expect(CATEGORY_COLORS[c]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});
