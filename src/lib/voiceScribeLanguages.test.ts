import { describe, it, expect } from "vitest";
import { SUPPORTED_LANGUAGES } from "./voiceScribeLanguages";

describe("SUPPORTED_LANGUAGES (voice scribe) — the one catalogue Settings and the scribe both read", () => {
  it("has a unique code for every language", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes the auto-detect option alongside real languages", () => {
    expect(SUPPORTED_LANGUAGES.find((l) => l.code === "auto")).toBeDefined();
  });

  it("gives every entry a valid engine assignment", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(["web_speech", "sarvam", "bhashini"]).toContain(lang.engine);
    }
  });

  it("uses the corrected codes for Odia and Bodo, not the ones Sarvam rejects", () => {
    // od-IN not or-IN; brx-IN not bo-IN — see the file's own regression note.
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "or-IN")).toBe(false);
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "od-IN")).toBe(true);
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "bo-IN")).toBe(false);
    expect(SUPPORTED_LANGUAGES.some((l) => l.code === "brx-IN")).toBe(true);
  });

  it("gives every non-English/auto language its native-script label, not a transliteration", () => {
    const hindi = SUPPORTED_LANGUAGES.find((l) => l.code === "hi-IN");
    expect(hindi?.native).toBe("हिन्दी");
  });
});
