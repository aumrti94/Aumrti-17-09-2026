/**
 * Phase 8B — ANC save fix + the delivery-recording screen (docs/testing/PHASE_8_STATUS.md §3,
 * KNOWN_BUG-226/227/228).
 *
 * Segment 1 is the regression for KNOWN-BUG-226: `ObstetricANCPage.tsx`'s save spread its ~45-field
 * form as top-level insert keys, and none but a handful matched real `obstetric_records` columns —
 * every save has always failed with a visible "Save failed" toast. The fix drops the spread in
 * favour of the `anc_full_data` jsonb blob the page already half-intended. This segment saves a
 * real ANC visit and asserts it lands, rather than just asserting "no error toast" (a save that
 * silently drops every field would still show a success toast).
 *
 * Segment 2 is the delivery-recording screen that has never existed (KNOWN-BUG-228) — built here
 * as `src/pages/specialty/DeliveryRecordPage.tsx`, extending the live `obstetric_records` table
 * (record_type already allowed 'delivery', just nothing ever wrote it) rather than the dead
 * `partograph_records` table. Drives a still-birth outcome specifically, to prove the negative
 * fork: a `clinical_alerts` row must raise on that outcome, matching `ObstetricSheet.tsx`'s own
 * risk-alert pattern.
 *
 * Segment 3 is the regression for KNOWN-BUG-227: Form 8 (`MaternityRegisterTab.tsx`) queried
 * `obstetric_records.admission_id`/`delivery_date`/`delivery_type`/`outcome`, none of which existed
 * — the register has always shown "No obstetric records found" for every hospital. This drives the
 * real MRD screen and asserts the delivery from Segment 2 actually renders in it.
 */
import { test, expect } from "@playwright/test";
import { HOSPITAL_A, HOSPITAL_B, staffUserId, tenantOf, wards, beds, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function ancDeliveryPatientName(tenant: TenantKey, suffix: string): string {
  return `AAA ObGyn${suffix}${tenant.toUpperCase()}1`;
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 8B — ANC save fix + delivery-recording screen + Form 8", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const svc = serviceClient();

    for (const suffix of ["Anc", "Del"]) {
      const patientName = ancDeliveryPatientName(tenant, suffix);
      const { data: patient } = await svc
        .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      if (!patient) continue;
      await svc.from("clinical_alerts").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
      await svc.from("obstetric_records").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
      await svc.from("partograph_entries").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
      await svc.from("admissions").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
      await svc.from("patients").delete().eq("id", patient.id);
    }
  });

  test("Segment 1 — a real ANC visit via ObstetricANCPage saves without error", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = ancDeliveryPatientName(tenant, "Anc");
    const uhid = `${hospital.uhidPrefix}OBANC${tenant.toUpperCase()}1`;
    const svc = serviceClient();

    await test.step("seed the patient directly", async () => {
      const { error } = await svc.from("patients").insert({
        hospital_id: hospital.id, full_name: patientName, uhid, gender: "female",
        phone: tenant === "a" ? "9000000061" : "9000000062", is_active: true,
      } as never);
      expect(error).toBeNull();
    });

    await test.step("open Obstetric ANC, select patient, fill and Sign & Save", async () => {
      await page.goto("/specialty/anc");
      await page.getByRole("combobox").first().selectOption({ label: `${patientName} · ${uhid}` });

      // "Encounter Details" section is open by default.
      const gaInput = page.locator('input[type="number"][min="4"][max="42"]');
      await gaInput.fill("28");

      await page.getByRole("button", { name: "Sign & Save" }).click();
      await expect(page.getByText("ANC encounter saved", { exact: false }).first()).toBeVisible({ timeout: 10_000 });
    });

    await test.step("the row lands with record_type=anc and the full form in anc_full_data", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: record, error } = await svc.from("obstetric_records").select("*")
        .eq("hospital_id", hospital.id).eq("patient_id", patient!.id).eq("record_type", "anc").maybeSingle();
      expect(error).toBeNull();
      expect(record).not.toBeNull();
      expect(record!.signoff_status).toBe("signed");
      expect((record!.anc_full_data as Record<string, unknown>).gestational_age_weeks).toBe(28);
    });
  });

  test("Segment 2 — a delivery record: stillbirth raises exactly one clinical_alerts row", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = ancDeliveryPatientName(tenant, "Del");
    const uhid = `${hospital.uhidPrefix}OBDEL${tenant.toUpperCase()}1`;
    const svc = serviceClient();
    const bed = beds(tenant)[1]; // SW-02 — unused by any other spec's fixture admission
    const ward = wards(tenant)[0];
    let admissionId = "";

    await test.step("seed the patient and a real active admission directly", async () => {
      const { error: pErr } = await svc.from("patients").insert({
        hospital_id: hospital.id, full_name: patientName, uhid, gender: "female",
        phone: tenant === "a" ? "9000000063" : "9000000064", is_active: true,
      } as never);
      expect(pErr).toBeNull();

      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: admission, error: aErr } = await svc.from("admissions").insert({
        hospital_id: hospital.id, patient_id: patient!.id,
        admitting_doctor_id: staffUserId(tenant, "doctor"),
        ward_id: ward.id, bed_id: bed.id, status: "active",
      } as never).select("id").maybeSingle();
      expect(aErr).toBeNull();
      expect(admission).not.toBeNull();
      admissionId = admission!.id;

      // A prior partograph entry — proves DeliveryRecordPage's read-only context panel resolves
      // the real query, not just that the delivery form itself works.
      const { error: peErr } = await svc.from("partograph_entries").insert({
        hospital_id: hospital.id, patient_id: patient!.id, admission_id: admissionId,
        time_hour: 4, cervical_dilation: 6, fhr: 140,
      } as never);
      expect(peErr).toBeNull();
    });

    await test.step("open Delivery Record, select patient + admission, record a stillbirth", async () => {
      await page.goto("/specialty/delivery");
      await page.getByRole("combobox").first().selectOption({ label: `${patientName} · ${uhid}` });
      await page.getByRole("combobox").nth(1).selectOption({ index: 1 }); // the one active admission

      await expect(page.getByText("Labour Progress (Partograph", { exact: false })).toBeVisible();
      await page.getByRole("button", { name: "Stillbirth", exact: true }).click();
      await page.locator("textarea").fill("Cord prolapse — Phase 8B fixture");
      await page.getByRole("button", { name: "Save Delivery Record" }).click();
      await expect(page.getByText("Delivery record saved")).toBeVisible({ timeout: 10_000 });
    });

    await test.step("the obstetric_records row and exactly one critical clinical_alerts row exist", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();

      const { data: record, error } = await svc.from("obstetric_records").select("*")
        .eq("hospital_id", hospital.id).eq("patient_id", patient!.id).eq("record_type", "delivery").maybeSingle();
      expect(error).toBeNull();
      expect(record).not.toBeNull();
      expect(record!.admission_id).toBe(admissionId);
      expect(record!.outcome).toBe("still_born");
      expect(record!.delivery_conducted_by).not.toBeNull();

      await expect
        .poll(async () => {
          const { data } = await svc.from("clinical_alerts").select("id")
            .eq("hospital_id", hospital.id).eq("patient_id", patient!.id).eq("alert_type", "obstetric_risk").eq("severity", "critical");
          return data?.length ?? 0;
        }, { timeout: 5_000 })
        .toBe(1);
    });
  });

  test("Segment 3 — Form 8 (Maternity Register) actually shows the delivery from Segment 2", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = ancDeliveryPatientName(tenant, "Del");

    await page.goto("/mrd");
    await page.getByRole("tab", { name: "🤱 Form 8" }).click();
    await page.getByRole("button", { name: "Load", exact: true }).click();

    const row = page.getByRole("row", { name: new RegExp(patientName) });
    await expect(row).toBeVisible({ timeout: 10_000 });
    await expect(row.getByText("still_born")).toBeVisible();
    await expect(row.getByText("Stillbirth")).toBeVisible();
  });
});
