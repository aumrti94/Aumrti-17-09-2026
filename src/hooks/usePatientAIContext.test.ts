import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { mockFrom, mockInvoke } = vi.hoisted(() => ({ mockFrom: vi.fn(), mockInvoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom, functions: { invoke: mockInvoke } },
}));

import { usePatientAIContext, type PatientAIContext } from "./usePatientAIContext";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "maybeSingle"]) p[m] = self;
  return p;
}

beforeEach(() => {
  mockFrom.mockReset();
  mockInvoke.mockReset();
});

describe("usePatientAIContext", () => {
  it("fetchContext loads and stores the row, returning it to the caller", async () => {
    const row: PatientAIContext = {
      chronic_conditions: ["Diabetes"], known_allergies: [], current_medications: [],
      recent_diagnoses: [], risk_flags: [], context_summary: "Stable diabetic", last_updated: "2026-09-01",
    };
    mockFrom.mockReturnValue(makeChain({ data: row }));

    const { result } = renderHook(() => usePatientAIContext());
    let returned: any;
    await act(async () => {
      returned = await result.current.fetchContext("p1");
    });

    expect(returned).toEqual(row);
    expect(result.current.context).toEqual(row);
  });

  it("fetchContext leaves context untouched when there is no row yet", async () => {
    mockFrom.mockReturnValue(makeChain({ data: null }));
    const { result } = renderHook(() => usePatientAIContext());
    await act(async () => {
      await result.current.fetchContext("p1");
    });
    expect(result.current.context).toBeNull();
  });

  it("refreshContext invokes the edge function and fills missing array fields with []", async () => {
    mockInvoke.mockResolvedValue({ data: { context_summary: "Refreshed", chronic_conditions: ["Asthma"] } });
    const { result } = renderHook(() => usePatientAIContext());

    await act(async () => {
      await result.current.refreshContext("p1", "h1");
    });

    expect(mockInvoke).toHaveBeenCalledWith("update-patient-ai-context", { body: { patient_id: "p1", hospital_id: "h1" } });
    expect(result.current.context).toEqual(
      expect.objectContaining({ context_summary: "Refreshed", chronic_conditions: ["Asthma"], known_allergies: [], current_medications: [], recent_diagnoses: [], risk_flags: [] }),
    );
    expect(result.current.loading).toBe(false);
  });

  it("refreshContext leaves context untouched when the function returns no summary", async () => {
    mockInvoke.mockResolvedValue({ data: null });
    const { result } = renderHook(() => usePatientAIContext());
    await act(async () => {
      await result.current.refreshContext("p1", "h1");
    });
    expect(result.current.context).toBeNull();
  });

  describe("buildContextPrompt", () => {
    it("returns an empty string with no context or an empty summary", () => {
      const { result } = renderHook(() => usePatientAIContext());
      expect(result.current.buildContextPrompt(null)).toBe("");
      expect(result.current.buildContextPrompt({ context_summary: "" } as any)).toBe("");
    });

    it("includes only the non-empty sections, in order", () => {
      const { result } = renderHook(() => usePatientAIContext());
      const prompt = result.current.buildContextPrompt({
        chronic_conditions: ["Diabetes"],
        known_allergies: ["Penicillin"],
        current_medications: [],
        recent_diagnoses: [],
        risk_flags: [],
        context_summary: "Summary text",
        last_updated: "2026-09-01",
      });
      expect(prompt).toContain("Summary text");
      expect(prompt).toContain("Known allergies: Penicillin");
      expect(prompt).toContain("Chronic conditions: Diabetes");
      expect(prompt).not.toContain("Current medications:");
      expect(prompt).not.toContain("Risk flags:");
    });
  });
});
