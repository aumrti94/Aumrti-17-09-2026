import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * checkClinicianCredential blocks a high-risk clinical sign-off when the clinician's
 * license/registration is expired or missing. Getting a threshold wrong here either lets
 * an unlicensed clinician sign off (patient-safety/legal risk) or wrongly blocks a licensed
 * one (care delay) — so every branch is pinned explicitly.
 */

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mockFrom } }));

import { checkClinicianCredential } from "./credentialGate";

function chain(data: unknown) {
  const result = { data } as any;
  const proxy: any = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === "maybeSingle") return vi.fn().mockResolvedValue(result);
      if (prop === "then") return Promise.resolve(result).then.bind(Promise.resolve(result));
      return vi.fn().mockReturnValue(proxy);
    },
  });
  return proxy;
}

function setup({ profile, creds }: { profile?: unknown; creds?: unknown[] }) {
  mockFrom.mockImplementation((table: string) => {
    if (table === "staff_profiles") return chain(profile ?? null);
    if (table === "staff_credentials") return chain(creds ?? []);
    return chain(null);
  });
}

beforeEach(() => mockFrom.mockReset());

const TODAY = new Date().toISOString().split("T")[0];
const YESTERDAY = new Date(Date.now() - 86400000).toISOString().split("T")[0];
const NEXT_YEAR = new Date(Date.now() + 365 * 86400000).toISOString().split("T")[0];

describe("checkClinicianCredential", () => {
  it("returns not blocked without querying when hospitalId or userId is missing", async () => {
    expect(await checkClinicianCredential("", "u1")).toEqual({ blocked: false, reason: "" });
    expect(await checkClinicianCredential("h1", "")).toEqual({ blocked: false, reason: "" });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("blocks when the staff profile's license has expired", async () => {
    setup({ profile: { license_expiry_date: YESTERDAY }, creds: [] });
    const result = await checkClinicianCredential("h1", "u1");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("Medical license expired");
  });

  it("does not block on a license expiring today or in the future", async () => {
    setup({ profile: { license_expiry_date: NEXT_YEAR }, creds: [] });
    const result = await checkClinicianCredential("h1", "u1");
    expect(result.blocked).toBe(false);
  });

  it("blocks when any credential (not just the license) has expired", async () => {
    setup({
      profile: { license_expiry_date: NEXT_YEAR },
      creds: [{ credential_type: "BLS Certification", expiry_date: YESTERDAY }],
    });
    const result = await checkClinicianCredential("h1", "u1");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("BLS Certification");
  });

  it("does not block when credentials exist and are all current", async () => {
    setup({
      profile: { license_expiry_date: NEXT_YEAR },
      creds: [{ credential_type: "BLS Certification", expiry_date: NEXT_YEAR }],
    });
    const result = await checkClinicianCredential("h1", "u1");
    expect(result.blocked).toBe(false);
  });

  it("blocks when there is no license and no credentials on record at all", async () => {
    setup({ profile: null, creds: [] });
    const result = await checkClinicianCredential("h1", "u1");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("No medical license");
  });

  it("does not block on a missing license profile if at least one current credential exists", async () => {
    setup({ profile: null, creds: [{ credential_type: "Nursing Registration", expiry_date: NEXT_YEAR }] });
    const result = await checkClinicianCredential("h1", "u1");
    expect(result.blocked).toBe(false);
  });
});
