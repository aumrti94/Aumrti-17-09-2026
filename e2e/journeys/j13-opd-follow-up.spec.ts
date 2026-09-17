/**
 * J13 — OPD follow-up visit (docs/testing/PATIENT_JOURNEY_TAXONOMY.md #13, journey listed under
 * Phase 7.5 "The adoption spine" in docs/testing/PHASED_TEST_PLAN.md).
 *
 * Tests the follow-up-fee + visit-cap rule in `src/lib/consultationFee.ts` end-to-end through
 * the real registration UI — register an anchor ("new") visit, then a second visit for the SAME
 * patient and doctor within the follow-up validity window, and assert the second one is billed
 * at the discounted follow-up rate, not the full fee.
 *
 * TWO THINGS CONFIRMED FIXED BY READING THE SOURCE DIRECTLY, NOT ASSUMED FROM THE PLAN:
 * - The `visit_type` spelling drift the plan's own taxonomy doc warned would threaten this
 *   journey ("a follow-up visit gets charged as a new visit — silently") is already resolved:
 *   `src/lib/visitTypes.ts` centralises all three real vocabularies (`visit_type`,
 *   `visit_purpose`, `charged_tier`) and their predicates, and `consultationFee.ts`'s own header
 *   comment documents the fix. This journey is the regression test that locks it in, not a bug
 *   fix.
 * - `computeConsultationFee` only takes the follow-up branch when a `followUpFee` is actually
 *   CONFIGURED (`rate.followUpFee !== null`) — the Tier-0 fixture's "General Consultation" row
 *   had no follow-up fee before this journey needed one, which would have made every "follow-up"
 *   visit silently charge full price. Fixed by extending `services()` in
 *   `e2e/fixtures/constants.ts` with `followUpFee: 200, followUpValidityDays: 7,
 *   followUpMaxVisits: 3`, not by changing consultationFee.ts itself.
 *
 * NOT TESTED HERE, DELIBERATELY: the visit-cap BOUNDARY (spending all 3 follow-ups, then
 * reverting to full fee) is `computeConsultationFee`'s own pure-function logic — exhaustively
 * sweeping that boundary belongs in a unit test once the suite is rebuilt (the file's own header
 * comment names `consultationFee.test.ts`, removed 2026-09-05), not in four consecutive rounds
 * of browser UI. This journey proves the real UI reaches the real pricing decision correctly
 * ONCE — the same scope discipline every other Phase 7/7.5 segment has followed.
 *
 * TWO OF THE PLAN'S THREE NAMED OPD NEGATIVE FORKS DO NOT APPLY TO WHAT WAS ACTUALLY BUILT.
 * "Unpaid bill blocks ancillary collection" and "override is audited" both presuppose an OPD
 * order can exist in an unpaid state to be blocked or overridden. Confirmed live by reading
 * `src/lib/ipdAncillaryGate.ts`'s own header comment: "OPD looks like it has a payment gate; it
 * does not. Its order modals simply refuse to create the order row until cash is taken... so
 * there is never an unpaid order to block" — and `evaluateAncillaryGate` hard-codes
 * `if (!isIPD) return clear("not_ipd")`. There is no gate and no override path for OPD to test;
 * writing one would be testing a scenario that structurally cannot occur.
 */
import { test, expect } from "@playwright/test";
import { OPDRegistrationPage } from "../pages/OPDRegistrationPage";
import { HOSPITAL_A, HOSPITAL_B, tenantOf, type TenantKey } from "../fixtures/constants";
import { serviceClient } from "../fixtures/serviceClient";

function followUpPatientName(tenant: TenantKey): string {
  return `Test Patient FollowUp${tenant.toUpperCase()}1`;
}

test.describe.configure({ mode: "serial" });

test.describe("J13 — OPD follow-up visit", () => {
  test.afterAll(async () => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = followUpPatientName(tenant);
    const svc = serviceClient();

    const { data: patient } = await svc
      .from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
    if (!patient) return;

    const { data: bills } = await svc.from("bills").select("id").eq("patient_id", patient.id);
    if (bills?.length) {
      await svc.from("bill_payments").delete().in("bill_id", bills.map((b) => b.id));
    }
    await svc.from("bills").delete().eq("patient_id", patient.id);
    await svc.from("service_charges").delete().eq("hospital_id", hospital.id).eq("patient_id", patient.id);
    await svc.from("opd_tokens").delete().eq("patient_id", patient.id);
    await svc.from("patient_consents").delete().eq("patient_id", patient.id);
    await svc.from("patients").delete().eq("id", patient.id);
  });

  test("Segment 1 — Anchor visit: register a new patient, full consultation fee", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = followUpPatientName(tenant);
    const registration = new OPDRegistrationPage(page);

    await test.step("register as a brand-new patient", async () => {
      await registration.open();
      await registration.clickRegisterWalkIn();
      await registration.fillNewPatientDetails({
        fullName: patientName,
        age: "40",
        department: "General Medicine",
        doctor: `doctor ${tenant.toUpperCase()}`,
      });
      await registration.proceedToPayment();
      await registration.payAndIssueToken();
      await registration.closeReceipt();
    });

    await test.step("assert the anchor token and full-fee bill", async () => {
      const svc = serviceClient();
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: token, error: tokenErr } = await svc
        .from("opd_tokens").select("charged_tier, visit_type").eq("patient_id", patient!.id).maybeSingle();
      expect(tokenErr).toBeNull();
      expect(token!.charged_tier).toBe("new");

      const { data: bill, error: billErr } = await svc
        .from("bills").select("total_amount").eq("patient_id", patient!.id).eq("bill_type", "opd").maybeSingle();
      expect(billErr).toBeNull();
      expect(Number(bill!.total_amount)).toBe(500);
    });
  });

  test("Segment 2 — Follow-up visit: same patient, same doctor, within validity — bills the discounted rate", async ({ page }) => {
    const tenant = tenantOf(test.info().project.name);
    const hospital = tenant === "a" ? HOSPITAL_A : HOSPITAL_B;
    const patientName = followUpPatientName(tenant);
    const registration = new OPDRegistrationPage(page);

    await test.step("register the same patient again as a follow-up, same doctor", async () => {
      await registration.open();
      await registration.clickRegisterWalkIn();
      await registration.fillReturningPatientDetails({
        patientQuery: patientName,
        expectedFullName: patientName,
        department: "General Medicine",
        doctor: `doctor ${tenant.toUpperCase()}`,
      });
      // The anchor visit's token is still "waiting" (never taken through a consultation), so
      // the same-day duplicate-billing guard fires — confirmed live. Its own "Register Anyway"
      // is the real recovery path a front desk uses here, not a workaround.
      await registration.proceedPastSameDayWarning();
      await registration.payAndIssueToken();
      await registration.closeReceipt();
    });

    await test.step("assert the SECOND token is charged_tier='follow_up' at the configured discount — the regression test for the visit_type drift", async () => {
      const svc = serviceClient();
      const { data: patient } = await svc.from("patients").select("id").eq("hospital_id", hospital.id).eq("full_name", patientName).maybeSingle();
      expect(patient).not.toBeNull();

      const { data: tokens, error: tokenErr } = await svc
        .from("opd_tokens")
        .select("charged_tier, visit_type, visit_purpose, created_at")
        .eq("patient_id", patient!.id)
        .order("created_at", { ascending: true });
      expect(tokenErr).toBeNull();
      expect(tokens).toHaveLength(2);
      expect(tokens![0].charged_tier).toBe("new");
      expect(tokens![1].charged_tier).toBe("follow_up");

      const { data: bills, error: billErr } = await svc
        .from("bills")
        .select("total_amount, created_at")
        .eq("patient_id", patient!.id)
        .eq("bill_type", "opd")
        .order("created_at", { ascending: true });
      expect(billErr).toBeNull();
      expect(bills).toHaveLength(2);
      expect(Number(bills![0].total_amount)).toBe(500);
      // The fixed fixture rate (services()'s followUpFee) — hand-derivable per D6, and the
      // one assertion that would have failed silently (billed ₹500 again) had either the
      // visit_type drift or the missing fixture follow-up rate not been addressed.
      expect(Number(bills![1].total_amount)).toBe(200);
    });
  });
});
