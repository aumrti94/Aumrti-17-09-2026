/**
 * Phase 7.5 — Pharmacy spine (docs/testing/PHASED_TEST_PLAN.md §Phase 7.5): "Prescribe →
 * dispense → charge posts once", with three negative forks.
 *
 * SOURCE OF EVERY LOCATOR CONFIRMED BY READING THE REAL COMPONENTS, NOT ASSUMED:
 * `src/components/opd/tabs/RxOrdersTab.tsx` (prescribing + the real `checkDrugSafety` gate),
 * `src/components/opd/DrugSafetyAlertModal.tsx` (the block/override UI),
 * `src/components/pharmacy/retail/RetailPOS.tsx` + `RetailPayment.tsx` (dispensing + charge).
 *
 * WHY RETAIL COUNTER, NOT "IP DISPENSING": `DispensingWorkspace.tsx`'s own charge-posting
 * block is hard-gated `if (prescription.admission_id && chargeItems.length > 0)` — an
 * OPD-originated (non-admitted) prescription dispensed there posts NO charge at all. Retail
 * Counter is the real path an OPD prescription reaches a paid bill through, confirmed live.
 *
 * WHY "DOCUMENTED ALLERGY BLOCKS X" IS TESTED AT PRESCRIBING, NOT DISPENSING: confirmed by
 * reading `DispensingWorkspace.tsx` directly — the allergy indicator there is a COSMETIC badge
 * only (`⚠️ ALLERGY`, a naive substring match against `patient.allergies`), and neither
 * `handleDispenseAll` nor `handleConfirmDispense` reads it; a pharmacist can dispense against a
 * documented allergy at that screen with only a visual warning. The REAL, hard-blocking gate —
 * `checkDrugSafety`, the same deterministic function this session's clinical-safety-testing
 * work already covers — runs at PRESCRIBING time in `RxOrdersTab.performSafetyCheck`, with a
 * genuine block (no "add" action on a contraindicated result) and a genuinely audited override
 * (`clinical_alerts` row with `patient_id` + `created_by` + the written reason). That is the
 * fork this spec actually exercises.
 *
 * A REAL, CONFIRMED-LIVE FIXTURE FIX WAS NEEDED FIRST: `patients.allergies` (the flat text
 * column every real check reads — `checkDrugSafety`, `RxOrdersTab`, `DispensingWorkspace`,
 * `ADRCheckPanel`) was never being seeded; only the structured `allergy_records` audit table
 * was, which nothing in the prescribing/dispensing path actually queries. Fixed in
 * `e2e/fixtures/tier0.seed.ts` — see its own comment. Without that fix, this spec's negative
 * fork would have silently never fired (the seeded allergy would have been invisible to
 * `checkDrugSafety`), which is exactly the class of defect this whole test track exists to
 * catch.
 *
 * HOSPITAL A AND HOSPITAL B DO NOT SHARE AN ALLERGEN — confirmed live, not assumed: a first
 * version of this spec hardcoded one drug pair for both tenants, and hospital B's patient
 * (Sulphonamides, not Penicillin) added the "conflicting" drug with no conflict at all. See
 * `pharmacyTestDrugs()` below — the drug pair is resolved per tenant from the patient's own
 * seeded allergy, not assumed identical.
 *
 * ALSO FOUND AND FIXED LIVE while building this spine:
 * - KNOWN-BUG-210 — `ADRCheckPanel.tsx` (the dispensing screen's OWN, separate, AI-only
 *   interaction check) failed open on any AI/network error and short-circuited to "safe"
 *   whenever the patient had no other current medication, without ever consulting the allergy
 *   list passed into it. Not exercised by this spec (Retail Counter doesn't render it — only
 *   `DispensingWorkspace` does), per CLAUDE.md's "checks must be real, never skipped" rule.
 * - KNOWN-BUG-212 — `RxOrdersTab.tsx`'s Antibiotic Stewardship hand-off had a stale-closure
 *   bug: `onSaved` called `setAntibioticJustified(true)` then `performSafetyCheck(pendingDrug)`
 *   in the same synchronous tick, so the re-invoked check still read the OLD `false` value and
 *   re-opened the identical modal — no antibiotic could ever actually be prescribed through
 *   this screen, for any patient, ever. `prescribeMajorInteractionDrugAndAddAnyway`'s own use of
 *   an antibiotic drug is this fix's regression test.
 */
import { test, expect } from "@playwright/test";
import { OPDRegistrationPage } from "../pages/OPDRegistrationPage";
import { OPDConsultationPage } from "../pages/OPDConsultationPage";
import { PharmacyDispensingPage } from "../pages/PharmacyDispensingPage";
import { HOSPITAL_A, HOSPITAL_B, allergyPatient, tenantOf, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

/**
 * Hospital A's and hospital B's allergy patients carry DIFFERENT documented allergies
 * (Penicillin vs Sulphonamides — confirmed live, not assumed: a first version of this spec
 * hardcoded Amoxicillin/Penicillin V for both tenants and hospital B's Amoxicillin added
 * cleanly with no conflict at all). Picks the drug pair matching whichever allergy the
 * tenant's own seeded patient actually has, rather than changing the pre-existing patient
 * fixture (PATIENTS_B predates Phase 7.5; other tests may already depend on its exact value).
 */
function pharmacyTestDrugs(tenant: TenantKey): { majorInteraction: string; contraindicated: string } {
  const allergy = allergyPatient(tenant).allergy;
  if (allergy === "Penicillin") return { majorInteraction: "Amoxicillin 500mg", contraindicated: "Penicillin V 250mg" };
  if (allergy === "Sulphonamides") return { majorInteraction: "Cotrimoxazole 480mg", contraindicated: "Sulphonamide 500mg" };
  throw new Error(`pharmacy-spine.spec.ts has no drug pair mapped for allergy "${allergy}" (tenant ${tenant})`);
}

test.describe.configure({ mode: "serial" });

test.describe("Phase 7.5 — Pharmacy spine: prescribe, contraindication block+override, dispense, charge once", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = allergyPatient(tenant);
    const svc = serviceClient();

    const { data: disps } = await svc.from("pharmacy_dispensing").select("id").eq("patient_id", patient.id);
    if (disps?.length) {
      await svc.from("pharmacy_dispensing_items").delete().in("dispensing_id", disps.map((d) => d.id));
      await svc.from("pharmacy_dispensing").delete().eq("patient_id", patient.id);
    }
    const { data: bills } = await svc.from("bills").select("id").eq("patient_id", patient.id).eq("bill_type", "pharmacy");
    if (bills?.length) {
      await svc.from("bill_payments").delete().in("bill_id", bills.map((b) => b.id));
      await svc.from("bills").delete().in("id", bills.map((b) => b.id));
    }
    await svc.from("clinical_alerts").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("prescriptions").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("opd_encounters").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("opd_tokens").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    // Reset stock so a re-run doesn't slowly drain the fixed batch quantity across runs.
    await svc.from("drug_batches").update({ quantity_available: 1000 }).eq("hospital_id", hospital.id);
  });

  test("Segment 1 — Prescribe: a safe drug adds cleanly, a contraindicated one blocks and requires an audited override", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = allergyPatient(tenant);
    const { majorInteraction, contraindicated } = pharmacyTestDrugs(tenant);
    const registration = new OPDRegistrationPage(page);
    const consultation = new OPDConsultationPage(page);
    const overrideReason = `Benefit outweighs risk — mild documented reaction, no prior anaphylaxis (${tenant})`;

    await test.step("register the seeded allergy patient for a visit", async () => {
      await registration.open();
      await registration.clickRegisterWalkIn();
      await registration.fillReturningPatientDetails({
        patientQuery: patient.fullName,
        expectedFullName: patient.fullName,
        department: "General Medicine",
        doctor: `doctor ${tenant.toUpperCase()}`,
      });
      await registration.proceedToPayment();
      await registration.payAndIssueToken();
      await registration.closeReceipt();
    });

    await test.step("start consultation, prescribe a safe drug", async () => {
      await consultation.open();
      await consultation.selectToken(patient.fullName);
      await consultation.startConsultation();
      await consultation.fillChiefComplaint(`Follow-up review — prescribing test (${tenant})`);
      await consultation.prescribeSafeDrug("Paracetamol 650mg", "1", "3");
    });

    await test.step("prescribe a cross-reactivity (MAJOR, not contraindicated) antibiotic — regression test for KNOWN-BUG-212's antibiotic-stewardship dead end", async () => {
      await consultation.prescribeMajorInteractionDrugAndAddAnyway(
        majorInteraction, "1", "5",
        "Suspected bacterial infection — E2E stewardship justification",
      );
    });

    await test.step("attempt the DIRECT-match drug — confirm the real hard block, then the audited override", async () => {
      await consultation.prescribeContraindicatedDrugWithOverride(contraindicated, "1", "5", overrideReason);
    });

    await test.step("complete the consultation", async () => {
      await consultation.completeConsultation(patient.fullName);
    });

    await test.step("assert the real prescription and the audited override row", async () => {
      const svc = serviceClient();
      const { data: rx, error: rxErr } = await svc
        .from("prescriptions")
        .select("drugs")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .maybeSingle();
      expect(rxErr).toBeNull();
      expect(rx).not.toBeNull();
      const drugNames = (rx!.drugs as { drug_name: string }[]).map((d) => d.drug_name);
      expect(drugNames).toContain("Paracetamol 650mg");
      expect(drugNames).toContain(majorInteraction);
      expect(drugNames).toContain(contraindicated);

      const { data: alert, error: alertErr } = await svc
        .from("clinical_alerts")
        .select("patient_id, created_by, alert_message")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .maybeSingle();
      expect(alertErr).toBeNull();
      expect(alert).not.toBeNull();
      // The regression assertion for BUG-P4-004 — the override used to log with neither.
      expect(alert!.patient_id).toBe(patient.id);
      expect(alert!.created_by).not.toBeNull();
      expect(alert!.alert_message).toContain(overrideReason);
    });
  });

  test("Segment 2 — Dispense via Retail Counter: all three prescribed drugs load, checkout posts one paid bill", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = allergyPatient(tenant);
    const dispensing = new PharmacyDispensingPage(page);

    await test.step("select the patient — the signed prescription auto-loads into the cart", async () => {
      await dispensing.open();
      await dispensing.selectPatientAndLoadPrescription(patient.fullName, 3);
    });

    await test.step("checkout in cash", async () => {
      await dispensing.checkout();
    });

    await test.step("assert the real pharmacy_dispensing, items, and paid bill rows", async () => {
      const svc = serviceClient();
      const { data: disp, error: dispErr } = await svc
        .from("pharmacy_dispensing")
        .select("id, status, dispensing_type")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .maybeSingle();
      expect(dispErr).toBeNull();
      expect(disp).not.toBeNull();
      expect(disp!.status).toBe("dispensed");
      expect(disp!.dispensing_type).toBe("retail");

      const { data: items, error: itemsErr } = await svc
        .from("pharmacy_dispensing_items").select("drug_name").eq("dispensing_id", disp!.id);
      expect(itemsErr).toBeNull();
      expect(items).toHaveLength(3);

      const { data: bill, error: billErr } = await svc
        .from("bills")
        .select("id, bill_type, payment_status, total_amount")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .eq("bill_type", "pharmacy")
        .maybeSingle();
      expect(billErr).toBeNull();
      expect(bill).not.toBeNull();
      expect(bill!.payment_status).toBe("paid");
      expect(Number(bill!.total_amount)).toBeGreaterThan(0);

      const { data: lineItems, error: lineErr } = await svc
        .from("bill_line_items").select("id").eq("bill_id", bill!.id).eq("source_module", "pharmacy_retail");
      expect(lineErr).toBeNull();
      // One paid bill, one charge per dispensed drug — "charge posts once" per drug, not a
      // single lumped line, so a future duplicate-dispense of just ONE drug would still show up.
      expect(lineItems).toHaveLength(3);
    });
  });

  /**
   * Segment 3 — the duplicate-charge fork, run as a genuine empirical test rather than assumed.
   * `RetailPayment.tsx`'s `bill_line_items` insert carries `source_module: "pharmacy_retail"`
   * and NO `source_dedupe_key` at all (confirmed by reading it directly) — unlike every other
   * charge-posting path in this codebase (OT, lab, IPD ancillary), which all key on one, this
   * looked like a live double-charge risk on paper. Empirically, live, it did NOT reproduce:
   * re-selecting the same patient in a fresh "New Sale" did not reload the already-dispensed
   * prescription at all (no toast, no items). `RetailPOS.tsx` has no `pharmacy_dispensing` or
   * "already dispensed" check anywhere in it (confirmed by grep), so whatever is actually
   * preventing the reload was NOT identified within this pass — this is reported honestly as
   * "not reproduced," not as "confirmed safe by a mechanism we found." Left as a real assertion
   * either way (not silently accepted) so a future run that DOES reproduce the reload fails
   * loudly instead of passing on a relaxed check.
   */
  test("Segment 3 — Negative fork: does re-selecting the same patient re-charge the already-dispensed prescription?", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = allergyPatient(tenant);
    const dispensing = new PharmacyDispensingPage(page);

    const svc = serviceClient();
    const { data: before } = await svc.from("pharmacy_dispensing").select("id").eq("patient_id", patient.id);
    const countBefore = before?.length ?? 0;

    await test.step("start a new sale and re-select the same patient", async () => {
      await dispensing.open();
      await page.getByPlaceholder("Search by name").fill(patient.fullName);
      await page.getByRole("button", { name: new RegExp(patient.fullName) }).first().click();
    });

    await test.step("record whether the prescription reloaded into a fresh cart", async () => {
      // A real wait, not an instant check: `loadPrescriptionForPatient` is an async round trip
      // (drug_master + drug_batches lookups per line), so "not visible yet" and "never coming"
      // must not be conflated by checking before it has had a chance to resolve either way.
      const reloaded = await page.getByText(/✓ \d+ drugs? loaded from prescription/)
        .waitFor({ state: "visible", timeout: 5_000 }).then(() => true).catch(() => false);

      if (reloaded) {
        await dispensing.checkout();
        const { data: after } = await svc.from("pharmacy_dispensing").select("id").eq("patient_id", patient.id);
        const countAfter = after?.length ?? 0;
        // If this branch is ever reached: a second `pharmacy_dispensing` + a second paid
        // `bills` row for the exact same prescription, with nothing in `RetailPayment.tsx` to
        // stop it (no dedupe key on its `bill_line_items` insert, confirmed by reading it
        // directly) — a real double-charge, worth its own KNOWN-BUG entry at that point. Left
        // as a real assertion rather than relaxed to `toBeGreaterThanOrEqual`, which would
        // silently start passing on exactly the defect this segment exists to catch.
        expect(countAfter).toBe(countBefore);
      } else {
        // Confirmed live (see this test's own file-header comment): the prescription did NOT
        // reload on a second patient-selection. The protective mechanism was not identified
        // within this pass, so this is reported as "not reproduced," not "confirmed safe."
        expect(reloaded).toBe(false);
      }
    });
  });
});
