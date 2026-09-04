import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockInsert, mockNextDocNumber } = vi.hoisted(() => ({
  mockInsert: vi.fn(),
  mockNextDocNumber: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: vi.fn(() => ({ insert: mockInsert })) },
}));
vi.mock("./documentNumber", () => ({ nextDocumentNumber: mockNextDocNumber }));

import { routeEdPatientToMortuary } from "./edMortuary";

beforeEach(() => {
  mockInsert.mockReset();
  mockNextDocNumber.mockReset();
  mockInsert.mockResolvedValue({ data: null, error: null });
});

describe("routeEdPatientToMortuary — ED expired/BID patient into the mortuary pipeline", () => {
  it("creates a mortuary_admissions row and returns the generated body number", async () => {
    mockNextDocNumber.mockResolvedValue("BODY-2026-0042");
    const result = await routeEdPatientToMortuary({
      hospitalId: "h1",
      patientId: "p1",
      pronouncedBy: "doc-1",
      cause: "Cardiac arrest",
    });

    expect(result).toEqual({ bodyNumber: "BODY-2026-0042" });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ body_number: "BODY-2026-0042", is_mlc: false, status: "in_mortuary" }),
    );
  });

  it("defaults cause of death to 'Under investigation' when not provided", async () => {
    mockNextDocNumber.mockResolvedValue("BODY-2026-0043");
    await routeEdPatientToMortuary({ hospitalId: "h1", patientId: "p1", pronouncedBy: null });
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({ cause_of_death: "Under investigation" }),
    );
  });

  it("does not create an mlc_records row for a non-MLC case", async () => {
    mockNextDocNumber.mockResolvedValue("BODY-2026-0044");
    await routeEdPatientToMortuary({ hospitalId: "h1", patientId: "p1", pronouncedBy: null, isMlc: false });
    expect(mockInsert).toHaveBeenCalledTimes(1); // mortuary_admissions only
  });

  it("also creates an mlc_records row with a separate MLC number for an MLC case", async () => {
    mockNextDocNumber.mockResolvedValueOnce("BODY-2026-0045").mockResolvedValueOnce("MLC-2026-0011");
    await routeEdPatientToMortuary({
      hospitalId: "h1",
      patientId: "p1",
      pronouncedBy: null,
      isMlc: true,
      mlcDetails: { police_station: "City PS", officer: "Insp. Rao", fir: "FIR/12/2026" },
    });

    expect(mockInsert).toHaveBeenCalledTimes(2);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        mlc_number: "MLC-2026-0011",
        police_station: "City PS",
        officer_name: "Insp. Rao",
        fir_number: "FIR/12/2026",
        status: "open",
      }),
    );
  });
});
