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
  useRevenueTrend,
  useRevenueBreakdown,
  useServiceLineBilled,
  usePaymentModes,
  useInsuranceSummary,
  useClinicalKPIs,
  useOPDTrend,
  useBedOccupancyBreakdown,
  useTopDiagnoses,
  useInventoryValueOnHand,
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

describe("useRevenueTrend", () => {
  it("groups bills by date into billed vs. collected totals, sorted chronologically", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "bills") {
        return makeChain({
          data: [
            { bill_date: "2026-09-02", total_amount: 1000, paid_amount: 800 },
            { bill_date: "2026-09-01", total_amount: 500, paid_amount: 500 },
            { bill_date: "2026-09-01", total_amount: 300, paid_amount: 100 },
          ],
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useRevenueTrend(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { date: "2026-09-01", billed: 800, collected: 600 },
      { date: "2026-09-02", billed: 1000, collected: 800 },
    ]);
  });
});

describe("useRevenueBreakdown", () => {
  it("categorizes line items across the bills in range and computes each category's percentage share", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "bills") return makeChain({ data: [{ id: "b1" }] });
      if (table === "bill_line_items") {
        return makeChain({ data: [{ item_type: "pharmacy", source_module: null, total_amount: 250 }, { item_type: "lab", source_module: null, total_amount: 750 }] });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useRevenueBreakdown(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const lab = result.current.data!.find((c) => c.name === "Lab")!;
    expect(lab.value).toBe(750);
    expect(lab.pct).toBe(75);
  });

  it("returns an empty list without querying line items when there are no bills in range", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "bills") return makeChain({ data: [] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useRevenueBreakdown(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalledWith("bill_line_items");
  });
});

describe("useServiceLineBilled", () => {
  it("sums OT and dialysis line items separately by source_module, since neither gets its own bill_type", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "bills") return makeChain({ data: [{ id: "b1" }] });
      if (table === "bill_line_items") {
        return makeChain({ data: [{ source_module: "ot", total_amount: 4000 }, { source_module: "dialysis", total_amount: 1500 }, { source_module: "dialysis", total_amount: 500 }] });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useServiceLineBilled(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ otBilled: 4000, dialysisBilled: 2000 });
  });
});

describe("usePaymentModes", () => {
  it("groups payments by mode, capitalizes the label, and defaults an unrecognised mode's color", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "bill_payments") {
        return makeChain({ data: [{ payment_mode: "cash", amount: 100 }, { payment_mode: "cash", amount: 200 }, { payment_mode: "crypto", amount: 50 }] });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => usePaymentModes(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const cash = result.current.data!.find((m) => m.mode === "Cash")!;
    expect(cash.total).toBe(300);
    expect(cash.count).toBe(2);
    const crypto = result.current.data!.find((m) => m.mode === "Crypto")!;
    expect(crypto.fill).toBe("hsl(215, 14%, 60%)");
  });

  it("buckets a missing payment_mode under 'Other'", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "bill_payments") return makeChain({ data: [{ payment_mode: null, amount: 40 }] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => usePaymentModes(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data![0].mode).toBe("Other");
  });
});

describe("useInsuranceSummary", () => {
  it("buckets claims by status and ranks the top 3 TPAs by pending amount", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "insurance_claims") {
        return makeChain({
          data: [
            { status: "settled", claimed_amount: 10000, approved_amount: 9500, settled_amount: 9500, tpa_name: "Star" },
            { status: "submitted", claimed_amount: 5000, approved_amount: 0, settled_amount: 0, tpa_name: "HDFC Ergo" },
            { status: "rejected", claimed_amount: 2000, approved_amount: 0, settled_amount: 0, tpa_name: "Star" },
            { status: "draft", claimed_amount: 1000, approved_amount: 0, settled_amount: 0, tpa_name: "Star" },
          ],
        });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useInsuranceSummary(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.settledCount).toBe(1);
    expect(data.settledAmount).toBe(9500);
    expect(data.pendingCount).toBe(1);
    expect(data.rejectedCount).toBe(1);
    // draft is excluded from "submitted" (submitted = status !== draft)
    expect(data.submittedCount).toBe(3);
    expect(data.topTPAs[0].name).toBe("HDFC Ergo");
  });
});

describe("useClinicalKPIs", () => {
  it("computes bed occupancy percentage and daily OPD average over the range's day count", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "opd_encounters") return makeChain({ data: [{ id: "e1" }, { id: "e2" }, { id: "e3" }] });
      if (table === "admissions") return makeChain({ data: [{ id: "a1" }] });
      if (table === "beds") return makeChain({ data: [{ id: "b1" }, { id: "b2" }] }); // occupied beds call
      if (table === "lab_order_items") return makeChain({ data: [{ id: "l1" }] });
      if (table === "ed_visits") return makeChain({ data: [{ id: "ed1", triage_category: "P1" }, { id: "ed2", triage_category: "P3" }] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useClinicalKPIs(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const data = result.current.data!;
    expect(data.opdVisits).toBe(3);
    expect(data.emergencyCases).toBe(2);
    expect(data.emergencyP1).toBe(1);
    expect(data.admissions).toBe(1);
  });
});

describe("useOPDTrend", () => {
  it("groups OPD encounters and ED visits into the same per-day series", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "opd_encounters") return makeChain({ data: [{ created_at: "2026-09-01T10:00:00Z" }, { created_at: "2026-09-01T11:00:00Z" }] });
      if (table === "ed_visits") return makeChain({ data: [{ arrival_time: "2026-09-01T09:00:00Z" }, { arrival_time: "2026-09-02T09:00:00Z" }] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useOPDTrend(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([
      { date: "2026-09-01", opd: 2, ed: 1 },
      { date: "2026-09-02", opd: 0, ed: 1 },
    ]);
  });
});

describe("useBedOccupancyBreakdown", () => {
  it("segments beds by status and rolls up occupied/total per ward", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "beds") {
        return makeChain({ data: [{ id: "b1", status: "occupied", ward_id: "w1" }, { id: "b2", status: "available", ward_id: "w1" }, { id: "b3", status: "occupied", ward_id: "w2" }] });
      }
      if (table === "wards") return makeChain({ data: [{ id: "w1", name: "ICU" }, { id: "w2", name: "General" }] });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useBedOccupancyBreakdown(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const icu = result.current.data!.wards.find((w) => w.name === "ICU")!;
    expect(icu).toEqual({ name: "ICU", occupied: 1, total: 2 });
    const occupiedSegment = result.current.data!.segments.find((s) => s.name === "Occupied")!;
    expect(occupiedSegment.value).toBe(2);
  });
});

describe("useTopDiagnoses", () => {
  it("counts chief complaints and returns only the top 10, ignoring null complaints", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "opd_encounters") {
        return makeChain({ data: [{ chief_complaint: "Fever" }, { chief_complaint: "Fever" }, { chief_complaint: "Cough" }] });
      }
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useTopDiagnoses(range), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ name: "Fever", count: 2 }, { name: "Cough", count: 1 }]);
  });
});

describe("useInventoryValueOnHand", () => {
  it("reads the pre-aggregated inventory value view, defaulting to 0 with no row", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return makeChain({ data: { hospital_id: "h1" } });
      if (table === "inventory_value_by_hospital") return makeChain({ data: { value_on_hand: 125000 } });
      throw new Error(`unexpected table ${table}`);
    });

    const { result } = renderHook(() => useInventoryValueOnHand(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual({ valueOnHand: 125000 });
  });
});
