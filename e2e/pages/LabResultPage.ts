/**
 * Phase 7.5 — Lab spine (docs/testing/PHASED_TEST_PLAN.md §Phase 7.5): "Order → sample → result
 * → verify → charge + NABH evidence row", plus the critical-value and TAT-breach dedupe forks.
 *
 * "Order" is NOT built here — reuse `OPDLabOrderPage` (Phase 7's own segment), which already
 * takes a prescribed test all the way to a real, paid `lab_orders` row via "Pending from OPD".
 * This page object picks up from there: sample collection → result entry → release.
 *
 * Drives `src/pages/lab/LabPage.tsx`'s "🔬 Worklist" tab (`LabQueuePanel` → `LabResultWorkspace`)
 * and "💉 Collection" tab (`CollectionWorkstation`) — confirmed by reading both directly.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class LabResultPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/lab");
    await recoverFromModuleLoadError(this.page);
  }

  async goToMainTab(label: string): Promise<void> {
    await this.page.getByRole("button", { name: label, exact: true }).click();
  }

  /**
   * Collection tab, "To Collect" sub-tab. Confirms the REAL two-identifier bedside check
   * (`PatientIdentityConfirmDialog`) rather than skipping it — this is a genuine NABH/patient
   * -safety step (wrong-patient samples are a sentinel event), not incidental UI.
   */
  async markSampleCollected(patientFullName: string): Promise<void> {
    const { page } = this;
    await this.goToMainTab("💉 Collection");
    await page.getByRole("button", { name: "⏳ To Collect", exact: true }).click();
    await page.getByRole("row", { name: new RegExp(patientFullName) }).getByRole("button", { name: "Collect", exact: true }).click();
    await expect(page.getByText("Verify Patient Identity")).toBeVisible();
    await page.getByText(/I have verified the patient's identity/).click();
    await page.getByRole("button", { name: "Confirm & Collect" }).click();
    await expect(page.getByText("Verify Patient Identity")).not.toBeVisible();
  }

  /**
   * Worklist tab — selects the order from the queue panel, opening `LabResultWorkspace`.
   * `distinguishingText`, when given, narrows to the one row containing it — needed the
   * moment a second order for the same patient is in the "All" queue at once (Phase 7.5's
   * Segments 2/3 seed a fresh order directly rather than re-registering a new patient per
   * fork, so an earlier segment's now-completed order stays listed alongside the new one).
   * `LabQueuePanel.tsx` derives its visible label as `LAB-{order.id.slice(0,8).toUpperCase()}`
   * from the order id directly — there is no stored barcode/accession column to match on.
   */
  async selectWorklistOrder(patientFullName: string, distinguishingText?: string): Promise<void> {
    await this.goToMainTab("🔬 Worklist");
    const candidates = this.page.getByRole("button", { name: new RegExp(patientFullName) });
    const target = distinguishingText ? candidates.filter({ hasText: distinguishingText }) : candidates.first();
    await target.click();
  }

  /** Derives the queue-row label `LabQueuePanel.tsx` shows for a given order id. */
  static queueLabel(orderId: string): string {
    return `LAB-${orderId.slice(0, 8).toUpperCase()}`;
  }

  /**
   * TAT tab — loads the overdue-order dashboard, which also fires the `lab_tat_overdue`
   * alert upsert (fire-and-forget, not awaited by `LabTATPanel.load()`) for any order overdue
   * by >2× its target TAT. Waits for the button's label to flip to "Refresh", which only
   * happens once `load()`'s synchronous state updates land.
   */
  async loadTatDashboard(): Promise<void> {
    await this.goToMainTab("⏱️ TAT");
    await this.page.getByRole("button", { name: "Load Dashboard", exact: true }).click();
    await expect(this.page.getByRole("button", { name: "Refresh", exact: true })).toBeVisible({ timeout: 10_000 });
  }

  /** Re-runs the same TAT scan — the dedupe fork's second trigger. */
  async refreshTatDashboard(): Promise<void> {
    const button = this.page.getByRole("button", { name: "Refresh", exact: true });
    await button.click();
    await expect(button).toBeEnabled({ timeout: 10_000 });
  }

  /**
   * Enters a NUMERIC result (the Tier-0 fixture's CBC test has `normal_min`/`normal_max` set,
   * so `LabResultWorkspace` renders a number input, not the qualitative Positive/Negative
   * select it would otherwise fall back to). Saves on blur — confirmed by reading
   * `onBlur={e => saveResult(item, e.target.value)}` directly, not a separate save action.
   * `.first()` rather than row-scoping by test name: this order carries exactly one
   * `lab_order_items` row (one seeded test), so exactly one such input exists on the page.
   */
  async enterResult(value: string): Promise<void> {
    const { page } = this;
    const input = page.locator('input[type="number"]').first();
    await input.fill(value);
    await input.blur();
  }

  /** The critical-value gate — required before release when the entered value flagged CH/CL. */
  async acknowledgeCriticalValue(): Promise<void> {
    const { page } = this;
    await expect(page.getByText("🚨 Critical Value")).toBeVisible({ timeout: 10_000 });
    await page.getByText("I have notified the treating doctor about this critical value").click();
    await page.getByRole("button", { name: "✓ Acknowledge & Continue" }).click();
  }

  /** Single-step release (the Tier-0 fixture's default — dual-validation is opt-in per hospital). */
  async validateAndRelease(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "✓ Validate & Release" }).click();
    await expect(page.getByText("✓ Report released", { exact: true })).toBeVisible({ timeout: 10_000 });
  }
}
