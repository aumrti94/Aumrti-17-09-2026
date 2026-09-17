/**
 * Phase 7.5 — Radiology spine (docs/testing/PHASED_TEST_PLAN.md §Phase 7.5): "order → schedule
 * → perform → report → charge", plus the fee-lookup-never-₹0 fork.
 *
 * "Order" pays up front through `NewRadiologyOrderModal` — `payment_status`/`billing_status`
 * both land as paid/billed at ORDER time, confirmed by reading `handleCollectAndCreate` /
 * `batchCreateRadiologyOrders` directly. `RadiologyReportingWorkspace`'s own at-signoff auto-bill
 * (`getInvestigationRate` → `autoBillOpdInvestigation`) is therefore a no-op on this happy path —
 * its own idempotency guard sees `billing_status` already `"billed"`. Segment 2 seeds a
 * genuinely-not-yet-billed order directly to actually exercise that fallback chain: the
 * `billing_status` CHECK constraint only allows `unbilled | billed | waived`, "unbilled" is
 * excluded from the worklist query itself (so such an order could never be opened from this
 * screen), which leaves "waived" — a real status a hospital can use for a charity/free case — as
 * the one combination that is both worklist-visible and not already `"billed"`.
 *
 * Side observation, not chased further here (out of this pass's scope, and no current UI path
 * was found that reaches it in practice): `autoBillOpdInvestigation` unconditionally flips
 * `billing_status` to `"billed"` once it runs, even though the order arrived as `"waived"` — so a
 * study a hospital explicitly marked free still gets a real, patient-owed bill line the moment
 * its report is signed. Worth a look if "waived" orders turn out to be reachable in practice.
 *
 * The patient is seeded directly rather than registered through OPD — this spine is testing
 * radiology's own order/report/charge behaviour, not OPD registration, which J12/J13 already
 * cover exhaustively.
 *
 * A REAL, LIVE, SILENT DATA-LOSS BUG WAS FOUND AND FIXED BUILDING SEGMENT 1 (KNOWN-BUG-216, see
 * KNOWN_BUGS.md): `RadiologyReportingWorkspace.tsx`'s `fetchData` depended on the whole `order`
 * object, not `order.id` — so `RadiologyPage.tsx`'s hospital-wide realtime subscription on
 * `radiology_orders` (which fires on this component's OWN status-transition clicks, among
 * everything else) re-ran it and reset `findings`/`impression` to empty on every echo. Reproduced
 * live: filling Findings then Impression in two steps left Findings wiped by the "Begin Report"
 * transition's own echo landing in between, `Validate & Sign` staying disabled with no visible
 * reason. Fixed by keying the effect on `order.id`. Segment 1's report-writing step is this fix's
 * regression test as much as it is the happy path's.
 */
import { test, expect } from "@playwright/test";
import { RadiologyOrderPage } from "../pages/RadiologyOrderPage";
import { RadiologyReportingPage } from "../pages/RadiologyReportingPage";
import { HOSPITAL_A, HOSPITAL_B, radiologyStudy, staffUserId, tenantOf, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function radiologySpinePatientName(tenant: TenantKey): string {
  return `Test Patient RadA${tenant.toUpperCase()}1`;
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 7.5 — Radiology spine: order, schedule, perform, report, charge", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = radiologySpinePatientName(tenant);
    const svc = serviceClient();

    const { data: patient } = await svc
      .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
    if (!patient) return;

    const { data: orders } = await svc.from("radiology_orders").select("id").eq("patient_id", patient.id);
    if (orders?.length) {
      const ids = orders.map((o) => o.id);
      await svc.from("clinical_alerts").delete().eq("hospital_id", hospital.id).in("dedupe_key", ids);
      await svc.from("radiology_reports").delete().in("order_id", ids);
      await svc.from("radiology_orders").delete().eq("patient_id", patient.id);
    }
    const { data: bills } = await svc.from("bills").select("id").eq("patient_id", patient.id).eq("bill_type", "radiology");
    if (bills?.length) {
      await svc.from("bill_payments").delete().in("bill_id", bills.map((b) => b.id));
      await svc.from("bills").delete().in("id", bills.map((b) => b.id));
    }
    await svc.from("patients").delete().eq("id", patient.id);
  });

  test("Segment 1 — order (paid), start, image, report, validate & sign: charge posted at order time", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = radiologySpinePatientName(tenant);
    const study = radiologyStudy(tenant);
    const svc = serviceClient();
    const order = new RadiologyOrderPage(page);
    const reporting = new RadiologyReportingPage(page);

    await test.step("seed the patient directly", async () => {
      const { error } = await svc.from("patients").insert({
        hospital_id: hospital.id,
        full_name: patientName,
        uhid: `${hospital.uhidPrefix}RAD${tenant.toUpperCase()}1`,
        phone: tenant === "a" ? "9000000031" : "9000000032",
        is_active: true,
      } as never);
      expect(error).toBeNull();
    });

    await test.step("order the study and pay up front", async () => {
      await order.open();
      await order.openNewOrderModal();
      await order.searchAndSelectPatient(patientName);
      await order.selectStudy(study.studyName);
      await order.proceedToPayment();
      await order.collectAndCreateOrder();
      await order.closeSuccess();
    });

    await test.step("start the study, acquire images, begin the report", async () => {
      await reporting.open();
      await reporting.selectWorklistOrder(patientName);
      await reporting.startStudy();
      await reporting.markImagesAcquired();
      await reporting.beginReport();
    });

    await test.step("write the report and validate & sign", async () => {
      await reporting.fillReport(
        "No acute abnormality identified. Fixture regression finding text.",
        "Unremarkable study — Phase 7.5 fixture."
      );
      await reporting.validateAndSign();
    });

    await test.step("assert the order is validated, signed, and the charge landed exactly once at the fixture's fee", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: freshOrder, error: orderErr } = await svc
        .from("radiology_orders")
        .select("id, status, billing_status")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient!.id)
        .maybeSingle();
      expect(orderErr).toBeNull();
      expect(freshOrder).not.toBeNull();
      expect(freshOrder!.status).toBe("validated");
      expect(freshOrder!.billing_status).toBe("billed");

      const { data: report, error: reportErr } = await svc
        .from("radiology_reports")
        .select("is_signed")
        .eq("order_id", freshOrder!.id)
        .maybeSingle();
      expect(reportErr).toBeNull();
      expect(report!.is_signed).toBe(true);

      const { data: lines, error: lineErr } = await svc
        .from("bill_line_items")
        .select("id, total_amount")
        .eq("hospital_id", hospital.id)
        .eq("source_module", "radiology")
        .eq("source_record_id", freshOrder!.id);
      expect(lineErr).toBeNull();
      expect(lines).toHaveLength(1);
      expect(Number(lines![0].total_amount)).toBe(study.fee);
    });
  });

  test("Segment 2 — a waived order for an unpriced study still charges the hard-default rate, never ₹0", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = radiologySpinePatientName(tenant);
    const study = radiologyStudy(tenant);
    const svc = serviceClient();
    const reporting = new RadiologyReportingPage(page);
    const unlistedStudyName = "Unlisted Fixture-Only Imaging Study";

    const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
    expect(patient).not.toBeNull();

    let orderId = "";
    await test.step("seed a waived OPD order for a study with no radiology_study_master or service_master fee", async () => {
      const now = new Date().toISOString();
      const { data: newOrder, error: orderErr } = await svc
        .from("radiology_orders")
        .insert({
          hospital_id: hospital.id,
          patient_id: patient!.id,
          modality_id: study.modalityId,
          modality_type: "other",
          study_name: unlistedStudyName,
          ordered_by: staffUserId(tenant, "hospital_admin"),
          priority: "routine",
          status: "ordered",
          billing_status: "waived",
          payment_status: "waived",
          order_time: now,
          ordered_at: now,
        } as never)
        .select("id")
        .maybeSingle();
      expect(orderErr).toBeNull();
      orderId = newOrder!.id;
    });

    await test.step("drive it through to Validate & Sign", async () => {
      await reporting.open();
      await reporting.selectWorklistOrder(patientName, RadiologyReportingPage.queueLabel(orderId));
      await reporting.startStudy();
      await reporting.markImagesAcquired();
      await reporting.beginReport();
      await reporting.fillReport(
        "No acute abnormality. Fee-fallback fixture finding.",
        "Unremarkable — fee fallback regression."
      );
      await reporting.validateAndSign();
    });

    await test.step("assert the auto-created bill charged the ₹500 hard default, never ₹0, and the order is now marked billed", async () => {
      // autoBillOpdInvestigation is invoked from inside validateAndSign but not awaited by the
      // click itself in a way Playwright can see — expect.poll waits for it to land.
      await expect
        .poll(async () => {
          const { data } = await svc
            .from("bill_line_items")
            .select("id")
            .eq("hospital_id", hospital.id)
            .eq("source_module", "radiology")
            .eq("source_record_id", orderId);
          return data?.length ?? 0;
        }, { timeout: 5_000 })
        .toBeGreaterThan(0);

      const { data: lines, error: lineErr } = await svc
        .from("bill_line_items")
        .select("id, unit_rate, total_amount")
        .eq("hospital_id", hospital.id)
        .eq("source_module", "radiology")
        .eq("source_record_id", orderId);
      expect(lineErr).toBeNull();
      expect(lines).toHaveLength(1);
      expect(Number(lines![0].unit_rate)).toBe(500);
      expect(Number(lines![0].total_amount)).toBeGreaterThan(0);

      const { data: freshOrder, error: orderErr } = await svc
        .from("radiology_orders")
        .select("billing_status")
        .eq("id", orderId)
        .maybeSingle();
      expect(orderErr).toBeNull();
      expect(freshOrder!.billing_status).toBe("billed");
    });
  });
});
