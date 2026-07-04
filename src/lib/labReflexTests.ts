// AI reflex-testing suggestions.
// Lab AI features, Phase 14 — genuinely LLM-suited: recommending the clinically
// correct follow-on test from an abnormal result pattern (abnormal TSH → free T4,
// microcytic anaemia → iron studies, positive ANA → ENA panel) is exactly the kind of
// pattern-matching an LLM is good at, and — unlike auto-verification or mix-up gating —
// nothing here is safety-critical or release-blocking: it only ever proposes an
// additional test for a human to order or dismiss. Purely advisory, non-blocking.
import { callAI } from "@/lib/aiProvider";

export interface ReflexSuggestion {
  suggested_test: string;
  trigger_finding: string;
  rationale: string;
  urgency: "routine" | "priority";
}

export async function suggestReflexTests(opts: {
  hospitalId: string;
  patientId: string;
  abnormalResults: Array<{ test_name: string; result_value: string | null; result_flag: string | null; unit: string | null }>;
  clinicalNotes?: string | null;
}): Promise<ReflexSuggestion[]> {
  if (opts.abnormalResults.length === 0) return [];

  const resultsText = opts.abnormalResults
    .map(r => `${r.test_name}: ${r.result_value} ${r.unit || ""} [${r.result_flag || "abnormal"}]`)
    .join("\n");

  const response = await callAI({
    featureKey: "lab_reflex_tests",
    hospitalId: opts.hospitalId,
    patientId: opts.patientId,
    prompt: `You are a clinical pathologist AI for an Indian hospital laboratory. A panel has
returned the following abnormal findings:

${resultsText}

${opts.clinicalNotes ? `Clinical notes: ${opts.clinicalNotes}` : ""}

Recommend REFLEX TESTS — standard follow-on investigations that a lab would typically add
to confirm or characterise this abnormality (e.g. abnormal TSH → suggest Free T4/T3; microcytic
anaemia pattern → suggest iron studies/ferritin; deranged LFTs → suggest viral hepatitis panel;
positive ANA → suggest ENA panel; hyperglycaemia → suggest HbA1c). Only suggest tests that are
NOT already in the list above. Consider Indian epidemiology.

Return ONLY JSON array (max 4, empty array if no reflex test is indicated):
[{"suggested_test":"Free T4","trigger_finding":"TSH 0.1 (suppressed)","rationale":"Confirm hyperthyroidism and assess severity","urgency":"priority"}]`,
    maxTokens: 400,
  });

  if (response.error || !response.text) return [];
  try {
    const clean = response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(clean);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
