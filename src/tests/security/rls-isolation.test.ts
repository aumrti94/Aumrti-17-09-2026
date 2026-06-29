// @vitest-environment node
//
// RLS Cross-Tenant Isolation — Sprint 2D
//
// Requires .env.test with two real Supabase test users in DIFFERENT hospitals.
// Run manually before go-live:  npm run test:security
// NOT included in CI (requires live Supabase session, not mocked).
//
// Setup: create two test users in Supabase auth, each assigned to a separate
// hospital in the `users` table, with at least one patient + bill per hospital.
//
import { describe, it, expect, beforeAll } from "vitest";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_TEST_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_TEST_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY ?? "";
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const HOSPITAL_A_EMAIL = process.env.TEST_HOSPITAL_A_EMAIL ?? "";
const HOSPITAL_A_PASSWORD = process.env.TEST_HOSPITAL_A_PASSWORD ?? "";
const HOSPITAL_B_EMAIL = process.env.TEST_HOSPITAL_B_EMAIL ?? "";
const HOSPITAL_B_PASSWORD = process.env.TEST_HOSPITAL_B_PASSWORD ?? "";
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? "";
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? "";

const SKIP =
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY ||
  !HOSPITAL_A_EMAIL ||
  !HOSPITAL_A_PASSWORD ||
  !HOSPITAL_B_EMAIL ||
  !HOSPITAL_B_PASSWORD;

async function authedClient(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Auth failed for ${email}: ${error.message}`);
  return client;
}

let clientA: SupabaseClient;
let clientB: SupabaseClient;
let adminClient: SupabaseClient | null = null;
let hospitalAId: string;
let hospitalBId: string;

beforeAll(async () => {
  if (SKIP) return;
  [clientA, clientB] = await Promise.all([
    authedClient(HOSPITAL_A_EMAIL, HOSPITAL_A_PASSWORD),
    authedClient(HOSPITAL_B_EMAIL, HOSPITAL_B_PASSWORD),
  ]);

  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    adminClient = await authedClient(ADMIN_EMAIL, ADMIN_PASSWORD);
  }

  // Discover hospital IDs from the users table (each user's own row)
  const { data: userA } = await clientA
    .from("users")
    .select("hospital_id")
    .limit(1)
    .maybeSingle();
  const { data: userB } = await clientB
    .from("users")
    .select("hospital_id")
    .limit(1)
    .maybeSingle();

  if (!userA?.hospital_id || !userB?.hospital_id) {
    throw new Error(
      "Could not determine hospital_id for test users. Ensure test users exist in the `users` table."
    );
  }
  hospitalAId = userA.hospital_id;
  hospitalBId = userB.hospital_id;

  if (hospitalAId === hospitalBId) {
    throw new Error(
      "Both test users belong to the same hospital. They must be in different hospitals for isolation testing."
    );
  }
});

describe("RLS cross-tenant isolation", () => {
  it("hospital A patients NOT visible to hospital B session", async () => {
    if (SKIP) {
      console.warn("SKIPPED: set TEST_HOSPITAL_A_* and TEST_HOSPITAL_B_* in .env.test to run");
      return;
    }
    const { data, error } = await clientB
      .from("patients")
      .select("id, hospital_id")
      .eq("hospital_id", hospitalAId);

    expect(error).toBeNull();
    // RLS must filter to zero rows — Hospital B session cannot see Hospital A patients
    expect(data).toHaveLength(0);
  });

  it("hospital A bills NOT visible to hospital B session", async () => {
    if (SKIP) {
      console.warn("SKIPPED: set TEST_HOSPITAL_A_* and TEST_HOSPITAL_B_* in .env.test to run");
      return;
    }
    const { data, error } = await clientB
      .from("bills")
      .select("id, hospital_id")
      .eq("hospital_id", hospitalAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("hospital A users NOT visible to hospital B session", async () => {
    if (SKIP) {
      console.warn("SKIPPED: set TEST_HOSPITAL_A_* and TEST_HOSPITAL_B_* in .env.test to run");
      return;
    }
    const { data, error } = await clientB
      .from("users")
      .select("id, hospital_id")
      .eq("hospital_id", hospitalAId);

    expect(error).toBeNull();
    expect(data).toHaveLength(0);
  });

  it("aumrti_admin role CAN read across all hospitals (bypass verified)", async () => {
    if (SKIP || !adminClient) {
      console.warn("SKIPPED: set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD in .env.test to run");
      return;
    }
    // Admin should see users from both hospitals
    const { data: usersA } = await adminClient
      .from("users")
      .select("hospital_id")
      .eq("hospital_id", hospitalAId);
    const { data: usersB } = await adminClient
      .from("users")
      .select("hospital_id")
      .eq("hospital_id", hospitalBId);

    // Admin bypass: both hospitals' data should be readable
    expect((usersA ?? []).length).toBeGreaterThan(0);
    expect((usersB ?? []).length).toBeGreaterThan(0);
  });

  it("hospital B CANNOT update hospital A records even with correct hospital_id in payload", async () => {
    if (SKIP) {
      console.warn("SKIPPED: set TEST_HOSPITAL_A_* and TEST_HOSPITAL_B_* in .env.test to run");
      return;
    }
    // Attempt to find any patient in Hospital A via Hospital B session
    // (This should return 0 rows due to RLS SELECT policy, so UPDATE also returns 0 affected rows)
    const { data: targets } = await clientA
      .from("patients")
      .select("id")
      .eq("hospital_id", hospitalAId)
      .limit(1);

    if (!targets || targets.length === 0) {
      console.warn(
        "No patients in Hospital A to test UPDATE isolation — seed at least 1 patient for Hospital A"
      );
      return;
    }

    const targetId = targets[0].id;

    // Hospital B session tries to update a Hospital A patient
    const { data: updated, error } = await clientB
      .from("patients")
      .update({ hospital_id: hospitalBId })
      .eq("id", targetId)
      .eq("hospital_id", hospitalAId)
      .select();

    // RLS must ensure 0 rows are affected (update is silently blocked by SELECT policy)
    expect(error).toBeNull(); // no error — just 0 rows affected
    expect(updated).toHaveLength(0);

    // Verify the record is still in Hospital A
    const { data: verify } = await clientA
      .from("patients")
      .select("hospital_id")
      .eq("id", targetId)
      .maybeSingle();
    expect(verify?.hospital_id).toBe(hospitalAId);
  });
});
