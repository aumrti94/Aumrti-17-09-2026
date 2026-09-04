import { describe, it, expect } from "vitest";
import { LANGUAGE_REGION_KEY, DEFAULT_LANGUAGE_REGION } from "./languageRegion";

describe("DEFAULT_LANGUAGE_REGION — must stay Indian even if a hospital never opens Settings", () => {
  it("defaults to DD/MM/YYYY, not the US format", () => {
    expect(DEFAULT_LANGUAGE_REGION.dateFormat).toBe("DD/MM/YYYY");
  });

  it("defaults to INR currency and Indian digit grouping", () => {
    expect(DEFAULT_LANGUAGE_REGION.currency).toBe("INR");
    expect(DEFAULT_LANGUAGE_REGION.numberFormat).toBe("indian");
  });

  it("defaults to the Asia/Kolkata timezone", () => {
    expect(DEFAULT_LANGUAGE_REGION.timezone).toBe("Asia/Kolkata");
  });

  it("defaults language to English (en), the safe cross-hospital default", () => {
    expect(DEFAULT_LANGUAGE_REGION.language).toBe("en");
  });

  it("stores config under the documented settings key", () => {
    expect(LANGUAGE_REGION_KEY).toBe("language_region");
  });
});
