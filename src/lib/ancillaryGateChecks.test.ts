import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockCheckClearance } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockCheckClearance: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));
vi.mock("@/lib/ipdAncillaryGate", () => ({ checkAncillaryClearance: mockCheckClearance }));

import { checkLabOrderClearance, checkRadiologyOrderClearance, checkPharmacyDispenseClearance, recordAncillaryOverride } from "./ancillaryGateChecks";

const CLEARED = { cleared: true, reason: "cleared", unpaidAmount: 0, overrideAvailable: false };

beforeEach(() => {
  mockFrom.mockReset();
  mockCheckClearance.mockReset();
});

describe("checkLabOrderClearance", () => {
  it("resolves order context and dedupe keys, then defers the decision to checkAncillaryClearance", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { hospital_id: "h1", admission_id: "adm-1", priority: "routine" } }) }) }) };
      if (table === "lab_order_items") return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: "item-1" }, { id: "item-2" }] }) }) };
      throw new Error(`unexpected table ${table}`);
    });
    mockCheckClearance.mockResolvedValue(CLEARED);

    const result = await checkLabOrderClearance("order-1", "doctor");
    expect(result).toEqual(CLEARED);
    expect(mockCheckClearance).toHaveBeenCalledWith("h1", expect.objectContaining({
      service: "lab", admissionId: "adm-1", priority: "routine", dedupeKeys: ["lab:item-1", "lab:item-2"],
    }));
  });

  it("treats an unresolvable order as cleared with no charge found, rather than blocking forever", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    const result = await checkLabOrderClearance("order-missing");
    expect(result).toEqual({ cleared: true, reason: "no_charge_found", unpaidAmount: 0, overrideAvailable: false });
    expect(mockCheckClearance).not.toHaveBeenCalled();
  });
});

describe("checkRadiologyOrderClearance", () => {
  it("dedupes on radiology:{orderId} — one line per order, not per item", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { hospital_id: "h1", admission_id: "adm-1", priority: "stat" } }) }) }) });
    mockCheckClearance.mockResolvedValue(CLEARED);

    await checkRadiologyOrderClearance("order-1");
    expect(mockCheckClearance).toHaveBeenCalledWith("h1", expect.objectContaining({ dedupeKeys: ["radiology:order-1"] }));
  });
});

describe("checkPharmacyDispenseClearance", () => {
  it("passes priority:null — pharmacy_dispensing has no priority column, urgency bypass is inapplicable", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "pharmacy_dispensing") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { hospital_id: "h1", admission_id: "adm-1" } }) }) }) };
      if (table === "pharmacy_dispensing_items") return { select: () => ({ eq: () => Promise.resolve({ data: [{ id: "di-1" }] }) }) };
      throw new Error(`unexpected table ${table}`);
    });
    mockCheckClearance.mockResolvedValue(CLEARED);

    await checkPharmacyDispenseClearance("disp-1");
    expect(mockCheckClearance).toHaveBeenCalledWith("h1", expect.objectContaining({
      priority: null, dedupeKeys: ["pharmacy:dispense-item:di-1"],
    }));
  });
});

describe("recordAncillaryOverride — audit trail written BEFORE the service proceeds", () => {
  it("refuses to record an override with a blank reason", async () => {
    const result = await recordAncillaryOverride({ hospitalId: "h1", service: "lab", reason: "   ", overriddenBy: "u1" });
    expect(result).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("refuses to record an override with no overriding user", async () => {
    const result = await recordAncillaryOverride({ hospitalId: "h1", service: "lab", reason: "Emergency", overriddenBy: "" });
    expect(result).toBe(false);
  });

  it("writes a clinical_alerts row capturing the reason, and returns true", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({ insert: insertSpy });

    const result = await recordAncillaryOverride({
      hospitalId: "h1", service: "pharmacy", patientId: "p1", reason: "Life-threatening emergency", overriddenBy: "u1", detail: "Sepsis protocol",
    });

    expect(result).toBe(true);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        alert_type: "ipd_ancillary_payment_override",
        alert_message: expect.stringContaining("Life-threatening emergency"),
        acknowledged_by: "u1",
      }),
    );
  });

  it("returns false when the audit write itself fails — the caller must refuse the override", async () => {
    mockFrom.mockReturnValue({ insert: vi.fn().mockResolvedValue({ error: { message: "insert failed" } }) });
    const result = await recordAncillaryOverride({ hospitalId: "h1", service: "lab", reason: "Emergency", overriddenBy: "u1" });
    expect(result).toBe(false);
  });
});
