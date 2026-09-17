/**
 * Phase 7 segment 4/9 — Orders (OT booking), built for J06. Drives
 * `src/pages/ot/OTPage.tsx` → `src/components/ot/BookOTModal.tsx`, a separate route from IPD
 * (`/ot`, not `/ipd`) — booking an OT slot is not one of the IPDWorkspace tabs.
 *
 * `ot_schedules.admission_id` is NOT set by this booking form at all (confirmed by reading
 * `BookOTModal.tsx`'s insert object directly — no `admission_id` key). Whatever resolves an OT
 * case back to its IPD admission for billing purposes does so some OTHER way; that is exactly
 * what the next segment (Charge posting) has to establish before it can be built.
 */
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { recoverFromModuleLoadError } from "./moduleRecovery";

export class OTPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto("/ot");
    await recoverFromModuleLoadError(this.page);
    await expect(this.page.getByRole("button", { name: "Book OT" })).toBeVisible();
  }

  async clickBookOT(): Promise<void> {
    await this.page.getByRole("button", { name: "Book OT" }).click();
    await expect(this.page.getByText("Schedule a surgical procedure")).toBeVisible();
  }

  async bookSlot(opts: {
    patientQuery: string;
    patientFullName: string;
    surgeryName: string;
    otRoomName: string;
    surgeonFullName: string; // WITHOUT the "Dr. " prefix the select adds
  }): Promise<void> {
    const { page } = this;

    await page.getByPlaceholder("Search by name or UHID…").fill(opts.patientQuery);
    await page.getByRole("button", { name: new RegExp(opts.patientFullName) }).first().click();

    await page.getByPlaceholder("e.g. Appendicectomy").fill(opts.surgeryName);
    // Case Type / Category / Anaesthesia Type are left at their defaults (elective/general/
    // general) — already correct for J06's elective appendicectomy, no interaction needed.
    await page.locator('div:has(> label:text-is("OT Room *"))').locator("select").selectOption({ label: opts.otRoomName });
    await page.locator('div:has(> label:text-is("Surgeon *"))').locator("select").selectOption({ label: `Dr. ${opts.surgeonFullName}` });

    await page.getByRole("button", { name: "📅 Confirm OT Booking" }).click();
    // The modal unmounts entirely on success (onBooked → setBookModalOpen(false)) — its own
    // absence is the real signal, not a success toast that might race the assertion.
    await expect(page.getByText("Schedule a surgical procedure")).not.toBeVisible();
  }

  /** Selects a booked case from the schedule panel — a plain `<div onClick>`, not a button. */
  async selectCase(surgeryName: string): Promise<void> {
    await this.page.getByText(surgeryName, { exact: true }).first().click();
  }

  /**
   * "Confirm Case" does not confirm directly on a fresh booking — `handleConfirmCase()` checks
   * `pac_cleared` first and opens an inline "Pre-Anaesthesia Check Required" banner instead
   * (confirmed live: clicking "Confirm Case" alone left the case on "scheduled" status and the
   * whole rest of the flow silently timed out waiting for "Start Case", which only renders once
   * status is "confirmed"). "Mark PAC Cleared & Confirm" is what actually transitions the case.
   */
  async confirmCase(): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "Confirm Case" }).click();
    await page.getByRole("button", { name: "Mark PAC Cleared & Confirm" }).click();
    await expect(page.getByRole("button", { name: "Start Case ▶" })).toBeVisible();
  }

  async startCase(): Promise<void> {
    await this.page.getByRole("button", { name: "Start Case ▶" }).click();
  }

  async goToTab(label: string): Promise<void> {
    await this.page.getByRole("button", { name: label, exact: true }).click();
  }

  /**
   * WHO Checklist gate, satisfied via the documented-exception path rather than ticking every
   * item across all three phases (Sign In/Time Out/Sign Out) — `handleEnd`'s own gate reads
   * one shared `ot_checklists.skip_reason` field, not per-phase completion, so one documented
   * reason satisfies the whole gate regardless of which phase's form was used. Only the SIGN IN
   * phase's button is actually clickable at this point (`renderPhase` hides Time Out/Sign
   * Out's version of it while `locked`), so the plain text match is unambiguous.
   */
  async skipWhoChecklist(reason: string): Promise<void> {
    await this.goToTab("WHO Checklist");
    await this.page.getByText("Cannot complete — document reason").click();
    await this.page.getByPlaceholder(/Required — e\.g\. life-threatening emergency/).fill(reason);
    await this.page.getByRole("button", { name: "Save exception reason" }).click();
    await expect(this.page.getByText("Documented exception")).toBeVisible();
  }

  /**
   * Anaesthesia consultant sign-off gate — required before a case can end. Save creates the
   * base record with its own sensible defaults (no fields need touching for this segment); the
   * sign-off itself needs an actual drawn stroke on the canvas, not just a click, since
   * `SignaturePad.onCapture` only fires (enabling "Sign & Lock") once a stroke was drawn.
   */
  async signAnaesthesiaRecord(): Promise<void> {
    const { page } = this;
    await this.goToTab("Anaesthesia");
    await page.getByRole("button", { name: "Save Anaesthesia Record" }).click();
    await expect(page.getByText("Save the anaesthesia record above before signing.")).not.toBeVisible();

    await page.getByRole("button", { name: "Sign as Consultant" }).click();
    const canvas = page.locator("canvas");
    await expect(canvas).toHaveCount(1);
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Signature canvas not found");
    // SignaturePad tracks strokes via onPointerMove while onPointerDown's own
    // setPointerCapture is active — a single down+move+up occasionally does not register a
    // stroke under CDP-driven synthetic pointer events (confirmed live: button stayed
    // disabled after one pass), so this draws several distinct strokes instead of one.
    for (let i = 0; i < 3; i++) {
      const y = box.y + 20 + i * 20;
      await page.mouse.move(box.x + 15, y);
      await page.mouse.down();
      for (let s = 1; s <= 8; s++) {
        await page.mouse.move(box.x + 15 + (box.width - 30) * (s / 8), y + (i % 2 === 0 ? 5 : -5));
      }
      await page.mouse.up();
    }

    await page.getByRole("button", { name: "Sign & Lock Anaesthesia Record" }).click();
    // Matched on the em dash + timestamp, not just "Signed by consultant" — the success TOAST
    // ("Anaesthesia record signed by consultant") contains that exact substring too, a strict-
    // mode violation confirmed live.
    await expect(page.getByText(/Signed by consultant —/)).toBeVisible();
  }

  /**
   * Ends the case: post-op diagnosis, outcome ("Completed Successfully" is already the
   * default), declares no implants used, then submits. Ending a case for an admitted patient
   * (admission_id set — KNOWN-BUG-205) triggers `EndCaseModal`'s own `triggerOTBilling()`
   * automatically, which is the REAL charge-posting mechanism for this journey — the manual
   * "Push OT Charges to IPD Bill" button in the Billing tab is a fallback/re-sync path, not
   * the primary one, confirmed by reading both functions directly.
   */
  async endCase(postOpDiagnosis: string): Promise<void> {
    const { page } = this;
    await page.getByRole("button", { name: "End Case ■" }).click();
    await expect(page.getByText("End Case", { exact: true })).toBeVisible();

    await page.getByPlaceholder("Final diagnosis after surgery").fill(postOpDiagnosis);
    // Case Outcome defaults to "Completed Successfully" — no interaction needed.
    await page.getByText("No", { exact: true }).click(); // "Were any implants...used?" → No
    await page.getByText("I confirm no implants or high-value consumables were used").click();

    await page.getByRole("button", { name: "✓ End Case & Close OT" }).click();
    await expect(page.getByText("End Case", { exact: true })).not.toBeVisible({ timeout: 10_000 });
  }
}
