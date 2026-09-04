import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

beforeEach(() => {
  vi.resetModules();
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

// resolveContext() caches module-level state across calls, so each test that depends on
// caching behaviour re-imports the module fresh via vi.resetModules() + dynamic import.

describe("trackEvent — fire-and-forget product analytics", () => {
  it("does nothing (no insert) when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    const { trackEvent } = await import("./trackEvent");

    trackEvent("module_opened", { module: "opd" });
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("inserts an event with the resolved hospital/user context", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    const insertSpy = vi.fn().mockResolvedValue({ data: null, error: null });
    mockFrom.mockImplementation((table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "user-1", hospital_id: "h1" } }) }) }) };
      }
      if (table === "product_analytics_events") return { insert: insertSpy };
      throw new Error(`unexpected table ${table}`);
    });

    const { trackEvent } = await import("./trackEvent");
    trackEvent("module_opened", { module: "opd" });
    await new Promise((r) => setTimeout(r, 0));

    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({ hospital_id: "h1", user_id: "user-1", event_name: "module_opened" }),
    );
  });

  it("never throws (fire-and-forget) even when resolving context fails", async () => {
    mockGetUser.mockRejectedValue(new Error("network down"));
    const { trackEvent } = await import("./trackEvent");

    expect(() => trackEvent("module_opened")).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
