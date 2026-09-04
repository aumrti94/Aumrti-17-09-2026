import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { getPendingInvestigations } from "./pendingInvestigations";

// A real Promise with every chain method attached (each returning the same promise), rather
// than a Proxy-based thenable — a generic (non-native) thenable can have its `.then` invoked
// more than once under the PromiseResolveThenableJob spec.
function emptyChain(): any {
  const p: any = Promise.resolve({ data: [] });
  for (const m of ["select", "eq", "in", "not", "neq", "gte", "lte", "order", "limit"]) p[m] = () => p;
  p.maybeSingle = () => Promise.resolve({ data: null });
  return p;
}
const NOOP = { select: () => emptyChain(), insert: () => emptyChain() };

beforeEach(() => mockFrom.mockReset());

describe("getPendingInvestigations — OPD path", () => {
  const RANGE = { start: "2026-08-01", end: "2026-08-31" };

  it("falls through to the (empty) ward list when there are no OPD encounters in range", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "opd_encounters") return { select: () => ({ eq: () => ({ gte: () => ({ lte: () => Promise.resolve({ data: [] }) }) }) }) };
      return NOOP;
    });

    const result = await getPendingInvestigations("h1", RANGE);
    expect(result).toEqual([]);
  });

  it("lists a prescribed test as pending only when no real order exists for it yet", async () => {
    const encounter = {
      id: "enc-1", visit_date: "2026-08-24", created_at: "2026-08-24T09:00:00+05:30",
      patient_id: "p1", doctor_id: "doc-1",
      patients: { id: "p1", full_name: "Jane Doe", uhid: "UHID001", phone: "9876543210" },
    };
    const prescription = {
      id: "rx1", encounter_id: "enc-1", patient_id: "p1",
      lab_orders: [{ test_name: "CBC" }, { test_name: "LFT" }],
      radiology_orders: [],
    };

    mockFrom.mockImplementation((table: string) => {
      if (table === "opd_encounters") return { select: () => ({ eq: () => ({ gte: () => ({ lte: () => Promise.resolve({ data: [encounter] }) }) }) }) };
      if (table === "users") return { select: () => ({ in: () => Promise.resolve({ data: [{ id: "doc-1", full_name: "Dr Rao" }] }) }) };
      if (table === "prescriptions") return { select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [prescription] }) }), eq: () => emptyChain() }) };
      if (table === "lab_orders") return { select: () => ({ in: () => ({ neq: () => Promise.resolve({ data: [{ encounter_id: "enc-1", lab_order_items: [{ lab_test_master: { test_name: "CBC" } }] }] }) }) }) };
      if (table === "radiology_orders") return { select: () => ({ in: () => ({ neq: () => Promise.resolve({ data: [] }) }) }) };
      if (table === "lab_test_master") return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [{ test_name: "LFT", fee: 400 }] }) }) }) };
      if (table === "radiology_study_master") return { select: () => ({ eq: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) };
      return NOOP;
    });

    const result = await getPendingInvestigations("h1", RANGE);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      patientId: "p1", patientName: "Jane Doe", uhid: "UHID001",
      pendingLabTests: ["LFT"], // CBC already has a real order, LFT does not
      estimatedRevenue: 400,
      doctorName: "Dr Rao",
      contextLabel: "OPD",
    });
  });

  it("excludes a prescription entirely once every prescribed test has a real order", async () => {
    const encounter = {
      id: "enc-1", visit_date: "2026-08-24", created_at: "2026-08-24T09:00:00+05:30",
      patient_id: "p1", doctor_id: "doc-1", patients: { full_name: "Jane Doe", uhid: "UHID001" },
    };
    const prescription = { id: "rx1", encounter_id: "enc-1", patient_id: "p1", lab_orders: [{ test_name: "CBC" }], radiology_orders: [] };

    mockFrom.mockImplementation((table: string) => {
      if (table === "opd_encounters") return { select: () => ({ eq: () => ({ gte: () => ({ lte: () => Promise.resolve({ data: [encounter] }) }) }) }) };
      if (table === "prescriptions") return { select: () => ({ in: () => ({ eq: () => Promise.resolve({ data: [prescription] }) }), eq: () => emptyChain() }) };
      if (table === "lab_orders") return { select: () => ({ in: () => ({ neq: () => Promise.resolve({ data: [{ encounter_id: "enc-1", lab_order_items: [{ lab_test_master: { test_name: "CBC" } }] }] }) }) }) };
      if (table === "radiology_orders") return { select: () => ({ in: () => ({ neq: () => Promise.resolve({ data: [] }) }) }) };
      return NOOP;
    });

    const result = await getPendingInvestigations("h1", RANGE);
    expect(result).toEqual([]);
  });
});
