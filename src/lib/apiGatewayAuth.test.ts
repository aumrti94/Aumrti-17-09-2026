/**
 * The module under test is `supabase/functions/api-gateway/auth.ts` (and its sibling
 * `errors.ts`), not anything in `src/lib/`. Normal co-location would put this file there
 * too — but `vitest.config.ts`'s test.include glob is "src/star-star/star.test.{ts,tsx}"
 * only (written out here to avoid closing this comment early — the real glob contains a
 * sequence that terminates a block comment), so a test outside `src` is never collected.
 * It does not error, it just silently never runs. This mirrors `leakageScan.test.ts`'s
 * documented workaround exactly: the file lives here so it is actually part of
 * `npx vitest run`, importing the real edge-function module by relative path. Do not move
 * it to sit next to auth.ts — that would remove it from the suite.
 *
 * This module happens to be safely importable under Node/vitest because it uses only
 * standard Web APIs (crypto.subtle, Request, TextEncoder) and has no Deno-specific imports —
 * confirmed by reading both auth.ts and errors.ts before writing this file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  authenticate,
  extractBearer,
  requireScope,
  canSeePhi,
  requireApiEntitlement,
  touchKey,
  PHI_UNLOCK_SCOPE,
  type AuthedKey,
} from "../../supabase/functions/api-gateway/auth";
import { ApiError } from "../../supabase/functions/api-gateway/errors";

const VALID_KEY = "sk_live_" + "a".repeat(64);

function makeRequest(authHeader?: string): Request {
  return new Request("https://api.example/v1/patients", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

function makeSb(overrides: {
  keyRow?: any;
  keyError?: any;
  subRow?: any;
  planRow?: any;
} = {}) {
  const updateEq = vi.fn().mockResolvedValue({ error: null });
  return {
    from: vi.fn((table: string) => {
      if (table === "api_keys") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: overrides.keyRow ?? null, error: overrides.keyError ?? null }),
          update: vi.fn(() => ({ eq: updateEq })),
        };
      }
      if (table === "hospital_subscriptions") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: overrides.subRow ?? null, error: null }),
        };
      }
      if (table === "subscription_plans") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: overrides.planRow ?? null, error: null }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
    __updateEq: updateEq,
  };
}

describe("extractBearer", () => {
  it("extracts the token from a well-formed Authorization header", () => {
    expect(extractBearer(makeRequest(`Bearer ${VALID_KEY}`))).toBe(VALID_KEY);
  });

  it("throws a missing_api_key error when no header is present", () => {
    try {
      extractBearer(makeRequest());
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      expect((e as ApiError).code).toBe("missing_api_key");
    }
  });

  it("throws when the header is present but not a Bearer token", () => {
    expect(() => extractBearer(makeRequest("Basic abc123"))).toThrow(ApiError);
  });
});

describe("authenticate — API Portal key verification", () => {
  it("rejects a key that doesn't match the sk_live_/sk_test_ shape before ever touching the database", async () => {
    const sb = makeSb();
    await expect(authenticate(sb as any, makeRequest("Bearer not-a-real-key"))).rejects.toThrow(ApiError);
    expect(sb.from).not.toHaveBeenCalled();
  });

  it("rejects when no matching active key is found — same error as every other failure mode (no oracle for probing)", async () => {
    const sb = makeSb({ keyRow: null });
    try {
      await authenticate(sb as any, makeRequest(`Bearer ${VALID_KEY}`));
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe("invalid_api_key");
    }
  });

  it("rejects an expired key even though the row exists and is_active=true", async () => {
    const sb = makeSb({
      keyRow: {
        id: "k1", hospital_id: "hosp-a", key_name: "Test Key", scopes: ["read:appointments"],
        environment: "production", expires_at: "2020-01-01T00:00:00Z", last_used_at: null,
      },
    });
    await expect(authenticate(sb as any, makeRequest(`Bearer ${VALID_KEY}`))).rejects.toThrow(ApiError);
  });

  it("resolves a valid, unexpired key into an AuthedKey with its scopes and hospital", async () => {
    const sb = makeSb({
      keyRow: {
        id: "k1", hospital_id: "hosp-a", key_name: "Test Key", scopes: ["read:appointments"],
        environment: "sandbox", expires_at: null, last_used_at: null,
      },
      subRow: { plan_id: "plan-1", status: "active" },
      planRow: { api_access: true, api_rate_limit_per_min: 120 },
    });
    const key = await authenticate(sb as any, makeRequest(`Bearer ${VALID_KEY}`));
    expect(key.hospitalId).toBe("hosp-a");
    expect(key.scopes).toEqual(["read:appointments"]);
    expect(key.rateLimitPerMin).toBe(120);
  });

  it("a different configured plan rate limit resolves to a different rateLimitPerMin for the same key", async () => {
    const baseKeyRow = { id: "k1", hospital_id: "hosp-a", key_name: "K", scopes: [], environment: "sandbox", expires_at: null, last_used_at: null };
    const sbLow = makeSb({ keyRow: baseKeyRow, subRow: { plan_id: "p1", status: "active" }, planRow: { api_access: true, api_rate_limit_per_min: 30 } });
    const sbHigh = makeSb({ keyRow: baseKeyRow, subRow: { plan_id: "p1", status: "active" }, planRow: { api_access: true, api_rate_limit_per_min: 500 } });
    const low = await authenticate(sbLow as any, makeRequest(`Bearer ${VALID_KEY}`));
    const high = await authenticate(sbHigh as any, makeRequest(`Bearer ${VALID_KEY}`));
    expect(low.rateLimitPerMin).toBe(30);
    expect(high.rateLimitPerMin).toBe(500);
  });

  it("falls back to the default rate limit when the plan configures 0 or a negative number", async () => {
    const keyRow = { id: "k1", hospital_id: "hosp-a", key_name: "K", scopes: [], environment: "sandbox", expires_at: null, last_used_at: null };
    const sb = makeSb({ keyRow, subRow: { plan_id: "p1", status: "active" }, planRow: { api_access: true, api_rate_limit_per_min: 0 } });
    const key = await authenticate(sb as any, makeRequest(`Bearer ${VALID_KEY}`));
    expect(key.rateLimitPerMin).toBe(60);
  });

  it("falls back to the default rate limit when the hospital has no active subscription at all", async () => {
    const keyRow = { id: "k1", hospital_id: "hosp-a", key_name: "K", scopes: [], environment: "sandbox", expires_at: null, last_used_at: null };
    const sb = makeSb({ keyRow, subRow: null });
    const key = await authenticate(sb as any, makeRequest(`Bearer ${VALID_KEY}`));
    expect(key.rateLimitPerMin).toBe(60);
  });
});

describe("requireScope — per-route scope enforcement", () => {
  const key = (scopes: string[]): AuthedKey => ({
    id: "k1", hospitalId: "hosp-a", keyName: "K", scopes, environment: "sandbox", rateLimitPerMin: 60, lastUsedAt: null,
  });

  it("passes silently when the key holds the required scope", () => {
    expect(() => requireScope(key(["read:appointments"]), "read:appointments")).not.toThrow();
  });

  it("throws insufficient_scope when the key lacks it", () => {
    try {
      requireScope(key(["read:appointments"]), "write:appointments");
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe("insufficient_scope");
    }
  });

  it("a key with more scopes passes where a key with fewer scopes fails, for the identical route check", () => {
    expect(() => requireScope(key(["read:appointments", "read:patients"]), "read:patients")).not.toThrow();
    expect(() => requireScope(key(["read:appointments"]), "read:patients")).toThrow(ApiError);
  });
});

describe("canSeePhi", () => {
  it("is true only when the key holds the PHI unlock scope", () => {
    const withPhi: AuthedKey = { id: "k", hospitalId: "h", keyName: "K", scopes: [PHI_UNLOCK_SCOPE], environment: "sandbox", rateLimitPerMin: 60, lastUsedAt: null };
    const withoutPhi: AuthedKey = { ...withPhi, scopes: ["read:appointments"] };
    expect(canSeePhi(withPhi)).toBe(true);
    expect(canSeePhi(withoutPhi)).toBe(false);
  });
});

describe("requireApiEntitlement — Plan gate, enforced server-side not just in the UI", () => {
  it("rejects when the hospital's plan does not include api_access", async () => {
    const sb = makeSb({ subRow: { plan_id: "p1", status: "active" }, planRow: { api_access: false } });
    try {
      await requireApiEntitlement(sb as any, "hosp-a");
      expect.unreachable();
    } catch (e) {
      expect((e as ApiError).code).toBe("api_not_in_plan");
    }
  });

  it("rejects with the same clear error when there is no subscription row at all, not a 500", async () => {
    const sb = makeSb({ subRow: null });
    await expect(requireApiEntitlement(sb as any, "hosp-a")).rejects.toThrow(ApiError);
  });

  it("passes when the plan includes api_access", async () => {
    const sb = makeSb({ subRow: { plan_id: "p1", status: "active" }, planRow: { api_access: true } });
    await expect(requireApiEntitlement(sb as any, "hosp-a")).resolves.toBeUndefined();
  });
});

describe("touchKey — debounced last_used_at write", () => {
  it("writes when the key has never been used", async () => {
    const sb = makeSb();
    const key: AuthedKey = { id: "k1", hospitalId: "h", keyName: "K", scopes: [], environment: "sandbox", rateLimitPerMin: 60, lastUsedAt: null };
    await touchKey(sb as any, key, "1.2.3.4");
    expect(sb.__updateEq).toHaveBeenCalled();
  });

  it("skips the write when the key was used less than a minute ago", async () => {
    const sb = makeSb();
    const key: AuthedKey = { id: "k1", hospitalId: "h", keyName: "K", scopes: [], environment: "sandbox", rateLimitPerMin: 60, lastUsedAt: new Date().toISOString() };
    await touchKey(sb as any, key, "1.2.3.4");
    expect(sb.__updateEq).not.toHaveBeenCalled();
  });

  it("writes again once more than a minute has passed since the last use", async () => {
    const sb = makeSb();
    const key: AuthedKey = { id: "k1", hospitalId: "h", keyName: "K", scopes: [], environment: "sandbox", rateLimitPerMin: 60, lastUsedAt: new Date(Date.now() - 61_000).toISOString() };
    await touchKey(sb as any, key, "1.2.3.4");
    expect(sb.__updateEq).toHaveBeenCalled();
  });
});
