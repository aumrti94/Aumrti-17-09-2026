/**
 * J12 — OPD walk-in, cash, new visit (docs/testing/PATIENT_JOURNEY_TAXONOMY.md #12).
 * Phase 7's proof that the segment shape generalises beyond J06 (IPD elective surgical,
 * TPA-insured) to a structurally different journey — register → encounter → orders → charge
 * posting, with no claim and no discharge (OPD has neither).
 *
 * HONEST NOTE ON THE PLAN'S OWN EXIT-GATE LANGUAGE: "J12 assembled with zero new segment code"
 * does not hold literally. Confirmed by reading the source directly (not assumed): OPD's
 * registration (`WalkInModal.tsx`), consultation (`ConsultationWorkspace.tsx`) and lab-ordering
 * (`NewLabOrderModal.tsx` via `PendingOpdLabTab.tsx`) screens share NO components with IPD's
 * equivalents (`AdmitPatientModal.tsx`, `IPDWorkspace.tsx`, `BookOTModal.tsx`) — three new page
 * objects were required (`OPDRegistrationPage.ts`, `OPDConsultationPage.ts`,
 * `OPDLabOrderPage.ts`). What DOES generalise, and is the real Phase 7 win: the conceptual
 * segment shape (Registration → Encounter → Orders → Charge posting), the two-hospital run
 * pattern, the `test.step` + real-row-assertion discipline, and — literally — `BillingPage.ts`'s
 * `payFullBalance()` is not reused here only because OPD never leaves a balance to collect (both
 * the consultation fee and the lab test are paid at the moment they're ordered, "payment-first,
 * order second" — confirmed by reading `finalizeConsultation`'s own comment in
 * `ConsultationWorkspace.tsx`).
 *
 * Also structurally different from J06: the patient is NOT a Tier-0 fixture row. J12 is
 * specifically a "new visit" — WalkInModal registers a brand-new patient inline, the same way a
 * real front desk would. The patient's identity for this run is a fixed, obviously-synthetic
 * full name (never a real name — see the fixtures skill's own "no PHI" rule), looked up by that
 * name rather than a pre-seeded id.
 */
import { test, expect } from "@playwright/test";
import { OPDRegistrationPage } from "../pages/OPDRegistrationPage";
import { OPDConsultationPage } from "../pages/OPDConsultationPage";
import { OPDLabOrderPage } from "../pages/OPDLabOrderPage";
import { HOSPITAL_A, HOSPITAL_B, labTestMaster, tenantOf, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function walkinPatientName(tenant: TenantKey): string {
  return `Test Patient OPD${tenant.toUpperCase()}1`;
}

test.describe.configure({ mode: "serial" });

test.describe("J12 — OPD walk-in, cash, new visit", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = walkinPatientName(tenant);
    const svc = serviceClient();

    const { data: patient } = await svc
      .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
    if (!patient) return; // registration never got far enough to create one — nothing to clean up

    const { data: labOrders } = await svc.from("lab_orders").select("id").eq("patient_id", patient.id);
    if (labOrders?.length) {
      const ids = labOrders.map((o) => o.id);
      await svc.from("lab_samples").delete().in("lab_order_id", ids);
      await svc.from("lab_order_items").delete().in("lab_order_id", ids);
      await svc.from("lab_orders").delete().eq("patient_id", patient.id);
    }

    // bill_payments has no patient_id column of its own (confirmed by reading the generated
    // types) — gathered via the bill ids first, deleted before the bills themselves.
    const { data: bills } = await svc.from("bills").select("id").eq("patient_id", patient.id);
    if (bills?.length) {
      await svc.from("bill_payments").delete().in("bill_id", bills.map((b) => b.id));
    }
    // bill_line_items.bill_id is ON DELETE CASCADE (established in j06's own cleanup) — no
    // separate delete needed.
    await svc.from("bills").delete().eq("patient_id", patient.id);

    // service_charges is the same reporting-mirror table flagged in KNOWN-BUG-206/207 as
    // sometimes not persisting past the request that inserted it — deleted defensively in case
    // that changes; harmless no-op today given the anomaly.
    await svc.from("service_charges").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);

    await svc.from("prescriptions").delete().eq("patient_id", patient.id);
    await svc.from("opd_encounters").delete().eq("patient_id", patient.id);
    await svc.from("opd_tokens").delete().eq("patient_id", patient.id);
    await svc.from("patient_consents").delete().eq("patient_id", patient.id);
    await svc.from("patients").delete().eq("id", patient.id);
  });

  test("Segment 1 — Registration: walk-in a brand-new cash patient, pay the consultation fee, get a token", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = walkinPatientName(tenant);
    const registration = new OPDRegistrationPage(page);
    let issuedToken = "";

    await test.step("open /opd and start a walk-in registration", async () => {
      await registration.open();
      await registration.clickRegisterWalkIn();
    });

    await test.step("step 1 — new patient details, department, doctor", async () => {
      await registration.fillNewPatientDetails({
        fullName: patientName,
        age: "35",
        department: "General Medicine",
        doctor: `doctor ${tenant.toUpperCase()}`,
      });
      await registration.proceedToPayment();
    });

    await test.step("step 2 — pay the consultation fee in cash, token issued", async () => {
      await registration.payAndIssueToken();
      issuedToken = await registration.readIssuedToken();
      expect(issuedToken).toMatch(/^[A-Z]+-\d+$/);
      await registration.closeReceipt();
    });

    await test.step("assert the real patient, opd_tokens and bills rows", async () => {
      const svc = serviceClient();
      const { data: patient, error: patientErr } = await svc
        .from("patients").select("id, full_name").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patientErr).toBeNull();
      expect(patient).not.toBeNull();

      const { data: token, error: tokenErr } = await svc
        .from("opd_tokens")
        .select("token_number, status, patient_id")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient!.id)
        .maybeSingle();
      expect(tokenErr).toBeNull();
      expect(token).not.toBeNull();
      expect(token!.token_number).toBe(issuedToken);
      expect(token!.status).toBe("waiting");

      const { data: bill, error: billErr } = await svc
        .from("bills")
        .select("bill_type, payment_status, total_amount")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient!.id)
        .maybeSingle();
      expect(billErr).toBeNull();
      expect(bill).not.toBeNull();
      expect(bill!.bill_type).toBe("opd");
      expect(bill!.payment_status).toBe("paid");
      // Fixed fixture rate (services()'s "General Consultation") — a hand-derivable total, per
      // the fixture skill's own D6 rule, not a > 0 placeholder assertion.
      expect(Number(bill!.total_amount)).toBe(500);
    });
  });

  test("Segment 2 — Encounter + Clinical documentation + Orders: consult, chief complaint, prescribe a lab test, complete", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = walkinPatientName(tenant);
    const consultation = new OPDConsultationPage(page);
    const chiefComplaint = `Fever and cough for 3 days — ${tenant}`;
    const testName = labTestMaster(tenant).testName;

    await test.step("open /opd and select the newly-registered patient's token", async () => {
      await consultation.open();
      await consultation.selectToken(patientName);
      await consultation.startConsultation();
    });

    await test.step("Complaint tab: chief complaint", async () => {
      await consultation.fillChiefComplaint(chiefComplaint);
    });

    await test.step("Rx & Orders tab: prescribe the lab test (no charge yet — payment-first happens on the lab side)", async () => {
      await consultation.addLabOrder(testName);
    });

    await test.step("complete the consultation", async () => {
      await consultation.completeConsultation(patientName);
    });

    await test.step("assert the real opd_encounters, prescriptions and opd_tokens rows", async () => {
      const svc = serviceClient();
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: encounter, error: encErr } = await svc
        .from("opd_encounters").select("id, chief_complaint").eq("patient_id", patient!.id).maybeSingle();
      expect(encErr).toBeNull();
      expect(encounter).not.toBeNull();
      expect(encounter!.chief_complaint).toBe(chiefComplaint);

      const { data: rx, error: rxErr } = await svc
        .from("prescriptions").select("lab_orders").eq("patient_id", patient!.id).maybeSingle();
      expect(rxErr).toBeNull();
      expect(rx).not.toBeNull();
      const labOrderNames = (rx!.lab_orders as { test_name: string }[]).map((l) => l.test_name);
      expect(labOrderNames).toContain(testName);

      const { data: token, error: tokenErr } = await svc
        .from("opd_tokens").select("status").eq("patient_id", patient!.id).maybeSingle();
      expect(tokenErr).toBeNull();
      expect(token!.status).toBe("completed");
    });
  });

  test("Segment 3 — Orders + Charge posting: raise and pay for the prescribed lab test from Pending from OPD", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = walkinPatientName(tenant);
    const lab = new OPDLabOrderPage(page);

    await test.step("open /lab, Pending from OPD, create the order for this patient", async () => {
      await lab.open();
      await lab.createOrderFor(patientName);
    });

    await test.step("proceed to payment and collect (cash)", async () => {
      await lab.proceedToPayment();
      await lab.collectAndCreateOrder();
      await lab.closeSuccess();
    });

    await test.step("assert the real lab_orders, lab_order_items and lab bill rows", async () => {
      const svc = serviceClient();
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: order, error: orderErr } = await svc
        .from("lab_orders")
        .select("id, status, payment_status, billing_status, encounter_id")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient!.id)
        .maybeSingle();
      expect(orderErr).toBeNull();
      expect(order).not.toBeNull();
      expect(order!.payment_status).toBe("paid");
      expect(order!.billing_status).toBe("billed");
      expect(order!.encounter_id).not.toBeNull();

      const { data: items, error: itemsErr } = await svc
        .from("lab_order_items").select("id").eq("lab_order_id", order!.id);
      expect(itemsErr).toBeNull();
      expect(items!.length).toBeGreaterThan(0);

      const { data: labBill, error: labBillErr } = await svc
        .from("bills")
        .select("bill_type, payment_status, total_amount")
        .eq("hospital_id", hospital.id)
        .eq("patient_id", patient!.id)
        .eq("bill_type", "lab")
        .maybeSingle();
      expect(labBillErr).toBeNull();
      expect(labBill).not.toBeNull();
      expect(labBill!.payment_status).toBe("paid");
      // Fixed fixture rate (labTestMaster()'s CBC) — hand-derivable, per D6.
      expect(Number(labBill!.total_amount)).toBe(300);
    });
  });
});
