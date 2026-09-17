/**
 * Phase 7 segment 1/9 — Registration/Admission, built for J06 (IPD elective surgical,
 * TPA-insured). Drives `src/pages/ipd/IPDPage.tsx` → `src/components/ipd/AdmitPatientModal.tsx`.
 *
 * NO data-testid, NO aria-label, and department/doctor <select>s have NO id/htmlFor pairing
 * with their <label> anywhere in this component (confirmed by reading the source directly,
 * not assumed) — every locator here keys off real visible text instead. The
 * `div:has(label:text-is("X")) select` pattern is the one this whole segment relies on; keep
 * using it for future segments rather than inventing a different strategy per screen.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class IPDAdmissionPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/ipd");
    await recoverFromModuleLoadError(this.page);
    // BedMap's own empty/loading states settle once at least one ward/bed exists; this is the
    // real "the board is ready" signal, not a fixed wait.
    await expect(this.page.getByRole("button", { name: "+ New Admission" })).toBeVisible();
  }

  /** Opens AdmitPatientModal with no bed preselected — step 2 requires an explicit bed pick. */
  async clickNewAdmission(): Promise<void> {
    await this.page.getByRole("button", { name: "+ New Admission" }).click();
  }

  /**
   * Opens AdmitPatientModal with `bedNumber` preselected (skips the "Select Bed" dropdown in
   * step 2 entirely). `exact: true` matters — bed buttons render only the bare bed_number
   * ("SW-01"), but Playwright's default substring match on button role names is loose enough
   * that "SW-1" would still match "SW-01" partially.
   */
  async clickAvailableBed(bedNumber: string): Promise<void> {
    await this.page.getByRole("button", { name: bedNumber, exact: true }).click();
  }

  /** Step 1: search for an existing patient by name/phone/UHID and select the first result. */
  async searchAndSelectPatient(query: string, expectedFullName: string): Promise<void> {
    await this.page.getByPlaceholder("Search by name, phone, or UHID...").fill(query);
    // Result rows render full_name as a <p>, not the button's own accessible name directly —
    // but the button's accessible name is built from its full text content, which includes it.
    await this.page.getByRole("button", { name: new RegExp(expectedFullName) }).first().click();
    await expect(this.page.getByText("✓ Patient selected")).toBeVisible();
  }

  async goToStep2(): Promise<void> {
    await this.page.getByRole("button", { name: "Next →" }).click();
  }

  /**
   * Step 2 — the admission-details screen. `bedAlreadyPreselected` controls whether the
   * "Select Bed *" dropdown is even present (AdmitPatientModal renders a plain label + span
   * instead when a bed was preselected via `clickAvailableBed`).
   */
  async fillAdmissionDetails(opts: {
    // Optional on purpose: selecting a department client-side filters the doctor dropdown to
    // doctors whose department_id matches it, and the Tier-0 seed does not set department_id
    // on any staff row — picking one here would filter every seeded doctor out of the list.
    department?: string;
    doctor: string;
    diagnosis: string;
    // The "Insurance" pill row — sets admissions.insurance_type. Distinct from payerType below,
    // and NOT cosmetic: `ClaimsToSubmit.tsx`'s own eligibility query filters
    // `admissions.insurance_type != 'self_pay'` — leaving this at its "self_pay" default (as an
    // earlier version of this method did) makes the bill permanently invisible to the Claim
    // segment, discovered only once that segment was actually built and run.
    insuranceType: "Private Insurance" | "PMJAY / Ayushman" | "CGHS" | "ECHS" | "ESI / ESIS" | "Corporate / TPA" | "State Scheme" | "Other";
    payerType: "cash" | "tpa" | "pmjay" | "cghs" | "esi" | "corporate" | "credit" | "state_scheme" | "other";
    payerName?: string; // required when payerType !== "cash" and a matching payer_masters row exists
    bedAlreadyPreselected: boolean;
    bedLabel?: string; // "<Ward Name> — <bed number>", required when bedAlreadyPreselected is false
  }): Promise<void> {
    const { page } = this;

    if (opts.department) {
      await page.locator('div:has(> label:text-is("Department"))').locator("select").selectOption({ label: opts.department });
    }
    await page.locator('div:has(> label:text-is("Admitting Doctor *"))').locator("select").selectOption({ label: opts.doctor });
    await page.getByPlaceholder("Admitting diagnosis...").fill(opts.diagnosis);

    if (!opts.bedAlreadyPreselected) {
      if (!opts.bedLabel) throw new Error("bedLabel is required when bedAlreadyPreselected is false");
      await page.locator('div:has(> label:text-is("Select Bed *"))').locator("select")
        .selectOption({ label: new RegExp(opts.bedLabel) });
    }

    await page.locator('div:has(> label:text-is("Insurance"))').getByRole("button", { name: opts.insuranceType, exact: true }).click();

    // "Billing Payer" is the tariff-relevant payer select — a SEPARATE column from the
    // "Insurance" pill above, used for tariff/rate resolution rather than claim eligibility.
    await page.locator('div:has(> label:text-is("Billing Payer"))').locator("select").first().selectOption(opts.payerType);
    if (opts.payerType !== "cash" && opts.payerName) {
      await page.locator('div:has(> label:text-is("Billing Payer"))').locator("select").nth(1)
        .selectOption({ label: opts.payerName });
    }

    // Mandatory gate — Next stays disabled without it (disabled={!doctorId || !bedId ||
    // !allergyVerified} in the source). Ticking it is the real assertion this segment makes
    // about the admission flow, not incidental.
    await page.getByText("I have verified the patient's allergy status").click();
  }

  /**
   * Phase 8B — the MLC section, at the bottom of step 2. `policeActuallyInformed` drives the
   * separate confirmation checkbox added alongside KNOWN-BUG-237's fix: `police_informed_at` is
   * now only stamped when this is ticked, not unconditionally the moment "MLC" itself is ticked.
   */
  async setMlc(opts: { policeStation?: string; policeActuallyInformed?: boolean }): Promise<void> {
    const { page } = this;
    await page.getByText("Medico-Legal Case (MLC)", { exact: true }).click();
    if (opts.policeStation) {
      await page.getByPlaceholder("Police station name").fill(opts.policeStation);
    }
    if (opts.policeActuallyInformed) {
      await page.getByText("Police have actually been informed", { exact: false }).click();
    }
  }

  async goToStep3(): Promise<void> {
    await this.page.getByRole("button", { name: "Next →" }).click();
  }

  /** Step 3 — estimate. No field here is required to advance; amounts are optional. */
  async goToStep4(): Promise<void> {
    await this.page.getByRole("button", { name: "Next →" }).click();
  }

  /** Step 4 — confirm screen. Submits and waits for the success state. */
  async confirmAdmission(patientFullName: string): Promise<void> {
    await this.page.getByRole("button", { name: "✓ Confirm Admission" }).click();
    await expect(this.page.getByText(`${patientFullName} successfully admitted`)).toBeVisible({ timeout: 10_000 });
  }

  /**
   * "Close" is ambiguous by itself — Radix's own DialogContent renders an X icon-button whose
   * accessible name is also "Close" (confirmed live: a `div:has(...)` container scope still
   * matched both, since DialogContent is a shared ancestor of the real button AND the X). The
   * X button's own literal class always includes "absolute" (`className="absolute right-4
   * top-4 ..."` in shadcn's DialogContent); excluding by that class is what actually
   * disambiguates it, not container nesting.
   */
  async closeSuccessDialog(): Promise<void> {
    await this.page.locator('button:text-is("Close"):not(.absolute)').click();
  }
}
