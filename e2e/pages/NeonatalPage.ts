/**
 * Phase 8B — Neonatal screening (docs/testing/PHASED_TEST_PLAN.md §8, PHASE_8_STATUS.md §4).
 * Drives `src/pages/specialty/NeonatalPage.tsx` + `src/components/specialty/NeonatalSheet.tsx`.
 *
 * None of this component's inputs are `htmlFor`/`id`-linked to their `<Label>` (no data-testid
 * anywhere in this repo either — established convention), so most locators scope to the section
 * container via its `<h3>` heading, then find the sibling `<label>`+`<input>` pair by exact text —
 * matching the "no accessible name, target by structure" pattern already used elsewhere in this
 * suite (see NDPSDispensingPage.ts's column-position targeting, MortuaryPage.ts's dialog scoping).
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

function section(page: Page, heading: string) {
  return page.locator(`div:has(> h3:text-is("${heading}"))`).first();
}

function fieldByLabel(scope: ReturnType<typeof section>, label: string) {
  return scope.locator(`div:has(> label:text-is("${label}")) input`);
}

export class NeonatalPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/specialty/neonatal");
    await recoverFromModuleLoadError(this.page);
  }

  /** The only `<select>` on the page until a patient is chosen and the sheet mounts. */
  async selectPatient(fullName: string, uhid: string): Promise<void> {
    await this.page.getByRole("combobox").first().selectOption({ label: `${fullName} · ${uhid}` });
  }

  async fillBirthDetails(opts: { dob: string; birthWeightG: number; gestationalAgeWeeks?: number }): Promise<void> {
    const s = section(this.page, "Birth Details");
    await fieldByLabel(s, "Date/Time of Birth").fill(opts.dob);
    await fieldByLabel(s, "Birth Weight (g)").fill(String(opts.birthWeightG));
    if (opts.gestationalAgeWeeks != null) {
      await fieldByLabel(s, "Gestational Age at Birth (weeks)").fill(String(opts.gestationalAgeWeeks));
    }
  }

  /** Fills the reading fields and clicks "+ Add" once — call twice with identical args for a dedupe check. */
  async addBilirubinReading(opts: { readingAt: string; valueMgDl: number }): Promise<void> {
    const s = section(this.page, "Bilirubin Tracker");
    await fieldByLabel(s, "Reading Date/Time").fill(opts.readingAt);
    await s.locator(`div:has(> label:text-is("Total Bilirubin (mg/dL)")) input`).fill(String(opts.valueMgDl));
    await s.getByRole("button", { name: "+ Add", exact: true }).click();
  }

  async setCchd(opts: { preSpo2: number; postSpo2: number; result: "pass" | "refer" | "not_done" }): Promise<void> {
    const s = section(this.page, "CCHD Screening (Pulse Oximetry)");
    await fieldByLabel(s, "Pre-ductal SpO2 (%)").fill(String(opts.preSpo2));
    await fieldByLabel(s, "Post-ductal SpO2 (%)").fill(String(opts.postSpo2));
    const label = opts.result === "not_done" ? "Not Done" : opts.result === "pass" ? "Pass" : "Refer";
    await s.getByRole("button", { name: label, exact: true }).click();
  }

  async expectRopEligible(expected: boolean): Promise<void> {
    const s = section(this.page, "ROP Screening (Retinopathy of Prematurity)");
    if (expected) {
      await expect(s.getByText("⚠️ ROP-eligible", { exact: false })).toBeVisible();
    } else {
      await expect(s.getByText("Not ROP-eligible based on", { exact: false })).toBeVisible();
    }
  }

  async getRopFirstScreenDueDate(): Promise<string> {
    const s = section(this.page, "ROP Screening (Retinopathy of Prematurity)");
    const text = await s.getByText("First screening due by:", { exact: false }).innerText();
    return text.replace("First screening due by:", "").trim();
  }

  async fillRopScreening(opts: { screeningDate: string; result: string; followupDueDate: string }): Promise<void> {
    const s = section(this.page, "ROP Screening (Retinopathy of Prematurity)");
    await s.getByRole("checkbox", { name: "Screening done" }).check();
    await s.locator(`div:has(> label:text-is("Screening Date")) input`).fill(opts.screeningDate);
    await s.locator("select").selectOption(opts.result);
    await s.locator(`div:has(> label:text-is("Follow-up Due")) input`).fill(opts.followupDueDate);
  }

  async save(): Promise<void> {
    await this.page.getByRole("button", { name: "Save Neonatal Record" }).click();
    await expect(this.page.getByText("Neonatal record saved")).toBeVisible({ timeout: 10_000 });
  }
}
