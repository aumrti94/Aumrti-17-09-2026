import { describe, it, expect, vi, beforeEach } from "vitest";

let hospitalRow: any = { uhid_prefix: "AUM", uhid_date_format: "YYYYMMDD" };
let seqValue = 7;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockImplementation(() => Promise.resolve({ data: hospitalRow, error: null })),
    })),
    rpc: vi.fn().mockImplementation(() => Promise.resolve({ data: seqValue, error: null })),
  },
}));

import { generatePatientUhid } from "@/lib/patient-records";

beforeEach(() => {
  hospitalRow = { uhid_prefix: "AUM", uhid_date_format: "YYYYMMDD" };
  seqValue = 7;
});

describe("generatePatientUhid — Settings › Hospital Profile UHID prefix/format", () => {
  it("uses the configured prefix and zero-pads the sequence to 4 digits", async () => {
    const uhid = await generatePatientUhid("hosp-a");
    expect(uhid.startsWith("AUM-")).toBe(true);
    expect(uhid.endsWith("-0007")).toBe(true);
  });

  it("a different configured prefix for the same hospital produces a visibly different UHID", async () => {
    hospitalRow = { uhid_prefix: "MED", uhid_date_format: "YYYYMMDD" };
    const uhid = await generatePatientUhid("hosp-b");
    expect(uhid.startsWith("MED-")).toBe(true);
  });

  it("date_format 'YYYY' omits the month/day from the UHID", async () => {
    hospitalRow = { uhid_prefix: "AUM", uhid_date_format: "YYYY" };
    const uhid = await generatePatientUhid("hosp-a");
    const year = new Date().getFullYear().toString();
    expect(uhid).toBe(`AUM-${year}-0007`);
  });

  it("date_format 'NONE' omits the date component entirely", async () => {
    hospitalRow = { uhid_prefix: "AUM", uhid_date_format: "NONE" };
    const uhid = await generatePatientUhid("hosp-a");
    expect(uhid).toBe("AUM-0007");
  });

  it("the three date formats produce three structurally different UHIDs from the identical prefix/sequence", async () => {
    hospitalRow = { uhid_prefix: "AUM", uhid_date_format: "YYYYMMDD" };
    const full = await generatePatientUhid("hosp-a");
    hospitalRow = { uhid_prefix: "AUM", uhid_date_format: "YYYY" };
    const yearOnly = await generatePatientUhid("hosp-a");
    hospitalRow = { uhid_prefix: "AUM", uhid_date_format: "NONE" };
    const noDate = await generatePatientUhid("hosp-a");
    expect(new Set([full, yearOnly, noDate]).size).toBe(3);
  });

  it("falls back to the 'UHID' prefix and full-date format when a hospital never configured either", async () => {
    hospitalRow = { uhid_prefix: null, uhid_date_format: null };
    const uhid = await generatePatientUhid("hosp-c");
    expect(uhid.startsWith("UHID-")).toBe(true);
    expect(uhid.split("-")).toHaveLength(3); // UHID-YYYYMMDD-seq
  });

  it("trims whitespace on a configured prefix", async () => {
    hospitalRow = { uhid_prefix: "  AUM  ", uhid_date_format: "NONE" };
    const uhid = await generatePatientUhid("hosp-a");
    expect(uhid).toBe("AUM-0007");
  });
});
