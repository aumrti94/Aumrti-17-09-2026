import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const {
  mockToast, mockUseHospitalContext, mockHasAccess, mockFrom, mockGetSession, mockInvoke, mockChannel, mockRemoveChannel,
} = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockUseHospitalContext: vi.fn(),
  mockHasAccess: vi.fn(),
  mockFrom: vi.fn(),
  mockGetSession: vi.fn(),
  mockInvoke: vi.fn(),
  mockChannel: vi.fn(),
  mockRemoveChannel: vi.fn(),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mockToast }) }));
vi.mock("@/hooks/useHospitalContext", () => ({ useHospitalContext: mockUseHospitalContext }));
vi.mock("@/lib/routeRoles", () => ({ hasAccess: mockHasAccess }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: mockFrom,
    auth: { getSession: mockGetSession },
    functions: { invoke: mockInvoke },
    channel: mockChannel,
    removeChannel: mockRemoveChannel,
  },
}));

import { useDashboardData } from "./useDashboardData";

function makeChain(resolveValue: any) {
  const p: any = Promise.resolve(resolveValue);
  const self = () => p;
  for (const m of ["select", "eq", "neq", "gte", "lt", "lte", "in"]) p[m] = self;
  return p;
}

function makeRejectingChain(err: any) {
  const p: any = Promise.reject(err);
  const self = () => p;
  for (const m of ["select", "eq", "neq", "gte", "lt", "lte", "in"]) p[m] = self;
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
    return typeof val === "function" ? val() : makeChain(val);
  });
}

beforeEach(() => {
  mockToast.mockReset();
  mockUseHospitalContext.mockReset();
  mockHasAccess.mockReset();
  mockFrom.mockReset();
  mockGetSession.mockReset();
  mockInvoke.mockReset();
  mockChannel.mockReset();
  mockRemoveChannel.mockReset();
  mockHasAccess.mockReturnValue(false);
  const chan: any = {};
  chan.on = vi.fn().mockReturnValue(chan);
  chan.subscribe = vi.fn().mockReturnValue(chan);
  mockChannel.mockReturnValue(chan);
});

describe("useDashboardData", () => {
  it("never fetches (stays loading, empty KPIs) while there is no hospital id yet", () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: null, role: null, permissions: null });
    const { result } = renderHook(() => useDashboardData());
    expect(result.current.loading).toBe(true);
    expect(result.current.kpis.totalPatients).toBe(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("computes doctorsOnDuty as total doctors minus on-leave, floored at 0", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", role: "admin", permissions: {} });
    tableSequence({
      patients: [{ count: 100 }, { count: 5 }],
      beds: [{ count: 20 }, { count: 15 }],
      opd_visits: [{ count: 8 }, { count: 3 }, { count: 5 }],
      users: [{ count: 10 }],
      staff_attendance: [{ count: 12 }], // more on-leave than doctors — should floor at 0, not go negative
      clinical_alerts: [{ count: 2 }],
    });

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kpis.doctorsOnDuty).toBe(0);
    expect(result.current.kpis.doctorsOnLeave).toBe(12);
    expect(result.current.kpis.criticalAlerts).toBe(2);
  });

  it("does not query bills or pharmacy_dispensing at all when the role lacks billing/accounts access", async () => {
    mockHasAccess.mockReturnValue(false);
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", role: "nurse", permissions: {} });
    tableSequence({
      patients: [{ count: 0 }, { count: 0 }],
      beds: [{ count: 0 }, { count: 0 }],
      opd_visits: [{ count: 0 }, { count: 0 }, { count: 0 }],
      users: [{ count: 0 }],
      staff_attendance: [{ count: 0 }],
      clinical_alerts: [{ count: 0 }],
    });

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kpis.revenueMTD).toBe(0);
    expect(mockFrom).not.toHaveBeenCalledWith("bills");
    expect(mockFrom).not.toHaveBeenCalledWith("pharmacy_dispensing");
  });

  it("sums bills paid_amount plus pharmacy_dispensing net_amount for revenueMTD when access is allowed", async () => {
    mockHasAccess.mockImplementation((route: string) => route === "/billing");
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", role: "admin", permissions: {} });
    tableSequence({
      patients: [{ count: 0 }, { count: 0 }],
      beds: [{ count: 0 }, { count: 0 }],
      opd_visits: [{ count: 0 }, { count: 0 }, { count: 0 }],
      bills: [{ data: [{ paid_amount: 1000 }, { paid_amount: 500 }] }, { data: [{ paid_amount: 200 }] }],
      users: [{ count: 0 }],
      staff_attendance: [{ count: 0 }],
      clinical_alerts: [{ count: 0 }],
      pharmacy_dispensing: [{ data: [{ net_amount: 300 }] }, { data: [] }],
    });

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kpis.revenueMTD).toBe(1800); // 1000 + 500 + 300
    expect(result.current.kpis.revenueLastMonth).toBe(200);
  });

  it("falls back to the safe default for a single query that rejects, without failing the whole fetch", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", role: "admin", permissions: {} });
    const counters: Record<string, number> = {};
    mockFrom.mockImplementation((table: string) => {
      if (table === "clinical_alerts") return makeRejectingChain(new Error("timeout"));
      const seq: Record<string, any> = {
        patients: { count: 1 }, beds: { count: 1 }, opd_visits: { count: 1 }, users: { count: 1 }, staff_attendance: { count: 0 },
      };
      return makeChain(seq[table] ?? { count: 0 });
    });

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.kpis.criticalAlerts).toBe(0);
  });

  it("seedData does nothing without an active session", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", role: "admin", permissions: {} });
    tableSequence({
      patients: [{ count: 0 }, { count: 0 }], beds: [{ count: 0 }, { count: 0 }], opd_visits: [{ count: 0 }, { count: 0 }, { count: 0 }],
      users: [{ count: 0 }], staff_attendance: [{ count: 0 }], clinical_alerts: [{ count: 0 }],
    });
    mockGetSession.mockResolvedValue({ data: { session: null } });

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.seedData();
    });

    expect(mockInvoke).not.toHaveBeenCalled();
    expect(result.current.seeding).toBe(false);
  });

  it("seedData invokes seed-dashboard, toasts, and refetches when it reports it seeded data", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", role: "admin", permissions: {} });
    tableSequence({
      patients: [{ count: 0 }, { count: 0 }], beds: [{ count: 0 }, { count: 0 }], opd_visits: [{ count: 0 }, { count: 0 }, { count: 0 }],
      users: [{ count: 0 }], staff_attendance: [{ count: 0 }], clinical_alerts: [{ count: 0 }],
    });
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "t" } } });
    mockInvoke.mockResolvedValue({ data: { seeded: true } });

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.seedData();
    });

    expect(mockInvoke).toHaveBeenCalledWith("seed-dashboard", {});
    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "Sample data loaded" }));
  });

  it("subscribes the realtime channel to beds, opd_visits, and clinical_alerts scoped by hospital", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", role: "admin", permissions: {} });
    tableSequence({
      patients: [{ count: 0 }, { count: 0 }], beds: [{ count: 0 }, { count: 0 }], opd_visits: [{ count: 0 }, { count: 0 }, { count: 0 }],
      users: [{ count: 0 }], staff_attendance: [{ count: 0 }], clinical_alerts: [{ count: 0 }],
    });

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const chan = mockChannel.mock.results[0].value;
    expect(chan.on).toHaveBeenCalledWith("postgres_changes", expect.objectContaining({ table: "beds", filter: "hospital_id=eq.h1" }), expect.any(Function));
    expect(chan.on).toHaveBeenCalledWith("postgres_changes", expect.objectContaining({ table: "clinical_alerts", event: "INSERT", filter: "hospital_id=eq.h1" }), expect.any(Function));
  });

  it("shows a destructive toast for a critical clinical alert insert, in addition to refetching", async () => {
    mockUseHospitalContext.mockReturnValue({ hospitalId: "h1", role: "admin", permissions: {} });
    tableSequence({
      patients: [{ count: 0 }, { count: 0 }], beds: [{ count: 0 }, { count: 0 }], opd_visits: [{ count: 0 }, { count: 0 }, { count: 0 }],
      users: [{ count: 0 }], staff_attendance: [{ count: 0 }], clinical_alerts: [{ count: 0 }],
    });

    const { result } = renderHook(() => useDashboardData());
    await waitFor(() => expect(result.current.loading).toBe(false));

    const chan = mockChannel.mock.results[0].value;
    const alertHandler = chan.on.mock.calls.find((c: any) => c[1].table === "clinical_alerts")[2];
    act(() => {
      alertHandler({ new: { severity: "critical", alert_message: "Patient deteriorating" } });
    });

    expect(mockToast).toHaveBeenCalledWith(expect.objectContaining({ title: "🚨 Critical Alert", description: "Patient deteriorating", variant: "destructive" }));
  });
});
