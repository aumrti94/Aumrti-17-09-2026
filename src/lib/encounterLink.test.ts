import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * resolveActiveEncounterLink decides which episode of care an order is attached to. Getting
 * the precedence wrong attaches an inpatient's investigation to a stale OPD visit, which is
 * how a result ends up in front of the wrong doctor — so the admission-wins rule, and the
 * "no candidate means no guess" rule, are pinned here.
 */

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { resolveActiveEncounterLink, resolveTreatingDoctor } from "./encounterLink";

/** A PostgREST-ish chain: every filter returns itself, awaiting yields { data }. */
function chain(data: unknown) {
  const result = { data } as any;
  const asPromise = Promise.resolve(result);
  const proxy: any = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === "then") return asPromise.then.bind(asPromise);
      if (prop === "catch") return asPromise.catch.bind(asPromise);
      if (prop === "maybeSingle") return vi.fn().mockResolvedValue(result);
      return vi.fn().mockReturnValue(proxy);
    },
  });
  return proxy;
}

const OPEN_ADMISSION = {
  id: "adm-1",
  admission_number: "ADM-2026-0142",
  admitted_at: "2026-08-20T09:00:00Z",
  discharged_at: null,
  status: "active",
  consultant_doctor_id: "doc-consultant",
  admitting_doctor_id: "doc-admitter",
  consultant: { full_name: "Rao" },
  admitter: { full_name: "Iyer" },
};

const TODAY_ENCOUNTER = {
  id: "enc-1",
  visit_date: "2026-08-24",
  doctor_id: "doc-opd",
  created_at: "2026-08-24T10:00:00Z",
  doctor: { full_name: "Menon" },
};

function setup({ admissions, encounters }: { admissions?: unknown[]; encounters?: unknown[] }) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "admissions") return chain(admissions ?? []);
    if (table === "opd_encounters") return chain(encounters ?? []);
    return chain([]);
  });
}

beforeEach(() => mockFrom.mockReset());

describe("resolveActiveEncounterLink", () => {
  it("prefers an open admission over an OPD encounter on the same day", async () => {
    setup({ admissions: [OPEN_ADMISSION], encounters: [TODAY_ENCOUNTER] });
    const link = await resolveActiveEncounterLink("h1", "p1", "2026-08-24");

    expect(link.kind).toBe("admission");
    expect(link.admissionId).toBe("adm-1");
    expect(link.encounterId).toBeNull();
    // The consultant, not the admitting doctor, is the one following the patient.
    expect(link.doctorId).toBe("doc-consultant");
    expect(link.label).toContain("ADM-2026-0142");
    expect(link.label).toContain("Rao");
  });

  it("falls back to the admitting doctor when no consultant is assigned", async () => {
    setup({
      admissions: [{ ...OPEN_ADMISSION, consultant_doctor_id: null, consultant: null }],
    });
    const link = await resolveActiveEncounterLink("h1", "p1", "2026-08-24");
    expect(link.doctorId).toBe("doc-admitter");
    expect(link.doctorName).toBe("Iyer");
  });

  it("uses the OPD encounter when the patient is not admitted", async () => {
    setup({ admissions: [], encounters: [TODAY_ENCOUNTER] });
    const link = await resolveActiveEncounterLink("h1", "p1", "2026-08-24");

    expect(link.kind).toBe("encounter");
    expect(link.encounterId).toBe("enc-1");
    expect(link.admissionId).toBeNull();
    expect(link.doctorId).toBe("doc-opd");
  });

  it("ignores an admission that begins after the order date", async () => {
    // A scan raised on the 20th cannot belong to an admission that started on the 23rd.
    setup({
      admissions: [{ ...OPEN_ADMISSION, admitted_at: "2026-08-23T09:00:00Z" }],
      encounters: [],
    });
    const link = await resolveActiveEncounterLink("h1", "p1", "2026-08-20");
    expect(link.kind).toBe("none");
  });

  it("returns no link rather than guessing when the patient has neither context", async () => {
    setup({ admissions: [], encounters: [] });
    const link = await resolveActiveEncounterLink("h1", "p1", "2026-08-24");

    expect(link.kind).toBe("none");
    expect(link.admissionId).toBeNull();
    expect(link.encounterId).toBeNull();
    expect(link.doctorId).toBeNull();
  });

  it("short-circuits without querying when ids are missing", async () => {
    const link = await resolveActiveEncounterLink("", "p1");
    expect(link.kind).toBe("none");
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("resolveTreatingDoctor", () => {
  it("reads the consultant for an admission context", async () => {
    mockFrom.mockImplementation(() => chain(OPEN_ADMISSION));
    const res = await resolveTreatingDoctor({ admissionId: "adm-1" });
    expect(res).toEqual({ doctorId: "doc-consultant", doctorName: "Rao" });
  });

  it("reads the consulting doctor for an encounter context", async () => {
    mockFrom.mockImplementation(() => chain(TODAY_ENCOUNTER));
    const res = await resolveTreatingDoctor({ encounterId: "enc-1" });
    expect(res).toEqual({ doctorId: "doc-opd", doctorName: "Menon" });
  });

  it("returns nulls — never throws — when there is no context", async () => {
    const res = await resolveTreatingDoctor({});
    expect(res).toEqual({ doctorId: null, doctorName: null });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
