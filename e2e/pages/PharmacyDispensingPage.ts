/**
 * Phase 7.5 — Pharmacy spine, the dispensing half. Drives `src/pages/pharmacy/PharmacyPage.tsx`
 * in Retail Counter mode (`/pharmacy?mode=retail` → `src/components/pharmacy/retail/RetailPOS.tsx`),
 * NOT the "IP Dispensing" tab (`DispensingWorkspace.tsx`) — confirmed by reading both directly:
 * `DispensingWorkspace`'s own charge-posting block is hard-gated
 * `if (prescription.admission_id && chargeItems.length > 0)`, so an OPD-originated (non-admitted)
 * prescription dispensed there posts NO charge at all. Retail Counter is the real path an OPD
 * prescription reaches a paid bill through — it auto-loads "today's signed OPD prescription" for
 * the selected patient (`RetailPOS.loadPrescriptionForPatient`) and posts its own
 * `bills`/`bill_line_items` on checkout.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class PharmacyDispensingPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/pharmacy?mode=retail");
    await recoverFromModuleLoadError(this.page);
    await expect(this.page.getByPlaceholder("Search by name")).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Selecting the patient is what triggers `loadPrescriptionForPatient` — there is no separate
   * "load prescription" action. Waits on the toast naming how many drugs loaded, not a fixed
   * delay: this is a real async round trip (drug_master lookup + drug_batches lookup per line).
   */
  async selectPatientAndLoadPrescription(patientQuery: string, expectedDrugCount: number): Promise<void> {
    const { page } = this;
    await page.getByPlaceholder("Search by name").fill(patientQuery);
    await page.getByRole("button", { name: new RegExp(patientQuery) }).first().click();
    await expect(page.getByText(`✓ ${expectedDrugCount} drugs loaded from prescription`, { exact: true })).toBeVisible({ timeout: 10_000 });
  }

  /** Cash is the default payment mode; "Exact ₹N" fills the precise amount owed. */
  async checkout(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: /^Exact ₹\d+$/ }).click();
    await page.getByRole("button", { name: /^✓ Complete Sale — ₹\d+$/ }).click();
    await expect(page.getByText("Sale Complete!")).toBeVisible({ timeout: 10_000 });
  }

  /** "New Sale" resets the POS to a blank cart, ready to select a patient again. */
  async startNewSale(): Promise<void> {
    await this.page.getByRole("button", { name: "New Sale" }).click();
  }
}
