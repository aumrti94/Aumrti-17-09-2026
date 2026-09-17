#!/usr/bin/env node
// Aumrti Phase 6 exit-gate check — no PHI-shaped value reaches an Edge Function log line.
//
// THE DEFECT THIS EXISTS TO PREVENT. Supabase retains Edge Function logs on the platform side.
// A `console.log(patient)` or `console.error(JSON.stringify(body))` in a patient-facing function
// writes a name, phone number, address, or Aadhaar straight into a log store this application does
// not control — a DPDP Act 2023 disclosure, not a debugging convenience. `_shared/phi-redactor.ts`
// (`sanitizeForLog`) exists precisely so a function CAN log useful context without doing that; this
// check is what makes calling it mandatory rather than a habit that erodes over time.
//
// HOW IT WORKS. A heuristic text scan of supabase/functions/**/*.ts (not a live-DB or live-log
// check): find every console.(log|warn|error|info|debug)(...) call, extract its balanced-paren
// argument text, and flag it if that text names a PHI-shaped identifier or logs a whole
// request/row object — UNLESS the call also routes through sanitizeForLog(), OR the exact call is
// in ALLOWLIST below with a [CORRECT] justification. Like check:user-fk and check:rls-coverage,
// this cannot prove a log line is safe — only that it is not one of the known-dangerous shapes.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const FUNCTIONS_DIR = join(process.cwd(), "supabase", "functions");

// Exact `relativePath:lineNumber` pairs judged safe on inspection, each with why. This is the one
// place this check can be silently defeated — treat adding to it as a decision, not a formality.
// (Currently empty: every flagged call found during Phase 6 setup was fixed by wrapping in
// sanitizeForLog rather than allowlisted — see docs/testing/PHASE_6 work for the fix list.)
const ALLOWLIST = new Set([
  // "supabase/functions/_shared/phi-redactor.ts:20", // [CORRECT] the redaction patterns themselves
]);

// Identifier fragments that name PHI when they appear as a bare variable/property inside a
// console.* call's argument list. Mirrors _shared/phi-redactor.ts's own JSON-key list plus the
// English names those columns are read into once destructured off a row.
const PHI_IDENTIFIER_RE = new RegExp(
  "\\b(" +
    [
      "patient_name", "full_name", "guardian_name", "father_name", "mother_name", "spouse_name",
      "patientName", "fullName", "guardianName",
      "mobile", "phone", "contact", "telephone", "cell",
      "address", "village", "locality", "street",
      "aadhaar", "aadhar", "national_id", "nationalId",
      "signature", "signature_data", "signatureData",
      "dob", "date_of_birth", "dateOfBirth",
      "allergy", "allergies", "diagnosis", "prescription",
      "abha_address", "abhaAddress", "abha_number", "abhaNumber",
      "email",
    ].join("|") +
    ")\\b",
  "i",
);

// Logging an entire request/row object wholesale is the other dangerous shape — the identifier
// itself need not look PHI-shaped when the whole object is dumped. Excludes access to a known-safe
// accessor (row.id, row.hospital_id, row.patient_id — a bare UUID reference, not PHI) so a
// property access on the object is not confused with dumping the object itself.
const WHOLE_OBJECT_RE = /\b(body|payload|patient|patientData|row|record|requestBody|reqBody)\b(?!\s*\.\s*(id|hospital_id|patient_id)\b)/;

// Calls that only ever carry non-PHI diagnostic context — never worth flagging even if a PHI
// keyword appears elsewhere on the same line (e.g. a comment, or a sibling log statement).
const SAFE_ONLY_RE = /^\s*(?:`[^`]*`|"[^"]*"|'[^']*')\s*(?:,\s*(?:err|error|e)\.(message|name|code)\s*)?$/;

// Blank out comment bodies char-for-char (preserving every newline) so line numbers computed
// against the stripped text stay perfectly aligned with the raw source's line numbers.
// Blank out static string/template-literal TEXT so a keyword appearing only in a human-readable
// message ("translate-patient-content error:", "send-email error:") cannot false-positive —
// while keeping `${...}` template interpolations intact, since those are real expressions that
// can genuinely reference a PHI-bearing variable.
function blankStaticStringText(argsText) {
  let out = "";
  let i = 0;
  while (i < argsText.length) {
    const ch = argsText[i];
    if (ch === "'" || ch === '"') {
      const quote = ch;
      out += " ";
      i++;
      while (i < argsText.length && argsText[i] !== quote) {
        if (argsText[i] === "\\" && i + 1 < argsText.length) {
          out += "  "; // blank the backslash and the escaped char together
          i += 2;
        } else {
          out += " ";
          i++;
        }
      }
      if (i < argsText.length) { out += " "; i++; } // closing quote
      continue;
    }
    if (ch === "`") {
      out += " ";
      i++;
      while (i < argsText.length && argsText[i] !== "`") {
        if (argsText[i] === "$" && argsText[i + 1] === "{") {
          out += "${";
          i += 2;
          let depth = 1;
          while (i < argsText.length && depth > 0) {
            if (argsText[i] === "{") depth++;
            else if (argsText[i] === "}") depth--;
            out += argsText[i];
            i++;
          }
          continue;
        }
        out += argsText[i] === "\n" ? "\n" : " ";
        i++;
      }
      if (i < argsText.length) { out += " "; i++; } // closing backtick
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (m) => " ".repeat(m.length));
}

/** Walk forward from `openIdx` (the '(' after console.xxx) and return the index of its matching ')'. */
function matchParen(text, openIdx) {
  let depth = 0;
  let inStr = null; // "'" | '"' | "`" | null
  for (let i = openIdx; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1];
    if (inStr) {
      if (ch === inStr && prev !== "\\") inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function listFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listFiles(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

const CONSOLE_CALL_RE = /console\.(log|warn|error|info|debug)\s*\(/g;

const offenders = [];
let scannedCalls = 0;

for (const file of listFiles(FUNCTIONS_DIR)) {
  const relPath = relative(process.cwd(), file).replace(/\\/g, "/");
  // The redactor's own pattern list quotes PHI key names as regex literals — not a log call.
  if (relPath.endsWith("_shared/phi-redactor.ts")) continue;

  const raw = readFileSync(file, "utf8");
  const text = stripComments(raw);
  const lines = raw.split(/\r?\n/);

  let m;
  CONSOLE_CALL_RE.lastIndex = 0;
  while ((m = CONSOLE_CALL_RE.exec(text))) {
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = matchParen(text, openIdx);
    if (closeIdx === -1) continue; // malformed / truncated match, skip rather than crash

    const args = text.slice(openIdx + 1, closeIdx);
    scannedCalls++;

    if (args.includes("sanitizeForLog(")) continue; // protected
    if (SAFE_ONLY_RE.test(args)) continue; // a bare string / err.message, nothing PHI-shaped

    // Scan only real code — a keyword inside a human-readable message string (e.g. the function's
    // own name, "translate-patient-content error:") must never trigger this on its own.
    const codeOnly = blankStaticStringText(args);
    const suspicious = PHI_IDENTIFIER_RE.test(codeOnly) || WHOLE_OBJECT_RE.test(codeOnly);
    if (!suspicious) continue;

    const lineNo = text.slice(0, m.index).split("\n").length;
    const key = `${relPath}:${lineNo}`;
    if (ALLOWLIST.has(key)) continue;

    offenders.push({
      key,
      snippet: (lines[lineNo - 1] || "").trim().slice(0, 160),
    });
  }
}

if (offenders.length > 0) {
  console.error(`PHI-in-logs check FAILED — ${offenders.length} console.* call(s) may log PHI without sanitizeForLog():`);
  for (const { key, snippet } of offenders) console.error(`  - ${key}\n      ${snippet}`);
  console.error(`
Each of these either:
  1. Needs wrapping — console.error("...", sanitizeForLog(String(err))) or
     sanitizeForLog(JSON.stringify(payload)) — import from "../_shared/phi-redactor.ts", or
  2. Is a false positive (the identifier is PHI-shaped in name only — e.g. a hospital's own
     "address" configuration field, not a patient's), in which case add the exact
     "relative/path.ts:lineNumber" to ALLOWLIST in scripts/check-no-phi-logs.mjs with a
     [CORRECT] comment explaining why nothing patient-identifying can flow through it.

This is a heuristic text scan (Phase 6, PHASED_TEST_PLAN.md). It cannot prove a log line is safe,
only that it is not one of the known-dangerous shapes — passing this check is necessary, not
sufficient, for "no PHI in logs, ever" (CLAUDE.md).`);
  process.exit(1);
}

console.log(`PHI-in-logs check passed — ${scannedCalls} console.* call(s) scanned across supabase/functions/, 0 flagged.`);
