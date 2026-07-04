// AI report narrative drafting.
// Lab AI features, Phase 16 — a pure drafting aid: the pathologist/technologist always
// reviews and edits the draft before it is saved or signed. Nothing here writes to the
// database or is ever printed without a human accepting it first (structurally: these
// functions only return a string; the caller decides whether/how to persist it).
import { callAI } from "@/lib/aiProvider";

/**
 * Draft a short interpretive comment for a lab report from its result panel.
 * Returns null on any AI failure — the caller falls back to leaving the comment blank
 * for manual entry, never to a partially-formed or misleading auto-comment.
 */
export async function draftLabInterpretiveComment(opts: {
  hospitalId: string;
  patientId: string;
  results: Array<{ test_name: string; result_value: string | null; result_flag: string | null; unit: string | null; reference_range: string | null }>;
}): Promise<string | null> {
  const withValues = opts.results.filter(r => r.result_value);
  if (withValues.length === 0) return null;

  const resultsText = withValues
    .map(r => `${r.test_name}: ${r.result_value} ${r.unit || ""} (Ref: ${r.reference_range || "N/A"}) ${r.result_flag && r.result_flag !== "N" ? `[${r.result_flag}]` : ""}`)
    .join("\n");

  const response = await callAI({
    featureKey: "lab_report_narrative",
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    prompt: `You are a clinical pathologist AI drafting a brief interpretive comment for a lab report,
for an Indian hospital. This is a DRAFT — the signing pathologist will edit it before release.

Results:
${resultsText}

Write a concise interpretive comment (2-4 sentences) summarising the clinically significant findings
and their likely relevance. If all values are normal, state that plainly. Do not repeat every value —
focus on abnormal/critical findings and their clinical correlation. Plain prose, no headings, no JSON.`,
    maxTokens: 250,
  });

  if (response.error || !response.text) return null;
  return response.text.trim();
}

/**
 * Draft a histopathology/cytology impression from the gross + microscopic description
 * already entered. Returns null on failure — the pathologist types their own impression.
 */
export async function draftHistopathImpression(opts: {
  hospitalId: string;
  patientId: string;
  caseType: string;
  specimenType: string | null;
  specimenSite: string | null;
  clinicalHistory: string | null;
  grossDescription: string;
  microscopicDescription: string;
}): Promise<string | null> {
  if (!opts.microscopicDescription?.trim()) return null;

  const response = await callAI({
    featureKey: "pathology_impression_draft",
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    prompt: `You are a pathologist AI drafting the IMPRESSION section of a ${opts.caseType} report for
an Indian hospital. This is a DRAFT — the signing pathologist will edit it before sign-off.

Specimen: ${opts.specimenType || "not specified"}${opts.specimenSite ? `, ${opts.specimenSite}` : ""}
Clinical history: ${opts.clinicalHistory || "not provided"}

Gross description:
${opts.grossDescription || "not entered"}

Microscopic description:
${opts.microscopicDescription}

Write a concise diagnostic impression (1-3 sentences) consistent with the gross and microscopic
findings above. Use standard pathology reporting language. Plain prose, no headings, no JSON.`,
    maxTokens: 250,
  });

  if (response.error || !response.text) return null;
  return response.text.trim();
}
