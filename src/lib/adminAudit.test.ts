import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { logAdminAction } from "./adminAudit";

function adminsChain(row: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row }) }) }) };
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("logAdminAction — fleet-wide admin_audit_log", () => {
  it("does nothing when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await logAdminAction("impersonation_start");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("records the acting admin's identity and the target hospital", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "aumrti_admins") return adminsChain({ id: "admin-1", full_name: "Platform Admin" });
      if (table === "admin_audit_log") return { insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    await logAdminAction("hospital_suspended", { hospitalId: "h1", hospitalName: "Test Hospital", details: { reason: "non-payment" } });

    expect(insertSpy).toHaveBeenCalledWith({
      admin_id: "admin-1",
      admin_name: "Platform Admin",
      action: "hospital_suspended",
      target_hospital_id: "h1",
      target_hospital_name: "Test Hospital",
      details: { reason: "non-payment" },
    });
  });

  it("writes null admin fields rather than failing when the caller has no aumrti_admins row", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "aumrti_admins") return adminsChain(null);
      if (table === "admin_audit_log") return { insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    await logAdminAction("some_action");
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ admin_id: null, admin_name: null }));
  });

  it("never throws — never blocks the action it's logging", async () => {
    mockGetUser.mockRejectedValue(new Error("network down"));
    await expect(logAdminAction("some_action")).resolves.toBeUndefined();
  });
});
