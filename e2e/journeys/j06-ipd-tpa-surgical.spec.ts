/**
 * J06 — IPD elective surgical, TPA-insured (docs/testing/PATIENT_JOURNEY_TAXONOMY.md #6).
 * Reference implementation for Phase 7 (docs/testing/PHASED_TEST_PLAN.md, D7): the segments
 * built here (e2e/pages/) are meant to be reused by every later journey, not rebuilt per spec.
 *
 * BUILT AND VERIFIED INCREMENTALLY, one segment at a time, against the real local dev server —
 * not written speculatively. Each `test` below corresponds to one journey segment (some cover
 * two — Encounter + Clinical documentation share one open workspace). All eight are complete and
 * verified, both tenants: Admission, Encounter, Clinical documentation, Orders (OT), Charge
 * posting, Billing, Claim (pre-auth → submit → reconciliation), Discharge. Segment-by-segment
 * live verification against the real UI surfaced three real application bugs along the way
 * (KNOWN-BUG-205, -206, -208 — see docs/testing/KNOWN_BUGS.md), each fixed in the same pass.
 *
 * TWO-HOSPITAL RUN, THE ESTABLISHED WAY (smoke.spec.ts's own pattern) — no manual tenant loop.
 * Playwright's two projects (hospital-a/hospital-b in playwright.config.ts) run this exact file
 * twice, each under its own storageState; `tenantOf(project.name)` reads back which one a given
 * run is. Looping tenants manually inside one project run was tried first and is wrong: it
 * reuses ONE project's login for both "tenants", so the second iteration acts as hospital A
 * staff trying to see hospital B's beds — RLS correctly hides them and the test times out
 * waiting for a bed that, from that session, does not exist.
 *
 * State assertions throughout — the real `admissions` row, not `expect(page).toHaveURL()` —
 * per the tenant-isolation-testing/playwright-e2e skills' own rule: a UI action is not the
 * assertion, the row it produces is.
 */
import { test, expect } from "@playwright/test";
import { IPDAdmissionPage } from "../pages/IPDAdmissionPage";
import { IPDWorkspacePage } from "../pages/IPDWorkspacePage";
import { OTPage } from "../pages/OTPage";
import { BillingPage } from "../pages/BillingPage";
import { InsurancePage } from "../pages/InsurancePage";
import { HOSPITAL_A, HOSPITAL_B, tenantOf, tpaPatient } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

// Segments compose into one continuous journey, and later segments (from Encounter on) act on
// the admission Segment 1 creates — declaration order matters, matching isolation.spec.ts's own
// precedent for a multi-test describe sharing state. `serial` also stops the file early on a
// failure instead of cascading confusing failures through every later segment.
test.describe.configure({ mode: "serial" });

test.describe("J06 — IPD elective surgical, TPA-insured", () => {
  test.afterAll(async () => {
    // Clean up so a re-run finds the bed free again — the seed itself only resets bed status
    // at seed time, it does not know which admission a previous SPEC run created. Queried by
    // (hospital, patient), NOT a variable captured mid-test: a failure at any step before that
    // capture point — confirmed live, three separate debugging attempts each left a real,
    // uncleaned admission row behind — must still be cleaned up, or every re-run after a
    // failure inherits an occupied SW-01 and fails for an unrelated reason.
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = tpaPatient(tenant);
    const svc = serviceClient();

    // insurance_payment_reconciliation.claim_id is ON DELETE RESTRICT (not CASCADE) — must go
    // before insurance_claims or its delete fails with a FK violation.
    const { data: claimIds } = await svc.from("insurance_claims").select("id")
      .eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    if (claimIds?.length) {
      await svc.from("insurance_payment_reconciliation").delete().in("claim_id", claimIds.map((c) => c.id));
    }
    await svc.from("insurance_claims").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("insurance_pre_auth").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    // bill_line_items.bill_id IS "ON DELETE CASCADE" (confirmed by reading the migration) —
    // deleting the bill alone takes its line items with it, no separate delete needed.
    await svc.from("bills").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id).eq("bill_type", "ipd");
    await svc.from("anaesthesia_records").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    // KNOWN-BUG-206's fix means this now actually gets written (it never did before) — clean
    // it up in kind, or every re-run accumulates one more "OT Revenue - Appendicectomy" entry.
    await svc.from("journal_entries").delete().eq("hospital_id", hospital.id).eq("description", "OT Revenue - Appendicectomy");
    // service_charges is a reporting mirror the same fix now writes to successfully too — see
    // KNOWN-BUG-206's note on a separate, unresolved anomaly where these particular rows do
    // not appear to persist past the request that inserted them. Deleted defensively in case
    // that changes; harmless no-op today given the anomaly.
    await svc.from("service_charges").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);

    // Every table with a NOT NULL, non-cascading FK to ot_schedules(id) — confirmed by grepping
    // every migration that references it, not assumed: ot_checklists, ot_team_members,
    // ot_instrument_counts, ot_equipment_checklist. (ot_implants/ot_consumables DO cascade;
    // anaesthesia_records.ot_id is nullable and already cleaned up above by patient_id.)
    // Discovered the hard way — a first cleanup pass missing ot_instrument_counts left a
    // foreign-key violation that silently aborted the rest of that afterAll's cleanup too.
    const { data: schedules } = await svc.from("ot_schedules").select("id").eq("patient_id", patient.id);
    if (schedules?.length) {
      const ids = schedules.map((s) => s.id);
      await svc.from("ot_checklists").delete().in("ot_schedule_id", ids);
      await svc.from("ot_team_members").delete().in("ot_schedule_id", ids);
      await svc.from("ot_instrument_counts").delete().in("ot_schedule_id", ids);
      await svc.from("ot_equipment_checklist").delete().in("ot_schedule_id", ids);
      await svc.from("ot_schedules").delete().eq("patient_id", patient.id);
    }

    // Discharge (Segment 8) creates a real housekeeping_tasks row via createBedTurnoverTask —
    // deleted by bed_id since it has no direct patient_id column of its own.
    const { data: swBed } = await svc.from("beds").select("id").eq("hospital_id", hospital.id).eq("bed_number", "SW-01").maybeSingle();
    if (swBed?.id) {
      await svc.from("housekeeping_tasks").delete().eq("bed_id", swBed.id);
    }

    await svc.from("admissions").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("beds").update({ status: "available" }).eq("hospital_id", hospital.id).eq("bed_number", "SW-01");
  });

  test("Segment 1 — Admission: search existing TPA patient, admit into an available bed", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = tpaPatient(tenant);
    const admission = new IPDAdmissionPage(page);

    await test.step("open /ipd and start a new admission on bed SW-01", async () => {
      await admission.open();
      await admission.clickAvailableBed("SW-01");
    });

    await test.step("step 1 — find and select the seeded TPA patient", async () => {
      await admission.searchAndSelectPatient(patient.uhid, patient.fullName);
      await admission.goToStep2();
    });

    await test.step("step 2 — admission details: doctor, diagnosis, TPA billing payer, allergy verification", async () => {
      await admission.fillAdmissionDetails({
        doctor: `doctor ${tenant.toUpperCase()}`,
        diagnosis: "Acute appendicitis — elective appendicectomy",
        insuranceType: "Corporate / TPA",
        payerType: "tpa",
        payerName: "Star Health TPA",
        bedAlreadyPreselected: true,
      });
      await admission.goToStep3();
    });

    await test.step("step 3 — estimate: no fields required, advance", async () => {
      await admission.goToStep4();
    });

    await test.step("step 4 — confirm admission", async () => {
      await admission.confirmAdmission(patient.fullName);
      await admission.closeSuccessDialog();
    });

    await test.step("assert the real admissions row — not just that the modal closed", async () => {
      const svc = serviceClient();
      const { data, error } = await svc
        .from("admissions")
        .select("id, hospital_id, patient_id, status, admission_type, payer_type, insurance_type, admitting_diagnosis, bed:beds(bed_number)")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .eq("status", "active")
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.admission_type).toBe("elective");
      expect(data!.payer_type).toBe("tpa");
      // Regression assertion: an earlier version of this journey left the "Insurance" pill at
      // its "self_pay" default, which made the bill invisible to ClaimsToSubmit.tsx's own
      // eligibility query (`insurance_type != 'self_pay'`) — discovered only once the Claim
      // segment was actually built and run against it.
      expect(data!.insurance_type).not.toBe("self_pay");
      expect(data!.admitting_diagnosis).toContain("appendicectomy");
      expect((data!.bed as unknown as { bed_number: string })?.bed_number).toBe("SW-01");
    });

    await test.step("assert the bed flipped to occupied — the other half of the same state change", async () => {
      const svc = serviceClient();
      const { data } = await svc.from("beds").select("status").eq("hospital_id", hospital.id).eq("bed_number", "SW-01").maybeSingle();
      expect(data?.status).toBe("occupied");
    });
  });

  test("Segment 2 — Encounter: open the admitted patient's IPD workspace; Segment 3 — Clinical documentation: add a note", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = tpaPatient(tenant);
    const workspace = new IPDWorkspacePage(page);
    const noteText = `Pre-op review complete, cleared for OT — ${tenant}`;

    await test.step("open /ipd and click the now-occupied bed — no separate 'open encounter' action exists", async () => {
      await workspace.open();
      await workspace.openEncounter("SW-01", patient.fullName);
    });

    await test.step("Notes tab: add a clinical note", async () => {
      await workspace.addClinicalNote(noteText);
    });

    await test.step("assert the real ipd_nursing_notes row", async () => {
      const svc = serviceClient();
      const { data: admission } = await svc
        .from("admissions").select("id").eq("hospital_id", hospital.id).eq("patient_id", patient.id).eq("status", "active").maybeSingle();
      expect(admission).not.toBeNull();

      const { data: notes, error } = await svc
        .from("ipd_nursing_notes")
        .select("id, note_text, admission_id")
        .eq("admission_id", admission!.id)
        .eq("note_text", noteText);

      expect(error).toBeNull();
      expect(notes).toHaveLength(1);
    });
  });

  test("Segment 4 — Orders: book the OT slot for the surgery", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const patient = tpaPatient(tenant);
    const ot = new OTPage(page);
    const surgeryName = "Appendicectomy";

    await test.step("open /ot and start a new booking", async () => {
      await ot.open();
      await ot.clickBookOT();
    });

    await test.step("fill patient, surgery, room, surgeon and confirm", async () => {
      await ot.bookSlot({
        patientQuery: patient.uhid,
        patientFullName: patient.fullName,
        surgeryName,
        otRoomName: "OT-1",
        surgeonFullName: `doctor ${tenant.toUpperCase()}`,
      });
    });

    await test.step("assert the real ot_schedules row, and that it is genuinely linked back to the admission (KNOWN-BUG-205, fixed)", async () => {
      const svc = serviceClient();
      const { data, error } = await svc
        .from("ot_schedules")
        .select("id, patient_id, admission_id, surgery_name, case_type, status")
        .eq("patient_id", patient.id)
        .eq("surgery_name", surgeryName)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.case_type).toBe("elective");
      // Before the fix, admission_id was never set by this booking form at all — the
      // regression test for it: without this, OTBillingTab's "Push OT Charges to IPD Bill"
      // (the next segment) is permanently disabled, no matter what.
      expect(data!.admission_id).not.toBeNull();
    });
  });

  test("Segment 5 — Charge posting: run the case through to completion and confirm OT charges reach the IPD bill", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = tpaPatient(tenant);
    const ot = new OTPage(page);
    const surgeryName = "Appendicectomy";

    await test.step("open /ot and select the booked case", async () => {
      await ot.open();
      await ot.selectCase(surgeryName);
    });

    await test.step("Confirm Case → Start Case", async () => {
      await ot.confirmCase();
      await ot.startCase();
    });

    await test.step("WHO Checklist: document exception rather than ticking every item", async () => {
      await ot.skipWhoChecklist("Add-on elective case, theatre running behind — team proceeded on verbal confirmation.");
    });

    await test.step("Anaesthesia: save the record and get the consultant sign-off", async () => {
      await ot.signAnaesthesiaRecord();
    });

    await test.step("End Case — this is what actually triggers OT billing", async () => {
      await ot.endCase("Acute appendicitis, uncomplicated appendicectomy");
    });

    await test.step("assert the ot_schedules row is completed", async () => {
      const svc = serviceClient();
      const { data } = await svc.from("ot_schedules").select("status, admission_id").eq("patient_id", patient.id).eq("surgery_name", surgeryName).maybeSingle();
      expect(data?.status).toBe("completed");
      expect(data?.admission_id).not.toBeNull();
    });

    await test.step("assert the OT charge genuinely reached the real IPD bill's bill_line_items — not just that the case closed", async () => {
      const svc = serviceClient();
      const { data: bill } = await svc
        .from("bills").select("id").eq("hospital_id", hospital.id).eq("patient_id", patient.id).eq("bill_type", "ipd").maybeSingle();
      expect(bill).not.toBeNull();

      const { data: lineItems, error } = await svc
        .from("bill_line_items")
        .select("id, source_module, total_amount")
        .eq("bill_id", bill!.id)
        .eq("source_module", "ot");

      expect(error).toBeNull();
      expect(lineItems!.length).toBeGreaterThan(0);
      expect(lineItems!.every((li) => Number(li.total_amount) > 0)).toBe(true);
    });
  });

  test("Segment 6 — Billing: finalise the IPD bill that already carries the OT charge", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = tpaPatient(tenant);
    const billing = new BillingPage(page);

    const svc = serviceClient();
    const { data: admission } = await svc
      .from("admissions").select("id").eq("hospital_id", hospital.id).eq("patient_id", patient.id).eq("status", "active").maybeSingle();
    expect(admission).not.toBeNull();

    await test.step("open the IPD bill via the same deep link IPDOverviewTab uses", async () => {
      await billing.openIpdBillFor(admission!.id);
    });

    await test.step("finalise it", async () => {
      await billing.finalizeBill();
    });

    await test.step("assert the real bills row is final, still carries the OT line item, and the total is genuinely non-zero", async () => {
      const { data: bill, error } = await svc
        .from("bills")
        .select("id, bill_status, total_amount")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .eq("bill_type", "ipd")
        .maybeSingle();

      expect(error).toBeNull();
      expect(bill).not.toBeNull();
      expect(bill!.bill_status).toBe("final");
      expect(Number(bill!.total_amount)).toBeGreaterThan(0);

      const { data: lineItems } = await svc.from("bill_line_items").select("id").eq("bill_id", bill!.id).eq("source_module", "ot");
      expect(lineItems!.length).toBeGreaterThan(0);
    });
  });

  test("Segment 7 — Claim: submit a TPA pre-auth for this admission", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = tpaPatient(tenant);
    const insurance = new InsurancePage(page);

    await test.step("open Insurance → Pre-Auth Queue → New Pre-Auth", async () => {
      await insurance.open();
      await insurance.goToNav("Pre-Auth Queue");
      await insurance.startNewPreAuth(patient.uhid, patient.fullName);
    });

    await test.step("TPA, policy number, verify policy", async () => {
      await insurance.selectTpa("Star Health TPA");
      await insurance.fillPolicyNumber("POL-J06-0001");
      await insurance.verifyPolicy();
    });

    await test.step("diagnosis code, estimated amount, clinical notes — enough to pass the quality gate outright", async () => {
      await insurance.addDiagnosisCode("K35.80", "K35.80");
      await insurance.fillEstimatedAmount(22000);
      await insurance.fillClinicalNotes(
        "Elective appendicectomy for acute appendicitis. Patient stable, admitted for surgical management, no complications anticipated. TPA-insured under Star Health.",
      );
    });

    await test.step("document checklist — upload to every required slot", async () => {
      await insurance.uploadAllChecklistDocuments();
    });

    await test.step("submit — expect a WARNING verdict (intimation not sent), acknowledge, proceed", async () => {
      await insurance.submitPreAuth();
    });

    await test.step("assert the real insurance_pre_auth row", async () => {
      const svc = serviceClient();
      const { data, error } = await svc
        .from("insurance_pre_auth")
        .select("id, status, tpa_name, policy_number, estimated_amount, diagnosis_codes")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.status).toBe("submitted");
      expect(data!.tpa_name).toBe("Star Health TPA");
      expect(Number(data!.estimated_amount)).toBe(22000);
      expect(data!.diagnosis_codes).toContain("K35.80");
    });

    let billNumber = "";

    await test.step("Claims to Submit: AI review unavailable locally, skip it, submit", async () => {
      const svc = serviceClient();
      const { data: bill } = await svc
        .from("bills")
        .select("bill_number")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .eq("bill_type", "ipd")
        .maybeSingle();
      expect(bill).not.toBeNull();
      billNumber = bill!.bill_number;

      await insurance.goToNav("Claims to Submit");
      await insurance.runAiReviewThenSubmit(billNumber);
    });

    let claimedAmount = 0;

    await test.step("assert the real insurance_claims row", async () => {
      const svc = serviceClient();
      const { data, error } = await svc
        .from("insurance_claims")
        .select("id, claim_number, bill_id, patient_id, claimed_amount")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.claim_number).toMatch(/^CLM-\d{4}-\d{5}$/);
      expect(Number(data!.claimed_amount)).toBeGreaterThan(0);
      claimedAmount = Number(data!.claimed_amount);
    });

    await test.step("Reconciliation: record the TPA's decision (approved), then the full payment", async () => {
      await insurance.goToNav("Claims Status");
      await insurance.recordTpaApproval(patient.fullName, claimedAmount);

      await insurance.goToNav("Reconciliation");
      await insurance.recordFullReconciliation(patient.fullName, claimedAmount);
    });

    await test.step("assert the real insurance_payment_reconciliation row and reconciled claim", async () => {
      const svc = serviceClient();
      const { data: claim, error: claimErr } = await svc
        .from("insurance_claims")
        .select("id, reconciled, settled_amount, status")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .maybeSingle();

      expect(claimErr).toBeNull();
      expect(claim).not.toBeNull();
      expect(claim!.reconciled).toBe(true);
      expect(Number(claim!.settled_amount)).toBe(claimedAmount);

      const { data: recon, error: reconErr } = await svc
        .from("insurance_payment_reconciliation")
        .select("id, tpa_paid_amount, reconciled")
        .eq("hospital_id", hospital.id)
        .eq("claim_id", claim!.id)
        .maybeSingle();

      expect(reconErr).toBeNull();
      expect(recon).not.toBeNull();
      expect(Number(recon!.tpa_paid_amount)).toBe(claimedAmount);
      expect(recon!.reconciled).toBe(true);
    });
  });

  test("Segment 8 — Discharge: clear the full workflow (medical, billing, pharmacy) and discharge without signature", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patient = tpaPatient(tenant);
    const workspace = new IPDWorkspacePage(page);
    const billing = new BillingPage(page);
    const unsignedReason = `E2E journey run — no doctor available to sign in this environment (${tenant})`;

    const svc = serviceClient();
    const { data: admission } = await svc
      .from("admissions").select("id").eq("hospital_id", hospital.id).eq("patient_id", patient.id).eq("status", "active").maybeSingle();
    expect(admission).not.toBeNull();

    await test.step("open the encounter and initiate discharge (starts the TAT clock, unblocks the clearance syncs)", async () => {
      await workspace.open();
      await workspace.openEncounter("SW-01", patient.fullName);
      await workspace.initiateDischarge();
    });

    await test.step("Doctor step: mark medical clearance", async () => {
      await workspace.markMedicalClearance();
    });

    await test.step("Billing step: no insurance coverage was entered against this bill (Segment 7's claim lives in insurance_claims, not bills.insurance_amount) — collect the full balance directly, the real action that flips payment_status to paid", async () => {
      await billing.openIpdBillFor(admission!.id);
      await billing.payFullBalance();
    });

    await test.step("Pharmacist step: reopen the encounter — a full page nav resets IPDOverviewTab's in-memory state, and only a fresh mount re-reads billing_cleared", async () => {
      await workspace.open();
      await workspace.openEncounter("SW-01", patient.fullName);
      await workspace.clearPharmacy();
    });

    await test.step("Discharge Summary step: write a manual summary (no AI credentials locally) and discharge without an e-signature", async () => {
      await workspace.writeDischargeSummary(
        `Elective appendicectomy performed without complication. Post-op course uneventful. Discharged in stable condition with standard analgesia and wound-care instructions. TPA claim submitted and reconciled — ${tenant}.`,
      );
      await workspace.dischargeWithoutSignature(unsignedReason);
    });

    await test.step("assert the real admissions row — discharged, summary done, unsigned reason recorded, billing/medical/pharmacy all cleared", async () => {
      const { data, error } = await svc
        .from("admissions")
        .select("status, discharged_at, discharge_summary_done, discharge_unsigned_reason, medical_cleared, billing_cleared, pharmacy_cleared")
        .eq("id", admission!.id)
        .maybeSingle();

      expect(error).toBeNull();
      expect(data).not.toBeNull();
      expect(data!.status).toBe("discharged");
      expect(data!.discharged_at).not.toBeNull();
      expect(data!.discharge_summary_done).toBe(true);
      expect(data!.discharge_unsigned_reason).toBe(unsignedReason);
      expect(data!.medical_cleared).toBe(true);
      expect(data!.billing_cleared).toBe(true);
      expect(data!.pharmacy_cleared).toBe(true);
    });

    await test.step("assert the bill is genuinely paid — the real signal the billing gate checked, not a flag alone", async () => {
      const { data: bill, error } = await svc
        .from("bills")
        .select("payment_status")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient.id)
        .eq("bill_type", "ipd")
        .maybeSingle();
      expect(error).toBeNull();
      expect(bill!.payment_status).toBe("paid");
    });
  });
});
