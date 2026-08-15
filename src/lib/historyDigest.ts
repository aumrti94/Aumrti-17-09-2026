// ── Patient History Digest ──────────────────────────────────────────────────
//
// Shared types, loader and prompt formatter for the structured history built from
// the outside medical records a patient brings with them.
//
// The digest is produced server-side by supabase/functions/ai-history-digest and
// consumed in three places:
//   • PatientHistoryTimeline.tsx — the doctor reads it
//   • ConsultationWorkspace.tsx  — it feeds all three AI Guidance cards
//   • Discharge Summary / Pre-Auth (future) — same formatter, no new plumbing
//
// Keep the types here in step with the JSONB written by ai-history-digest. They
// are the contract between an edge function and the UI, and nothing type-checks
// across that boundary.

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// ── Cost model ──────────────────────────────────────────────────────────────
//
// Used for the pre-scan estimate the doctor confirms BEFORE any spend. Rupees per
// page, all-in (page extraction plus this bundle's share of the digest pass).
//
// These are ESTIMATES, and the job records actual_cost_inr next to
// estimated_cost_inr so the two can be compared (Kavitha). If actuals drift more
// than ~20% from these figures, fix the numbers here rather than quietly
// tolerating a confirm dialog that lies to the doctor.
//
// The ~25x gap is the whole reason the tier is a per-document choice: a typical
// bag is 300 printed lab pages that Fast reads perfectly, plus a dozen
// handwritten prescription pages that need Accurate. Choosing per document keeps
// that bag near ₹12 instead of ₹172.
export const TIER_COST_PER_PAGE_INR: Record<HistoryModelTier, number> = {
  fast: 0.02,
  accurate: 0.55,
};

export type HistoryModelTier = "fast" | "accurate";

export const TIER_LABELS: Record<HistoryModelTier, { label: string; hint: string }> = {
  fast: { label: "Fast", hint: "Typed and printed documents — lab reports, computer-printed prescriptions" },
  accurate: { label: "Accurate", hint: "Handwritten, faded, photocopied, or annotated in a regional script" },
};

/**
 * Rounded UP to the nearest rupee — never quote a doctor a figure below the real one.
 *
 * The toFixed(4) is not cosmetic. `100 * 0.55` is 55.00000000000001 in IEEE-754, so a bare
 * Math.ceil quotes ₹56 for an exact ₹55 — and does it at round numbers of pages, which is
 * precisely where someone would notice and stop trusting the estimate.
 */
export const estimateTierCost = (pages: number, tier: HistoryModelTier): number =>
  Math.ceil(Number((pages * TIER_COST_PER_PAGE_INR[tier]).toFixed(4)));

// ── Types (mirror the JSONB written by ai-history-digest) ───────────────────

export interface HistorySourceRef {
  source_id: string;
  source_name: string;
  page_from: number;
  page_to: number;
}

export interface HistoryEvent {
  id: string;
  date: string | null;
  date_confidence: "exact" | "approximate" | "unknown";
  type: string;
  facility: string | null;
  title: string;
  detail: string;
  values: Array<{ name: string; value: string; unit: string | null; ref: string | null }>;
  medications: Array<{ name: string; dose: string | null; frequency: string | null; duration: string | null }>;
  significance: "high" | "medium" | "low";
  red_flag: boolean;
  /** The transcribed line this came from. With the scan purged, this IS the evidence. */
  verbatim: string | null;
  source: HistorySourceRef;
  /** Other documents that recorded the same event, folded in during the merge. */
  also_in?: HistorySourceRef[];
}

export interface HistorySummary {
  one_liner: string;
  active_problems: Array<{ problem: string; since: string | null; note: string | null }>;
  current_medications: Array<{
    name: string; dose: string | null; frequency: string | null; since: string | null;
    certainty: "documented" | "likely" | "unclear";
  }>;
  past_medications: Array<{ name: string; stopped: string | null; why: string | null }>;
  allergies: Array<{ substance: string; reaction: string | null; source_date: string | null }>;
  surgeries: Array<{ procedure: string; date: string | null; facility: string | null }>;
  key_investigations: Array<{ name: string; value: string; date: string | null; trend: string | null }>;
  red_flags: string[];
  /** Where two documents disagree. Deliberately NOT resolved — the doctor asks the patient. */
  conflicts: Array<{ topic: string; versions: Array<{ value: string; date: string | null; source: string | null }> }>;
  gaps: string[];
}

export interface HistoryCoverage {
  documents_total: number;
  pages_total: number;
  pages_read: number;
  pages_unreadable: number;
  unreadable_refs: Array<{ source_name: string; page_from: number; page_to: number }>;
  events_truncated?: boolean;
}

export interface HistoryDigest {
  id: string;
  patient_id: string;
  job_id: string | null;
  version: number;
  model_used: string | null;
  timeline: HistoryEvent[];
  summary: HistorySummary;
  coverage: HistoryCoverage;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
}

export type HistoryJobStatus =
  | "uploading" | "queued" | "running" | "reducing"
  | "complete" | "partial" | "failed" | "cancelled";

export interface HistoryJob {
  id: string;
  status: HistoryJobStatus;
  documents_total: number;
  pages_total: number;
  pages_extracted: number;
  pages_failed: number;
  estimated_cost_inr: number | null;
  actual_cost_inr: number | null;
  error_name: string | null;
  created_at: string;
}

export const isJobRunning = (s: HistoryJobStatus | undefined): boolean =>
  s === "uploading" || s === "queued" || s === "running" || s === "reducing";

const EMPTY_SUMMARY: HistorySummary = {
  one_liner: "", active_problems: [], current_medications: [], past_medications: [],
  allergies: [], surgeries: [], key_investigations: [], red_flags: [], conflicts: [], gaps: [],
};

const EMPTY_COVERAGE: HistoryCoverage = {
  documents_total: 0, pages_total: 0, pages_read: 0, pages_unreadable: 0, unreadable_refs: [],
};

/** JSONB arrives as `unknown`; every consumer assumes the arrays exist. */
const normalise = (row: Record<string, any>): HistoryDigest => ({
  id: row.id,
  patient_id: row.patient_id,
  job_id: row.job_id ?? null,
  version: Number(row.version) || 1,
  model_used: row.model_used ?? null,
  timeline: Array.isArray(row.timeline) ? row.timeline : [],
  summary: { ...EMPTY_SUMMARY, ...(row.summary && typeof row.summary === "object" ? row.summary : {}) },
  coverage: { ...EMPTY_COVERAGE, ...(row.coverage && typeof row.coverage === "object" ? row.coverage : {}) },
  reviewed_by: row.reviewed_by ?? null,
  reviewed_at: row.reviewed_at ?? null,
  created_at: row.created_at,
});

// ── Ordering ────────────────────────────────────────────────────────────────

const SIGNIFICANCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

function cmpTiebreak(a: HistoryEvent, b: HistoryEvent): number {
  if (a.red_flag !== b.red_flag) return a.red_flag ? -1 : 1;
  const sa = SIGNIFICANCE_RANK[a.significance] ?? 1;
  const sb = SIGNIFICANCE_RANK[b.significance] ?? 1;
  if (sa !== sb) return sa - sb;
  return a.title.localeCompare(b.title);
}

/**
 * Canonical timeline ordering: newest first, undated last.
 *
 * TWIN of sortTimeline() in supabase/functions/ai-history-digest/index.ts — keep the two
 * in lockstep (same arrangement as azureMaxOutputTokens / src/lib/azureFoundry.ts). The
 * edge function sorts once at write time; this copy exists so the ordering rules are
 * unit-testable outside Deno, and so a digest written by an older function version still
 * renders correctly.
 *
 * WHY THIS IS CODE AND NOT A PROMPT INSTRUCTION: a model asked to sort 400 events quietly
 * drops some, and a dropped event is indistinguishable from one that was never extracted —
 * which is exactly the silent loss the coverage ledger exists to rule out.
 *
 * Undated events sort LAST rather than first: they cannot be placed on the timeline at all,
 * and giving them a position implies a chronology the records do not support.
 */
export function sortHistoryTimeline(events: HistoryEvent[]): HistoryEvent[] {
  return [...events].sort((a, b) => {
    if (!a.date && !b.date) return cmpTiebreak(a, b);
    if (!a.date) return 1;
    if (!b.date) return -1;
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return cmpTiebreak(a, b);
  });
}

// ── Loader ──────────────────────────────────────────────────────────────────

/**
 * The patient's current history digest, or null when nothing has been scanned.
 *
 * Deliberately NOT scoped to an encounter: the whole compounding value of the
 * feature is that a scan done at registration last year is still there today.
 */
export function useCurrentHistoryDigest(patientId: string | null | undefined) {
  const [digest, setDigest] = useState<HistoryDigest | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!patientId) { setDigest(null); return; }
    setLoading(true);
    const { data } = await (supabase as any)
      .from("patient_history_digests")
      .select("id, patient_id, job_id, version, model_used, timeline, summary, coverage, reviewed_by, reviewed_at, created_at")
      .eq("patient_id", patientId)
      .eq("is_current", true)
      .maybeSingle();
    setDigest(data ? normalise(data) : null);
    setLoading(false);
  }, [patientId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { digest, loading, refresh };
}

// ── Prompt formatting ───────────────────────────────────────────────────────

/**
 * Hard cap on the block handed to the AI Guidance cards.
 *
 * Small on purpose. This is CONTEXT, not the case — the differential must still
 * be driven by today's complaint, and a 6,000-character history would drown it.
 * It also lands in three prompts per consultation, so its size is multiplied by
 * three on every OPD patient's AI bill.
 */
export const DIGEST_PROMPT_MAX_CHARS = 1200;

/** How many dated events make it into the prompt. Recent history drives management. */
const PROMPT_EVENT_LIMIT = 8;

const UNVERIFIED_PREFIX =
  "Prior records (AI-extracted from patient-supplied outside documents; NOT hospital-verified — treat as a lead, not as fact)";
const VERIFIED_PREFIX =
  "Prior records (AI-extracted from patient-supplied outside documents; reviewed and accepted by a treating doctor)";

const fmtDate = (iso: string | null): string => {
  if (!iso) return "undated";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "undated" : d.toLocaleDateString("en-IN", { month: "short", year: "numeric" });
};

/**
 * Render a digest as one compact block for a clinical AI prompt.
 *
 * Returns undefined when there is nothing worth sending, so callers can leave the
 * field off entirely rather than paying tokens for "no prior records on file".
 *
 * The provenance prefix is NOT optional and is never dropped by the cap. A model
 * given an unverified, AI-extracted medication list with no such warning will
 * treat it as the hospital's own record — which for a handwritten prescription
 * transcribed by OCR is exactly the wrong confidence level.
 */
export function formatDigestForPrompt(
  digest: HistoryDigest | null | undefined,
  maxChars: number = DIGEST_PROMPT_MAX_CHARS,
): string | undefined {
  if (!digest) return undefined;

  const s = digest.summary;
  const lines: string[] = [];

  if (s.one_liner) lines.push(s.one_liner);

  if (s.allergies.length) {
    // Allergies first among the lists: it is the one item where getting it wrong
    // in the next five minutes can kill the patient.
    lines.push(`ALLERGIES: ${s.allergies.map((a) => a.substance + (a.reaction ? ` (${a.reaction})` : "")).join("; ")}`);
  }
  if (s.red_flags.length) lines.push(`Red flags: ${s.red_flags.join("; ")}`);
  if (s.active_problems.length) {
    lines.push(`Active problems: ${s.active_problems.map((p) => p.problem + (p.since ? ` (since ${fmtDate(p.since)})` : "")).join("; ")}`);
  }
  if (s.current_medications.length) {
    lines.push(`Current medications: ${s.current_medications
      .map((m) => [m.name, m.dose, m.frequency].filter(Boolean).join(" ") + (m.certainty !== "documented" ? ` [${m.certainty}]` : ""))
      .join("; ")}`);
  }
  if (s.surgeries.length) {
    lines.push(`Past surgery: ${s.surgeries.map((x) => x.procedure + (x.date ? ` (${fmtDate(x.date)})` : "")).join("; ")}`);
  }
  if (s.key_investigations.length) {
    lines.push(`Key results: ${s.key_investigations.slice(0, 6)
      .map((i) => `${i.name} ${i.value}${i.date ? ` (${fmtDate(i.date)})` : ""}`).join("; ")}`);
  }

  const dated = digest.timeline.filter((e) => !!e.date).slice(0, PROMPT_EVENT_LIMIT);
  if (dated.length) {
    lines.push(`Recent history: ${dated.map((e) => `${fmtDate(e.date)} — ${e.title}`).join("; ")}`);
  }

  // Conflicts matter more to a prescribing decision than a tidy list does: the model
  // must not pick a dose the records disagree about.
  if (s.conflicts.length) {
    lines.push(`Records disagree on: ${s.conflicts.slice(0, 3).map((c) => c.topic).join("; ")}`);
  }
  if (s.gaps.length) lines.push(`Not covered by these records: ${s.gaps.slice(0, 2).join("; ")}`);

  if (lines.length === 0) return undefined;

  // Coverage travels with the content. A summary built from 60% of the pages is a
  // different kind of evidence from one built from all of them, and the model has
  // no other way to know which it is holding.
  const cov = digest.coverage;
  const covNote = cov.pages_total > 0
    ? ` [${cov.pages_read}/${cov.pages_total} scanned pages readable]`
    : "";
  const prefix = `${digest.reviewed_at ? VERIFIED_PREFIX : UNVERIFIED_PREFIX}${covNote}:`;

  // Trim the BODY to fit, never the prefix — see the doc comment above.
  const budget = Math.max(maxChars - prefix.length - 1, 0);
  let body = lines.join("\n");
  if (body.length > budget) body = `${body.slice(0, Math.max(budget - 1, 0)).trimEnd()}…`;

  return `${prefix}\n${body}`;
}

/**
 * Digest-derived comorbidities, for merging into the `comorbidities` prop the
 * Clinical Guidance card already takes. Deduplicated case-insensitively against
 * the chronic conditions the hospital recorded itself, which the caller passes in.
 */
export function digestComorbidities(
  digest: HistoryDigest | null | undefined,
  existing: string[] = [],
): string[] {
  const seen = new Set(existing.map((c) => c.trim().toLowerCase()));
  const out = [...existing];
  for (const p of digest?.summary.active_problems ?? []) {
    const key = p.problem.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p.problem.trim());
  }
  return out;
}
