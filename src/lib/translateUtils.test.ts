import { describe, it, expect, vi, beforeEach } from "vitest";

let hospitalRow: any = { patient_languages: ["Hindi", "Telugu"] };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve({ data: hospitalRow, error: null })),
    })),
  },
}));

import { getHospitalLanguages, buildBilingualHtml, ALL_PATIENT_LANGUAGES } from "@/lib/translateUtils";

beforeEach(() => {
  hospitalRow = { patient_languages: ["Hindi", "Telugu"] };
});

describe("getHospitalLanguages — Settings › Hospital Profile patient_languages", () => {
  it("returns the hospital's configured languages with English prepended", async () => {
    expect(await getHospitalLanguages("hosp-a")).toEqual(["English", "Hindi", "Telugu"]);
  });

  it("a different hospital's configured list produces a different picker for the identical call", async () => {
    hospitalRow = { patient_languages: ["Tamil", "Kannada", "Malayalam"] };
    expect(await getHospitalLanguages("hosp-b")).toEqual(["English", "Tamil", "Kannada", "Malayalam"]);
  });

  it("does not duplicate English if the hospital already configured it explicitly", async () => {
    hospitalRow = { patient_languages: ["English", "Bengali"] };
    expect(await getHospitalLanguages("hosp-a")).toEqual(["English", "Bengali"]);
  });

  it("falls back to just English when the hospital has never configured any languages", async () => {
    hospitalRow = { patient_languages: null };
    expect(await getHospitalLanguages("hosp-c")).toEqual(["English"]);
  });

  it("falls back to just English for a hospital row that resolves to no data at all", async () => {
    hospitalRow = null;
    expect(await getHospitalLanguages("hosp-d")).toEqual(["English"]);
  });
});

describe("ALL_PATIENT_LANGUAGES — the catalogue the settings screen offers", () => {
  it("every entry has a TTS locale in the en/hi/... -IN form used by the TV/discharge audio call-out", () => {
    for (const lang of ALL_PATIENT_LANGUAGES) {
      expect(lang.tts).toMatch(/^[a-z]{2}-IN$/);
    }
  });

  it("includes English as a selectable entry", () => {
    expect(ALL_PATIENT_LANGUAGES.some((l) => l.code === "English")).toBe(true);
  });
});

describe("buildBilingualHtml", () => {
  it("embeds both the English and translated text in the output", () => {
    const html = buildBilingualHtml("Take rest", "आराम करें", "Hindi", "हिन्दी");
    expect(html).toContain("Take rest");
    expect(html).toContain("आराम करें");
    expect(html).toContain("Hindi");
  });

  it("escapes HTML-significant characters in patient content to prevent injection", () => {
    const html = buildBilingualHtml("<script>x</script>", "safe", "Hindi", "हिन्दी");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
