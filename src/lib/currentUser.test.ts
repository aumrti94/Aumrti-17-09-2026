import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom, mockOnAuthStateChange } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
  mockOnAuthStateChange: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser, onAuthStateChange: mockOnAuthStateChange }, from: mockFrom },
}));

beforeEach(() => {
  vi.resetModules();
  mockGetUser.mockReset();
  mockFrom.mockReset();
  mockOnAuthStateChange.mockReset();
});

// getCurrentUserRowId caches its result at module scope, so each test that depends on that
// cache re-imports the module fresh via vi.resetModules().

describe("getCurrentUserRowId — resolves public.users.id, not the auth.users id", () => {
  it("returns null without querying users when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { getCurrentUserRowId } = await import("./currentUser");
    expect(await getCurrentUserRowId()).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("resolves and caches the public.users row id", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "user-row-1" } }) }) }) });

    const { getCurrentUserRowId } = await import("./currentUser");
    expect(await getCurrentUserRowId()).toBe("user-row-1");

    // Second call hits the cache — no second getUser/from call.
    mockGetUser.mockClear();
    mockFrom.mockClear();
    expect(await getCurrentUserRowId()).toBe("user-row-1");
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("registers an onAuthStateChange listener to invalidate the cache on sign-out/sign-in", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    await import("./currentUser");
    expect(mockOnAuthStateChange).toHaveBeenCalledWith(expect.any(Function));
  });
});
