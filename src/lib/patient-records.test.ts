import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockFrom, mockRpc, mockGetSession } = vi.hoisted(() => ({
  mockFrom: vi.fn(),
  mockRpc: vi.fn(),
  mockGetSession: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mockFrom, rpc: mockRpc, auth: { getSession: mockGetSession } },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { calculateDobFromAge, generatePatientUhid, findPatientByPhone, createPatientRecord } from "./patient-records";

beforeEach(() => {
  mockFrom.mockReset();
  mockRpc.mockReset();
  mockGetSession.mockReset();
  mockFetch.mockReset();
});

describe("calculateDobFromAge", () => {
  it("computes a DOB roughly `age` years before today", () => {
    const dob = calculateDobFromAge(30);
    const expectedYear = new Date().getFullYear() - 30;
    expect(dob).toMatch(new RegExp(`^${expectedYear}-\\d{2}-\\d{2}$`));
  });

  it("returns null for a missing, zero, negative, or NaN age", () => {
    expect(calculateDobFromAge(undefined)).toBeNull();
    expect(calculateDobFromAge(null)).toBeNull();
    expect(calculateDobFromAge(0)).toBeNull();
    expect(calculateDobFromAge(-5)).toBeNull();
    expect(calculateDobFromAge(NaN)).toBeNull();
  });
});

describe("generatePatientUhid", () => {
  it("formats YYYYMMDD-#### by default", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { uhid_prefix: "AUM", uhid_date_format: null } }) }) }) });
    mockRpc.mockResolvedValue({ data: 7, error: null });

    const uhid = await generatePatientUhid("h1");
    const today = new Date();
    const yyyymmdd = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
    expect(uhid).toBe(`AUM-${yyyymmdd}-0007`);
  });

  it("formats YYYY-#### when the hospital is configured for a year-only format", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { uhid_prefix: "AUM", uhid_date_format: "YYYY" } }) }) }) });
    mockRpc.mockResolvedValue({ data: 12, error: null });

    const uhid = await generatePatientUhid("h1");
    expect(uhid).toBe(`AUM-${new Date().getFullYear()}-0012`);
  });

  it("formats a bare sequence when configured for NONE", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { uhid_prefix: "AUM", uhid_date_format: "NONE" } }) }) }) });
    mockRpc.mockResolvedValue({ data: 3, error: null });
    expect(await generatePatientUhid("h1")).toBe("AUM-0003");
  });

  it("defaults the prefix to UHID when the hospital hasn't configured one", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    mockRpc.mockResolvedValue({ data: 1, error: null });
    const uhid = await generatePatientUhid("h1");
    expect(uhid.startsWith("UHID-")).toBe(true);
  });

  it("throws when the sequence RPC fails, rather than minting a duplicate-risk id", async () => {
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    mockRpc.mockResolvedValue({ data: null, error: { message: "sequence exhausted" } });
    await expect(generatePatientUhid("h1")).rejects.toEqual({ message: "sequence exhausted" });
  });
});

describe("findPatientByPhone", () => {
  it("returns null without any lookup for a too-short phone number", async () => {
    expect(await findPatientByPhone("h1", "123")).toBeNull();
    expect(mockGetSession).not.toHaveBeenCalled();
  });

  it("returns a display-masked record from the Edge Function path", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ patient: { id: "p1", uhid: "UHID001", displayName: "Jane Doe", displayPhone: "98765 *** 10" } }),
    });

    const result = await findPatientByPhone("h1", "9876543210");
    expect(result).toEqual({ id: "p1", uhid: "UHID001", full_name: "Jane Doe", phone: null, displayPhone: "98765 *** 10" });
  });

  it("returns null when the Edge Function finds no match", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ patient: null }) });
    expect(await findPatientByPhone("h1", "9876543210")).toBeNull();
  });

  it("falls back to a direct plaintext query when the Edge Function is unreachable", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } }); // callPhiFunction throws "Not authenticated"
    mockFrom.mockReturnValue({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "p1", full_name: "Jane Doe", uhid: "UHID001", phone: "9876543210" }, error: null }) }) }) }),
    });

    const result = await findPatientByPhone("h1", "9876543210");
    expect(result?.id).toBe("p1");
    expect(result?.displayPhone).toBeTruthy();
  });
});

describe("createPatientRecord", () => {
  it("inserts the base record and returns it with a masked display phone", async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === "hospitals") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { uhid_prefix: "AUM", uhid_date_format: "NONE" } }) }) }) };
      if (table === "patients") {
        return { insert: () => ({ select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "p1", full_name: "Jane Doe", uhid: "AUM-0001", phone: "9876543210" }, error: null }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({ data: 1, error: null });
    mockGetSession.mockResolvedValue({ data: { session: null } }); // PHI encrypt call fails fire-and-forget, fine

    const result = await createPatientRecord({ hospitalId: "h1", fullName: "Jane Doe", phone: "9876543210" });
    expect(result.id).toBe("p1");
    expect(result.displayPhone).toBeTruthy();
    expect(result.displayPhone).not.toBe("9876543210");
  });

  it("defaults an unnamed patient to 'Walk-in Customer'", async () => {
    let insertedRow: any;
    mockFrom.mockImplementation((table: string) => {
      if (table === "hospitals") return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) };
      if (table === "patients") {
        return { insert: (row: any) => { insertedRow = row; return { select: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "p1", full_name: "Walk-in Customer", uhid: "UHID-0001", phone: null }, error: null }) }) }; } };
      }
      throw new Error(`unexpected table ${table}`);
    });
    mockRpc.mockResolvedValue({ data: 1, error: null });

    await createPatientRecord({ hospitalId: "h1", fullName: "   " });
    expect(insertedRow.full_name).toBe("Walk-in Customer");
  });
});
