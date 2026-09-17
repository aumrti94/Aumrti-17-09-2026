/**
 * Phase 7 — J12 (OPD walk-in, cash, new visit). Drives `src/pages/opd/OPDPage.tsx` →
 * `src/components/opd/WalkInModal.tsx` (default `mode="walk_in"`).
 *
 * Genuinely NEW screens, not shared with the IPD page objects (`IPDAdmissionPage.ts` etc.) —
 * confirmed by reading the source directly: OPD registration is a different component, on a
 * different route, with a different field set (no bed, no admitting doctor step, an inline
 * three-step wizard instead of a four-step one). The Phase 7 plan's own exit-gate language
 * ("J12 assembled with zero new segment code") does not hold literally here — OPD and IPD do
 * not share UI at the registration/consultation layer, only the conceptual segment shape
 * (Registration → Encounter → Orders → Charge posting) repeats.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class OPDRegistrationPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/opd");
    await recoverFromModuleLoadError(this.page);
    await expect(this.page.getByRole("button", { name: "+ Register Walk-in" })).toBeVisible();
  }

  async clickRegisterWalkIn(): Promise<void> {
    await this.page.getByRole("button", { name: "+ Register Walk-in" }).click();
    await expect(this.page.getByText("Quick Registration")).toBeVisible();
  }

  /**
   * Step 1 (details) — registers a brand-new patient (no search/select of an existing one,
   * matching J12's own name: "new visit"). `department`/`doctor` are required selects with no
   * id/htmlFor pairing to their label — same `div:has(label:...) select` pattern established
   * for IPD's admission wizard.
   */
  async fillNewPatientDetails(opts: { fullName: string; age: string; department: string; doctor: string }): Promise<void> {
    const { page } = this;
    await page.getByPlaceholder("Patient full name").fill(opts.fullName);
    await page.getByPlaceholder("Age").fill(opts.age);
    // Gender defaults to "male" — left as-is; not a fact this journey asserts on.
    await page.locator('div:has(> label:text-is("Department"))').locator("select").selectOption({ label: opts.department });
    await page.locator('div:has(> label:text-is("Doctor"))').locator("select").selectOption({ label: `Dr. ${opts.doctor}` });
    await page.getByText(/Patient consents to collection and processing/).click();
  }

  /**
   * Step 1 (details), the RETURNING-patient path — Phase 7.5, J13 (OPD follow-up). Searching
   * an existing patient auto-sets Visit Type to "revisit" the moment ANY prior token is found
   * (confirmed by reading `WalkInModal.tsx`'s search-result `onClick` directly) — this
   * deliberately overrides that with an explicit "Follow-up" pill + "Follow-Up" purpose, since
   * `computeConsultationFee` only takes the follow-up branch for `visitType === "followup" ||
   * visitPurpose === "follow_up"`, not for a bare "revisit".
   */
  async fillReturningPatientDetails(opts: {
    patientQuery: string;
    expectedFullName: string;
    department: string;
    doctor: string;
  }): Promise<void> {
    const { page } = this;
    // Scoped to the search field's own outer section (the div whose DIRECT child is the
    // "Search Patient..." label — the input itself sits one level deeper, in its own
    // `relative` wrapper, but the results dropdown renders as a SIBLING of that wrapper, one
    // level up, so the scope has to be this outer div, not the input's immediate parent).
    // Needed at all because the anchor visit's token (Segment 1's, still "waiting") sits in the
    // TokenQueue behind this modal with the SAME patient name in ITS OWN button's accessible
    // name — confirmed live, a page-wide getByRole matched that queue row instead of the
    // search-result button inside the modal, and then failed to click it (correctly blocked by
    // the modal backdrop).
    const searchSection = page.locator('div:has(> label:text-is("Search Patient (Name, Phone, or UHID)"))');
    await searchSection.getByPlaceholder("Search by name, phone, or UHID...").fill(opts.patientQuery);
    await searchSection.getByRole("button", { name: new RegExp(opts.expectedFullName) }).first().click();
    await expect(page.getByText("Patient selected")).toBeVisible();
    await page.locator('div:has(> label:text-is("Department"))').locator("select").selectOption({ label: opts.department });
    await page.locator('div:has(> label:text-is("Doctor"))').locator("select").selectOption({ label: `Dr. ${opts.doctor}` });
    await page.getByRole("button", { name: "Follow-up", exact: true }).click();
    await page.locator('div:has(> label:text-is("Visit Purpose"))').locator("select").selectOption({ label: "Follow-Up" });
  }

  /**
   * The same-day duplicate-billing guard fires because Segment 1's anchor visit is still
   * "waiting" (never taken through a consultation) — confirmed live. This is the modal's own
   * real recovery path, not a workaround: `handleProceedToPayment`'s own guard offers exactly
   * this choice to a genuine front desk.
   */
  async proceedPastSameDayWarning(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "Proceed to Payment →" }).click();
    await expect(page.getByText("Patient already in queue today")).toBeVisible();
    await page.getByRole("button", { name: "Register Anyway" }).click();
    await expect(page.getByText("Collect Consultation Fee")).toBeVisible();
  }

  async proceedToPayment(): Promise<void> {
    await this.page.getByRole("button", { name: "Proceed to Payment →" }).click();
    await expect(this.page.getByText("Collect Consultation Fee")).toBeVisible();
  }

  /** Step 2 (payment) — cash is the pre-selected default mode; this only confirms it and pays. */
  async payAndIssueToken(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: /^💳 Pay ₹[\d,]+ & Issue Token →$/ }).click();
    await expect(page.getByText("Token Issued Successfully")).toBeVisible({ timeout: 10_000 });
  }

  /** Step 3 (receipt) — reads the allocated token number back off the printed receipt. */
  async readIssuedToken(): Promise<string> {
    const text = await this.page.locator("#opd-receipt").getByText(/^[A-Z]+-\d+$/).innerText();
    return text.trim();
  }

  async closeReceipt(): Promise<void> {
    await this.page.getByRole("button", { name: "Done" }).click();
  }
}
