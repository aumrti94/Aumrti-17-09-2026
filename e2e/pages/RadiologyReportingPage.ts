/**
 * Phase 7.5 — Radiology spine, the schedule → perform → report → charge half. Picks up from a
 * real `radiology_orders` row (however it got there — the paid order modal, or a directly seeded
 * negative-fork precondition) and drives `RadiologyReportingWorkspace.tsx`'s status ladder
 * (`renderStatusAction()`: Start Study → Images Acquired → Begin Report) then the report form and
 * "Validate & Sign", which also fires the at-signoff auto-bill for any order not already billed.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class RadiologyReportingPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/radiology");
    await recoverFromModuleLoadError(this.page);
  }

  /**
   * Worklist — selects the order, opening `RadiologyReportingWorkspace`. `distinguishingText`
   * narrows to one row the moment a second order for the same patient is in the list at once
   * (the same `RAD-{id8}` label `RadiologyWorklist.tsx` derives from the order id, mirroring
   * Lab's `LabResultPage.queueLabel`).
   */
  async selectWorklistOrder(patientFullName: string, distinguishingText?: string): Promise<void> {
    const { page } = this;
    const candidates = page.getByRole("button", { name: new RegExp(patientFullName) });
    const target = distinguishingText ? candidates.filter({ hasText: distinguishingText }) : candidates.first();
    await target.click();
  }

  static queueLabel(orderId: string): string {
    return `RAD-${orderId.slice(0, 8).toUpperCase()}`;
  }

  async startStudy(): Promise<void> {
    await this.page.getByRole("button", { name: "Start Study" }).click();
  }

  async markImagesAcquired(): Promise<void> {
    await this.page.getByRole("button", { name: "Images Acquired" }).click();
  }

  async beginReport(): Promise<void> {
    await this.page.getByRole("button", { name: "Begin Report" }).click();
  }

  /**
   * `modality_type: "other"` (the Tier-0 fixture's study) matches no entry in
   * `FINDINGS_PLACEHOLDERS`/`TECHNIQUE_PLACEHOLDERS`, so both fall back to their
   * modality-independent defaults — confirmed by reading the maps directly rather than
   * guessing at per-modality placeholder text.
   */
  async fillReport(findings: string, impression: string): Promise<void> {
    const { page } = this;
    await page.getByPlaceholder("Enter findings...").fill(findings);
    await page.getByPlaceholder("Write your clinical impression here...").fill(impression);
  }

  async validateAndSign(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "Validate & Sign" }).click();
    await expect(page.getByText("Report signed ✓", { exact: true })).toBeVisible({ timeout: 10_000 });
  }
}
