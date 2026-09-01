import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  SARVAM_ASR_CODES, BHASHINI_LANG_MAP, isSarvamAsrCode,
  explainBadSarvamCode, toBhashiniLang, toSarvamTranslateLang,
} from "./asrLanguages";
import { SUPPORTED_LANGUAGES } from "./voiceScribeLanguages";

/**
 * Two jobs here.
 *
 * 1. The Deno copy at supabase/functions/_shared/asr-languages.ts must not drift from the
 *    pure region of src/lib/asrLanguages.ts — same constraint and same remedy as
 *    medicalLexicon.parity.test.ts.
 *
 * 2. Every language the scribe OFFERS must be a code Sarvam actually ACCEPTS. This is the
 *    assertion whose absence let `or-IN` (Odia) and `bo-IN` (Bodo) ship in the dropdown for
 *    languages that could never transcribe — the request 400'd upstream and the client
 *    swallowed it as "no speech".
 */

const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src/lib/asrLanguages.ts");
const DENO = path.join(ROOT, "supabase/functions/_shared/asr-languages.ts");

const START = "// ── region:pure";
const END = "// ── endregion:pure";

function pureRegion(source: string): string {
  const a = source.indexOf(START);
  const b = source.indexOf(END);
  expect(a, "region:pure marker missing").toBeGreaterThan(-1);
  expect(b, "endregion:pure marker missing").toBeGreaterThan(a);
  return source.slice(a, b).trimEnd();
}

describe("asrLanguages Deno parity", () => {
  const srcText = fs.readFileSync(SRC, "utf8");
  const denoText = fs.readFileSync(DENO, "utf8");

  it("carries the pure region byte-for-byte into the Deno copy", () => {
    expect(
      denoText.includes(pureRegion(srcText)),
      "supabase/functions/_shared/asr-languages.ts has drifted from src/lib/asrLanguages.ts — " +
        "re-copy the region between the region:pure markers.",
    ).toBe(true);
  });

  it("keeps every exported symbol of the pure region", () => {
    const exported = [...pureRegion(srcText).matchAll(/export (?:function|const|type) (\w+)/g)]
      .map(m => m[1]);
    expect(exported.length).toBeGreaterThan(5);
    for (const name of exported) {
      expect(denoText, `${name} missing from the Deno copy`).toMatch(
        new RegExp(`export (?:function|const|type) ${name}\\b`),
      );
    }
  });
});

describe("scribe catalogue matches Sarvam's accepted codes", () => {
  it("offers no language Sarvam would reject", () => {
    // "auto" is the app's own label for Sarvam's `unknown` sentinel and is translated at
    // the call site, so it is the one code allowed to be absent from the enum.
    const offending = SUPPORTED_LANGUAGES
      .filter(l => l.code !== "auto" && !isSarvamAsrCode(l.code))
      .map(l => `${l.label} (${l.code}) — ${explainBadSarvamCode(l.code)}`);

    expect(offending, "voiceScribeLanguages.ts offers codes Sarvam cannot transcribe").toEqual([]);
  });

  it("still carries the two codes that were previously wrong", () => {
    // Regression pins: these are the exact values that were broken in production.
    const codes = SUPPORTED_LANGUAGES.map(l => l.code);
    expect(codes, "Odia must be od-IN, not or-IN").toContain("od-IN");
    expect(codes, "Bodo must be brx-IN, not bo-IN").toContain("brx-IN");
    expect(codes).not.toContain("or-IN");
    expect(codes).not.toContain("bo-IN");
  });

  it("has no duplicate codes", () => {
    const codes = SUPPORTED_LANGUAGES.map(l => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });
});

describe("provider code translation", () => {
  it("names the correct replacement for the codes that are easy to get wrong", () => {
    expect(explainBadSarvamCode("or-IN")).toContain('"od-IN"');
    expect(explainBadSarvamCode("bo-IN")).toContain('"brx-IN"');
  });

  it("lists the supported set when there is no known correction", () => {
    const msg = explainBadSarvamCode("xx-IN");
    expect(msg).toContain("ta-IN");
    expect(msg).not.toContain("use \"");
  });

  it("maps Odia and Bodo to Bhashini's disagreeing codes", () => {
    // The whole reason provider maps exist rather than a code.split("-")[0].
    expect(toBhashiniLang("od-IN")).toBe("or");
    expect(toBhashiniLang("brx-IN")).toBe("brx");
  });

  it("reports no Bhashini route rather than guessing one", () => {
    expect(toBhashiniLang("unknown")).toBeNull();
    expect(toBhashiniLang("auto")).toBeNull();
    expect(toBhashiniLang(null)).toBeNull();
  });

  it("covers every Sarvam language except the auto-detect sentinel", () => {
    const missing = SARVAM_ASR_CODES.filter(c => c !== "unknown" && !(c in BHASHINI_LANG_MAP));
    expect(missing, "Bhashini fallback would be skipped for these").toEqual([]);
  });

  it("refuses to hand a non-language to the translate API as a source language", () => {
    // This is what sent the literal "auto" to Sarvam's translate endpoint.
    expect(toSarvamTranslateLang("auto")).toBeNull();
    expect(toSarvamTranslateLang("unknown")).toBeNull();
    expect(toSarvamTranslateLang("ta-IN")).toBe("ta-IN");
  });
});
