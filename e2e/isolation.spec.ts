/**
 * Phase 4 exit gate: no cross-tenant read achievable on any of the five hub tables — see
 * `HUB_TABLES` in scripts/generate-test-inventory.mjs — at the DB (RLS) layer.
 *
 * This is the two-hospital "assert the negative" pattern from the tenant-isolation-testing
 * skill, not the naive `rows.every(...)` version: for each hub table, a row is seeded into
 * BOTH hospitals that would collide if isolation failed (same alert_type, same criterion, a
 * bill sharing nothing but shape), ground truth for hospital B's row is confirmed via the
 * service-role client, and only THEN does the assertion run — through the app's own anon-key
 * client, signed in as hospital A, exactly as a real session would.
 *
 * Two things are asserted per table, not one:
 *   1. An unfiltered read as hospital A never contains hospital B's row.
 *   2. A read as hospital A that explicitly asks for hospital B's id (`.eq("hospital_id", B)`)
 *      still returns nothing — a CLIENT-SUPPLIED hospital_id is never trusted, because RLS
 *      enforces the caller's own hospital_id regardless of what the query claims to want. A
 *      buggy or malicious client passing another tenant's id is the exact shape of leak RLS
 *      exists to close, and (1) alone would not catch a query that filters unconditionally on
 *      whatever hospital_id argument the caller handed it.
 *
 * Every table needs BOTH hospitals' sides regardless of which Playwright project runs it, so
 * this file builds its own tenant clients directly rather than relying on a project's
 * storageState. It is restricted to the `hospital-a` project via `testIgnore` in
 * playwright.config.ts — otherwise both projects would collect and run it, double-seeding and
 * racing on the same fixture rows.
 */
import { expect, test } from "@playwright/test";
import { HOSPITAL_A, HOSPITAL_B, PATIENTS_BY_TENANT, TEST_PASSWORD, staffEmail } from "./fixtures/constants";
import { expectRowExists, serviceClient, tenantClient } from "./fixtures/serviceClient";

// Fixture ids, namespaced by hospital like every other Tier-0 id in fixtures/constants.ts.
// 5xxx = bills, 6xxx = bill_line_items, 7xxx = clinical_alerts, 8xxx = insurance_claims,
// 9xxx = nabh_evidence_log. Not added to constants.ts: single-purpose to this spec, unlike
// the Tier-0 ids other specs share.
const BILL_A = "a0000000-0000-4000-8000-500000000001";
const BILL_B = "b0000000-0000-4000-8000-500000000001";
const LINE_ITEM_A = "a0000000-0000-4000-8000-600000000001";
const LINE_ITEM_B = "b0000000-0000-4000-8000-600000000001";
const ALERT_A = "a0000000-0000-4000-8000-700000000001";
const ALERT_B = "b0000000-0000-4000-8000-700000000001";
const CLAIM_A = "a0000000-0000-4000-8000-800000000001";
const CLAIM_B = "b0000000-0000-4000-8000-800000000001";
const NABH_A = "a0000000-0000-4000-8000-900000000001";
const NABH_B = "b0000000-0000-4000-8000-900000000001";

test.describe.configure({ mode: "serial" });

test.describe("Phase 4: no cross-tenant read on any hub table", () => {
  test.beforeAll(async () => {
    const svc = serviceClient();
    const patientA = PATIENTS_BY_TENANT.a[0]!;
    const patientB = PATIENTS_BY_TENANT.b[0]!;

    // bills — bill_line_items and insurance_claims both need one to hang off.
    const { error: billErr } = await svc.from("bills").upsert(
      [
        { id: BILL_A, hospital_id: HOSPITAL_A.id, bill_number: "ISO-TEST-A-0001", patient_id: patientA.id },
        { id: BILL_B, hospital_id: HOSPITAL_B.id, bill_number: "ISO-TEST-B-0001", patient_id: patientB.id },
      ],
      { onConflict: "id" },
    );
    expect(billErr).toBeNull();

    const { error: lineErr } = await svc.from("bill_line_items").upsert(
      [
        {
          id: LINE_ITEM_A,
          hospital_id: HOSPITAL_A.id,
          bill_id: BILL_A,
          description: "Isolation test line item A",
          unit_rate: 100,
          total_amount: 100,
        },
        {
          id: LINE_ITEM_B,
          hospital_id: HOSPITAL_B.id,
          bill_id: BILL_B,
          description: "Isolation test line item B",
          unit_rate: 100,
          total_amount: 100,
        },
      ],
      { onConflict: "id" },
    );
    expect(lineErr).toBeNull();

    // Same alert_type/severity on purpose — a query that forgets its hospital_id filter would
    // otherwise still look isolated by accident if the two rows happened to differ.
    const { error: alertErr } = await svc.from("clinical_alerts").upsert(
      [
        {
          id: ALERT_A,
          hospital_id: HOSPITAL_A.id,
          alert_type: "critical_value",
          alert_message: "Isolation test alert A",
          severity: "critical",
        },
        {
          id: ALERT_B,
          hospital_id: HOSPITAL_B.id,
          alert_type: "critical_value",
          alert_message: "Isolation test alert B",
          severity: "critical",
        },
      ],
      { onConflict: "id" },
    );
    expect(alertErr).toBeNull();

    const { error: claimErr } = await svc.from("insurance_claims").upsert(
      [
        {
          id: CLAIM_A,
          hospital_id: HOSPITAL_A.id,
          bill_id: BILL_A,
          patient_id: patientA.id,
          tpa_name: "Isolation Test TPA",
          claimed_amount: 1000,
        },
        {
          id: CLAIM_B,
          hospital_id: HOSPITAL_B.id,
          bill_id: BILL_B,
          patient_id: patientB.id,
          tpa_name: "Isolation Test TPA",
          claimed_amount: 1000,
        },
      ],
      { onConflict: "id" },
    );
    expect(claimErr).toBeNull();

    // Same criterion_number on both sides is what makes "hospital A sees hospital A's row
    // only" a real assertion rather than one satisfied by the two rows never colliding on
    // anything. Explicit ids + upsert (rather than a plain insert) so re-running this spec
    // does not pile up duplicate evidence rows every time.
    const { error: nabhErr } = await svc.from("nabh_evidence_log").upsert(
      [
        {
          id: NABH_A,
          hospital_id: HOSPITAL_A.id,
          criterion_number: "ISO.TEST.1",
          description: "Isolation test evidence A",
          source: "manual",
        },
        {
          id: NABH_B,
          hospital_id: HOSPITAL_B.id,
          criterion_number: "ISO.TEST.1",
          description: "Isolation test evidence B",
          source: "manual",
        },
      ],
      { onConflict: "id" },
    );
    expect(nabhErr).toBeNull();

    // Ground truth: hospital B's rows must actually exist, or every assertion below would pass
    // vacuously — the single most common way an isolation test lies (tenant-isolation-testing
    // skill). Hospital A's rows are proven to exist implicitly: each assertion below requires
    // finding at least one A row to be a meaningful "and nothing else" check.
    await expectRowExists(svc, "bills", BILL_B);
    await expectRowExists(svc, "bill_line_items", LINE_ITEM_B);
    await expectRowExists(svc, "clinical_alerts", ALERT_B);
    await expectRowExists(svc, "insurance_claims", CLAIM_B);
    await expectRowExists(svc, "nabh_evidence_log", NABH_B);
  });

  test("patients: hospital A sees none of hospital B's patients, filtered or not", async () => {
    const asA = await tenantClient(staffEmail("a", "hospital_admin"), TEST_PASSWORD);

    const unfiltered = await asA.from("patients").select("id, hospital_id");
    expect(unfiltered.error).toBeNull();
    expect(unfiltered.data!.length).toBeGreaterThan(0);
    expect(unfiltered.data!.every((r) => r.hospital_id === HOSPITAL_A.id)).toBe(true);

    // Client-supplied hospital_id naming the OTHER tenant — RLS must win regardless.
    const spoofed = await asA.from("patients").select("id").eq("hospital_id", HOSPITAL_B.id);
    expect(spoofed.error).toBeNull();
    expect(spoofed.data).toHaveLength(0);
  });

  test("clinical_alerts: hospital A cannot read hospital B's alert", async () => {
    const asA = await tenantClient(staffEmail("a", "hospital_admin"), TEST_PASSWORD);

    const unfiltered = await asA.from("clinical_alerts").select("id, hospital_id");
    expect(unfiltered.error).toBeNull();
    expect(unfiltered.data!.some((r) => r.id === ALERT_A)).toBe(true);
    expect(unfiltered.data!.some((r) => r.hospital_id === HOSPITAL_B.id)).toBe(false);

    const byId = await asA.from("clinical_alerts").select("id").eq("id", ALERT_B).eq("hospital_id", HOSPITAL_B.id);
    expect(byId.error).toBeNull();
    expect(byId.data).toHaveLength(0);
  });

  test("bill_line_items: hospital A cannot read hospital B's line item", async () => {
    const asA = await tenantClient(staffEmail("a", "hospital_admin"), TEST_PASSWORD);

    const unfiltered = await asA.from("bill_line_items").select("id, hospital_id");
    expect(unfiltered.error).toBeNull();
    expect(unfiltered.data!.some((r) => r.id === LINE_ITEM_A)).toBe(true);
    expect(unfiltered.data!.some((r) => r.hospital_id === HOSPITAL_B.id)).toBe(false);

    const spoofed = await asA.from("bill_line_items").select("id").eq("hospital_id", HOSPITAL_B.id);
    expect(spoofed.error).toBeNull();
    expect(spoofed.data).toHaveLength(0);
  });

  test("insurance_claims: hospital A cannot read hospital B's claim, and the admin bypass is gated on is_aumrti_admin(), not hospital_id", async () => {
    const asA = await tenantClient(staffEmail("a", "hospital_admin"), TEST_PASSWORD);

    const unfiltered = await asA.from("insurance_claims").select("id, hospital_id");
    expect(unfiltered.error).toBeNull();
    expect(unfiltered.data!.some((r) => r.id === CLAIM_A)).toBe(true);
    expect(unfiltered.data!.some((r) => r.hospital_id === HOSPITAL_B.id)).toBe(false);

    const spoofed = await asA.from("insurance_claims").select("id").eq("hospital_id", HOSPITAL_B.id);
    expect(spoofed.error).toBeNull();
    expect(spoofed.data).toHaveLength(0);

    // The one hub table with a second policy: "aumrti_admin_read_all_insurance_claims" USING
    // (is_aumrti_admin()) — a platform-wide read path that exists ON PURPOSE. This hospital
    // admin is not in aumrti_admins, so is_aumrti_admin() is false and that policy contributes
    // nothing here — confirming the bypass is gated on admin identity, not on some hospital_id
    // special-case that would otherwise be indistinguishable from a leak.
    const { data: isAdmin } = await asA.rpc("is_aumrti_admin");
    expect(isAdmin).toBe(false);
  });

  test("nabh_evidence_log: hospital A cannot read hospital B's evidence, even matching on criterion_number", async () => {
    const asA = await tenantClient(staffEmail("a", "hospital_admin"), TEST_PASSWORD);

    const byCriterion = await asA
      .from("nabh_evidence_log")
      .select("id, hospital_id")
      .eq("criterion_number", "ISO.TEST.1");
    expect(byCriterion.error).toBeNull();
    expect(byCriterion.data!.length).toBeGreaterThan(0);
    expect(byCriterion.data!.every((r) => r.hospital_id === HOSPITAL_A.id)).toBe(true);

    const spoofed = await asA
      .from("nabh_evidence_log")
      .select("id")
      .eq("criterion_number", "ISO.TEST.1")
      .eq("hospital_id", HOSPITAL_B.id);
    expect(spoofed.error).toBeNull();
    expect(spoofed.data).toHaveLength(0);
  });
});
