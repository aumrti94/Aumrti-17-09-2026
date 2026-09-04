import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetSession, mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mockGetSession, getUser: mockGetUser }, from: mockFrom },
}));

import { rotateHospitalKey, getRotationStatus, getCurrentKeyInfo } from "./key-rotation";

function chain(data: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data }) }) }) };
}

function chain2(data: unknown) {
  // supports .select().eq().eq().maybeSingle() (getCurrentKeyInfo) and
  // .select().eq().order().limit().maybeSingle() (getRotationStatus)
  const node: any = {
    eq: () => node,
    order: () => node,
    limit: () => node,
    maybeSingle: () => Promise.resolve({ data }),
  };
  return { select: () => node };
}

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockGetSession.mockReset();
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockFetch.mockReset();
});

describe("rotateHospitalKey — admin-only DEK rotation", () => {
  it("refuses without an authenticated session", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await expect(rotateHospitalKey("h1")).rejects.toThrow("Not authenticated");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("refuses for a non-admin caller without calling the rotation endpoint", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue(chain({ role: "receptionist" }));

    const result = await rotateHospitalKey("h1");
    expect(result).toEqual({ status: "error", message: "Key rotation requires admin or super_admin role." });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("reports an already-in-progress rotation distinctly from a fresh one", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue(chain({ role: "super_admin" }));
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ alreadyInProgress: true }) });

    const result = await rotateHospitalKey("h1");
    expect(result.status).toBe("already_in_progress");
  });

  it("initiates rotation for an admin caller and reports the new key version", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue(chain({ role: "admin" }));
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ newKeyVersion: 3, initiatedAt: "2026-08-24T00:00:00Z" }),
    });

    const result = await rotateHospitalKey("h1");
    expect(result.status).toBe("initiated");
    expect(result.newKeyVersion).toBe(3);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/functions/v1/phi-backfill-encrypt"),
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer tok" }),
      }),
    );
  });

  it("surfaces a failed rotation request as a status:error result, not a throw", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue(chain({ role: "admin" }));
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => "internal error" });

    const result = await rotateHospitalKey("h1");
    expect(result.status).toBe("error");
    expect(result.message).toContain("500");
  });
});

describe("getRotationStatus", () => {
  it("reports not-running when there is no backfill log entry", async () => {
    mockFrom.mockReturnValue(chain2(null));
    const result = await getRotationStatus("h1");
    expect(result).toEqual({ isRunning: false, lastEntry: null });
  });

  it("reports running when the latest entry's status is 'running'", async () => {
    mockFrom.mockReturnValue(
      chain2({ status: "running", rows_encrypted: 500, rows_failed: 0, started_at: "t1", finished_at: null }),
    );
    const result = await getRotationStatus("h1");
    expect(result.isRunning).toBe(true);
    expect(result.lastEntry?.rowsEncrypted).toBe(500);
  });

  it("reports not-running once the latest entry has completed", async () => {
    mockFrom.mockReturnValue(
      chain2({ status: "completed", rows_encrypted: 1000, rows_failed: 2, started_at: "t1", finished_at: "t2" }),
    );
    const result = await getRotationStatus("h1");
    expect(result.isRunning).toBe(false);
  });
});

describe("getCurrentKeyInfo", () => {
  it("returns null when no key has been generated yet", async () => {
    mockFrom.mockReturnValue(chain2(null));
    expect(await getCurrentKeyInfo("h1")).toBeNull();
  });

  it("returns the active key's version and rotation timestamps", async () => {
    mockFrom.mockReturnValue(chain2({ key_version: 2, created_at: "t1", rotated_at: "t2" }));
    const result = await getCurrentKeyInfo("h1");
    expect(result).toEqual({ version: 2, createdAt: "t1", rotatedAt: "t2" });
  });
});
