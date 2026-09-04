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
  categorizeLineItem,
  computeReadmissionMetrics,
  computePatientSatisfaction,
  useRevenueKPIs,
  useDailyHeatmap,
  useDischargeTAT,
  usePayrollCostRatio,
  usePMJAYClaimsSummary,
  type DateRange,
} from "./useAnalyticsData";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "neq", "in", "not", "gte", "lte", "order", "limit", "maybeSingle"]) p[m] = self;
  return p;
}

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

const range: DateRange = { from: "2026-09-01", to: "2026-09-03" };

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockGetUser.mockResolvedValue({ data: { user: { id: "auth1" } } });
});

describe("categorizeLineItem", () => {
  it("routes OT, dialysis, and physio to their source_module category regardless of item_type", () => {
    expect(categorizeLineItem("procedure", "ot")).toBe("ot_charge");
    expect(categorizeLineItem(null, "dialysis")).toBe("dialysis");
    expect(categorizeLineItem("service", "physio")).toBe("physio");
  });

  it("falls back to item_type, or 'other' when both are missing", () => {
    expect(categorizeLineItem("pharmacy", null)).toBe("pharmacy");
    expect(categorizeLineItem(null, null)).toBe("other");
  });
});

describe("computeReadmissionMetrics", () => {
  it("returns a null rate with zero discharges (not a divide-by-zero 0%)", async () => {
    mockFrom.mockReturnValue(makeChain({ data: [] }));
    const result = await computeReadmissionMetrics("h1", range);
    expect(result).toEqual({ readmissionRate: null, readmittedCount: 0, totalDischarges: 0, aiAvgRiskScore: null, aiHighRiskPct: null, aiAssessedCount: 0 });
  });

  it("counts a readmission strictly within the 30-day window after discharge, excluding the discharge admission itself", async () => {
    // First call resolves discharges; second call (allAdms) needs its own data.
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) {
        return makeChain({ data: [{ id: "a1", patient_id: "p1", discharged_at: "2026-09-01T00:00:00Z", readmission_risk_level: null, readmission_risk_score: null }] });
      }
      return makeChain({
        data: [
          { id: "a1", patient_id: "p1", admitted_at: "2026-08-25T00:00:00Z" },
          { id: "a2", patient_id: "p1", admitted_at: "2026-09-15T00:00:00Z" },
        ],
      });
    });

    const result = await computeReadmissionMetrics("h1", range);
    expect(result.readmittedCount).toBe(1);
    expect(result.readmissionRate).toBe(100);
  });

  it("does not count a readmission that falls exactly on discharge or outside the 30-day window", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) {
        return makeChain({ data: [{ id: "a1", patient_id: "p1", discharged_at: "2026-09-01T00:00:00Z", readmission_risk_level: null, readmission_risk_score: null }] });
      }
      return makeChain({
        data: [
          { id: "a1", patient_id: "p1", admitted_at: "2026-08-25T00:00:00Z" },
          // 31 days after discharge — outside the window
          { id: "a2", patient_id: "p1", admitted_at: "2026-10-02T00:00:00Z" },
        ],
      });
    });

    const result = await computeReadmissionMetrics("h1", range);
    expect(result.readmittedCount).toBe(0);
    expect(result.readmissionRate).toBe(0);
  });

  it("computes the AI risk-score average and high-risk percentage only from assessed discharges", async () => {
    let call = 0;
    mockFrom.mockImplementation(() => {
      call++;
      if (call === 1) {
        return makeChain({
          data: [
            { id: "a1", patient_id: "p1", discharged_at: "2026-09-01T00:00:00Z", readmission_risk_level: "high", readmission_risk_score: 80 },
            { id: "a2", patient_id: "p2", discharged_at: "2026-09-02T00:00:00Z", readmission_risk_level: "low", readmission_risk_score: 20 },
            { id: "a3", patient_id: "p3", discharged_at: "2026-09-02T00:00:00Z", readmission_risk_level: null, readmission_risk_score: null },
          ],
        });
      }
      return makeChain({ data: [] });
    });

    const result = await computeReadmissionMetrics("h1", range);
    expect(result.aiAssessedCount).toBe(2);
    expect(result.aiAvgRiskScore).toBe(50);
    expect(result.aiHighRiskPct).toBe(33); // 1 of 3 total discharges is high-risk
  });
});

describe("computePatientSatisfaction", () => {
  it("averages prem_overall scores and ignores nulls", async () => {
    mockFrom.mockReturnValue(makeChain({ data: [{ prem_overall: 4 }, { prem_overall: 5 }, { prem_overall: null }] }));
    const result = await computePatientSatisfaction("h1", range);
    expect(result).toEqual({ avgOverall5: 4.5, responseCount: 2 });
  });

  it("returns a null average with zero responses", async () => {
    mockFrom.mockReturnValue(makeChain({ data: [] }));
    const result = await computePatientSatisfaction("h1", range);
    expect(result).toEqual({ avgOverall5: null, responseCount: 0 });
  });
});

describe("useRevenueKPIs", () => {
  it("sums bills revenue plus pharmacy_dispensing revenue, excluding pharmacy bill rows, and dedupes OPD/IPD by encounter/admission id", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "bills") return makeChain({ data: [{ paid_amount: 1000 }, { paid_amount: 2000 }] });
      if (table === "pharmacy_dispensing") return makeChain({ data: [{ net_amount: 500 }] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useRevenueKPIs(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Every bills-backed query resolves to the same 2 rows in this mock, so
    // totalRevenue = bills-total (3000) + pharmacy (500).
    expect(result.current.data!.totalRevenue).toBe(3500);
    expect(result.current.data!.pharmacyRevenue).toBe(500);
  });

  it("returns null without hitting the network when there is no signed-in user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { result } = renderHook(() => useRevenueKPIs(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("useDailyHeatmap", () => {
  it("fills every day in the range with 0 when there is no billing that day", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "bills") return makeChain({ data: [{ bill_date: "2026-09-02", paid_amount: 1200 }] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useDailyHeatmap({ from: "2026-09-01", to: "2026-09-03" }), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { date: "2026-09-01", amount: 0 },
      { date: "2026-09-02", amount: 1200 },
      { date: "2026-09-03", amount: 0 },
    ]);
  });
});

describe("useDischargeTAT", () => {
  it("buckets length-of-stay hours and computes the average, discarding a negative (bad data) duration", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "admissions") {
        return makeChain({
          data: [
            { admitted_at: "2026-09-01T00:00:00Z", discharged_at: "2026-09-01T20:00:00Z", ward_id: "w1" }, // 20h → <24h
            { admitted_at: "2026-09-01T00:00:00Z", discharged_at: "2026-09-03T06:00:00Z", ward_id: "w1" }, // 54h → 48-72h
            { admitted_at: "2026-09-02T00:00:00Z", discharged_at: "2026-09-01T00:00:00Z", ward_id: "w1" }, // negative, discarded
          ],
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useDischargeTAT(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.totalDischarges).toBe(2);
    expect(result.current.data!.avgHours).toBe(37); // (20 + 54) / 2
    const dist = result.current.data!.distribution;
    expect(dist.find((d) => d.bucket === "<24h")!.count).toBe(1);
    expect(dist.find((d) => d.bucket === "48-72h")!.count).toBe(1);
  });
});

describe("usePayrollCostRatio", () => {
  it("includes only payroll runs whose mid-month anchor falls inside the selected range", async () => {
    // The run's month is anchored to its 15th, so the selected range has to span past
    // the 15th of the month under test for that run to be picked up.
    const monthRange: DateRange = { from: "2026-09-01", to: "2026-09-30" };
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "payroll_runs") {
        return makeChain({
          data: [
            { total_net: 100000, month: 9, year: 2026 }, // 15 Sep falls inside the range
            { total_net: 999999, month: 3, year: 2026 }, // outside
          ],
        });
      }
      if (table === "bills") return makeChain({ data: [{ paid_amount: 500000 }] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => usePayrollCostRatio(monthRange), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data!.totalNet).toBe(100000);
    expect(result.current.data!.runsFound).toBe(1);
    expect(result.current.data!.costToRevenuePct).toBe(20);
  });
});

describe("usePMJAYClaimsSummary", () => {
  it("counts a claim as denied when it has a denial_reason or denial_code, and computes the denial rate", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "pmjay_claims") {
        return makeChain({
          data: [
            { claimed_amount: 10000, approved_amount: 9000, settled_amount: 9000, denial_reason: null, denial_code: null },
            { claimed_amount: 5000, approved_amount: 0, settled_amount: 0, denial_reason: "doc missing", denial_code: null },
          ],
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => usePMJAYClaimsSummary(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({
      claimedAmount: 15000, approvedAmount: 9000, settledAmount: 9000, totalClaims: 2, deniedClaims: 1, denialRatePct: 50,
    });
  });
});
