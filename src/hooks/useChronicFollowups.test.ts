import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { useChronicFollowups } from "./useChronicFollowups";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "lte", "gte", "neq", "in", "order", "limit"]) p[m] = self;
  return p;
}

beforeEach(() => {
  mockFrom.mockReset();
});

describe("useChronicFollowups", () => {
  it("does nothing and stays loading with no hospital id", () => {
    const { result } = renderHook(() => useChronicFollowups(null));
    expect(mockFrom).not.toHaveBeenCalled();
    expect(result.current.rows).toEqual([]);
  });

  it("maps rows and fills in defaults for a patient with missing contact fields", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "chronic_disease_programs") {
        return makeChain({
          data: [{ id: "f1", condition_label: "Diabetes", next_followup: "2026-09-10", followup_tests: ["HbA1c"], patient_id: "p1", patient: null }],
        });
      }
      if (table === "appointments") return makeChain({ data: [] });
      if (table === "opd_tokens") return makeChain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useChronicFollowups("h1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([
      { id: "f1", condition_label: "Diabetes", next_followup: "2026-09-10", followup_tests: ["HbA1c"], patient_name: "Unknown", patient_phone: null, patient_uhid: "", patient_id: "p1" },
    ]);
  });

  it("excludes patients who already have a future appointment or OPD token booked", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "chronic_disease_programs") {
        return makeChain({
          data: [
            { id: "f1", condition_label: "Diabetes", next_followup: "2026-09-10", followup_tests: null, patient_id: "p1", patient: { full_name: "A", phone: "1", uhid: "U1" } },
            { id: "f2", condition_label: "Hypertension", next_followup: "2026-09-11", followup_tests: null, patient_id: "p2", patient: { full_name: "B", phone: "2", uhid: "U2" } },
          ],
        });
      }
      if (table === "appointments") return makeChain({ data: [{ patient_id: "p1" }] });
      if (table === "opd_tokens") return makeChain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useChronicFollowups("h1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows.map((r) => r.patient_id)).toEqual(["p2"]);
  });

  it("clears rows and loading when the programs query returns no data", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "chronic_disease_programs") return makeChain({ data: null });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useChronicFollowups("h1"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([]);
  });
});
