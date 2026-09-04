import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { logAudit } from "./auditLog";

function usersChain(row: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row }) }) }) };
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("logAudit", () => {
  it("does nothing when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await logAudit({ action: "view", module: "opd" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("does nothing when the auth user has no matching public.users row", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue(usersChain(null));
    await logAudit({ action: "view", module: "opd" });
    expect(mockFrom).toHaveBeenCalledTimes(1); // only the users lookup, no audit_log insert
  });

  it("writes the resolved user's identity onto the audit_log row", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain({ id: "u1", full_name: "Rao", role: "doctor", hospital_id: "h1" });
      if (table === "audit_log") return { insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    await logAudit({ action: "prescription_saved", module: "opd", entityType: "prescription", entityId: "rx1" });

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        hospital_id: "h1",
        user_id: "u1",
        user_name: "Rao",
        user_role: "doctor",
        action: "prescription_saved",
        module: "opd",
        entity_type: "prescription",
        entity_id: "rx1",
      }),
    );
  });

  it("defaults details to an empty object and entity fields to null when not provided", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain({ id: "u1", full_name: "Rao", role: "doctor", hospital_id: "h1" });
      if (table === "audit_log") return { insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    await logAudit({ action: "view", module: "dashboard" });
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ entity_type: null, entity_id: null, details: {} }),
    );
  });

  it("never throws — an audit-logging failure must not break the caller's action", async () => {
    mockGetUser.mockRejectedValue(new Error("network down"));
    await expect(logAudit({ action: "view", module: "opd" })).resolves.toBeUndefined();
  });
});
