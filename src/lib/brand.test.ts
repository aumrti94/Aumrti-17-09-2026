/**
 * CI guard: the product's domain is aumrti.com, and it lives in exactly two places.
 *
 * It was previously written out as a literal in about forty files — support and sales mailto
 * links, invoice footers, subscription email templates, the white-label CNAME target, the FHIR
 * base URL, the API docs and the OpenAPI spec — with the wrong TLD in every one of them. Nothing
 * connected them, so there was no way to notice and no way to fix them together.
 *
 * A wrong support address is not cosmetic: it is printed on invoices and sent in subscription
 * emails, so a hospital's reply reaches nobody.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { APP_DOMAIN, SUPPORT_EMAIL, API_BASE_URL, CNAME_TARGET } from "./brand";

const ROOT = resolve(__dirname, "../..");

/**
 * Migrations are excluded: they are an applied historical record, and rewriting one that has
 * already run would make the file disagree with the database. The two wrong DEFAULTs they left
 * behind are corrected forward by 20261019000008_brand_domain_aumrti_com.sql instead.
 */
const SCAN_DIRS = ["src", "supabase/functions", "docs", "scripts", "e2e"];
const SKIP_DIRS = /^(node_modules|dist|coverage|\.git|playwright-report|test-results)$/;

function walk(dir: string, acc: string[] = []): string[] {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.test(e.name)) walk(p, acc);
    } else if (/\.(ts|tsx|mjs|cjs|js|md|json)$/.test(e.name)) {
      acc.push(p);
    }
  }
  return acc;
}

describe("brand domain", () => {
  it("is aumrti.com", () => {
    expect(APP_DOMAIN).toBe("aumrti.com");
    expect(SUPPORT_EMAIL).toBe("support@aumrti.com");
    expect(API_BASE_URL).toBe("https://api.aumrti.com/v1");
    expect(CNAME_TARGET).toBe("cname.aumrti.com");
  });

  it("appears nowhere as the old .in literal", () => {
    const offenders: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(join(ROOT, dir))) {
        // Reading its own source would match the needle it is searching for.
        if (/brand\.test\.ts$/.test(file)) continue;
        let src: string;
        try {
          if (statSync(file).size > 2_000_000) continue;
          src = readFileSync(file, "utf8");
        } catch { continue; }
        if (src.includes("aumrti" + ".in")) {
          offenders.push(relative(ROOT, file).replace(/\\/g, "/"));
        }
      }
    }
    expect(
      offenders,
      "The domain is aumrti.com. Import APP_DOMAIN / SUPPORT_EMAIL from src/lib/brand.ts, or " +
      "supabase/functions/_shared/brand.ts inside an edge function — never write the domain out.",
    ).toEqual([]);
  });

  it("keeps the edge-function copy in step with the frontend one", () => {
    // Two files must state the same default, because Deno cannot import from src/. If they drift,
    // an email sent by an edge function and a link rendered in the app disagree.
    const edge = readFileSync(
      join(ROOT, "supabase/functions/_shared/brand.ts"), "utf8",
    );
    const match = edge.match(/APP_DOMAIN\s*=\s*ENV_DOMAIN\s*\?\?\s*"([^"]+)"/);
    expect(match?.[1], "supabase/functions/_shared/brand.ts must default to the same domain").toBe(APP_DOMAIN);
  });
});
