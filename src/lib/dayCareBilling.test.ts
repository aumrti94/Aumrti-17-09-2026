import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockAutoChargeService } = vi.hoisted(() => ({ mockAutoChargeService: vi.fn() }));
vi.mock("@/lib/serviceBilling", () => ({
  MODULE_DAY_CARE: "day_care",
  autoChargeService: mockAutoChargeService,
}));
vi.mock("@/lib/dayCareProcedures", () => ({
  normalizeQuantity: (q: unknown) => Math.max(1, Number(q) || 1),
}));

import { chargeDayCareProcedures } from "./dayCareBilling";

beforeEach(() => mockAutoChargeService.mockReset());

describe("chargeDayCareProcedures", () => {
  it("charges every procedure on the booking, one line item each", async () => {
    mockAutoChargeService.mockResolvedValue({ billId: "bill-1" });

    const results = await chargeDayCareProcedures({
      hospitalId: "h1",
      patientId: "p1",
      admissionId: "adm-1",
      procedures: [
        { procedureName: "Cataract Surgery", quantity: 1, rate: 15000 } as any,
        { procedureName: "Minor Suturing", quantity: 1, rate: 800 } as any,
      ],
    });

    expect(mockAutoChargeService).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(2);
  });

  it("posts each charge as GST-exempt (0%) — healthcare services are statutorily exempt", async () => {
    mockAutoChargeService.mockResolvedValue({ billId: "bill-1" });
    await chargeDayCareProcedures({
      hospitalId: "h1", patientId: "p1", admissionId: "adm-1",
      procedures: [{ procedureName: "Cataract Surgery", quantity: 1, rate: 15000 } as any],
    });
    expect(mockAutoChargeService).toHaveBeenCalledWith(expect.objectContaining({ gstPercent: 0 }));
  });

  it("charges the rate frozen at booking, not zero, even if the rate field is a string", async () => {
    mockAutoChargeService.mockResolvedValue({ billId: "bill-1" });
    await chargeDayCareProcedures({
      hospitalId: "h1", patientId: "p1", admissionId: "adm-1",
      procedures: [{ procedureName: "Cataract Surgery", quantity: 1, rate: "15000" } as any],
    });
    expect(mockAutoChargeService).toHaveBeenCalledWith(expect.objectContaining({ unitRate: 15000 }));
  });

  it("continues sequentially and lets a mid-way failure propagate rather than rolling back earlier charges", async () => {
    mockAutoChargeService
      .mockResolvedValueOnce({ billId: "bill-1" })
      .mockRejectedValueOnce(new Error("db unreachable"));

    await expect(
      chargeDayCareProcedures({
        hospitalId: "h1", patientId: "p1", admissionId: "adm-1",
        procedures: [
          { procedureName: "First", quantity: 1, rate: 100 } as any,
          { procedureName: "Second", quantity: 1, rate: 200 } as any,
        ],
      }),
    ).rejects.toThrow("db unreachable");

    // The first call was still made — its charge is real and stays posted.
    expect(mockAutoChargeService).toHaveBeenCalledTimes(2);
  });

  it("filters out a null result (unbilled, zero-rate) from the returned results", async () => {
    mockAutoChargeService.mockResolvedValue(null);
    const results = await chargeDayCareProcedures({
      hospitalId: "h1", patientId: "p1", admissionId: "adm-1",
      procedures: [{ procedureName: "Free Follow-up", quantity: 1, rate: 0 } as any],
    });
    expect(results).toEqual([]);
  });
});
