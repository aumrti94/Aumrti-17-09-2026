import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { notifyOrderingDoctorLabResult, resultRecipient } from "./resultNotifications";

function orderChain(order: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: order }) }) }) };
}

function alertsChain(existingUnacked: unknown[]) {
  return { select: () => ({ eq: () => ({ eq: () => ({ limit: () => Promise.resolve({ data: existingUnacked }) }) }) }) };
}

function patientChain(patient: unknown) {
  return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: patient }) }) }) };
}

// Fallback for any table not explicitly handled by a test's dispatcher — a harmless empty
// result rather than a throw, since some Supabase mock chains see a stray extra call.
const NOOP = { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }), eq: () => ({ limit: () => Promise.resolve({ data: [] }) }) }) }), insert: () => Promise.resolve({ error: null }) };

beforeEach(() => mockFrom.mockReset());

describe("resultRecipient — referring clinician wins, ordered_by (the desk) is the fallback", () => {
  it("prefers referring_doctor_id when present", () => {
    expect(resultRecipient({ referring_doctor_id: "doc-1", ordered_by: "clerk-1" })).toBe("doc-1");
  });

  it("falls back to ordered_by when there is no separate referring doctor", () => {
    expect(resultRecipient({ referring_doctor_id: null, ordered_by: "doc-1" })).toBe("doc-1");
  });

  it("returns null when neither is set", () => {
    expect(resultRecipient({})).toBeNull();
  });
});

describe("notifyOrderingDoctorLabResult", () => {
  const BASE_ORDER = {
    id: "order-1", hospital_id: "h1", patient_id: "p1",
    ordered_by: "clerk-1", referring_doctor_id: "doc-1",
    lab_order_items: [
      { result_flag: "N", lab_test_master: { test_name: "CBC" } },
      { result_flag: "N", lab_test_master: { test_name: "LFT" } },
    ],
  };

  it("does nothing when the order can't be resolved", async () => {
    mockFrom.mockReturnValue(orderChain(null));
    await notifyOrderingDoctorLabResult("order-missing");
    expect(mockFrom).toHaveBeenCalledTimes(1); // only the order lookup
  });

  it("does not raise an alert when there is no recipient to tell (a desk order with no doctor)", async () => {
    const insertSpy = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") return orderChain({ ...BASE_ORDER, ordered_by: null, referring_doctor_id: null });
      if (table === "patients") return patientChain(null);
      if (table === "clinical_alerts") return { ...alertsChain([]), insert: insertSpy };
      return NOOP;
    });

    await notifyOrderingDoctorLabResult("order-1");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("skips raising a duplicate alert when one is already unacknowledged for this order", async () => {
    const insertSpy = vi.fn();
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") return orderChain(BASE_ORDER);
      if (table === "patients") return patientChain(null);
      if (table === "clinical_alerts") return { ...alertsChain([{ id: "existing-alert" }]), insert: insertSpy };
      return NOOP;
    });

    await notifyOrderingDoctorLabResult("order-1");
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("raises a medium-severity alert addressed to the referring doctor for a normal result", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") return orderChain(BASE_ORDER);
      if (table === "clinical_alerts") return { ...alertsChain([]), insert: insertSpy };
      if (table === "patients") return patientChain({ full_name: "Jane Doe", uhid: "UHID001" });
      return NOOP;
    });

    await notifyOrderingDoctorLabResult("order-1", "tech-1");

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient_user_id: "doc-1",
        severity: "medium",
        alert_message: expect.stringContaining("Jane Doe (UHID001)"),
        created_by: "tech-1",
      }),
    );
  });

  it("escalates to critical severity when any result is flagged critical-high/low", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const criticalOrder = {
      ...BASE_ORDER,
      lab_order_items: [{ result_flag: "CH", lab_test_master: { test_name: "Potassium" } }],
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") return orderChain(criticalOrder);
      if (table === "clinical_alerts") return { ...alertsChain([]), insert: insertSpy };
      if (table === "patients") return patientChain(null);
      return NOOP;
    });

    await notifyOrderingDoctorLabResult("order-1");
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({ severity: "critical" }));
  });

  it("summarises the test names, truncating a long panel and counting abnormal results", async () => {
    const insertSpy = vi.fn().mockResolvedValue({ error: null });
    const bigPanel = {
      ...BASE_ORDER,
      lab_order_items: [
        { result_flag: "H", lab_test_master: { test_name: "Test1" } },
        { result_flag: "N", lab_test_master: { test_name: "Test2" } },
        { result_flag: "N", lab_test_master: { test_name: "Test3" } },
        { result_flag: "N", lab_test_master: { test_name: "Test4" } },
      ],
    };
    mockFrom.mockImplementation((table: string) => {
      if (table === "lab_orders") return orderChain(bigPanel);
      if (table === "clinical_alerts") return { ...alertsChain([]), insert: insertSpy };
      if (table === "patients") return patientChain(null);
      return NOOP;
    });

    await notifyOrderingDoctorLabResult("order-1");
    const message = insertSpy.mock.calls[0][0].alert_message;
    expect(message).toContain("Test1, Test2, Test3 +1 more");
    expect(message).toContain("1 abnormal result");
  });
});
