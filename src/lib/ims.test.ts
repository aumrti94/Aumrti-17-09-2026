import { describe, it, expect, vi, beforeEach } from "vitest";

const insertMock = vi.fn().mockReturnValue({ then: (resolve: any) => Promise.resolve().then(resolve) });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "auth-uid-1" } } }),
      onAuthStateChange: vi.fn(),
    },
    from: vi.fn((table: string) => {
      if (table === "users") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: { id: "app-user-1" } }),
        };
      }
      return { insert: insertMock };
    }),
  },
}));

import { logRecordAccess, logConfigChange } from "@/lib/ims";

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  insertMock.mockClear();
});

describe("logRecordAccess — Record Access Log mechanism", () => {
  it("does nothing when hospitalId is null — never writes an orphaned log row", async () => {
    logRecordAccess({ hospitalId: null, recordType: "patient_chart", action: "view" });
    await flush();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("writes a row carrying the resolved app-user id, hospital, and action", async () => {
    logRecordAccess({ hospitalId: "hosp-a", recordType: "patient_chart", recordId: "rec-1", patientId: "pat-1", action: "print" });
    await flush();
    await flush();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hospital_id: "hosp-a",
        record_type: "patient_chart",
        record_id: "rec-1",
        accessed_by: "app-user-1",
        access_action: "print",
        patient_id: "pat-1",
      })
    );
  });

  it("a different access action produces a different logged action value", async () => {
    logRecordAccess({ hospitalId: "hosp-a", recordType: "patient_chart", action: "export" });
    await flush();
    await flush();
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ access_action: "export" }));
  });

  it("never throws synchronously, even for a missing hospitalId", () => {
    expect(() => logRecordAccess({ hospitalId: null, recordType: "x", action: "view" })).not.toThrow();
  });
});

describe("logConfigChange — Config Change Log mechanism", () => {
  it("does nothing when hospitalId is null", async () => {
    logConfigChange({ hospitalId: null, configArea: "service_rates", newValue: 500 });
    await flush();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("writes old and new value together so a diff is reconstructable", async () => {
    logConfigChange({ hospitalId: "hosp-a", configArea: "service_rates", itemId: "svc-1", oldValue: 400, newValue: 500, reason: "annual revision" });
    await flush();
    await flush();
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        hospital_id: "hosp-a",
        config_area: "service_rates",
        item_id: "svc-1",
        old_value: 400,
        new_value: 500,
        reason: "annual revision",
        changed_by: "app-user-1",
      })
    );
  });

  it("uses the explicitly-passed userId instead of resolving one, saving a round trip", async () => {
    logConfigChange({ hospitalId: "hosp-a", configArea: "role_permissions", newValue: {}, userId: "explicit-user" });
    await flush();
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ changed_by: "explicit-user" }));
  });
});
