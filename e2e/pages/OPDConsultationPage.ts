/**
 * Phase 7 — J12 (OPD walk-in, cash, new visit), Encounter + Clinical documentation + Orders
 * segments. Drives `src/components/opd/ConsultationWorkspace.tsx`, opened by selecting a token
 * from `TokenQueue.tsx` on the same `/opd` page `OPDRegistrationPage` already sits on — no
 * separate navigation, matching IPD's own "selecting an occupied bed opens the workspace"
 * precedent (`IPDWorkspacePage.openEncounter`).
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class OPDConsultationPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/opd");
    await recoverFromModuleLoadError(this.page);
  }

  async selectToken(patientFullName: string): Promise<void> {
    await this.page.getByRole("button", { name: new RegExp(patientFullName) }).click();
  }

  async startConsultation(): Promise<void> {
    await this.page.getByRole("button", { name: "▶ Start Consultation" }).click();
  }

  async goToTab(label: string): Promise<void> {
    await this.page.getByRole("button", { name: label, exact: true }).click();
  }

  /** Complaint tab — the one field `handleComplete`'s own gate actually requires. */
  async fillChiefComplaint(text: string): Promise<void> {
    await this.goToTab("Complaint");
    await this.page.getByPlaceholder("Patient's main complaint in their own words...").fill(text);
  }

  /**
   * Rx & Orders tab — adds a lab test by exact name via the typeahead, pressing Enter to
   * commit it as a chip. Requires a real `lab_test_master` row (the Tier-0 fixture's
   * "Complete Blood Count") — confirmed by reading `RxOrdersTab.tsx`: this typeahead reads
   * `lab_test_master`, a table entirely separate from `service_master`.
   */
  async addLabOrder(testName: string): Promise<void> {
    const { page } = this;
    await this.goToTab("Rx & Orders");
    const input = page.getByPlaceholder("Search test name...");
    await input.fill(testName);
    await expect(page.getByRole("button", { name: testName, exact: true })).toBeVisible();
    await input.press("Enter");
    // The chip rendering (not a toast) is the real "the order is queued" signal here — nothing
    // is billed or persisted as a row yet (see finalizeConsultation's own comment: payment-first,
    // order second), so there is no DB row to assert against until the lab side runs.
    await expect(page.getByText(testName, { exact: true }).first()).toBeVisible();
  }

  /**
   * Rx & Orders tab — the shared "search, pick, fill dose/days, submit" steps every drug-add
   * goes through, regardless of what `performSafetyCheck` decides afterward. Route ("Oral")
   * and frequency ("OD") are left at their real defaults.
   */
  private async searchAndSubmitDrug(drugName: string, dose: string, days: string): Promise<void> {
    const { page } = this;
    await this.goToTab("Rx & Orders");
    // The leading "+" is a lucide <Plus> icon, not literal text, so the accessible name is
    // plain "Add Drug" — confirmed live (a first attempt at "+ Add Drug" timed out).
    await page.getByRole("button", { name: "Add Drug", exact: true }).click();
    await page.getByPlaceholder("Search drug name...").fill(drugName);
    await page.getByRole("button", { name: new RegExp(drugName) }).first().click();
    await page.getByPlaceholder("Dose").fill(dose);
    await page.getByPlaceholder("Days").fill(days);
    await page.getByRole("button", { name: "Add to Prescription" }).click();
  }

  /**
   * Prescribes a drug with no safety issue. Asserts it lands directly on the prescription with
   * NO `DrugSafetyAlertModal` — the real, deterministic `checkDrugSafety` gate this app runs at
   * PRESCRIBING time (confirmed by reading `RxOrdersTab.performSafetyCheck` directly — it
   * calls the same local, DB-backed function `drugSafetyCheck.ts` exports, not an AI call).
   */
  async prescribeSafeDrug(drugName: string, dose: string, days: string): Promise<void> {
    const { page } = this;
    await this.searchAndSubmitDrug(drugName, dose, days);
    await expect(page.getByText("🚫 CONTRAINDICATION DETECTED")).not.toBeVisible();
    await expect(page.getByText(drugName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Prescribes an antibiotic that has a CROSS-REACTIVITY conflict with a documented allergy
   * (`drug_allergy_cross_reactivity.risk_level: "high"`, which `SEVERITY_RANK` maps to
   * "major" — confirmed live, NOT "contraindicated": only a DIRECT allergen match gets that).
   * Two real, required gates in sequence, not a workaround:
   *
   * 1. Antibiotic Stewardship — fires for ANY antibiotic by name, before the safety check even
   *    runs. This is the regression subject for KNOWN-BUG-212 (see KNOWN_BUGS.md):
   *    `onSaved`'s own re-invocation of `performSafetyCheck` used to run in the same tick as
   *    `setAntibioticJustified(true)`, so the stale closure re-opened this identical modal
   *    every time — no antibiotic could ever actually be prescribed through this screen, for
   *    any patient, ever.
   * 2. The MAJOR interaction modal — a plain, UNAUDITED "Add Anyway" (confirmed live:
   *    `handleSafetyAddAnyway` writes no `clinical_alerts` row at all). This is deliberately a
   *    softer gate than the contraindicated path below.
   */
  async prescribeMajorInteractionDrugAndAddAnyway(drugName: string, dose: string, days: string, clinicalIndication: string): Promise<void> {
    const { page } = this;
    await this.searchAndSubmitDrug(drugName, dose, days);

    await expect(page.getByText("Antibiotic Stewardship")).toBeVisible({ timeout: 10_000 });
    await page.getByPlaceholder(/Community-acquired pneumonia/).fill(clinicalIndication);
    await page.getByRole("button", { name: "Save Justification" }).click();

    await expect(page.getByText("⚠️ MAJOR DRUG INTERACTION")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "✓ Add Anyway" }).click();
    await expect(page.getByText("⚠️ MAJOR DRUG INTERACTION")).not.toBeVisible();
    await expect(page.getByText(drugName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Prescribes a drug that DIRECTLY matches a documented allergy (the drug's own resolved
   * alias equals the allergen itself — not a cross-reactivity relative). `checkDrugSafety`
   * hardcodes this to `severity: "contraindicated"` regardless of any reference table's own
   * risk_level, and `checkDrugSafety` genuinely BLOCKS here: the primary action on a
   * contraindicated result is "✗ Remove {drug} — Do Not Add", not an add button. This method
   * instead drives the modal's own explicit, AUDITED override path (a required written reason
   * + an explicit risk-acknowledgement checkbox) — `RxOrdersTab.handleSafetyOverride` writes a
   * real `clinical_alerts` row carrying `patient_id`, `created_by` and the reason text
   * (BUG-P4-004's fix — an earlier version of this override wrote the row with neither, an
   * anonymous, unattributable note). THIS is the plan's "documented allergy blocks X; override
   * is audited" fork — the major/cross-reactivity path above is not.
   */
  async prescribeContraindicatedDrugWithOverride(drugName: string, dose: string, days: string, overrideReason: string): Promise<void> {
    const { page } = this;
    await this.searchAndSubmitDrug(drugName, dose, days);

    await expect(page.getByText("🚫 CONTRAINDICATION DETECTED")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: "Override with clinical justification..." }).click();
    await page.getByPlaceholder("Clinical justification for overriding this alert...").fill(overrideReason);
    await page.getByText("I confirm I am aware of the risk and take clinical responsibility for this decision").click();
    await page.getByRole("button", { name: "Override and Add Drug" }).click();
    await expect(page.getByText("🚫 CONTRAINDICATION DETECTED")).not.toBeVisible();
    await expect(page.getByText(drugName, { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Completes the consultation. This deliberately creates NO lab_orders row and posts NO
   * charge for the lab test just added — confirmed by reading `finalizeConsultation`'s own
   * comment: the prescription JSON is the handoff, and Lab's "Pending from OPD" tab is where
   * the order is actually created AND paid, in one step, via `NewLabOrderModal`.
   */
  async completeConsultation(patientFullName: string): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "✓ Complete" }).click();
    await expect(page.getByText(`Consultation complete for ${patientFullName}`, { exact: true })).toBeVisible({ timeout: 10_000 });
  }
}
