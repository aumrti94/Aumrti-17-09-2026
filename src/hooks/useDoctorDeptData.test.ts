import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import {
  useDoctorScores, useDeptPerformance, useDeptDoctors, useDeptTopServices,
  useDoctorRevenueByCategory, useDeptRevenueByCategory,
} from "./useDoctorDeptData";
import type { DateRange } from "./useAnalyticsData";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "neq", "in", "not", "is", "gte", "lte", "limit", "order", "maybeSingle"]) p[m] = self;
  return p;
}

function tableSequence(map: Record<string, any[]>) {
  const counters: Record<string, number> = {};
  mockFrom.mockImplementation((table: string) => {
    if (!(table in map)) throw new Error(`unexpected table ${table}`);
    const idx = counters[table] ?? 0;
    counters[table] = idx + 1;
    const seq = map[table];
    const val = seq[Math.min(idx, seq.length - 1)];
    return makeChain(val);
  });
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

const range: DateRange = { from: "2026-09-01", to: "2026-09-30" };

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } } });
});

describe("useDoctorScores", () => {
  it("ranks doctors by revenue (OPD + IPD + token-fallback), and computes avgLOS only from discharged admissions", async () => {
    tableSequence({
      users: [
        { data: { hospital_id: "h1" } }, // getHospitalId
        { data: [{ id: "d1", full_name: "Dr Rao", role: "doctor", department_id: "dept1" }, { id: "d2", full_name: "Dr Iyer", role: "doctor", department_id: null }] },
      ],
      departments: [{ data: [{ id: "dept1", name: "Cardiology" }] }],
      opd_encounters: [{ data: [{ id: "e1", doctor_id: "d1" }] }],
      admissions: [{ data: [{ id: "a1", admitting_doctor_id: "d1", admitted_at: "2026-09-01T00:00:00Z", discharged_at: "2026-09-03T00:00:00Z", status: "discharged" }] }],
      ot_schedules: [{ data: [{ id: "ot1", surgeon_id: "d1" }] }],
      bills: [
        { data: [{ paid_amount: 5000, encounter_id: "e1" }] }, // OPD bills
        { data: [{ paid_amount: 20000, admission_id: "a1" }] }, // IPD bills
        { data: [] }, // unlinked OPD bills (token fallback)
      ],
      opd_tokens: [{ data: [{ id: "t1", doctor_id: "d1", patient_id: "p1", visit_date: "2026-09-01" }] }],
    });

    const { result } = renderHook(() => useDoctorScores(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rao = result.current.data!.find((d) => d.id === "d1")!;
    expect(rao.department_name).toBe("Cardiology");
    expect(rao.revenue).toBe(25000);
    expect(rao.avgLOS).toBe(2);
    expect(rao.otCases).toBe(1);

    const iyer = result.current.data!.find((d) => d.id === "d2")!;
    expect(iyer.department_name).toBe("Unassigned");
    expect(iyer.revenue).toBe(0);
    expect(iyer.avgLOS).toBeNull();

    // Sorted by revenue descending
    expect(result.current.data!.map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("returns an empty list without querying anything else when the hospital has no active doctors", async () => {
    tableSequence({
      users: [{ data: { hospital_id: "h1" } }, { data: [] }],
    });

    const { result } = renderHook(() => useDoctorScores(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalledWith("departments");
  });
});

describe("useDeptPerformance", () => {
  it("computes each department's revenue share as a percentage of hospital total revenue", async () => {
    tableSequence({
      users: [
        { data: { hospital_id: "h1" } },
        { data: [{ id: "d1", department_id: "dept1" }, { id: "d2", department_id: "dept2" }] },
      ],
      departments: [{ data: [{ id: "dept1", name: "Cardiology" }, { id: "dept2", name: "Ortho" }] }],
      opd_encounters: [{ data: [{ id: "e1", doctor_id: "d1" }, { id: "e2", doctor_id: "d2" }] }],
      admissions: [{ data: [] }],
      bills: [{ data: [{ paid_amount: 3000, encounter_id: "e1" }, { paid_amount: 1000, encounter_id: "e2" }] }],
    });

    const { result } = renderHook(() => useDeptPerformance(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const cardio = result.current.data!.find((d) => d.name === "Cardiology")!;
    const ortho = result.current.data!.find((d) => d.name === "Ortho")!;
    expect(cardio.revenue).toBe(3000);
    expect(cardio.revenueShare).toBe(75);
    expect(ortho.revenueShare).toBe(25);
  });
});

describe("useDeptDoctors", () => {
  it("is disabled (no query) with no department id", () => {
    const { result } = renderHook(() => useDeptDoctors(null, range), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("computes each doctor's revenue share within their department", async () => {
    tableSequence({
      users: [
        { data: { hospital_id: "h1" } },
        { data: [{ id: "d1", full_name: "Dr Rao" }, { id: "d2", full_name: "Dr Iyer" }] },
      ],
      opd_encounters: [{ data: [{ id: "e1", doctor_id: "d1" }, { id: "e2", doctor_id: "d2" }] }],
      bills: [{ data: [{ paid_amount: 4000, encounter_id: "e1" }, { paid_amount: 1000, encounter_id: "e2" }] }],
    });

    const { result } = renderHook(() => useDeptDoctors("dept1", range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const rao = result.current.data!.find((d) => d.name === "Dr Rao")!;
    expect(rao.share).toBe(80);
  });
});

describe("useDeptTopServices", () => {
  it("aggregates line-item spend by description and returns only the top 8", async () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ description: `Service ${i}`, total_amount: 100 * (10 - i) }));
    tableSequence({
      users: [{ data: { hospital_id: "h1" } }, { data: [{ id: "d1" }] }],
      opd_encounters: [{ data: [{ id: "e1" }] }],
      admissions: [{ data: [] }],
      bills: [{ data: [{ id: "b1" }] }],
      bill_line_items: [{ data: items }],
    });

    const { result } = renderHook(() => useDeptTopServices("dept1", range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(8);
    expect(result.current.data![0].name).toBe("Service 0");
    expect(result.current.data![0].total).toBe(1000);
  });
});

describe("useDoctorRevenueByCategory / useDeptRevenueByCategory", () => {
  it("categorizes a doctor's billed line items and computes each category's percentage share", async () => {
    tableSequence({
      users: [{ data: { hospital_id: "h1" } }],
      opd_encounters: [{ data: [{ id: "e1" }] }],
      admissions: [{ data: [] }],
      bills: [{ data: [{ id: "b1" }] }],
      bill_line_items: [{ data: [{ item_type: "pharmacy", source_module: null, total_amount: 300 }, { item_type: null, source_module: "ot", total_amount: 700 }] }],
    });

    const { result } = renderHook(() => useDoctorRevenueByCategory("d1", range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const ot = result.current.data!.find((c) => c.name === "OT")!;
    expect(ot.value).toBe(700);
    expect(ot.pct).toBe(70);
  });

  it("returns an empty list when disabled with no doctor id", () => {
    const { result } = renderHook(() => useDoctorRevenueByCategory(null, range), { wrapper });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("useDeptRevenueByCategory pools bills across every doctor in the department before categorizing", async () => {
    tableSequence({
      users: [{ data: { hospital_id: "h1" } }, { data: [{ id: "d1" }, { id: "d2" }] }],
      opd_encounters: [{ data: [{ id: "e1" }] }],
      admissions: [{ data: [] }],
      bills: [{ data: [{ id: "b1" }] }],
      bill_line_items: [{ data: [{ item_type: "consultation", source_module: null, total_amount: 100 }] }],
    });

    const { result } = renderHook(() => useDeptRevenueByCategory("dept1", range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { name: "Consultation", value: 100, pct: 100, fill: expect.any(String) },
    ]);
  });
});
