import { describe, it, expect } from "vitest";
import { formatDocumentNumber } from "./documentNumber";

describe("formatDocumentNumber", () => {
  it("pads to 4 digits and starts each hospital's series at 0001", () => {
    expect(formatDocumentNumber("body", 1, 2026)).toBe("BODY-2026-0001");
    expect(formatDocumentNumber("mlc", 7, 2026)).toBe("MLC-2026-0007");
    expect(formatDocumentNumber("mccd", 42, 2026)).toBe("MCCD-2026-0042");
    expect(formatDocumentNumber("journal_voucher", 1, 2026)).toBe("JV-2026-0001");
  });

  it("does not truncate once a series passes 9999", () => {
    expect(formatDocumentNumber("body", 12345, 2026)).toBe("BODY-2026-12345");
  });

  it("keeps the prefixes distinct so two series never look alike", () => {
    const kinds = ["body", "mlc", "mccd", "journal_voucher"] as const;
    const rendered = kinds.map((k) => formatDocumentNumber(k, 1, 2026));
    expect(new Set(rendered).size).toBe(kinds.length);
  });
});
