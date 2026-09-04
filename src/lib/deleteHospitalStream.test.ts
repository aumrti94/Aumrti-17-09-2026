import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInvoke, mockGetSession } = vi.hoisted(() => ({
  mockInvoke: vi.fn(),
  mockGetSession: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mockInvoke }, auth: { getSession: mockGetSession } },
}));

import { checkDeletePrerequisites, deleteHospitalStream } from "./deleteHospitalStream";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockInvoke.mockReset();
  mockGetSession.mockReset();
  mockFetch.mockReset();
  mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
});

describe("checkDeletePrerequisites", () => {
  it("reports deployed:false when the edge function can't be reached at all", async () => {
    mockInvoke.mockResolvedValue({ data: null, error: { message: "404" } });
    const result = await checkDeletePrerequisites("h1");
    expect(result.ok).toBe(false);
    expect(result.checks.deployed).toBe(false);
  });

  it("reports the granular checks when the function itself replies", async () => {
    mockInvoke.mockResolvedValue({
      data: { ok: false, checks: { deployed: true, service_role_key: false, authenticated: true, admin: true } },
      error: null,
    });
    const result = await checkDeletePrerequisites("h1");
    expect(result).toEqual({
      ok: false,
      checks: { deployed: true, service_role_key: false, authenticated: true, admin: true },
    });
  });
});

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => "application/json" },
    json: async () => body,
  };
}

describe("deleteHospitalStream — non-streaming responses (phase-1 soft-delete/restore/errors)", () => {
  it("returns the soft-delete confirmation body", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { soft_deleted: true, permanent_after: "2026-09-24" }));
    const result = await deleteHospitalStream("h1");
    expect(result).toEqual({ soft_deleted: true, permanent_after: "2026-09-24" });
  });

  it("returns the restore confirmation body when action=restore", async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { restored: true }));
    const result = await deleteHospitalStream("h1", {}, "restore");
    expect(result).toEqual({ restored: true });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ body: JSON.stringify({ hospital_id: "h1", action: "restore" }) }),
    );
  });

  it("throws with the server's real error text, not a generic message", async () => {
    mockFetch.mockResolvedValue(jsonResponse(409, { error: "Hospital is within its 30-day grace period" }));
    await expect(deleteHospitalStream("h1")).rejects.toThrow("Hospital is within its 30-day grace period");
  });

  it("throws a status-coded message when the failure body isn't JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => "text/plain" },
      json: async () => { throw new Error("not json"); },
    });
    await expect(deleteHospitalStream("h1")).rejects.toThrow("Request failed (500)");
  });
});

describe("deleteHospitalStream — streaming purge (SSE)", () => {
  function sseResponse(frames: string[]) {
    let i = 0;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "text/event-stream" },
      body: {
        getReader: () => ({
          read: async () => {
            if (i < frames.length) {
              const chunk = new TextEncoder().encode(frames[i]);
              i++;
              return { done: false, value: chunk };
            }
            return { done: true, value: undefined };
          },
        }),
      },
    };
  }

  it("invokes onTotal/onPhase/onProgress callbacks and resolves with the done payload", async () => {
    const frames = [
      'event: total\ndata: {"rows":500}\n\n',
      'event: phase\ndata: {"label":"Deleting patients"}\n\n',
      'event: progress\ndata: {"table":"patients","i":1,"n":10,"deleted":50,"cumulative":50}\n\n',
      'event: done\ndata: {"hospital_name":"Test Hospital","deleted_auth_users":3}\n\n',
    ];
    mockFetch.mockResolvedValue(sseResponse(frames));

    const onTotal = vi.fn();
    const onPhase = vi.fn();
    const onProgress = vi.fn();
    const result = await deleteHospitalStream("h1", { onTotal, onPhase, onProgress });

    expect(onTotal).toHaveBeenCalledWith(500);
    expect(onPhase).toHaveBeenCalledWith("Deleting patients", undefined);
    expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({ table: "patients", deleted: 50 }));
    expect(result).toEqual(expect.objectContaining({ done: true, hospital_name: "Test Hospital" }));
  });

  it("throws the streamed error event's message rather than resolving", async () => {
    mockFetch.mockResolvedValue(sseResponse(['event: error\ndata: {"error":"Purge failed at patients table"}\n\n']));
    await expect(deleteHospitalStream("h1")).rejects.toThrow("Purge failed at patients table");
  });

  it("throws when the stream ends with no completion signal at all", async () => {
    mockFetch.mockResolvedValue(sseResponse(['event: phase\ndata: {"label":"Starting"}\n\n']));
    await expect(deleteHospitalStream("h1")).rejects.toThrow("Purge ended without a completion signal");
  });

  it("handles a frame split across multiple stream chunks", async () => {
    // "event: total\ndata: {...}\n\n" arrives split mid-line across two reads.
    const frames = ['event: total\nda', 'ta: {"rows":42}\n\n', 'event: done\ndata: {}\n\n'];
    mockFetch.mockResolvedValue(sseResponse(frames));

    const onTotal = vi.fn();
    await deleteHospitalStream("h1", { onTotal });
    expect(onTotal).toHaveBeenCalledWith(42);
  });
});
