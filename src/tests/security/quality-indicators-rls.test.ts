// @vitest-environment node
//
// Quality Indicator Engine — cross-tenant isolation
//
// The qi_collect_* functions and run_quality_indicator_collection are
// SECURITY DEFINER: they must read tables a ward clerk cannot, so the
// `hospital_id = p_hospital_id` predicate inside them is the only thing keeping
// tenants apart. These tests assert that predicate holds and that the RPC
// refuses to run for someone else's hospital.
//
// Requires .env.test with two real Supabase test users in DIFFERENT hospitals.
// Run manually before go-live:  npm run test:security
// NOT included in CI (requires a live Supabase session, not mocked).
//
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_TEST_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_TEST_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";

const HOSPITAL_A_EMAIL = process.env.TEST_HOSPITAL_A_EMAIL ?? "";
const HOSPITAL_A_PASSWORD = process.env.TEST_HOSPITAL_A_PASSWORD ?? "";
const HOSPITAL_B_EMAIL = process.env.TEST_HOSPITAL_B_EMAIL ?? "";
const HOSPITAL_B_PASSWORD = process.env.TEST_HOSPITAL_B_PASSWORD ?? "";

const SKIP =
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  !HOSPITAL_A_EMAIL ||
  !HOSPITAL_A_PASSWORD ||
  !HOSPITAL_B_EMAIL ||
  !HOSPITAL_B_PASSWORD;

const skipNote = () =>
  console.warn("SKIPPED: set TEST_HOSPITAL_A_* and TEST_HOSPITAL_B_* in .env.test to run");

async function authedClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Auth failed for ${email}: ${error.message}`);
  return client;
}

let clientA: SupabaseClient;
let clientB: SupabaseClient;
let hospitalAId: string;
let hospitalBId: string;

const currentMonthStart = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

beforeAll(async () => {
  if (SKIP) return;
  [clientA, clientB] = await Promise.all([
    authedClient(HOSPITAL_A_EMAIL, HOSPITAL_A_PASSWORD),
    authedClient(HOSPITAL_B_EMAIL, HOSPITAL_B_PASSWORD),
  ]);

  const [{ data: userA }, { data: userB }] = await Promise.all([
    clientA.from("users").select("hospital_id").limit(1).maybeSingle(),
    clientB.from("users").select("hospital_id").limit(1).maybeSingle(),
  ]);

  if (!userA?.hospital_id || !userB?.hospital_id) {
    throw new Error("Could not determine hospital_id for test users.");
  }
  hospitalAId = userA.hospital_id;
  hospitalBId = userB.hospital_id;

  if (hospitalAId === hospitalBId) {
    throw new Error("Both test users belong to the same hospital.");
  }
});

describe("quality indicator RPC authorisation", () => {
  it("refuses to collect for another hospital", async () => {
    if (SKIP) return skipNote();

    const { error } = await (clientA as any).rpc("run_quality_indicator_collection", {
      p_hospital_id: hospitalBId,
      p_period_start: currentMonthStart(),
    });

    // 42501 = insufficient_privilege, raised explicitly by the function.
    expect(error).not.toBeNull();
    expect(error?.code ?? "").toBe("42501");
  });

  it("refuses to backfill for another hospital", async () => {
    if (SKIP) return skipNote();

    const { error } = await (clientA as any).rpc("backfill_quality_indicators", {
      p_hospital_id: hospitalBId,
      p_months: 1,
    });

    expect(error).not.toBeNull();
    expect(error?.code ?? "").toBe("42501");
  });

  it("refuses to score NABH criteria for another hospital", async () => {
    if (SKIP) return skipNote();

    const { error } = await (clientA as any).rpc("run_nabh_auto_collection", {
      p_hospital_id: hospitalBId,
      p_period_start: currentMonthStart(),
    });

    expect(error).not.toBeNull();
    expect(error?.code ?? "").toBe("42501");
  });

  it("allows collecting for the caller's own hospital", async () => {
    if (SKIP) return skipNote();

    const { error } = await (clientA as any).rpc("run_quality_indicator_collection", {
      p_hospital_id: hospitalAId,
      p_period_start: currentMonthStart(),
    });

    expect(error).toBeNull();
  });

  it("does not expose the every-tenant variant to a browser session", async () => {
    if (SKIP) return skipNote();

    const { error } = await (clientA as any).rpc("run_quality_indicator_collection_all", {
      p_period_start: currentMonthStart(),
    });

    // Granted to service_role only, so an authenticated session cannot execute it.
    expect(error).not.toBeNull();
  });
});

describe("quality indicator data isolation", () => {
  it("hospital A indicators are NOT visible to hospital B", async () => {
    if (SKIP) return skipNote();

    const { data, error } = await clientB
      .from("quality_indicators")
      .select("id, hospital_id")
      .eq("hospital_id", hospitalAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("the current-value view does not leak across tenants", async () => {
    if (SKIP) return skipNote();

    // The view is security_invoker, so it must inherit the caller's RLS rather
    // than running as its owner.
    const { data, error } = await (clientB as any)
      .from("quality_indicators_current")
      .select("indicator_code, hospital_id")
      .eq("hospital_id", hospitalAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("hospital A NABH evidence is NOT visible to hospital B", async () => {
    if (SKIP) return skipNote();

    const { data, error } = await (clientB as any)
      .from("nabh_evidence_log")
      .select("id, hospital_id")
      .eq("hospital_id", hospitalAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("hospital A indicator overrides are NOT visible to hospital B", async () => {
    if (SKIP) return skipNote();

    const { data, error } = await (clientB as any)
      .from("quality_indicator_overrides")
      .select("id, hospital_id")
      .eq("hospital_id", hospitalAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("a non-admin cannot write the global indicator catalogue", async () => {
    if (SKIP) return skipNote();

    const { error } = await (clientA as any)
      .from("quality_indicator_definitions")
      .insert({
        indicator_code: "test.should_not_insert",
        display_name: "Should not insert",
        nabh_chapter: "QPS",
        category: "clinical",
        unit: "%",
        direction: "higher_is_better",
        collection_mode: "manual",
        numerator_description: "n/a",
      });

    expect(error).not.toBeNull();
  });

  it("the indicator catalogue is readable by any authenticated user", async () => {
    if (SKIP) return skipNote();

    const { data, error } = await (clientA as any)
      .from("quality_indicator_definitions")
      .select("indicator_code")
      .limit(5);

    expect(error).toBeNull();
    expect((data ?? []).length).toBeGreaterThan(0);
  });
});

describe("collected indicator integrity", () => {
  it("writes no rows outside the requested hospital", async () => {
    if (SKIP) return skipNote();

    await (clientA as any).rpc("run_quality_indicator_collection", {
      p_hospital_id: hospitalAId,
      p_period_start: currentMonthStart(),
    });

    // Everything hospital A can see must belong to hospital A.
    const { data, error } = await clientA
      .from("quality_indicators")
      .select("hospital_id")
      .neq("hospital_id", hospitalAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("never reports a value without a denominator", async () => {
    if (SKIP) return skipNote();

    const { data, error } = await (clientA as any)
      .from("quality_indicators")
      .select("indicator_code, value, denominator, notes")
      .eq("hospital_id", hospitalAId)
      .eq("period_start", currentMonthStart())
      .or("denominator.is.null,denominator.eq.0");

    expect(error).toBeNull();
    // A missing denominator must yield a NULL value with an explanatory note,
    // never a raw numerator presented as a rate.
    for (const row of (data ?? []) as any[]) {
      expect(row.value).toBeNull();
      expect(row.notes).toBeTruthy();
    }
  });
});
