/**
 * Phase 3 — the guard between the seed and production (D5).
 *
 * This is the one piece of Phase 3 infrastructure that is worth unit testing rather than
 * proving by running it, because the failure it prevents cannot be recovered from and cannot
 * be safely rehearsed. Every assertion below is "it refuses", and the interesting ones are
 * the near-misses — a cloud URL, a tunnel on an unexpected port, a project ref that looks
 * plausible.
 *
 * Lives under e2e/fixtures/ next to the code it guards; `vitest.config.ts` includes it so it
 * runs in the normal unit suite rather than needing Playwright.
 */
import { describe, it, expect } from "vitest";
import { ALLOWED_PROJECT_REFS, UnsafeSeedTargetError, assertLocalTarget, isLocalTarget } from "./guard";

const LOCAL = "http://127.0.0.1:54321";

describe("assertLocalTarget — what it allows", () => {
  it.each([
    "http://127.0.0.1:54321",
    "http://localhost:54321",
    "http://127.0.0.1:54322",
    "http://host.docker.internal:54321",
  ])("allows %s", (url) => {
    expect(() => assertLocalTarget(url)).not.toThrow();
  });
});

describe("assertLocalTarget — what it refuses", () => {
  it("refuses a Supabase cloud project", () => {
    // The failure this whole file exists to prevent. Seeding truncates tenant data; pointed
    // at production it is a hospital losing patient records, not a failed test.
    expect(() => assertLocalTarget("https://abcdefghijklmnop.supabase.co")).toThrow(UnsafeSeedTargetError);
  });

  it("refuses a cloud project even when a project ref is supplied", () => {
    // A ref alone is not permission — it has to be on the allowlist.
    expect(() => assertLocalTarget("https://abcdefghijklmnop.supabase.co", "abcdefghijklmnop")).toThrow(
      UnsafeSeedTargetError,
    );
  });

  it("refuses when no URL is supplied rather than guessing a default", () => {
    // Defaulting to localhost would be convenient and wrong: a script that silently picks a
    // target is a script that can silently pick the wrong one.
    expect(() => assertLocalTarget(undefined)).toThrow(UnsafeSeedTargetError);
    expect(() => assertLocalTarget("")).toThrow(UnsafeSeedTargetError);
  });

  it("refuses a malformed URL", () => {
    expect(() => assertLocalTarget("not-a-url")).toThrow(UnsafeSeedTargetError);
  });

  it("refuses localhost on a port supabase start does not bind", () => {
    // A local port that is not one of Supabase's is most likely an SSH tunnel or a proxy —
    // which is exactly how someone reaches a remote database while believing it is local.
    expect(() => assertLocalTarget("http://127.0.0.1:5432")).toThrow(/tunnel/i);
    expect(() => assertLocalTarget("http://localhost:8080")).toThrow(UnsafeSeedTargetError);
  });

  it("refuses a host that merely CONTAINS localhost", () => {
    // "localhost.evil.example" resolves wherever its owner wants. Exact-match only.
    expect(() => assertLocalTarget("https://localhost.attacker.example:54321")).toThrow(UnsafeSeedTargetError);
    expect(() => assertLocalTarget("https://127.0.0.1.attacker.example:54321")).toThrow(UnsafeSeedTargetError);
  });

  it("names the offending host in the error so the mistake is obvious", () => {
    // An operator who sees this needs to know WHICH target was refused, or the natural next
    // move is to disable the guard.
    expect(() => assertLocalTarget("https://prod-ref.supabase.co")).toThrow(/prod-ref\.supabase\.co/);
  });
});

describe("the allowlist", () => {
  it("is empty, so no cloud project is seedable today", () => {
    // Phase 8 is where a staging ref gets added, alongside written sign-off. Until then the
    // safe default is that the answer is always no.
    expect(ALLOWED_PROJECT_REFS).toEqual([]);
  });

  it("has no environment-variable escape hatch", () => {
    // Deliberately asserted: a `SKIP_SEED_GUARD=1` would be used exactly once, in a hurry,
    // by someone who was sure. The guard is only worth having if it cannot be turned off.
    const before = process.env.SKIP_SEED_GUARD;
    process.env.SKIP_SEED_GUARD = "1";
    process.env.FORCE_SEED = "true";
    try {
      expect(() => assertLocalTarget("https://prod-ref.supabase.co")).toThrow(UnsafeSeedTargetError);
    } finally {
      if (before === undefined) delete process.env.SKIP_SEED_GUARD;
      else process.env.SKIP_SEED_GUARD = before;
      delete process.env.FORCE_SEED;
    }
  });
});

describe("isLocalTarget", () => {
  it("reports true only for a local container", () => {
    expect(isLocalTarget(LOCAL)).toBe(true);
    expect(isLocalTarget("https://abcdefghijklmnop.supabase.co")).toBe(false);
    expect(isLocalTarget(undefined)).toBe(false);
    expect(isLocalTarget("not-a-url")).toBe(false);
  });
});
