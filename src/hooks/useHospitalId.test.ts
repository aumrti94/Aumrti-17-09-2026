import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { getHospitalIdAsync } from "./useHospitalId";

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("getHospitalIdAsync — standalone helper for non-hook contexts", () => {
  it("returns null without querying when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await getHospitalIdAsync()).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("resolves the hospital_id for the signed-in user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { hospital_id: "h1" } }) }) }) });
    expect(await getHospitalIdAsync()).toBe("h1");
  });

  it("returns null when the user has no hospital_id (e.g. a platform admin)", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }) });
    expect(await getHospitalIdAsync()).toBeNull();
  });
});
