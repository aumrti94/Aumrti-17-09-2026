import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetUser, mockFrom } = vi.hoisted(() => ({
  mockGetUser: vi.fn(),
  mockFrom: vi.fn(),
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getUser: mockGetUser }, from: mockFrom },
}));

import { resolvePostAuthRoute, isPlatformAdmin } from "./postAuthRoute";

function chain(data: unknown) {
  const result = { data } as any;
  const proxy: any = new Proxy({} as any, {
    get(_t, prop: string) {
      if (prop === "maybeSingle") return vi.fn().mockResolvedValue(result);
      return vi.fn().mockReturnValue(proxy);
    },
  });
  return proxy;
}

beforeEach(() => {
  mockGetUser.mockReset();
  mockFrom.mockReset();
});

describe("resolvePostAuthRoute — where an authenticated user lands", () => {
  it("routes to /login when there is no authenticated user", async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } });
    expect(await resolvePostAuthRoute()).toBe("/login");
  });

  it("routes an active platform admin to /platform, overriding the fallback", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue(chain({ id: "admin-1" }));
    expect(await resolvePostAuthRoute("/dashboard")).toBe("/platform");
  });

  it("routes a regular hospital user to the given fallback", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue(chain(null));
    expect(await resolvePostAuthRoute("/dashboard")).toBe("/dashboard");
  });

  it("defaults the fallback to /dashboard when none is given", async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: "auth-1" } } });
    mockFrom.mockReturnValue(chain(null));
    expect(await resolvePostAuthRoute()).toBe("/dashboard");
  });
});

describe("isPlatformAdmin", () => {
  it("is true when an active aumrti_admins row exists for the auth user", async () => {
    mockFrom.mockReturnValue(chain({ id: "admin-1" }));
    expect(await isPlatformAdmin("auth-1")).toBe(true);
  });

  it("is false when no matching row exists (or it's inactive, filtered at the query)", async () => {
    mockFrom.mockReturnValue(chain(null));
    expect(await isPlatformAdmin("auth-1")).toBe(false);
  });
});
