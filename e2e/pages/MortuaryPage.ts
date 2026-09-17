/**
 * Phase 8 — MCCD → mortuary release (docs/testing/PHASED_TEST_PLAN.md §Phase 8). Drives
 * `src/pages/mortuary/MortuaryPage.tsx`: Admit → MCCD → Release, plus the negative fork this
 * session's own migration `20261106000029_mlc_police_clearance_release_gate.sql` now enforces
 * server-side (previously client-side only — `handleRelease`'s own `if (mort?.is_mlc &&
 * !releaseForm.police_clearance)` check).
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class MortuaryPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/mortuary");
    await recoverFromModuleLoadError(this.page);
  }

  async goToTab(label: string): Promise<void> {
    await this.page.getByRole("tab", { name: label }).click();
  }

  async admitBody(opts: {
    patientQuery: string;
    timeOfDeath: string; // "YYYY-MM-DDTHH:mm", datetime-local format
    doctorName: string;
    causeOfDeath: string;
    isMlc?: boolean;
  }): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "+ Admit to Mortuary" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Admit to Mortuary" })).toBeVisible();

    await dialog.getByPlaceholder("Search by name or UHID…").fill(opts.patientQuery);
    await dialog.getByRole("button", { name: new RegExp(opts.patientQuery) }).first().click();

    await dialog.locator('input[type="datetime-local"]').fill(opts.timeOfDeath);

    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: new RegExp(opts.doctorName) }).click();

    await dialog.locator("textarea").first().fill(opts.causeOfDeath);

    if (opts.isMlc) {
      await dialog.getByRole("switch").first().click();
    }

    await dialog.getByRole("button", { name: "Admit" }).click();
    await expect(dialog).not.toBeVisible();
  }

  /** Selects the pending body from the MCCD tab's left list, opening the MCCD Form 4. */
  async selectPendingMccd(bodyLabel: string): Promise<void> {
    await this.page.getByText(bodyLabel, { exact: false }).first().click();
  }

  async saveMccd(opts: { cause1a: string; certifyingDoctorName: string }): Promise<void> {
    const { page } = this;
    await page.getByPlaceholder("Disease or condition directly leading to death").fill(opts.cause1a);
    // "Certifying Doctor" is the second combobox on this tab (Manner of death is the first).
    const comboboxes = page.getByRole("combobox");
    await comboboxes.nth(1).click();
    await page.getByRole("option", { name: new RegExp(opts.certifyingDoctorName) }).click();
    await page.getByRole("button", { name: "Generate MCCD Certificate" }).click();
  }

  async openReleaseModal(): Promise<void> {
    await this.page.getByRole("button", { name: "Release Body" }).click();
    await expect(this.page.getByRole("dialog").getByRole("heading", { name: "Release Body" })).toBeVisible();
  }

  /**
   * Fills the Release Body form. `policeClearance` left undefined leaves the switch at its
   * default (off) — the negative fork this page object exists to drive.
   */
  async fillReleaseForm(opts: {
    bodyLabel: string;
    releasedTo: string;
    relation: string;
    policeClearance?: boolean;
  }): Promise<void> {
    const { page } = this;
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: new RegExp(opts.bodyLabel) }).click();

    const textboxes = dialog.getByRole("textbox");
    await textboxes.nth(0).fill(opts.releasedTo);
    await textboxes.nth(1).fill(opts.relation);

    if (opts.policeClearance) {
      await dialog.getByRole("switch").first().click();
    }
  }

  async confirmRelease(): Promise<void> {
    await this.page.getByRole("dialog").getByRole("button", { name: "Confirm Release" }).click();
  }

  /** The client-side block — the release form's own pre-existing guard, unchanged by this pass. */
  async expectClientSideClearanceError(): Promise<void> {
    await expect(this.page.getByText("Police clearance is required for MLC cases")).toBeVisible();
  }

  /**
   * The client-side block leaves the Release Body modal open with the form still filled in
   * (handleRelease's toast.error path returns before setReleaseModal(false)) — this continues
   * in that same modal rather than re-navigating to the tab and reopening it.
   */
  async toggleClearanceOn(): Promise<void> {
    await this.page.getByRole("dialog").getByRole("switch").first().click();
  }
}
