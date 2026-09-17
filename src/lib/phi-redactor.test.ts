/**
 * KNOWN-BUG-124, fixed. The module under test is `supabase/functions/_shared/phi-redactor.ts`,
 * not anything in `src/lib/` — this file lives here (not co-located with its source) because
 * `vitest.config.ts`'s `test.include` only scans `src/**` and `e2e/**`, matching the precedent
 * `src/lib/leakageScan.test.ts` already established for testing a Deno-adjacent shared module
 * that has no Deno-specific imports of its own (this one has none at all — pure regex, no
 * `Deno.*`, no remote-URL imports — so it is trivially importable from vitest).
 *
 * The bug: the pattern list's "encrypted column names" rule named `signature_data_enc` and
 * `patient_name_enc` — neither is a real column. The migration that was meant to introduce
 * signature encryption (20261106000010) instead added `patient_consents.patient_signature_enc`
 * and `.witness_signature_enc`, and the redactor's pattern list was never updated to match — so
 * a log line carrying either real column's ciphertext would have passed through unredacted.
 */
import { describe, it, expect } from "vitest";
import { sanitizeForLog } from "../../supabase/functions/_shared/phi-redactor";

describe("sanitizeForLog", () => {
  it("redacts the real patient_signature_enc column (KNOWN-BUG-124, fixed)", () => {
    const line = `payload: {"patient_signature_enc":"v1:abcXYZ123=="}`;
    const out = sanitizeForLog(line);
    expect(out).not.toContain("abcXYZ123");
    expect(out).toContain("[PHI-ENCRYPTED]");
  });

  it("redacts the real witness_signature_enc column (KNOWN-BUG-124, fixed)", () => {
    const line = `payload: {"witness_signature_enc":"v1:defQRS456=="}`;
    const out = sanitizeForLog(line);
    expect(out).not.toContain("defQRS456");
    expect(out).toContain("[PHI-ENCRYPTED]");
  });

  it("still redacts the other real encrypted columns the rule already covered", () => {
    const line = `{"name_enc":"v1:aaa==","result_enc":"v1:bbb==","notes_enc":"v1:ccc=="}`;
    const out = sanitizeForLog(line);
    expect(out).not.toMatch(/aaa==|bbb==|ccc==/);
  });

  it("redacts a mobile number, an Aadhaar-shaped number, and an email in the same string", () => {
    const out = sanitizeForLog("Contact 9876543210, Aadhaar 1234 5678 9012, email a@b.com");
    expect(out).toContain("[MOBILE]");
    expect(out).toContain("[AADHAAR]");
    expect(out).toContain("[EMAIL]");
    expect(out).not.toMatch(/9876543210|1234 5678 9012|a@b\.com/);
  });

  it("truncates long output after redaction", () => {
    const out = sanitizeForLog("x".repeat(600));
    expect(out.length).toBeLessThanOrEqual(500 + "…[truncated]".length);
    expect(out.endsWith("…[truncated]")).toBe(true);
  });

  it("passes an empty string through unchanged", () => {
    expect(sanitizeForLog("")).toBe("");
  });
});
