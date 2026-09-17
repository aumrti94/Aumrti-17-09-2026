/**
 * Phase 7.5 — Radiology spine (docs/testing/PHASED_TEST_PLAN.md §Phase 7.5): "order → schedule
 * → perform → report → charge", plus the fee-lookup-never-₹0 fork.
 *
 * Drives `src/pages/radiology/RadiologyPage.tsx`'s "📡 Worklist" tab → `NewRadiologyOrderModal`,
 * opened standalone (no preselected patient) via "+ New Radiology Order" — unlike Lab's
 * equivalent order modal, this one has its own built-in patient search and is not reached only
 * through a "Pending from OPD" pre-population, confirmed by reading both files directly.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class RadiologyOrderPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/radiology");
    await recoverFromModuleLoadError(this.page);
  }

  async openNewOrderModal(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "+ New Radiology Order" }).click();
    await expect(page.getByRole("heading", { name: "New Radiology Order" })).toBeVisible();
  }

  /** The modal's own patient search — debounced 300ms, confirmed by reading the source. */
  async searchAndSelectPatient(patientQuery: string): Promise<void> {
    const { page } = this;
    await page.getByPlaceholder("Search by name, UHID, phone...").fill(patientQuery);
    await page.getByRole("button", { name: new RegExp(patientQuery) }).first().click();
  }

  /**
   * Study buttons render `{study_name}{fee > 0 && <span>₹{fee}</span>}` — the accessible name
   * carries the fee suffix, so this matches a prefix rather than the exact label.
   */
  async selectStudy(studyName: string): Promise<void> {
    await this.page.getByRole("button", { name: new RegExp(`^${studyName}`) }).click();
  }

  async proceedToPayment(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "📋 Proceed to Payment →" }).click();
    await expect(page.getByRole("heading", { name: "Collect Payment" })).toBeVisible();
  }

  /** Cash is the pre-selected default mode; this confirms and collects, whatever the total is. */
  async collectAndCreateOrder(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: /^Collect ₹[\d,]+ & Create Order$/ }).click();
    await expect(page.getByText("Payment Collected!")).toBeVisible({ timeout: 10_000 });
  }

  async closeSuccess(): Promise<void> {
    await this.page.getByRole("button", { name: "Done" }).click();
  }
}
