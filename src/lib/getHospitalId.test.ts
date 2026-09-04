import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { getHospitalId } from "./getHospitalId";

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("getHospitalId", () => {
  it("returns null without querying users when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await getHospitalId()).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("resolves the hospital_id for the signed-in user's users row", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { hospital_id: "h1" } }) }) }) });
    expect(await getHospitalId()).toBe("h1");
  });

  it("returns null when the users row has no hospital_id (e.g. a platform admin)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    expect(await getHospitalId()).toBeNull();
  });
});
