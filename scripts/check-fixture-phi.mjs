#!/usr/bin/env node
// Aumrti CI guard — no PHI, and nothing PHI-shaped, in test fixtures.
//
// D5, enforcement mechanism 2 of docs/testing/PHASED_TEST_PLAN.md §2:
// "A `check:fixture-phi` CI script fails if any file under `e2e/fixtures/` contains a
//  pattern matching a real-format Aadhaar, ABHA, or mobile number outside the reserved
//  test ranges."
//
// WHY THIS IS A CI GATE AND NOT A CONVENTION. Fixture data does not stay in the repo. It gets
// pasted into issues, printed in CI logs, attached to screenshots in bug reports, and copied
// into Slack when someone asks "what does the seed look like?". A realistic-looking Aadhaar
// in a fixture is therefore a DPDP exposure with a much wider blast radius than the file it
// lives in — and it is indistinguishable, to every downstream reader, from a real one.
//
// The check is deliberately structural rather than a validity test: it does NOT try to decide
// whether a number is a real person's. It fails on anything SHAPED like a real identifier,
// because "this Aadhaar is fake, I promise" is not a claim a reviewer can verify.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["e2e"];

// ── Reserved test ranges ─────────────────────────────────────────────────────
//
// Mobiles: 9000000000–9000009999 is the placeholder block used across this repo and the
// skills. It is a valid Indian series (starts with 9), which is the point — a fixture has to
// exercise the same validation a real number does — but the 900000xxxx prefix is not
// allocated to a live subscriber block in practice and is recognisable on sight as a fixture.
const ALLOWED_MOBILE = /^90000\d{5}$/;

// Aadhaar: UIDAI does not issue numbers starting 0 or 1, so a repdigit like 222222222222 is
// structurally valid-looking yet cannot be anyone's. Repdigits are the only 12-digit form
// permitted in a fixture.
const ALLOWED_AADHAAR_REPDIGIT = /^(\d)\1{11}$/;

// ABHA: 14 digits. The 91-0000-0000-xxxx family is reserved here for the same reason.
const ALLOWED_ABHA = /^91000000\d{6}$/;

const FINDINGS = [
  {
    label: "mobile number",
    // 10 digits starting 6-9, not part of a longer digit run.
    pattern: /(?<![\d])[6-9]\d{9}(?![\d])/g,
    allowed: (digits) => ALLOWED_MOBILE.test(digits),
    guidance: "Use the reserved 90000xxxxx placeholder range.",
  },
  {
    label: "Aadhaar-shaped number",
    pattern: /(?<![\d])[2-9]\d{11}(?![\d])/g,
    allowed: (digits) => ALLOWED_AADHAAR_REPDIGIT.test(digits),
    guidance: "Use a repeated-digit placeholder such as 222222222222.",
  },
  {
    label: "ABHA-shaped number",
    pattern: /(?<![\d])\d{14}(?![\d])/g,
    allowed: (digits) => ALLOWED_ABHA.test(digits),
    guidance: "Use the reserved 91000000xxxxxx range.",
  },
];

/**
 * Blank out digit runs that are structurally NOT identifiers, so the patterns below only see
 * candidates worth judging.
 *
 * Each rule here is a hole in the check, so each is deliberately narrow — the failure mode to
 * avoid is a broad "looks like an id" rule that also swallows a real Aadhaar. Everything that
 * does not match one of these shapes is still scanned.
 */
function stripNonIdentifierNoise(line) {
  return (
    line
      // UUIDs — including ones built in a template literal, e.g.
      //   `${t}0000000-0000-4000-8000-300000000001`
      // whose final 12-digit group would otherwise read as Aadhaar-shaped. Anchored on the
      // full 4-4-4-12 hyphen structure, which no bare identifier has.
      .replace(
        /(?:\$\{[^}]*\}|[0-9a-f]){0,8}-?[0-9a-f]{0,8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
        "<uuid>",
      )
      // Migration filenames and references: YYYYMMDDHHMMSS. Matched only when the embedded
      // month and day are real, so an arbitrary 14-digit number is NOT excused — this repo
      // cites migration timestamps constantly in comments and every one would be a false
      // ABHA hit otherwise.
      .replace(/\b20\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{6}\b/g, "<migration>")
      // ISO timestamps and dates.
      .replace(/\d{4}-\d{2}-\d{2}[T ]?[\d:.]*Z?/g, "<date>")
      // Epoch milliseconds / long numeric literals used as timeouts.
      .replace(/\b\d{13,}(?=\s*[,;)\]}])/g, "<num>")
  );
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out; // directory does not exist yet — not a failure
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".auth" || e.name === "test-results") continue;
      walk(p, out);
    } else if (/\.(ts|tsx|js|mjs|json|sql|csv)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

const violations = [];
let filesScanned = 0;

for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    filesScanned += 1;
    const lines = readFileSync(file, "utf8").split("\n");

    lines.forEach((raw, idx) => {
      const line = stripNonIdentifierNoise(raw);
      for (const finding of FINDINGS) {
        finding.pattern.lastIndex = 0;
        let m;
        while ((m = finding.pattern.exec(line)) !== null) {
          const digits = m[0];
          if (finding.allowed(digits)) continue;
          violations.push({
            file: relative(ROOT, file).replace(/\\/g, "/"),
            line: idx + 1,
            label: finding.label,
            value: digits,
            guidance: finding.guidance,
          });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("check:fixture-phi FAILED — fixture data contains identifiers shaped like real ones.\n");
  console.error(
    "Fixture data gets pasted into issues, CI logs and screenshots. A realistic-looking\n" +
      "identifier is a DPDP exposure regardless of whether it belongs to anyone (D5).\n",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}  ${v.label} "${v.value}"`);
    console.error(`      → ${v.guidance}`);
  }
  console.error(`\n${violations.length} violation(s) across ${filesScanned} file(s).`);
  process.exit(1);
}

console.log(
  `check:fixture-phi passed — ${filesScanned} fixture file(s) scanned, no real-format Aadhaar, ABHA or mobile numbers outside the reserved test ranges.`,
);
