import { describe, it, expect } from "vitest";
import {
  SARVAM_ASR_CODES,
  isSarvamAsrCode,
  SARVAM_CODE_CORRECTIONS,
  explainBadSarvamCode,
  BHASHINI_LANG_MAP,
  toBhashiniLang,
  toSarvamTranslateLang,
} from "./asrLanguages";

// This is the single source of truth for provider language codes after they drifted across
// four call sites and shipped two codes (or-IN, bo-IN) that Sarvam silently rejected.

describe("isSarvamAsrCode", () => {
  it("accepts every code in the canonical list", () => {
    for (const code of SARVAM_ASR_CODES) {
      expect(isSarvamAsrCode(code)).toBe(true);
    }
  });

  it("rejects the two codes this codebase used to ship incorrectly", () => {
    expect(isSarvamAsrCode("or-IN")).toBe(false);
    expect(isSarvamAsrCode("bo-IN")).toBe(false);
  });

  it("rejects a missing code", () => {
    expect(isSarvamAsrCode(null)).toBe(false);
    expect(isSarvamAsrCode(undefined)).toBe(false);
    expect(isSarvamAsrCode("")).toBe(false);
  });
});

describe("explainBadSarvamCode", () => {
  it("names the correction for a known-wrong code", () => {
    expect(explainBadSarvamCode("or-IN")).toBe('Sarvam does not accept "or-IN" — use "od-IN".');
    expect(explainBadSarvamCode("bo-IN")).toBe('Sarvam does not accept "bo-IN" — use "brx-IN".');
  });

  it("lists the full supported set for a code with no known correction", () => {
    const msg = explainBadSarvamCode("zz-ZZ");
    expect(msg).toContain('Sarvam does not accept "zz-ZZ"');
    expect(msg).toContain("en-IN");
  });

  it("every correction target is itself a valid Sarvam code", () => {
    for (const target of Object.values(SARVAM_CODE_CORRECTIONS)) {
      expect(isSarvamAsrCode(target)).toBe(true);
    }
  });
});

describe("toBhashiniLang — canonical code → Bhashini's bare ISO-639", () => {
  it("translates the two codes that disagree with Sarvam's own form", () => {
    expect(toBhashiniLang("od-IN")).toBe("or");
    expect(toBhashiniLang("brx-IN")).toBe("brx");
  });

  it("translates a straightforward code", () => {
    expect(toBhashiniLang("hi-IN")).toBe("hi");
  });

  it("returns null for a code with no Bhashini route (e.g. the auto-detect sentinel)", () => {
    expect(toBhashiniLang("unknown")).toBeNull();
  });

  it("returns null for a missing code", () => {
    expect(toBhashiniLang(null)).toBeNull();
    expect(toBhashiniLang(undefined)).toBeNull();
  });

  it("every canonical code with a Bhashini mapping is a real Sarvam code", () => {
    for (const code of Object.keys(BHASHINI_LANG_MAP)) {
      expect(isSarvamAsrCode(code)).toBe(true);
    }
  });
});

describe("toSarvamTranslateLang", () => {
  it("passes through a supported code unchanged", () => {
    expect(toSarvamTranslateLang("hi-IN")).toBe("hi-IN");
  });

  it("rejects 'auto' — it is not a real source language for translation", () => {
    expect(toSarvamTranslateLang("unknown")).toBeNull();
  });

  it("rejects an unsupported code rather than forwarding it to the API", () => {
    expect(toSarvamTranslateLang("or-IN")).toBeNull();
  });

  it("rejects a missing code", () => {
    expect(toSarvamTranslateLang(null)).toBeNull();
    expect(toSarvamTranslateLang(undefined)).toBeNull();
  });
});
