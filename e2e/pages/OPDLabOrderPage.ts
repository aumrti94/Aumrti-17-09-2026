/**
 * Phase 7 — J12 (OPD walk-in, cash, new visit), the Orders + Charge posting segment's lab half.
 * Drives `src/pages/lab/LabPage.tsx` → "⏳ Pending from OPD" tab (`PendingOpdLabTab.tsx`) →
 * `NewLabOrderModal.tsx`, opened pre-populated with the patient and the prescribed test names
 * (confirmed by reading `PendingOpdLabTab`'s `onCreateOrder` call and the modal's own
 * `preselectedPatient`/`preselectedTestNames` props) — so this flow never re-searches the
 * patient or re-adds the test, only confirms and collects.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class OPDLabOrderPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/lab");
    await recoverFromModuleLoadError(this.page);
    await this.page.getByRole("button", { name: "⏳ Pending from OPD" }).click();
    await expect(this.page.getByText("Pending Lab Orders")).toBeVisible();
  }

  /**
   * Opens `NewLabOrderModal` for the given patient's pending row, pre-populated. Each row is a
   * flat (non-nested) `div.border.border-border.rounded-lg.bg-card` sibling — that specific
   * class combination, scoped by `hasText`, picks exactly the one row for this patient rather
   * than every ancestor `div` a plain `:has()` would also match (the same class of strict-mode
   * trap documented in `IPDAdmissionPage.ts`'s own selector notes).
   */
  async createOrderFor(patientFullName: string): Promise<void> {
    const { page } = this;
    await page
      .locator("div.border-border.rounded-lg.bg-card", { hasText: patientFullName })
      .getByRole("button", { name: "Create Order" })
      .click();
  }

  async proceedToPayment(): Promise<void> {
    await this.page.getByRole("button", { name: "📋 Proceed to Payment →" }).click();
    await expect(this.page.getByText("Payment Mode")).toBeVisible();
  }

  /** Cash is the pre-selected default mode; this confirms and collects. */
  async collectAndCreateOrder(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: /^Collect ₹[\d,]+ & Create Order$/ }).click();
    await expect(page.getByText("Payment Collected!")).toBeVisible({ timeout: 10_000 });
  }

  async closeSuccess(): Promise<void> {
    await this.page.getByRole("button", { name: "Done" }).click();
  }
}
