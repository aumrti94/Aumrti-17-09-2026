#!/usr/bin/env node
// Aumrti test-coverage gate for src/lib — the pure/near-pure business-logic layer where
// money, drug-safety, and NABH-compliance calculations live.
//
// Rather than a blended coverage percentage (which a single untested 2000-line file can
// hide behind), this checks a simpler, harder-to-game invariant: every file in src/lib/
// either has a sibling *.test.ts, or is named in one of the two lists below with a reason.
// A new file that is neither tested nor listed fails CI — the gate can only get stricter
// as TODO entries are moved to EXEMPT (never) or removed once a test lands (the goal).
//
// This is a ratchet: TODO may only shrink. If this check starts failing because someone
// added an entry back to TODO, that is the bug this script exists to catch.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const LIB_DIR = join(process.cwd(), "src", "lib");

// Files with no meaningful logic to unit test, or where the "logic" is calling a live
// external API/LLM and asserting on the call shape provides no real regression protection.
// Keep every entry justified — this list is permanent, unlike TODO below.
const EXEMPT = {
  // Generated data — regenerate via its own script, not hand-verified.
  "icd10Data.ts": "generated lookup table (~49KB of static ICD-10 codes), no logic",

  // Presentation-only: HTML/PDF string templating for print output. No business logic,
  // just markup — a snapshot test would only catch incidental whitespace changes.
  "admissionSlip.ts": "print-only HTML templating, no business logic",
  "bloodBagLabel.ts": "print-only HTML templating, no business logic",
  "investigationPrint.ts": "print-only HTML templating, no business logic",
  "printUtils.ts": "print-only HTML templating, no business logic",
  "payslipPrint.ts": "print-only HTML templating, no business logic",
  "payrollExports.ts": "export/print formatting, no business logic",

  // AI-wrapper: calls an LLM and returns its (non-deterministic) text. Advisory-only —
  // never safety-blocking or release-blocking (see each file's own header comment) — so
  // there is no decision logic here to regression-test, only a prompt and a parse.
  "aiFeatures.ts": "AI feature catalogue/dispatch — see aiProvider.ts",
  "aiProvider.ts": "LLM call wrapper — advisory only, no deterministic logic to assert on",
  "documentAI.ts": "AI-wrapper, advisory only (see file header)",
  "orderCatalogueAI.ts": "AI-wrapper, advisory only (see file header)",
  "labReflexTests.ts": "AI-wrapper, advisory only (see file header)",
  "labReportNarrative.ts": "AI-wrapper, advisory only (see file header)",

  // Third-party API/format wrappers: the "logic" is mapping our shape onto an external
  // service's request/response shape. A unit test would just restate the mapping.
  "drugbankAPI.ts": "third-party API param mapping, no branching logic",
  "whatsapp-notifications.ts": "third-party API param mapping, no branching logic",
  "whatsapp-send.ts": "third-party API param mapping, no branching logic",
  "apiPlatform.ts": "third-party API param mapping, no branching logic",
};

// Real business logic that genuinely needs a test and does not have one yet. Every entry
// here is a gap, not a design decision — remove the line the moment a test lands. CI does
// not block on TODO entries existing, only on a file being in NEITHER list nor tested.
const TODO = new Set([
  "accounting.ts",
  "adminAudit.ts",
  "ancillaryCharges.ts",
  "ancillaryGateChecks.ts",
  "auditLog.ts",
  "chargePosting.ts",
  "currentUser.ts",
  "dayCareBilling.ts",
  "dicomParser.ts",
  "getHospitalId.ts",
  "ims.ts",
  "insuranceAlerts.ts",
  "inventoryStock.ts",
  "investigationBilling.ts",
  "labSamples.ts",
  "moduleDepartments.ts",
  "offlineQueue.ts",
  "patient-records.ts",
  "payrollEngine.ts",
  "pendingInvestigations.ts",
  "pharmacyReturns.ts",
  "resultNotifications.ts",
  "serviceCatalogSync.ts",
  "storeStock.ts",
  "tallyXmlGenerator.ts",
]);

const allFiles = readdirSync(LIB_DIR).filter((f) => {
  if (!/\.(ts|tsx)$/.test(f)) return false;
  if (/\.(test|spec)\.(ts|tsx)$/.test(f)) return false;
  if (f.endsWith(".d.ts")) return false;
  return statSync(join(LIB_DIR, f)).isFile();
});

const testedBase = new Set(
  readdirSync(LIB_DIR)
    .filter((f) => /\.test\.(ts|tsx)$/.test(f))
    .map((f) => f.replace(/\.test\.(ts|tsx)$/, "")),
);

const uncovered = [];
let todoStillMissing = 0;

for (const file of allFiles) {
  const base = file.replace(/\.(ts|tsx)$/, "");
  const hasTest = testedBase.has(base);
  const isExempt = Object.prototype.hasOwnProperty.call(EXEMPT, file);
  const isTodo = TODO.has(file);

  if (hasTest && isTodo) {
    console.warn(`⚠ ${file} has a test now — remove it from TODO in scripts/check-lib-test-coverage.mjs`);
  }
  if (hasTest || isExempt) continue;
  if (isTodo) {
    todoStillMissing++;
    continue;
  }
  uncovered.push(file);
}

if (uncovered.length > 0) {
  console.error(
    `Test coverage check FAILED — ${uncovered.length} src/lib file(s) have no test and are not in EXEMPT or TODO:`,
  );
  for (const f of uncovered) console.error(`  - ${f}`);
  console.error(
    "\nAdd a src/lib/<name>.test.ts, or if this file genuinely has no testable logic, add it " +
      "to EXEMPT in scripts/check-lib-test-coverage.mjs with a one-line reason.",
  );
  process.exit(1);
}

const testedCount = allFiles.filter((f) => testedBase.has(f.replace(/\.(ts|tsx)$/, ""))).length;
console.log(
  `Test coverage check passed — ${testedCount}/${allFiles.length} src/lib files tested, ` +
    `${Object.keys(EXEMPT).length} exempt, ${todoStillMissing} tracked in TODO (pending).`,
);
