/**
 * Phase 8 — NDPS dual sign-off (docs/testing/PHASED_TEST_PLAN.md §Phase 8): the "second NDPS
 * signatory absent" negative fork this phase specifically calls for. Built as the regression
 * test for a real, live bug found while researching this phase: `NDPSDualSignoffModal.tsx`'s
 * counter-signer pool never excluded the primary pharmacist, so a primary pharmacist who is
 * themselves hospital_admin-role (every seeded E2E user, and a realistic role for a small
 * hospital's senior pharmacist too) could select THEMSELVES as counter-signer and re-enter
 * their own already-known password — which `signInWithPassword` accepts, since it genuinely is
 * their credential. The one DB-level safety net (`ndps_different_pharmacists`, a CHECK
 * constraint rejecting `countersigned_by = pharmacist_id`) would then reject the resulting
 * `ndps_register` insert — but `DispensingWorkspace.tsx` never checked that insert's result, so
 * stock still deducted, "✓ Dispensed" still showed, and the legally-mandated register entry for
 * that narcotic dispense simply never existed. See KNOWN_BUGS.md for the full write-up,
 * including the three sibling bugs found in the same pass: retail POS's complete absence of any
 * identity check and drug returns writing to the wrong column (both fixed alongside this one but
 * not separately driven live here), and — the most severe of the four — `DispensingWorkspace`
 * never fetching `patients.address` at all, which meant `FiveRightsPanel`'s own NDPS gate
 * (`validateNDPSDispense`, requiring a non-empty patient address) could **never** pass for any
 * patient regardless of whether one was on file. That one is exercised live below: without it,
 * this spec's own 5-Rights step could not succeed for the NDPS row at all.
 *
 * ndps_register is a genuinely immutable ledger (`no_delete_ndps`/`no_update_ndps`, `USING
 * (false)`, confirmed live — this suite's own service-role cleanup cannot remove a prior run's
 * row) — a deliberate compliance property, not a test-hygiene gap. The final assertion is
 * written against the latest matching row for that reason, not a total row count.
 *
 * The prescription is created through the real, already-proven OPD registration + consultation
 * flow (OPDRegistrationPage/OPDConsultationPage, from Phase 7/7.5) rather than seeded directly —
 * `prescriptions` requires an `opd_encounters` row, which requires an `opd_tokens` row, and
 * replicating that whole chain by hand would just be re-deriving what this UI already does
 * correctly. Morphine Sulphate is prescribed via the same `prescribeSafeDrug` helper Phase 7.5's
 * Pharmacy spine already uses for Paracetamol — it is neither an antibiotic nor an allergen
 * match for this fresh, allergy-free patient, so it adds cleanly with no stewardship/allergy
 * modal in the way of the actual thing under test.
 */
import { test, expect } from "@playwright/test";
import { OPDRegistrationPage } from "../pages/OPDRegistrationPage";
import { OPDConsultationPage } from "../pages/OPDConsultationPage";
import { NDPSDispensingPage } from "../pages/NDPSDispensingPage";
import { HOSPITAL_A, HOSPITAL_B, TEST_PASSWORD, drugs, seniorAdminUserId, tenantOf, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function ndpsPatientName(tenant: TenantKey): string {
  return `Test Patient NdpsA${tenant.toUpperCase()}1`;
}

/** Matches tier0.seed.ts's own `full_name` convention for a SEEDED_ROLES account. */
function seededFullName(role: string, tenant: TenantKey): string {
  return `${role.replace(/_/g, " ")} ${tenant.toUpperCase()}`;
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 8 — NDPS dual sign-off: a genuinely different, password-verified counter-signer is required", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = ndpsPatientName(tenant);
    const svc = serviceClient();

    const { data: patient } = await svc
      .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
    if (!patient) return;

    // ndps_register does NOT actually clear here — confirmed live, rows for this fixture
    // patient accumulate across every run of this spec regardless of this delete call. The
    // table carries a real, deliberate immutability property (`no_delete_ndps`/
    // `no_update_ndps`, `USING (false)`) for exactly the reason a controlled-substances
    // ledger should never be edited or deleted after the fact; this call is left in as a
    // harmless best-effort rather than removed, and the spec's own assertion is written
    // against the LATEST row for this reason, not the total row count.
    await svc.from("ndps_register").delete().eq("hospital_id", hospital.id).eq("patient_name", patientName);
    await svc.from("ndps_pending_dispenses").delete().eq("hospital_id", hospital.id).eq("patient_name", patientName);
    await svc.from("clinical_alerts").delete().eq("hospital_id", hospital.id).ilike("alert_message", `%${patientName}%`);

    const { data: dispensings } = await svc.from("pharmacy_dispensing").select("id").eq("patient_id", patient.id);
    if (dispensings?.length) {
      const ids = dispensings.map((d) => d.id);
      await svc.from("pharmacy_dispensing_items").delete().in("dispensing_id", ids);
      await svc.from("pharmacy_dispensing").delete().in("id", ids);
    }
    await svc.from("prescriptions").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("opd_encounters").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("opd_tokens").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("patient_consents").delete().eq("patient_id", patient.id);
    await svc.from("patients").delete().eq("id", patient.id);
  });

  test("a genuinely different, password-verified counter-signer completes the dispense; the primary pharmacist cannot appear as their own", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = ndpsPatientName(tenant);
    const ndpsDrug = drugs(tenant).find((d) => d.isNdps);
    if (!ndpsDrug) throw new Error("Tier-0 fixture has no NDPS-flagged drug");
    const svc = serviceClient();

    const registration = new OPDRegistrationPage(page);
    const consultation = new OPDConsultationPage(page);
    const dispensing = new NDPSDispensingPage(page);

    await test.step("register, consult, prescribe the NDPS drug", async () => {
      await registration.open();
      await registration.clickRegisterWalkIn();
      await registration.fillNewPatientDetails({
        fullName: patientName, age: "50", department: "General Medicine", doctor: `doctor ${tenant.toUpperCase()}`,
      });
      await registration.proceedToPayment();
      await registration.payAndIssueToken();
      await registration.closeReceipt();

      await consultation.open();
      await consultation.selectToken(patientName);
      await consultation.startConsultation();
      await consultation.fillChiefComplaint(`Post-operative pain management — NDPS fixture (${tenant})`);
      await consultation.prescribeSafeDrug(ndpsDrug.drugName, "10mg", "3");
      await consultation.completeConsultation(patientName);
    });

    await test.step("patch in a patient address — required for NDPS dispensing (validateNDPSDispense) but not collected by the walk-in registration form", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();
      const { error } = await svc.from("patients").update({ address: "12 MG Road, Fixture Town" }).eq("id", patient!.id);
      expect(error).toBeNull();
    });

    await test.step("dispense: 5-rights, then Dispense All", async () => {
      await dispensing.open();
      await dispensing.selectPrescription(patientName);
      await dispensing.openFiveRights(ndpsDrug.drugName);
      await dispensing.confirmFiveRights(seededFullName("pharmacist", tenant));
      await dispensing.clickDispenseAll();
    });

    await test.step("the dual sign-off modal: primary pharmacist verifies, then a genuinely different counter-signer", async () => {
      await dispensing.verifyPrimaryPharmacist("MCI-REG-12345", TEST_PASSWORD);
      await dispensing.counterSignAs("Senior Admin", seededFullName("hospital_admin", tenant), TEST_PASSWORD);
    });

    await test.step("assert the register entry is real, and correctly attributed to two DIFFERENT people", async () => {
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      // ndps_register is a genuinely immutable ledger — `no_delete_ndps`/`no_update_ndps`
      // (USING (false), no role exception) mean not even this suite's own service-role
      // cleanup can remove a prior run's row for the same fixture patient name. That is a
      // real, deliberate compliance property (a controlled-substances register that could be
      // edited or deleted after the fact would defeat its own purpose), not a test-hygiene
      // gap — so this asserts against the LATEST entry rather than the total row count, which
      // only ever grows across repeated runs.
      const { data: entries, error } = await svc
        .from("ndps_register")
        .select("pharmacist_id, countersigned_by, drug_name, transaction_type, created_at")
        .eq("hospital_id", hospital.id)
        .eq("patient_name", patientName)
        .order("created_at", { ascending: false })
        .limit(1);
      expect(error).toBeNull();
      expect(entries!.length).toBeGreaterThan(0);
      const latest = entries![0];
      expect(latest.transaction_type).toBe("issue");
      expect(latest.drug_name).toBe(ndpsDrug.drugName);
      // The actual regression: countersigned_by is set, non-null, and a DIFFERENT person from
      // the primary pharmacist — exactly what ndps_different_pharmacists enforces at the DB
      // layer and what the fixed counter-signer dropdown now enforces at the UI layer too.
      expect(latest.countersigned_by).not.toBeNull();
      expect(latest.countersigned_by).not.toBe(latest.pharmacist_id);
      expect(latest.countersigned_by).toBe(seniorAdminUserId(tenant));

      const { data: items, error: itemsErr } = await svc
        .from("pharmacy_dispensing_items")
        .select("is_ndps, drug_name")
        .eq("hospital_id", hospital.id)
        .eq("drug_name", ndpsDrug.drugName);
      expect(itemsErr).toBeNull();
      expect(items!.some((i) => i.is_ndps)).toBe(true);
    });
  });
});
