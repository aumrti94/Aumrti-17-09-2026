import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInsert } = vi.hoisted(() => ({ mockInsert: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(() => ({ insert: mockInsert })) },
}));
vi.mock("./aiProvider", () => ({ callAI: vi.fn() }));

import { logNABHEvidence } from "./nabh-evidence";

beforeEach(() => mockInsert.mockReset());

describe("logNABHEvidence — append-only NABH accreditation audit trail", () => {
  it("refuses to log without both a hospital id and a criterion number", async () => {
    const result = await logNABHEvidence("", "COP.2", "text");
    expect(result.ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("normalises the legacy 'partial' status to the DB-accepted 'partially_compliant'", async () => {
    mockInsert.mockResolvedValue({ error: null });
    await logNABHEvidence("h1", "COP.2", "Patient education documented", "partial" as any);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ compliance_status: "partially_compliant" }),
    );
  });

  it("passes through non_compliant unchanged", async () => {
    mockInsert.mockResolvedValue({ error: null });
    await logNABHEvidence("h1", "COP.2", "text", "non_compliant");
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ compliance_status: "non_compliant" }),
    );
  });

  it("defaults to compliant for an unrecognised status rather than rejecting the write", async () => {
    mockInsert.mockResolvedValue({ error: null });
    await logNABHEvidence("h1", "COP.2", "text", "something_else" as any);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ compliance_status: "compliant" }),
    );
  });

  it("returns ok:false with the DB error message rather than throwing, on an insert error", async () => {
    mockInsert.mockResolvedValue({ error: { message: "constraint violation" } });
    const result = await logNABHEvidence("h1", "COP.2", "text");
    expect(result).toEqual({ ok: false, error: "constraint violation" });
  });

  it("returns ok:true on a successful write", async () => {
    mockInsert.mockResolvedValue({ error: null });
    const result = await logNABHEvidence("h1", "COP.2", "text");
    expect(result).toEqual({ ok: true });
  });
});
