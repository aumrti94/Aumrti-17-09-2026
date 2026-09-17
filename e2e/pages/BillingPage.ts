/**
 * Phase 7 segment 6/9 — Billing, built for J06. Drives `src/pages/billing/BillingPage.tsx`
 * (via the `?action=new&admission_id=X&type=ipd` deep link `IPDOverviewTab.tsx` itself uses —
 * see the earlier segments' comments) → `BillEditor.tsx`, opened as a Dialog once the bill
 * resolves from the URL params.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class BillingPage {
  constructor(private readonly page: Page) {}

  /**
   * The exact deep link IPDOverviewTab's "View / Update IPD Bill" button navigates to. Waits on
   * the "Payments" tab trigger, not "Finalise Bill" — that button only renders while
   * `bill_status !== "final"` (confirmed live: Segment 8 reopens the SAME bill Segment 6 already
   * finalised, and the button is genuinely gone), so it is not a safe "the bill loaded" signal
   * for every caller of this method.
   */
  async openIpdBillFor(admissionId: string): Promise<void> {
    await this.page.goto(`/billing?action=new&admission_id=${admissionId}&type=ipd`);
    await recoverFromModuleLoadError(this.page);
    await expect(this.page.getByRole("tab", { name: "Payments" })).toBeVisible({ timeout: 10_000 });
  }

  async finalizeBill(): Promise<void> {
    await this.page.getByRole("button", { name: "Finalise Bill" }).click();
    // The button itself is conditional on bill_status !== "final" (confirmed by reading
    // BillEditor.tsx) — its own disappearance is the real signal the update committed.
    await expect(this.page.getByRole("button", { name: "Finalise Bill" })).not.toBeVisible({ timeout: 10_000 });
  }

  /**
   * Payments tab, `CollectPaymentForm` — collects the FULL outstanding balance in one cash
   * payment. This is what actually flips `bills.payment_status` to "paid", which is the only
   * thing `IPDOverviewTab`'s discharge-workflow billing sync ever checks (confirmed by reading
   * it directly) — no TPA insurance-coverage entry was made on this bill (Segment 7's claim
   * lives independently in `insurance_claims`, not against `bills.insurance_amount`), so the
   * full amount is genuinely owed as a direct collection for this journey's discharge gate.
   */
  async payFullBalance(): Promise<void> {
    const { page } = this;
    await page.getByRole("tab", { name: "Payments" }).click();
    // The amount input is pre-filled with the effective balance due by the component itself —
    // this only clicks Pay, it does not compute or re-enter the figure.
    await page.getByRole("button", { name: /^Pay ₹[\d,]+$/ }).click();
    await expect(page.getByText(/^Payment of ₹[\d,]+ collected ✓$/)).toBeVisible({ timeout: 10_000 });
  }
}
