import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const {
  mockToast, mockGetUser, mockFrom, mockRpc, mockFunctionsInvoke, mockCallAI, mockAutoPostJournalEntry,
} = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockFunctionsInvoke: vi.fn(),
  mockCallAI: vi.fn(),
  mockAutoPostJournalEntry: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: mockGetUser },
    from: mockFrom,
    rpc: mockRpc,
    functions: { invoke: mockFunctionsInvoke },
  },
}));
vi.mock("@/lib/aiProvider", () => ({ callAI: mockCallAI }));
vi.mock("@/lib/accounting", () => ({ autoPostJournalEntry: mockAutoPostJournalEntry }));

import { useInsuranceSubmission } from "./useInsuranceSubmission";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "update", "insert", "maybeSingle"]) p[m] = self;
  return p;
}

beforeEach(() => {
  mockToast.mockReset();
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockFunctionsInvoke.mockReset();
  mockCallAI.mockReset();
  mockAutoPostJournalEntry.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } } });
});

const claimRow = {
  bill_id: "b1",
  patient_id: "p1",
  tpa_name: "Star Health",
  total_amount: 50000,
  denial_risk: 0.2,
  patient_name: "Jane Doe",
  bill_number: "BILL-1",
  has_pre_auth: true,
};

describe("useInsuranceSubmission — submitPreAuth", () => {
  it("manual mode marks the pre-auth submitted and shows a success toast", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "insurance_pre_auth") return { update: () => makeChain({ error: null }) };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.submitPreAuth("pa1", "manual");
    });

    expect(outcome).toEqual(expect.objectContaining({ success: true, submissionMode: "manual" }));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Pre-auth submitted ✓" }));
    expect(result.current.submitting).toBe(false);
  });

  it("ai_assisted mode generates a cover letter and opens the modal without touching the DB yet", async () => {
    mockCallAI.mockResolvedValue({ text: "Dear TPA,..." });

    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.submitPreAuth("pa1", "ai_assisted", { patientName: "Jane" });
    });

    expect(outcome).toBeNull();
    expect(result.current.coverLetter).toEqual(
      expect.objectContaining({ open: true, text: "Dear TPA,...", preAuthId: "pa1", entityMode: "preauth" }),
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("automated mode returns the TPA reference number on success", async () => {
    mockFunctionsInvoke.mockResolvedValue({ data: { success: true, tpa_reference_number: "TPA-123", message: "ok" }, error: null });

    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.submitPreAuth("pa1", "automated");
    });

    expect(outcome).toEqual(expect.objectContaining({ success: true, tpaReferenceNumber: "TPA-123" }));
  });

  it("automated mode surfaces a failure result and a destructive toast when the edge function reports failure", async () => {
    mockFunctionsInvoke.mockResolvedValue({ data: { success: false, message: "TPA rejected" }, error: null });

    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.submitPreAuth("pa1", "automated");
    });

    expect(outcome).toEqual(expect.objectContaining({ success: false, message: "TPA rejected" }));
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Submission failed", variant: "destructive" }));
  });

  it("returns null and does nothing without a pre-auth id", async () => {
    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.submitPreAuth("", "manual");
    });
    expect(outcome).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("useInsuranceSubmission — confirmCoverLetterSubmitted", () => {
  it("marks the pre-auth submitted after the ai_assisted cover letter was downloaded", async () => {
    mockCallAI.mockResolvedValue({ text: "letter" });
    const updateSpy = vi.fn(() => makeChain({ error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "insurance_pre_auth") return { update: updateSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    await act(async () => {
      await result.current.submitPreAuth("pa1", "ai_assisted");
    });
    await act(async () => {
      await result.current.confirmCoverLetterSubmitted();
    });

    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "submitted", submission_mode: "ai_assisted" }));
    expect(result.current.coverLetter.open).toBe(false);
  });

  it("marks the claim submitted and reclasses the receivable after an ai_assisted claim cover letter", async () => {
    mockCallAI.mockResolvedValue({ text: "letter" });
    const claimUpdateSpy = vi.fn(() => makeChain({ error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === "insurance_claims") return { insert: () => ({ select: () => makeChain({ data: { id: "claim1" } }) }), update: claimUpdateSpy };
      if (table === "users") return makeChain({ data: { id: "u1" } });
      throw new Error(`unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({ data: 42, error: null });

    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    await act(async () => {
      await result.current.submitClaim(claimRow, "ai_assisted");
    });
    await act(async () => {
      await result.current.confirmCoverLetterSubmitted();
    });

    expect(claimUpdateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: "submitted", submission_mode: "ai_assisted" }));
    expect(mockAutoPostJournalEntry).toHaveBeenCalledWith(
      expect.objectContaining({ triggerEvent: "insurance_claim_raised", sourceId: "claim1", amount: claimRow.total_amount }),
    );
  });
});

describe("useInsuranceSubmission — submitClaim", () => {
  it("manual mode generates a sequential claim number and posts the AR reclass", async () => {
    mockRpc.mockResolvedValue({ data: 7, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "insurance_claims") return { insert: () => ({ select: () => makeChain({ data: { id: "claim1" } }) }) };
      if (table === "users") return makeChain({ data: { id: "u1" } });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.submitClaim(claimRow, "manual");
    });

    expect(outcome.claimNumber).toMatch(/^CLM-\d{4}-00007$/);
    expect(mockAutoPostJournalEntry).toHaveBeenCalledWith(expect.objectContaining({ sourceId: "claim1" }));
  });

  it("throws a controlled failure instead of fabricating a claim number when next_seq errors", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "sequence exhausted" } });

    const { result } = renderHook(() => useInsuranceSubmission("h1"));
    let outcome: any;
    await act(async () => {
      outcome = await result.current.submitClaim(claimRow, "manual");
    });

    expect(outcome).toEqual(expect.objectContaining({ success: false, message: "sequence exhausted" }));
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
