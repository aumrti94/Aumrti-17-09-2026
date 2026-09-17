/**
 * Phase 7 segment 2/9 — Encounter (opening an admitted patient's IPD workspace) plus segment
 * 3 — Clinical documentation (the Notes tab). Built for J06.
 *
 * There is no separate "open encounter" action in this app — selecting an OCCUPIED bed on the
 * bed map IS opening the encounter (confirmed by reading `IPDPage.tsx`'s `handleBedSelect`:
 * an available bed opens AdmitPatientModal, anything else just sets `selectedBedId`, which
 * renders IPDWorkspace). Same route as IPDAdmissionPage (`/ipd`) — no separate open() needed
 * beyond a fresh navigation.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class IPDWorkspacePage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/ipd");
    await recoverFromModuleLoadError(this.page);
  }

  /**
   * Clicking an OCCUPIED bed opens the workspace directly — no modal, no extra step. Two things
   * confirmed live, not assumed: (1) not an `exact` match — an occupied bed's button also
   * renders the patient's initials, day count, and a payer badge in the same accessible name;
   * (2) the WardStats side panel ALSO lists "Bed: SW-01" inside its own per-admission row,
   * which is a second, entirely different `<button>` that a plain substring match on the bed
   * number matches too (strict-mode violation) — `.h-14` is BedMap's own per-bed button class
   * (WardStats rows use different classes entirely) and is what actually disambiguates them.
   */
  async openEncounter(bedNumber: string, expectedPatientName: string): Promise<void> {
    await this.page.locator("button.h-14", { hasText: bedNumber }).click();
    await expect(this.page.getByText(expectedPatientName, { exact: true }).first()).toBeVisible();
  }

  async goToTab(label: string): Promise<void> {
    await this.page.getByRole("tab", { name: label }).click();
  }

  /** Notes tab: add a free-text nursing/doctor note. Writes `ipd_nursing_notes`. */
  async addClinicalNote(text: string): Promise<void> {
    await this.goToTab("Notes");
    await this.page.getByRole("button", { name: "+ Add Note" }).click();
    await this.page.getByPlaceholder("Type your note...").fill(text);
    await this.page.getByRole("button", { name: "Save" }).click();
    // The form collapses back to the "+ Add Note" toggle once the insert resolves — the
    // fastest real signal that the save round-trip finished, short of re-querying the DB.
    await expect(this.page.getByRole("button", { name: "+ Add Note" })).toBeVisible();
  }

  /**
   * Segment 8/9 — Discharge. `admissions.discharge_ordered_at` (the flag every downstream
   * clearance sync checks — confirmed by reading `dischargeWorkflow.ts` and
   * `IPDOverviewTab.tsx` directly) is only ever set by this button. Our fixture patient has no
   * `patient_consents` row, so `consentStatus` resolves to "none" and the button's own onClick
   * genuinely calls `window.confirm(...)` before proceeding — confirmed live, not assumed — so a
   * dialog handler must be registered BEFORE the click or Playwright's default auto-dismiss
   * would cancel the discharge instead of confirming it.
   */
  async initiateDischarge(): Promise<void> {
    const { page } = this;
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "🏠 Initiate Discharge" }).click();
    // exact: true — the same live-region toast-duplicate pattern as every other toast assertion
    // in this journey.
    await expect(
      page.getByText("Discharge workflow initiated", { exact: true })
        .or(page.getByText("Discharge workflow already running", { exact: true })),
    ).toBeVisible({ timeout: 10_000 });
  }

  /** Overview tab, Doctor step of the discharge stepper. */
  async markMedicalClearance(): Promise<void> {
    await this.goToTab("Overview");
    await this.page.getByRole("button", { name: "Mark Medical Clearance" }).click();
    await expect(this.page.getByText("medical cleared marked", { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Overview tab, Pharmacist step. Hard-blocks only if a pending dispense exists (none does for
   * this fixture — no pharmacy order was ever placed in this journey), so this always succeeds.
   */
  async clearPharmacy(): Promise<void> {
    await this.goToTab("Overview");
    await this.page.getByRole("button", { name: "Clear Pharmacy" }).click();
    await expect(this.page.getByText("pharmacy cleared marked", { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  /** Discharge Summary step — types a manual summary (no AI credentials configured locally). */
  async writeDischargeSummary(text: string): Promise<void> {
    await this.goToTab("Overview");
    await this.page.getByPlaceholder("Type discharge summary here, or click 'Generate with AI' to auto-fill...").fill(text);
  }

  /**
   * The "Discharge without Signature" path — deliberately used over the e-signature path for
   * this journey segment: `signSummary()`'s own completeness-warning gate (no vitals in 24h,
   * overdue MAR doses, pending labs) is a real, separate journey fork worth its own test, not
   * incidental plumbing this segment needs to fight through; `directDischarge()` skips it by
   * design (confirmed by reading `DischargeSummaryGenerator.tsx` — only `signSummary` calls
   * `checkDischargeCompleteness()`) while still enforcing the same billing/LAMA gate.
   */
  async dischargeWithoutSignature(reason: string): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "Discharge without Signature" }).click();
    await expect(page.getByText("Discharge without Signature").last()).toBeVisible();
    await page.getByPlaceholder("Reason for discharging without a signature (required)").fill(reason);
    await page.getByRole("button", { name: "Confirm & Discharge" }).click();
    await expect(page.getByText("Patient discharged — summary not signed (reason recorded)")).toBeVisible({ timeout: 15_000 });
  }
}
