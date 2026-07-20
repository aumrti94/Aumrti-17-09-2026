import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The Deno copy at supabase/functions/_shared/platform-billing.ts must stay in
 * step with src/lib/platformBilling.ts.
 *
 * Edge functions can't import from src/, and vitest can't see
 * supabase/functions/ — and with no local Deno or Docker, the copy is only
 * exercised in production. A silent drift between the two would mean the price
 * shown at checkout and the price bound to the Razorpay plan disagree, which is
 * the exact class of bug this whole change set exists to fix.
 *
 * Rather than compare whole files (they legitimately differ in imports and
 * header comments), this compares each exported function body after
 * normalising whitespace.
 */

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src/lib/platformBilling.ts");
const DENO = path.join(ROOT, "supabase/functions/_shared/platform-billing.ts");
const GST = path.join(ROOT, "src/lib/gst.ts");

/** Extracts `export function NAME(...) { ... }` bodies keyed by name. */
function extractFunctions(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const re = /export function (\w+)/g;
  let m: RegExpExecArray | null;

  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    // Walk from the first '{' after the signature, counting braces.
    const start = source.indexOf("{", m.index);
    if (start === -1) continue;
    let depth = 0;
    let end = start;
    for (let i = start; i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    const body = source.slice(start, end + 1).replace(/\s+/g, " ").trim();
    out.set(name, body);
  }
  return out;
}

describe("platformBilling Deno parity", () => {
  const srcFns = extractFunctions(fs.readFileSync(SRC, "utf8"));
  const denoFns = extractFunctions(fs.readFileSync(DENO, "utf8"));
  const gstFns = extractFunctions(fs.readFileSync(GST, "utf8"));

  it("mirrors every exported function from src/lib/platformBilling.ts", () => {
    const missing = [...srcFns.keys()].filter((n) => !denoFns.has(n));
    expect(missing, `Missing from the Deno copy: ${missing.join(", ")}`).toEqual([]);
  });

  it.each([...srcFns.keys()])("has an identical body for %s", (name) => {
    expect(denoFns.get(name)).toBe(srcFns.get(name));
  });

  it("mirrors the gst.ts helpers it inlines", () => {
    // platformBilling.ts imports these; the Deno copy inlines them, so they
    // must match gst.ts rather than platformBilling.ts.
    for (const name of ["stateCodeFromGstin", "resolveStateCode"]) {
      expect(denoFns.get(name), `${name} missing or drifted in the Deno copy`)
        .toBe(gstFns.get(name));
    }
  });

  it("does not let the Deno copy export anything the source lacks", () => {
    const inlinedFromGst = new Set(["stateCodeFromGstin", "resolveStateCode"]);
    const extra = [...denoFns.keys()].filter((n) => !srcFns.has(n) && !inlinedFromGst.has(n));
    expect(extra, `Extra in the Deno copy: ${extra.join(", ")}`).toEqual([]);
  });
});
