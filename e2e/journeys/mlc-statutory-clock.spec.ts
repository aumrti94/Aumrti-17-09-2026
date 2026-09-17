/**
 * Phase 8B — the MLC statutory clock (docs/testing/PHASE_8_STATUS.md §2, KNOWN-BUG-238). Until
 * this pass, the only trace of "notify police within 24 hours" anywhere in the codebase was one
 * sentence of UI copy in AdmitPatientModal.tsx, never enforced — and that same modal
 * unconditionally stamped `police_informed_at` the instant the MLC checkbox was ticked, regardless
 * of whether police were actually contacted (KNOWN-BUG-237, fixed alongside this).
 *
 * This journey drives the real `AdmitPatientModal` UI for both forks of the new clock — not just
 * a service-role trigger test — because the fix under test (a separate "police actually informed"
 * confirmation, distinct from the MLC flag itself) is a UI behaviour change, not just a schema
 * change. The clock's dedupe/sweep mechanics (`check_mlc_deadlines()`) are invoked directly via
 * the service-role client, matching this repo's established pattern for time-based logic
 * (backdating a deadline rather than waiting for a real 24h or a live pg_cron tick) — see
 * `delete-hospital.test.ts`'s own grace-period test for the precedent.
 *
 * The `ed_visits`/`mortuary_admissions` companion trigger paths (police confirmed via
 * `MLCDetailsModal.tsx` or `MortuaryPage.tsx`'s "Intimate Police" action, on a table with no
 * informed-at column of its own) were verified live via direct service-role invocation during
 * development of this migration, not through a dedicated UI journey in this spec — see
 * KNOWN-BUG-238's write-up for that scope boundary.
 */
import { test, expect } from "@playwright/test";
import { IPDAdmissionPage } from "../pages/IPDAdmissionPage";
import { HOSPITAL_A, HOSPITAL_B, tenantOf, wards, beds, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function mlcPatientName(tenant: TenantKey, suffix: string): string {
  return `Test Patient MlcClock${suffix}${tenant.toUpperCase()}1`;
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 8B — MLC statutory clock: pending overdue alerts, informed never fires", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const svc = serviceClient();

    for (const suffix of ["Pend", "Inf"]) {
      const patientName = mlcPatientName(tenant, suffix);
      const { data: patient } = await svc
        .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      if (!patient) continue;
      const { data: admissions } = await svc.from("admissions").select("id").eq("hospital_id", hospital.id).eq("patient_id", patient.id);
      const admissionIds = (admissions ?? []).map((a) => a.id);
      if (admissionIds.length) {
        await svc.from("clinical_alerts").delete().eq("hospital_id", hospital.id).eq("alert_type", "mlc_police_notification_overdue");
        await svc.from("mlc_police_notifications").delete().eq("source_table", "admissions").in("source_id", admissionIds);
        await svc.from("admissions").delete().in("id", admissionIds);
      }
      await svc.from("patients").delete().eq("id", patient.id);
    }
  });

  test("Segment 1 — MLC without a police-informed confirmation: pending, then overdue raises exactly one alert", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = mlcPatientName(tenant, "Pend");
    const svc = serviceClient();
    const ipd = new IPDAdmissionPage(page);
    const bed = beds(tenant)[1]; // SW-02
    const ward = wards(tenant)[0];

    await test.step("seed the patient directly", async () => {
      const { error } = await svc.from("patients").insert({
        hospital_id: hospital.id, full_name: patientName,
        uhid: `${hospital.uhidPrefix}MLCPEND${tenant.toUpperCase()}1`,
        phone: tenant === "a" ? "9000000071" : "9000000072", is_active: true,
      } as never);
      expect(error).toBeNull();
    });

    let admissionId = "";
    await test.step("admit as MLC via the real UI, without confirming police were informed", async () => {
      await ipd.open();
      await ipd.clickAvailableBed(bed.bedNumber);
      await ipd.searchAndSelectPatient(patientName, patientName);
      await ipd.goToStep2();
      await ipd.fillAdmissionDetails({
        doctor: `doctor ${tenant.toUpperCase()}`,
        diagnosis: "Road traffic accident — Phase 8B fixture",
        insuranceType: "Other",
        payerType: "cash",
        bedAlreadyPreselected: true,
      });
      await ipd.setMlc({ policeStation: "Fixture Police Station" }); // no policeActuallyInformed
      await ipd.goToStep3();
      await ipd.goToStep4();
      await ipd.confirmAdmission(patientName);
    });

    await test.step("police_informed_at is null and a pending tracking row exists", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      const { data: admission } = await svc.from("admissions").select("id, is_mlc, police_informed_at").eq("hospital_id", hospital.id).eq("patient_id", patient!.id).maybeSingle();
      expect(admission).not.toBeNull();
      expect(admission!.is_mlc).toBe(true);
      expect(admission!.police_informed_at).toBeNull();
      admissionId = admission!.id;

      await expect
        .poll(async () => {
          const { data } = await svc.from("mlc_police_notifications").select("status").eq("source_table", "admissions").eq("source_id", admissionId).maybeSingle();
          return data?.status ?? null;
        }, { timeout: 5_000 })
        .toBe("pending");
    });

    await test.step("backdating the deadline and sweeping raises exactly one alert, twice in a row", async () => {
      const { data: notif } = await svc.from("mlc_police_notifications").select("id").eq("source_table", "admissions").eq("source_id", admissionId).maybeSingle();
      await svc.from("mlc_police_notifications").update({ notification_deadline: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", notif!.id);

      const { error: sweepErr1 } = await svc.rpc("check_mlc_deadlines" as never);
      expect(sweepErr1).toBeNull();
      const { error: sweepErr2 } = await svc.rpc("check_mlc_deadlines" as never);
      expect(sweepErr2).toBeNull();

      const { data: alerts } = await svc.from("clinical_alerts").select("id").eq("hospital_id", hospital.id).eq("alert_type", "mlc_police_notification_overdue").eq("dedupe_key", notif!.id);
      expect(alerts ?? []).toHaveLength(1);
    });

    // Frees SW-02 for Segment 2 — this fixture ward has only 2 beds, and a real admission stays
    // "occupied" until discharge, which is out of scope for what this journey is testing.
    await svc.from("beds").update({ status: "available" }).eq("id", bed.id);
  });

  test("Segment 2 — MLC with police confirmed informed at admission: never sweeps as overdue", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = mlcPatientName(tenant, "Inf");
    const svc = serviceClient();
    const ipd = new IPDAdmissionPage(page);
    const bed = beds(tenant)[1]; // SW-02, freed by Segment 1's own admission never occupying it long-term
    const ward = wards(tenant)[0];

    await test.step("seed the patient directly", async () => {
      const { error } = await svc.from("patients").insert({
        hospital_id: hospital.id, full_name: patientName,
        uhid: `${hospital.uhidPrefix}MLCINF${tenant.toUpperCase()}1`,
        phone: tenant === "a" ? "9000000073" : "9000000074", is_active: true,
      } as never);
      expect(error).toBeNull();
    });

    let admissionId = "";
    await test.step("admit as MLC via the real UI, confirming police were informed", async () => {
      await ipd.open();
      await ipd.clickAvailableBed(bed.bedNumber);
      await ipd.searchAndSelectPatient(patientName, patientName);
      await ipd.goToStep2();
      await ipd.fillAdmissionDetails({
        doctor: `doctor ${tenant.toUpperCase()}`,
        diagnosis: "Assault — Phase 8B fixture",
        insuranceType: "Other",
        payerType: "cash",
        bedAlreadyPreselected: true,
      });
      await ipd.setMlc({ policeStation: "Fixture Police Station", policeActuallyInformed: true });
      await ipd.goToStep3();
      await ipd.goToStep4();
      await ipd.confirmAdmission(patientName);
    });

    await test.step("police_informed_at is set and the tracking row is already informed", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      const { data: admission } = await svc.from("admissions").select("id, police_informed_at").eq("hospital_id", hospital.id).eq("patient_id", patient!.id).maybeSingle();
      expect(admission!.police_informed_at).not.toBeNull();
      admissionId = admission!.id;

      await expect
        .poll(async () => {
          const { data } = await svc.from("mlc_police_notifications").select("status").eq("source_table", "admissions").eq("source_id", admissionId).maybeSingle();
          return data?.status ?? null;
        }, { timeout: 5_000 })
        .toBe("informed");
    });

    await test.step("backdating the deadline anyway and sweeping raises no alert — an informed case never fires", async () => {
      const { data: notif } = await svc.from("mlc_police_notifications").select("id").eq("source_table", "admissions").eq("source_id", admissionId).maybeSingle();
      await svc.from("mlc_police_notifications").update({ notification_deadline: new Date(Date.now() - 3_600_000).toISOString() }).eq("id", notif!.id);

      const { error: sweepErr } = await svc.rpc("check_mlc_deadlines" as never);
      expect(sweepErr).toBeNull();

      const { data: alerts } = await svc.from("clinical_alerts").select("id").eq("hospital_id", hospital.id).eq("alert_type", "mlc_police_notification_overdue").eq("dedupe_key", notif!.id);
      expect(alerts ?? []).toHaveLength(0);
    });
  });
});
