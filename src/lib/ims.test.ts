import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom, mockOnAuthStateChange } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser, onAuthStateChange: mockOnAuthStateChange }, from: mockFrom },
}));

function usersChain(row: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: row }) }) }) };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  vi.resetModules();
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockOnAuthStateChange.mockReset();
});

describe("logRecordAccess — fire-and-forget record-access audit trail", () => {
  it("does nothing when hospitalId is missing", async () => {
    const { logRecordAccess } = await import("./ims");
    logRecordAccess({ hospitalId: null, recordType: "prescription", action: "view" });
    await flush();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("logs the access event once the user id resolves", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain({ id: "user-1" });
      if (table === "record_access_logs") return { insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const { logRecordAccess } = await import("./ims");
    logRecordAccess({ hospitalId: "h1", recordType: "prescription", recordId: "rx1", action: "print" });
    await flush();

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hospital_id: "h1", record_type: "prescription", accessed_by: "user-1", access_action: "print" }),
    );
  });

  it("does not insert when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { logRecordAccess } = await import("./ims");
    logRecordAccess({ hospitalId: "h1", recordType: "prescription", action: "view" });
    await flush();
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("logConfigChange — fire-and-forget config-change audit trail", () => {
  it("does nothing when hospitalId is missing", async () => {
    const { logConfigChange } = await import("./ims");
    logConfigChange({ hospitalId: null, configArea: "tariff" });
    await flush();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("skips the user lookup when userId is passed explicitly", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    const { logConfigChange } = await import("./ims");
    logConfigChange({ hospitalId: "h1", configArea: "tariff", userId: "user-1", oldValue: 100, newValue: 150 });
    await flush();

    expect(mockGetUser).not.toHaveBeenCalled();
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hospital_id: "h1", config_area: "tariff", changed_by: "user-1", old_value: 100, new_value: 150 }),
    );
  });

  it("resolves the user id when not passed explicitly", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") return usersChain({ id: "user-1" });
      if (table === "config_change_logs") return { insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const { logConfigChange } = await import("./ims");
    logConfigChange({ hospitalId: "h1", configArea: "permissions" });
    await flush();

    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ changed_by: "user-1" }));
  });
});
