import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { initiateDischargeWorkflow, announceDischargeInitiated, DISCHARGE_INITIATED_EVENT } from "./dischargeWorkflow";

function selectChain(data: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data }) }) }) };
}

function updateChain(error: unknown = null) {
  return { update: () => ({ eq: () => Promise.resolve({ error }) }) };
}

function insertChain() {
  return { insert: () => Promise.resolve({ data: null, error: null }) };
}

beforeEach(() => mockFrom.mockReset());

describe("initiateDischargeWorkflow — starts the TAT clock exactly once", () => {
  it("starts the workflow and returns alreadyStarted:false on first call", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "admissions") {
        // First call reads discharge_ordered_at (null); subsequent update call.
        return { ...selectChain(null), ...updateChain(null) };
      }
      return insertChain();
    });

    const result = await initiateDischargeWorkflow("adm-1", null);
    expect(result.alreadyStarted).toBe(false);
    expect(result.startedAt).toBeTruthy();
  });

  it("is idempotent — a second call returns the original start time unchanged", async () => {
    const originalStart = "2026-08-24T09:00:00.000Z";
    mockFrom.mockImplementation((table: string) => {
      if (table === "admissions") return selectChain({ discharge_ordered_at: originalStart });
      return insertChain();
    });

    const result = await initiateDischargeWorkflow("adm-1", null);
    expect(result).toEqual({ startedAt: originalStart, alreadyStarted: true });
  });

  it("throws when the update fails, rather than reporting a false success", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "admissions") return { ...selectChain(null), ...updateChain({ message: "row locked" }) };
      return insertChain();
    });

    await expect(initiateDischargeWorkflow("adm-1", null)).rejects.toThrow("row locked");
  });

  it("does not attempt team-alert notifications when no hospitalId is given", async () => {
    const insertSpy = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "admissions") return { ...selectChain(null), ...updateChain(null) };
      if (table === "clinical_alerts") return { insert: insertSpy };
      return insertChain();
    });

    await initiateDischargeWorkflow("adm-1", null);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

describe("announceDischargeInitiated", () => {
  it("dispatches a window CustomEvent carrying the admission id and start time", () => {
    const handler = vi.fn();
    window.addEventListener(DISCHARGE_INITIATED_EVENT, handler);
    announceDischargeInitiated("adm-1", "2026-08-24T09:00:00.000Z");
    expect(handler).toHaveBeenCalledTimes(1);
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toEqual({ admissionId: "adm-1", startedAt: "2026-08-24T09:00:00.000Z" });
    window.removeEventListener(DISCHARGE_INITIATED_EVENT, handler);
  });
});
