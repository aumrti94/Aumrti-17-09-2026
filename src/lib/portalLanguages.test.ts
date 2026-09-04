import { describe, it, expect } from "vitest";
import { SUPPORTED_LANGUAGES } from "./portalLanguages";

describe("SUPPORTED_LANGUAGES — patient-portal UI languages", () => {
  it("has a unique code for every language", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("includes English and the major Indian regional languages", () => {
    const codes = SUPPORTED_LANGUAGES.map((l) => l.code);
    expect(codes).toEqual(
      expect.arrayContaining(["en", "hi", "te", "ta", "kn", "ml", "mr", "gu", "bn"]),
    );
  });

  it("gives every language both a display label and a native-script label", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      expect(lang.label.length).toBeGreaterThan(0);
      expect(lang.native.length).toBeGreaterThan(0);
    }
  });

  it("shows English's native label in Latin script, not translated", () => {
    expect(SUPPORTED_LANGUAGES.find((l) => l.code === "en")?.native).toBe("English");
  });
});
