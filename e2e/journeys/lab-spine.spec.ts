/**
 * Phase 7.5 — Lab spine (docs/testing/PHASED_TEST_PLAN.md §Phase 7.5): "Order → sample → result
 * → verify → charge + NABH evidence row", plus the critical-value and TAT-breach dedupe forks.
 *
 * "Order" reuses Phase 7's own `OPDLabOrderPage` rather than rebuilding it — confirmed still
 * correct by Phase 7's own live verification. This file picks up from a real, paid `lab_orders`
 * row and drives sample collection → result entry → release, which Phase 7 never touched.
 *
 * A REAL, CONFIRMED-LIVE COMPLIANCE GAP WAS FOUND AND FIXED WHILE READING THIS SCREEN
 * (KNOWN-BUG-213, see KNOWN_BUGS.md): `LabResultWorkspace.tsx`'s two MANUAL release paths
 * (`handlePathologistValidate`, `releaseNow` — i.e. `handleValidateAll`, the single-step button
 * this Tier-0 fixture's default configuration uses) never called `logNABHEvidence` at all.
 * Only the AUTO-VERIFY path did (`autoCompleteRunRef`, requiring `lab_test_master
 * .autoverify_eligible = true`, which defaults false and is not set by this fixture). That
 * means the ordinary, everyday manual release — almost certainly the common real-world path —
 * produced no COP.6 evidence row, a direct violation of CLAUDE.md's "log NABH evidence on
 * clinical actions... never skip it." Fixed by adding the same `logNABHEvidence(..., "COP.6",
 * ..., "compliant")` call to both manual paths. Segment 1 below is this fix's regression test.
 *
 * The two negative forks' OWN dedupe mechanism (critical-value alert, TAT-breach alert) was
 * confirmed, by reading the current source directly, to already be correctly implemented — the
 * established `dedupe_key` + `ON CONFLICT ... DO NOTHING` pattern (KNOWN-BUG-002's resolution)
 * is already in place for both. Segments 2 and 3 are regression tests locking that in, not bug
 * hunts. Their preconditions (an already-collected sample; a backdated order) are seeded
 * directly rather than re-driving the already-proven registration/consultation/order UI a
 * second and third time — the same shortcut the Lab TAT research itself identified: "no
 * timers/polling — a test can seed a lab_orders row with an old order_time... and just click
 * Load Dashboard."
 *
 * BUILDING SEGMENT 2 FOUND A SECOND, UNRELATED, SEVERE LIVE BUG (KNOWN-BUG-214): entering a
 * critical value for a patient whose own prior result for the same test differs by ≥50% (exactly
 * what Segment 2 does, on top of Segment 1's already-validated CBC) tripped `saveResult`'s delta
 * check, which wrote the string `"delta"` into `lab_order_items.delta_flag` — a real `boolean`
 * column — and Postgres's rejection of that silently aborted the ENTIRE result save, not just
 * the delta flag. Fixed at the source (`deltaFlag` is a real `boolean` throughout); Segment 2 is
 * this fix's regression test as much as it is the critical-value dedupe's.
 */
import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { OPDRegistrationPage } from "../pages/OPDRegistrationPage";
import { OPDConsultationPage } from "../pages/OPDConsultationPage";
import { OPDLabOrderPage } from "../pages/OPDLabOrderPage";
import { LabResultPage } from "../pages/LabResultPage";
import { HOSPITAL_A, HOSPITAL_B, labTestMaster, staffUserId, tenantOf, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function labSpinePatientName(tenant: TenantKey): string {
  return `Test Patient LabA${tenant.toUpperCase()}1`;
}

/** Segments 2 and 3 seed their own order directly onto Segment 1's patient rather than
 * re-registering one — this look-up documents that ordering dependency (enforced anyway by
 * `test.describe.configure({ mode: "serial" })` below, which runs tests in declaration order). */
async function getLabSpinePatientId(svc: SupabaseClient, hospitalId: string, patientName: string): Promise<string> {
  const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospitalId).eq("full_name", patientName).maybeSingle();
  if (!patient) throw new Error(`Lab spine patient "${patientName}" not found — Segment 1 must run first to create it.`);
  return patient.id;
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 7.5 — Lab spine: order, sample, result, release, charge + NABH evidence", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = labSpinePatientName(tenant);
    const svc = serviceClient();

    const { data: patient } = await svc
      .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
    if (!patient) return;

    const { data: orders } = await svc.from("lab_orders").select("id").eq("patient_id", patient.id);
    if (orders?.length) {
      const ids = orders.map((o) => o.id);
      await svc.from("clinical_alerts").delete().in("lab_order_item_id",
        (await svc.from("lab_order_items").select("id").in("lab_order_id", ids)).data?.map((i) => i.id) ?? []);
      await svc.from("clinical_alerts").delete().eq("hospital_id", hospital.id).in("dedupe_key", ids);
      await svc.from("lab_samples").delete().in("lab_order_id", ids);
      await svc.from("lab_order_items").delete().in("lab_order_id", ids);
      await svc.from("lab_orders").delete().eq("patient_id", patient.id);
    }
    const { data: bills } = await svc.from("bills").select("id").eq("patient_id", patient.id).eq("bill_type", "lab");
    if (bills?.length) {
      await svc.from("bill_payments").delete().in("bill_id", bills.map((b) => b.id));
      await svc.from("bills").delete().in("id", bills.map((b) => b.id));
    }
    if (orders?.length) {
      await svc.from("nabh_evidence_log").delete().eq("hospital_id", hospital.id)
        .or(orders.map((o) => `description.ilike.%${o.id}%`).join(","));
    }
    await svc.from("prescriptions").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("opd_encounters").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("opd_tokens").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("patient_consents").delete().eq("patient_id", patient.id);
    await svc.from("patients").delete().eq("id", patient.id);
  });

  test("Segment 1 — order, collect, enter a normal result, release: charge posts and NABH evidence is logged", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = labSpinePatientName(tenant);
    const testName = labTestMaster(tenant).testName;
    const registration = new OPDRegistrationPage(page);
    const consultation = new OPDConsultationPage(page);
    const opdLab = new OPDLabOrderPage(page);
    const lab = new LabResultPage(page);

    await test.step("register, consult, prescribe the lab test", async () => {
      await registration.open();
      await registration.clickRegisterWalkIn();
      await registration.fillNewPatientDetails({
        fullName: patientName, age: "45", department: "General Medicine", doctor: `doctor ${tenant.toUpperCase()}`,
      });
      await registration.proceedToPayment();
      await registration.payAndIssueToken();
      await registration.closeReceipt();

      await consultation.open();
      await consultation.selectToken(patientName);
      await consultation.startConsultation();
      await consultation.fillChiefComplaint(`Routine bloods — Lab spine test (${tenant})`);
      await consultation.addLabOrder(testName);
      await consultation.completeConsultation(patientName);
    });

    await test.step("raise and pay for the order from Pending from OPD", async () => {
      await opdLab.open();
      await opdLab.createOrderFor(patientName);
      await opdLab.proceedToPayment();
      await opdLab.collectAndCreateOrder();
      await opdLab.closeSuccess();
    });

    await test.step("collect the sample with the real two-identifier bedside check", async () => {
      await lab.open();
      await lab.markSampleCollected(patientName);
    });

    await test.step("enter a normal result and release", async () => {
      await lab.selectWorklistOrder(patientName);
      await lab.enterResult("14");
      await lab.validateAndRelease();
    });

    await test.step("assert the order completed, the charge posted, and NABH evidence was logged (KNOWN-BUG-213's regression test)", async () => {
      const svc = serviceClient();
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: order, error: orderErr } = await svc
        .from("lab_orders")
        .select("id, status, billing_status")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient!.id)
        .maybeSingle();
      expect(orderErr).toBeNull();
      expect(order).not.toBeNull();
      expect(order!.status).toBe("completed");
      expect(order!.billing_status).toBe("billed");

      const { data: bill, error: billErr } = await svc
        .from("bills")
        .select("bill_type, total_amount")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient!.id)
        .eq("bill_type", "lab")
        .maybeSingle();
      expect(billErr).toBeNull();
      expect(bill).not.toBeNull();
      expect(Number(bill!.total_amount)).toBeGreaterThan(0);

      const { data: evidence, error: evidenceErr } = await svc
        .from("nabh_evidence_log")
        .select("criterion_number, compliance_status, is_known_criterion")
        .eq("hospital_id", hospital.id)
        .eq("criterion_number", "COP.6")
        .ilike("description", `%${order!.id}%`)
        .maybeSingle();
      expect(evidenceErr).toBeNull();
      expect(evidence).not.toBeNull();
      expect(evidence!.compliance_status).toBe("compliant");
      expect(evidence!.is_known_criterion).toBe(true);
    });
  });

  test("Segment 2 — a critical value saved twice raises exactly one alert (dedupe regression)", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = labSpinePatientName(tenant);
    const testInfo = labTestMaster(tenant);
    const svc = serviceClient();
    const lab = new LabResultPage(page);
    const patientId = await getLabSpinePatientId(svc, hospital.id, patientName);

    let orderId = "";
    let itemId = "";
    await test.step("seed an already-collected, paid order directly — Collection/payment UI is Segment 1's proven territory, not this fork's concern", async () => {
      const now = new Date().toISOString();
      const { data: order, error: orderErr } = await svc
        .from("lab_orders")
        .insert({
          hospital_id: hospital.id,
          patient_id: patientId,
          ordered_by: staffUserId(tenant, "hospital_admin"),
          priority: "routine",
          status: "sample_collected",
          billing_status: "billed",
          payment_status: "paid",
          order_time: now,
          ordered_at: now,
          sample_collected_at: now,
        } as never)
        .select("id")
        .maybeSingle();
      expect(orderErr).toBeNull();
      orderId = order!.id;

      const { data: item, error: itemErr } = await svc
        .from("lab_order_items")
        .insert({
          hospital_id: hospital.id,
          lab_order_id: orderId,
          test_id: testInfo.id,
          status: "sample_collected",
          sample_collected_at: now,
          sample_collected_by: staffUserId(tenant, "hospital_admin"),
        } as never)
        .select("id")
        .maybeSingle();
      expect(itemErr).toBeNull();
      itemId = item!.id;

      const { error: sampleErr } = await svc.from("lab_samples").insert({
        hospital_id: hospital.id,
        lab_order_id: orderId,
        sample_type: "Blood",
        barcode: `BC-SEG2-${tenant.toUpperCase()}-${Date.now()}`,
        status: "collected",
        collected_at: now,
        collected_by: staffUserId(tenant, "hospital_admin"),
      } as never);
      expect(sampleErr).toBeNull();
    });

    await test.step("enter a critical-high value, acknowledge it, then save the identical value again", async () => {
      await lab.open();
      await lab.selectWorklistOrder(patientName, LabResultPage.queueLabel(orderId));
      await lab.enterResult("22"); // > criticalHigh (20) from the fixture — a CH flag
      await lab.acknowledgeCriticalValue();
      await lab.enterResult("22"); // same item, same critical value, saved a second time
    });

    await test.step("assert exactly one clinical_alerts row exists, even though the critical value was saved twice", async () => {
      // saveResult's critical-alert upsert IS awaited inside LabResultWorkspace.tsx, but the
      // <input>'s onBlur handler does not await saveResult itself, so Playwright's blur() can
      // return before the write lands. expect.poll waits for the (already-expected) first
      // row rather than trusting a fixed sleep; the determinate check right after it is what
      // actually proves the dedupe — both saves have had time to resolve by then, since the
      // second was triggered strictly before this step began.
      await expect
        .poll(async () => {
          const { data } = await svc
            .from("clinical_alerts")
            .select("id")
            .eq("hospital_id", hospital.id)
            .eq("alert_type", "critical_lab_value")
            .eq("lab_order_item_id", itemId);
          return data?.length ?? 0;
        }, { timeout: 5_000 })
        .toBeGreaterThan(0);

      const { data: alerts, error } = await svc
        .from("clinical_alerts")
        .select("id")
        .eq("hospital_id", hospital.id)
        .eq("alert_type", "critical_lab_value")
        .eq("lab_order_item_id", itemId);
      expect(error).toBeNull();
      expect(alerts).toHaveLength(1);
    });
  });

  test("Segment 3 — a TAT-overdue order scanned twice raises exactly one alert (dedupe regression)", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = labSpinePatientName(tenant);
    const testInfo = labTestMaster(tenant);
    const svc = serviceClient();
    const lab = new LabResultPage(page);
    const patientId = await getLabSpinePatientId(svc, hospital.id, patientName);

    let orderId = "";
    await test.step("seed a fresh order backdated 3 hours — well past 2× the fixture's 60-minute default TAT target", async () => {
      const backdated = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
      const { data: order, error: orderErr } = await svc
        .from("lab_orders")
        .insert({
          hospital_id: hospital.id,
          patient_id: patientId,
          ordered_by: staffUserId(tenant, "hospital_admin"),
          priority: "routine",
          status: "ordered",
          billing_status: "billed",
          payment_status: "paid",
          order_date: backdated.split("T")[0],
          order_time: backdated,
          ordered_at: backdated,
        } as never)
        .select("id")
        .maybeSingle();
      expect(orderErr).toBeNull();
      orderId = order!.id;

      const { error: itemErr } = await svc.from("lab_order_items").insert({
        hospital_id: hospital.id,
        lab_order_id: orderId,
        test_id: testInfo.id,
        status: "ordered",
      } as never);
      expect(itemErr).toBeNull();
    });

    await test.step("load the TAT dashboard, then refresh it — the dedupe fork's two triggers", async () => {
      await lab.open();
      await lab.loadTatDashboard();
      await lab.refreshTatDashboard();
    });

    await test.step("assert exactly one lab_tat_overdue alert exists for this order", async () => {
      // LabTATPanel.load()'s alert upsert is genuinely fire-and-forget (`.then(() => {}, () =>
      // {})`, never awaited) — expect.poll waits for it to land at all; the plain check right
      // after is the actual dedupe assertion, by which point both loads' upserts (the second
      // triggered well before this step even started) have had time to settle.
      await expect
        .poll(async () => {
          const { data } = await svc
            .from("clinical_alerts")
            .select("id")
            .eq("hospital_id", hospital.id)
            .eq("alert_type", "lab_tat_overdue")
            .eq("dedupe_key", orderId);
          return data?.length ?? 0;
        }, { timeout: 5_000 })
        .toBeGreaterThan(0);

      const { data: alerts, error } = await svc
        .from("clinical_alerts")
        .select("id")
        .eq("hospital_id", hospital.id)
        .eq("alert_type", "lab_tat_overdue")
        .eq("dedupe_key", orderId);
      expect(error).toBeNull();
      expect(alerts).toHaveLength(1);
    });
  });
});
