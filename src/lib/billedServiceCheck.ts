/**
 * "Has this consumed service already been billed?" — one implementation.
 *
 * WHY THIS FILE EXISTS. Four surfaces asked that question and **three** of them answered it
 * differently:
 *
 *   * `LeakageScanner.tsx`          — `existingDescriptions.some(d => d.includes(testName))`
 *   * `PreDischargeLeakageBanner`   — exact match on a Set of lowercased descriptions
 *   * `UnbilledServicesModal`       — `source_dedupe_key` lookup (correct)
 *   * `daily-leakage-scan`          — `billing_status` / `bill_linked` flags
 *
 * Two implementations of one question that can disagree **is** the leakage risk — the whole
 * point of the scanners is to catch revenue that was missed, and a scanner that answers
 * "already billed" when it was not is a scanner that hides the thing it exists to find.
 *
 * DESCRIPTION MATCHING IS NOT A BILLING CHECK. It is wrong in four ways that all happen in a
 * normal week at a hospital, and every one of them is silent:
 *
 *   1. **Overlapping names.** Billing "Blood Sugar Fasting" makes a separate "Blood Sugar"
 *      order look billed under substring matching. The hospital is never paid for it.
 *   2. **The same drug twice.** One admission, two dispenses of Paracetamol. The second
 *      matches the first's description and is silently written off.
 *   3. **Edited master data.** A test renamed in `lab_test_master` after the order was placed
 *      no longer matches its own bill line — so it is re-offered, pre-selected, and the
 *      patient is billed twice.
 *   4. **Voided bills.** A line on a cancelled bill still carries its description, so the
 *      service reads as billed while the hospital holds no valid claim on it.
 *
 * `source_dedupe_key` has none of those failure modes: it is derived from the source record's
 * id, it is stable across renames, it is unique per dispense, and it is written by every
 * charge-posting path (`chargePosting.ts:90`). It is the only correct answer.
 */

/** The `bill_status` values that mean a line is NOT a live claim on the patient. */
export const VOIDED_BILL_STATUSES = new Set(["cancelled", "refunded"]);

/**
 * A candidate service to bill — a lab order item, a dispense line, a radiology order.
 * `dedupeKey` is its identity; `description` is for display only and is never compared.
 */
export interface BillableCandidate {
  dedupeKey: string;
  description: string;
  /** Anything the caller needs back untouched — the source row, a rate, a schedule. */
  [extra: string]: unknown;
}

/** A `bill_line_items` row, joined to its bill's status. */
export interface ChargedLine {
  source_dedupe_key?: string | null;
  /** `bills.bill_status`. Null when the caller did not join it — treated as live. */
  billStatus?: string | null;
}

export type UnbilledReason =
  /** No bill line carries this key at all. */
  | "never_billed"
  /** A line exists, but only on a cancelled or refunded bill. */
  | "prior_bill_voided";

export interface UnbilledService {
  candidate: BillableCandidate;
  reason: UnbilledReason;
}

export interface BilledServiceSplit {
  /** Genuinely unbilled — safe to offer. */
  unbilled: UnbilledService[];
  /** Already on a live bill. Must never be re-offered. */
  billed: BillableCandidate[];
}

/**
 * Canonical dedupe key. Matches `chargePosting.ts:90` — `${module}:${sourceId}` — with an
 * optional segment for sources that produce several lines (an OT case bills a theatre charge,
 * a surgeon fee, an anaesthesia fee and each implant separately).
 *
 * Constructing keys by hand at call sites is how `ipd:nursing:${id}` and `nursing:${id}` came
 * to both exist for the same charge.
 */
export function buildDedupeKey(module: string, sourceId: string, segment?: string): string {
  const base = `${module}:${sourceId}`;
  return segment ? `${base}:${segment}` : base;
}

/** True when a charged line sits on a bill that is no longer a claim on the patient. */
export function isVoidedLine(line: ChargedLine): boolean {
  const status = (line.billStatus ?? "").trim().toLowerCase();
  if (!status) return false; // not joined — assume live, the conservative read
  return VOIDED_BILL_STATUSES.has(status);
}

/**
 * Index charged lines by dedupe key, recording whether ANY live line carries that key.
 *
 * "Any live" rather than "the first": a service re-billed onto a fresh bill after the
 * original was cancelled has two lines, one voided and one live. It is billed.
 */
export function indexChargedKeys(lines: ChargedLine[] | null | undefined): {
  live: Set<string>;
  voidedOnly: Set<string>;
} {
  const live = new Set<string>();
  const seen = new Set<string>();

  for (const line of lines ?? []) {
    const key = line?.source_dedupe_key;
    if (!key) continue;
    seen.add(key);
    if (!isVoidedLine(line)) live.add(key);
  }

  const voidedOnly = new Set<string>();
  for (const key of seen) if (!live.has(key)) voidedOnly.add(key);

  return { live, voidedOnly };
}

/**
 * Split candidates into what still needs billing and what does not.
 *
 * A candidate whose only bill line sits on a cancelled or refunded bill comes back as
 * unbilled with reason `prior_bill_voided`. That is deliberate and it is the revenue-safe
 * direction — the hospital holds no valid claim, so the service genuinely is unbilled — but
 * a caller that auto-selects its results MUST NOT auto-select this reason, because the same
 * shape also occurs mid-correction while a biller is voiding and re-raising a bill.
 */
export function splitBilledServices(
  candidates: BillableCandidate[] | null | undefined,
  chargedLines: ChargedLine[] | null | undefined,
): BilledServiceSplit {
  const { live, voidedOnly } = indexChargedKeys(chargedLines);
  const unbilled: UnbilledService[] = [];
  const billed: BillableCandidate[] = [];

  for (const candidate of candidates ?? []) {
    if (!candidate?.dedupeKey) continue; // no identity — cannot be reasoned about
    if (live.has(candidate.dedupeKey)) {
      billed.push(candidate);
    } else {
      unbilled.push({
        candidate,
        reason: voidedOnly.has(candidate.dedupeKey) ? "prior_bill_voided" : "never_billed",
      });
    }
  }

  return { unbilled, billed };
}

/**
 * Candidates safe to pre-select in a UI that bills on confirm.
 *
 * Excludes `prior_bill_voided`. A pre-ticked checkbox is a decision made on the user's behalf,
 * and the one case where "unbilled" is ambiguous is exactly the one where it should not be.
 */
export function autoSelectable(split: BilledServiceSplit): BillableCandidate[] {
  return split.unbilled.filter((u) => u.reason === "never_billed").map((u) => u.candidate);
}
