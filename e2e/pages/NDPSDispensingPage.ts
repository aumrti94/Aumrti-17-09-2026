/**
 * Phase 8 — NDPS dual sign-off (docs/testing/PHASED_TEST_PLAN.md §Phase 8, "NDPS dual
 * sign-off" / "second NDPS signatory absent" negative fork).
 *
 * Drives `src/pages/pharmacy/PharmacyPage.tsx` (defaults to mode="ip", tab="dispense" with no
 * query params — confirmed by reading the component's own useState initialisers) →
 * `PharmacyDispenseTab` → `PrescriptionQueue` (select) → `DispensingWorkspace` → per-drug
 * `FiveRightsPanel` → `NDPSDualSignoffModal`.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

const FIVE_RIGHTS_LABELS = ["Right PATIENT", "Right DRUG", "Right DOSE", "Right ROUTE", "Right TIME"];

export class NDPSDispensingPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/pharmacy");
    await recoverFromModuleLoadError(this.page);
  }

  async selectPrescription(patientName: string): Promise<void> {
    await this.page.getByRole("button", { name: new RegExp(patientName) }).first().click();
  }

  /**
   * Opens the drug row's 5-Rights panel. The checkbox trigger itself is icon-only (no
   * accessible name), so it's targeted by table column position rather than button index —
   * confirmed directly from the JSX column order: Drug Name(0), Prescribed(1), Dispense
   * Qty(2), Batch(3), MRP(4), Stock(5), 5-Rights(6), Status(7).
   */
  async openFiveRights(drugName: string): Promise<void> {
    const row = this.page.getByRole("row", { name: new RegExp(drugName) });
    await row.locator("td").nth(6).getByRole("button").click();
  }

  /**
   * Ticks all 5 right-cards by their fixed "Right {LABEL}" text — stable regardless of the
   * drug/patient's actual values, unlike matching on the values themselves (which would risk
   * colliding with the same patient name/drug name shown elsewhere on screen at the same time).
   * Then picks any pharmacist for the panel's own "2nd Pharmacist" dropdown — confirmed by
   * reading `FiveRightsPanel.tsx`/`compliance-checks.ts` directly that this specific value is
   * NOT the real dual-signoff control (that's `NDPSDualSignoffModal`, driven separately below);
   * it is stored to `ndps_second_pharmacist_id` and never reconciled with the real countersigner.
   */
  async confirmFiveRights(anyPharmacistName: string): Promise<void> {
    const { page } = this;
    for (const label of FIVE_RIGHTS_LABELS) {
      await page.getByRole("button", { name: new RegExp(label) }).click();
    }
    // The panel's own combobox is the last one in DOM order at this point (it renders after
    // the drugRows table, which has its own per-row Batch combobox already on screen).
    await page.getByRole("combobox").last().click();
    await page.getByRole("option", { name: new RegExp(anyPharmacistName) }).click();
    await page.getByRole("button", { name: /All 5 Rights Verified/ }).click();
  }

  async clickDispenseAll(): Promise<void> {
    await this.page.getByRole("button", { name: "Dispense All", exact: true }).click();
  }

  /** Step 1 of `NDPSDualSignoffModal` — the primary (currently logged-in) pharmacist. */
  async verifyPrimaryPharmacist(prescriberRegNo: string, ownPassword: string): Promise<void> {
    const { page } = this;
    await expect(page.getByText("NDPS Act — Mandatory Dual Sign-Off")).toBeVisible();
    await page.getByPlaceholder("Prescriber Registration No. (required)").fill(prescriberRegNo);
    await page.getByPlaceholder("Enter your password").fill(ownPassword);
    await page.getByRole("button", { name: "Verify & Alert Counter-Signer" }).click();
  }

  /**
   * Step 2 — asserts the primary pharmacist does NOT appear as their own counter-signer option
   * (the regression this whole page object exists to prove), then selects a genuinely different,
   * named counter-signer and completes the real password re-authentication.
   */
  async counterSignAs(counterSignerName: string, primaryPharmacistName: string, counterSignerPassword: string): Promise<void> {
    const { page } = this;
    await expect(page.getByText("Step 2 of 2 — Counter-Signer Approval")).toBeVisible();
    await page.getByRole("combobox").click();
    await expect(page.getByRole("option", { name: primaryPharmacistName })).not.toBeVisible();
    await page.getByRole("option", { name: new RegExp(counterSignerName) }).click();
    await page.getByRole("button", { name: "Counter-Sign Now" }).click();
    await page.getByPlaceholder("Enter counter-signer's password").fill(counterSignerPassword);
    await page.getByRole("button", { name: "Approve & Counter-Sign" }).click();
    // Not the "✓ Dispensed" toast itself — onDispensed() clears the selected prescription
    // (PharmacyDispenseTab.tsx) fast enough that the toast can come and go before a fixed
    // wait reliably catches it. The workspace returning to its empty state is a stable DOM
    // change instead of a transient toast, and the real assertion (ndps_register/
    // pharmacy_dispensing_items) happens against the database afterwards regardless.
    await expect(page.getByText("Select a prescription from the queue")).toBeVisible({ timeout: 10_000 });
  }
}
