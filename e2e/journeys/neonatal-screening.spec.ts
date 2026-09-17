/**
 * Phase 8B — Neonatal screening (docs/testing/PHASE_8_STATUS.md §4). Closes three findings from
 * that audit, none of which were "missing tests" — they were silent defects and missing fields:
 *
 * Segment 1 exercises the jaundice/Bhutani fix. `NeonatalSheet.tsx` used to compute the bilirubin
 * zone from a hand-typed "Day of Life" number, completely disconnected from the record's own real
 * `date_of_birth` — removed entirely in favour of a "Reading Date/Time" input, with age-at-reading
 * now derived from `date_of_birth`. The alert-raising `.insert()` had no dedupe key either (every
 * other alert-raising site in this repo already dedupes via `dedupe_key` + `onConflict` —
 * `src/components/lab/LabTATPanel.tsx` is the pattern copied here) — adding the same high reading
 * twice used to create two `clinical_alerts` rows. This segment adds it twice and asserts one.
 *
 * Segment 2 exercises the two genuinely new fields: CCHD (manual pulse-oximetry capture, no
 * automated diagnosis — see PHASE_8_STATUS.md §4 and the migration's own comment for why this
 * doesn't need Nalini's AI-governance gate) and ROP eligibility, which is a deterministic
 * birth-weight/gestational-age threshold, not a diagnosis. A preterm/low-birth-weight baby must
 * show the eligibility banner and a computed first-screen-due date; a term/normal-weight baby must
 * not.
 */
import { test, expect } from "@playwright/test";
import { NeonatalPage } from "../pages/NeonatalPage";
import { HOSPITAL_A, HOSPITAL_B, tenantOf, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function neoPatientName(tenant: TenantKey, suffix: string): string {
  return `AAA Neo ${suffix}${tenant.toUpperCase()}1`;
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 8B — Neonatal screening: jaundice dedupe, CCHD, ROP eligibility", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const svc = serviceClient();

    for (const suffix of ["Term", "Preterm"]) {
      const patientName = neoPatientName(tenant, suffix);
      const { data: patient } = await svc
        .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      if (!patient) continue;
      await svc.from("clinical_alerts").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
      await svc.from("neonatal_records").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
      await svc.from("patients").delete().eq("id", patient.id);
    }
  });

  test("Segment 1 — a high bilirubin reading added twice raises exactly one alert", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = neoPatientName(tenant, "Term");
    const uhid = `${hospital.uhidPrefix}NEOTERM${tenant.toUpperCase()}1`;
    const svc = serviceClient();
    const neo = new NeonatalPage(page);

    const dob = "2026-09-01T06:00";
    const readingAt = "2026-09-02T12:00"; // 30h later — ageHours<48 bracket, highThreshold=12

    await test.step("seed the patient directly", async () => {
      const { error } = await svc.from("patients").insert({
        hospital_id: hospital.id, full_name: patientName, uhid,
        phone: tenant === "a" ? "9000000051" : "9000000052", is_active: true,
      } as never);
      expect(error).toBeNull();
    });

    await test.step("open Neonatal EMR, fill birth details, add the same high reading twice", async () => {
      await neo.open();
      await neo.selectPatient(patientName, uhid);
      await neo.fillBirthDetails({ dob, birthWeightG: 3200, gestationalAgeWeeks: 39 });
      await neo.addBilirubinReading({ readingAt, valueMgDl: 15 }); // >= highThreshold(12) at 30h
      await neo.addBilirubinReading({ readingAt, valueMgDl: 15 }); // identical reading, re-added
    });

    await test.step("exactly one clinical_alerts row exists for this reading", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      await expect
        .poll(async () => {
          const { data } = await svc.from("clinical_alerts").select("id")
            .eq("hospital_id", hospital.id).eq("patient_id", patient!.id).eq("alert_type", "neonatal_jaundice");
          return data?.length ?? 0;
        }, { timeout: 5_000 })
        .toBe(1);
    });

    await test.step("set CCHD, save, and assert the record — including the zone computed from date_of_birth", async () => {
      await neo.setCchd({ preSpo2: 98, postSpo2: 97, result: "pass" });
      await neo.expectRopEligible(false);
      await neo.save();

      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      const { data: record, error } = await svc.from("neonatal_records").select("*")
        .eq("hospital_id", hospital.id).eq("patient_id", patient!.id).maybeSingle();
      expect(error).toBeNull();
      expect(record).not.toBeNull();
      expect(record!.cchd_result).toBe("pass");
      expect(record!.cchd_pre_ductal_spo2).toBe(98);
      expect(record!.rop_eligible).toBe(false);
      const readings = record!.bilirubin_readings as Array<{ value_mg_dl: number; zone: string }>;
      expect(readings).toHaveLength(2);
      expect(readings[0].zone).toBe("high"); // proves the zone came from date_of_birth-derived age, not a typed day number
    });
  });

  test("Segment 2 — a preterm/low-birth-weight baby is ROP-eligible with a computed due date; save round-trips", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = neoPatientName(tenant, "Preterm");
    const uhid = `${hospital.uhidPrefix}NEOPRETERM${tenant.toUpperCase()}1`;
    const svc = serviceClient();
    const neo = new NeonatalPage(page);

    const dob = "2026-09-05T10:00";
    const expectedDueDate = new Date(new Date(dob).getTime() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    await test.step("seed the patient directly", async () => {
      const { error } = await svc.from("patients").insert({
        hospital_id: hospital.id, full_name: patientName, uhid,
        phone: tenant === "a" ? "9000000053" : "9000000054", is_active: true,
      } as never);
      expect(error).toBeNull();
    });

    await test.step("birth weight 1400g, GA 30 weeks — eligible, banner shows the computed due date", async () => {
      await neo.open();
      await neo.selectPatient(patientName, uhid);
      await neo.fillBirthDetails({ dob, birthWeightG: 1400, gestationalAgeWeeks: 30 });
      await neo.expectRopEligible(true);
      const dueDateShown = await neo.getRopFirstScreenDueDate();
      expect(dueDateShown).toBe(expectedDueDate);
    });

    await test.step("fill and save ROP screening, assert the row", async () => {
      await neo.fillRopScreening({ screeningDate: "2026-09-19", result: "stage_1", followupDueDate: "2026-10-03" });
      await neo.save();

      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      const { data: record, error } = await svc.from("neonatal_records").select("*")
        .eq("hospital_id", hospital.id).eq("patient_id", patient!.id).maybeSingle();
      expect(error).toBeNull();
      expect(record).not.toBeNull();
      expect(record!.rop_eligible).toBe(true);
      expect(record!.rop_first_screen_due_date).toBe(expectedDueDate);
      expect(record!.rop_screening_done).toBe(true);
      expect(record!.rop_result).toBe("stage_1");
    });
  });
});
