import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke, mockMaybeSingle } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockMaybeSingle: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mockInvoke },
    from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) })),
  },
}));

import { translateText, getHospitalLanguages, buildBilingualHtml } from "./translateUtils";

beforeEach(() => {
  mockInvoke.mockReset();
  mockMaybeSingle.mockReset();
});

describe("translateText", () => {
  it("returns the content unchanged for English without calling the edge function", async () => {
    const result = await translateText("Take rest", "English", "h1");
    expect(result).toBe("Take rest");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns blank content unchanged without calling the edge function", async () => {
    expect(await translateText("   ", "Hindi", "h1")).toBe("   ");
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it("returns the translated text on success", async () => {
    mockInvoke.mockResolvedValue({ data: { translated_text: "आराम करें" }, error: null });
    const result = await translateText("Take rest", "Hindi", "h1");
    expect(result).toBe("आराम करें");
  });

  it("falls back to the original English content when the edge function errors", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "unreachable" } });
    const result = await translateText("Take rest", "Hindi", "h1");
    expect(result).toBe("Take rest");
  });

  it("falls back to English when the function returns no translated text", async () => {
    mockInvoke.mockResolvedValue({ data: {}, error: null });
    const result = await translateText("Take rest", "Hindi", "h1");
    expect(result).toBe("Take rest");
  });
});

describe("getHospitalLanguages", () => {
  it("prepends English when the configured list doesn't already include it", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { patient_languages: ["Hindi", "Telugu"] } });
    expect(await getHospitalLanguages("h1")).toEqual(["English", "Hindi", "Telugu"]);
  });

  it("does not duplicate English if it's already configured", async () => {
    mockMaybeSingle.mockResolvedValue({ data: { patient_languages: ["English", "Hindi"] } });
    expect(await getHospitalLanguages("h1")).toEqual(["English", "Hindi"]);
  });

  it("returns just English when nothing is configured", async () => {
    mockMaybeSingle.mockResolvedValue({ data: null });
    expect(await getHospitalLanguages("h1")).toEqual(["English"]);
  });
});

describe("buildBilingualHtml", () => {
  it("includes both the English and translated text in the output", () => {
    const html = buildBilingualHtml("Take rest", "आराम करें", "Hindi", "हिन्दी");
    expect(html).toContain("Take rest");
    expect(html).toContain("आराम करें");
    expect(html).toContain("Hindi");
    expect(html).toContain("हिन्दी");
  });

  it("HTML-escapes both texts to prevent injection from patient-content strings", () => {
    const html = buildBilingualHtml("<script>alert(1)</script>", "normal text", "Hindi", "हिन्दी");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });
});
