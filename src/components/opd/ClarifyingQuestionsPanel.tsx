import React, { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useAIFeature } from "@/hooks/useAIFeature";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import { HelpCircle, RefreshCw, AlertTriangle, Mic, X, CheckCircle2 } from "lucide-react";
import type { EncounterData } from "./ConsultationWorkspace";

/**
 * AI Clarifying Questions — the third card in the OPD "AI Guidance" tab.
 *
 * The other two cards only help once the doctor has already done the hard part: the
 * differential needs a chief complaint, and Clinical Guidance needs a diagnosis. This one
 * closes the loop — it reads everything documented so far, proposes the few questions that
 * would most narrow the differential, records the doctor's answers into the HPI, and asks the
 * differential to re-run against the now-richer history.
 *
 * SaMD Class B (Decision Support). Human-in-the-loop throughout: generation is never
 * automatic, every answer is doctor-entered, and what lands in the record is plain editable
 * text in the ordinary HPI field.
 */

export interface ClarifyingQuestion {
  id: string;
  rank: number;
  question: string;
  why: string;
  rules_in: string[];
  rules_out: string[];
  yield: number;
  red_flag: boolean;
  category: string;
}

export type ClarifyingAnswer = "yes" | "no" | "not_asked";

/** Persisted to opd_encounters.ai_clarifying_questions — see migration 20261012000030. */
export interface ClarifyingQuestionsState {
  version: number;
  prompt_version: number;
  generated_at: string;
  /** Snapshot of the complaint this set was generated from, so we can flag it as stale. */
  generated_for_complaint: string;
  questions: ClarifyingQuestion[];
  answers: Record<string, { answer: ClarifyingAnswer; note?: string }>;
  already_known: string[];
  appended_to_hpi_at: string | null;
}

interface Props {
  encounter: EncounterData;
  onChange: (partial: Partial<EncounterData>) => void;
  hospitalId: string | null;
  patientId?: string | null;
  encounterId?: string | null;
  age?: number;
  gender?: string;
  allergies?: string;
  chronicConditions?: string;
  /** Already guarded against a cross-patient session and truncated by the parent. */
  voiceTranscript?: string;
  /**
   * The patient's history built from the outside records they brought in, pre-formatted and
   * length-capped by formatDigestForPrompt (src/lib/historyDigest.ts).
   *
   * This is what stops the card asking a question the patient's own paperwork already
   * answers — the prompt's `already_known` bucket exists precisely so the doctor can see it
   * read the chart, and before this the chart it read stopped at this hospital's front door.
   */
  priorHistoryDigest?: string;
  onRefineDdx?: () => void;
}

const ANSWER_LABELS: { value: ClarifyingAnswer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "not_asked", label: "Not asked" },
];

const ANSWER_STYLES: Record<ClarifyingAnswer, string> = {
  yes: "bg-emerald-50 border-emerald-400 text-emerald-700",
  no: "bg-slate-100 border-slate-400 text-slate-700",
  not_asked: "bg-amber-50 border-amber-400 text-amber-700",
};

const HPI_BLOCK_START = "--- Clarifying Questions";
const HPI_BLOCK_END = "--- end ---";

/**
 * Matches every previously appended block, so re-applying REPLACES rather than stacks.
 * The `g` flag means a pre-existing duplicate self-heals on the next apply; the non-greedy
 * body stops two adjacent blocks being swallowed as one.
 */
const HPI_BLOCK_RE = /\n*--- Clarifying Questions \([^)]*\) ---\n[\s\S]*?\n--- end ---/g;

/**
 * Rebuild the HPI with exactly one Clarifying Questions block at the end.
 *
 * The `Duration: X` line that ComplaintTab keeps as the FIRST line of the HPI lives entirely
 * inside `stripped`, so it is never touched — the duration dropdown and this block coexist.
 */
const applyQuestionsToHpi = (
  hpi: string,
  questions: ClarifyingQuestion[],
  answers: Record<string, { answer: ClarifyingAnswer; note?: string }>,
): string => {
  const lines = questions
    .filter((q) => answers[q.id])
    .map((q) => {
      const a = answers[q.id];
      const label = a.answer === "yes" ? "Yes" : a.answer === "no" ? "No" : "Not asked";
      const note = a.note?.trim() ? ` (${a.note.trim()})` : "";
      return `Q: ${q.question} — ${label}${note}`;
    });

  const stripped = hpi.replace(HPI_BLOCK_RE, "").replace(/\n{3,}/g, "\n\n").trimEnd();
  if (lines.length === 0) return stripped;

  const block = [
    `${HPI_BLOCK_START} (${new Date().toLocaleDateString("en-IN")}) ---`,
    ...lines,
    HPI_BLOCK_END,
  ].join("\n");

  return stripped ? `${stripped}\n\n${block}` : block;
};

/** Defensive clamp — the model is not trusted to honour its own schema. */
const clampQuestions = (raw: unknown): ClarifyingQuestion[] => {
  const arr = Array.isArray(raw) ? raw : [];
  return arr
    .filter((q): q is Record<string, unknown> =>
      !!q && typeof (q as Record<string, unknown>).question === "string" &&
      String((q as Record<string, unknown>).question).trim().length > 0)
    .slice(0, 5)
    .map((q, i) => ({
      id: String(q.id ?? `q${i + 1}`),
      rank: Number(q.rank) || i + 1,
      question: String(q.question).trim(),
      why: typeof q.why === "string" ? q.why : "",
      rules_in: Array.isArray(q.rules_in) ? q.rules_in.map(String).slice(0, 3) : [],
      rules_out: Array.isArray(q.rules_out) ? q.rules_out.map(String).slice(0, 3) : [],
      yield: Math.min(1, Math.max(0, Number(q.yield) || 0)),
      red_flag: q.red_flag === true,
      category: typeof q.category === "string" ? q.category : "history",
    }))
    // Red flags first — a question screening for an emergency outranks a merely useful one,
    // regardless of what the model scored it.
    .sort((a, b) => (b.red_flag ? 1 : 0) - (a.red_flag ? 1 : 0) || a.rank - b.rank);
};

const ClarifyingQuestionsPanel: React.FC<Props> = ({
  encounter, onChange, hospitalId, patientId, encounterId,
  age, gender, allergies, chronicConditions, voiceTranscript, priorHistoryDigest, onRefineDdx,
}) => {
  const aiOn = useAIFeature("clarifying_questions");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useTranscript, setUseTranscript] = useState(true);

  const state = encounter.ai_clarifying_questions ?? null;
  const answers = state?.answers ?? {};
  const answeredCount = state
    ? state.questions.filter((q) => answers[q.id]).length
    : 0;

  const transcript = useTranscript ? (voiceTranscript ?? "") : "";

  // The complaint may have been edited after the questions were generated, which can make
  // them irrelevant. Say so — but never clear the doctor's answers, those are their record.
  const isStale = useMemo(
    () => !!state && state.generated_for_complaint !== encounter.chief_complaint,
    [state, encounter.chief_complaint],
  );

  if (!aiOn) {
    return (
      <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
        <HelpCircle className="h-4 w-4 text-muted-foreground" />
        <span className="text-[14px] text-muted-foreground">
          AI Clarifying Questions is disabled by your administrator.
        </span>
      </div>
    );
  }

  const persist = (next: Partial<ClarifyingQuestionsState>) => {
    if (!state) return;
    onChange({ ai_clarifying_questions: { ...state, ...next } });
  };

  const generate = async () => {
    if (!encounter.chief_complaint.trim()) {
      toast.error("Enter chief complaint first.");
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: invokeError } = await supabase.functions.invoke("ai-clarifying-questions", {
      body: {
        chief_complaint: encounter.chief_complaint,
        history: encounter.history_of_present_illness,
        onset: encounter.soap_subjective,
        vitals: encounter.vitals,
        examination: encounter.examination_notes,
        systemic_examination: encounter.soap_objective,
        age,
        gender,
        allergies,
        chronic_conditions: chronicConditions,
        current_diagnosis: encounter.diagnosis,
        voice_transcript: transcript,
        prior_history_digest: priorHistoryDigest,
        patient_id: patientId,
        encounter_id: encounterId,
        hospital_id: hospitalId,
      },
    });

    if (invokeError || !data) {
      // Read the edge function's own message where we can — a 403 means the feature is
      // withheld, which is a very different thing from a broken AI config.
      let message = "Could not generate clarifying questions. Check AI configuration.";
      try {
        const ctx = (invokeError as unknown as { context?: Response })?.context;
        const body = ctx && typeof ctx.json === "function" ? await ctx.json() : null;
        if (body?.error) message = String(body.error);
      } catch {
        /* keep the default message — the response body was not readable JSON */
      }
      setError(message);
      toast.error(message);
      setLoading(false);
      return;
    }

    const questions = clampQuestions(data.questions);
    onChange({
      ai_clarifying_questions: {
        version: 1,
        prompt_version: Number(data.prompt_version) || 1,
        generated_at: new Date().toISOString(),
        generated_for_complaint: encounter.chief_complaint,
        questions,
        // Keep any answers the doctor already gave for questions that came back again.
        answers: Object.fromEntries(
          Object.entries(answers).filter(([id]) => questions.some((q) => q.id === id)),
        ),
        already_known: Array.isArray(data.already_known) ? data.already_known.map(String) : [],
        appended_to_hpi_at: null,
      },
    });
    setLoading(false);
  };

  const setAnswer = (id: string, answer: ClarifyingAnswer) => {
    const current = answers[id];
    const next = { ...answers };
    // Tapping the selected answer again clears it — the doctor can undo a mis-tap.
    if (current?.answer === answer) delete next[id];
    else next[id] = { ...current, answer };
    persist({ answers: next });
  };

  const setNote = (id: string, note: string) => {
    if (!answers[id]) return;
    persist({ answers: { ...answers, [id]: { ...answers[id], note } } });
  };

  const applyAndRefine = () => {
    if (!state || answeredCount === 0) return;
    const nextHpi = applyQuestionsToHpi(
      encounter.history_of_present_illness,
      state.questions,
      answers,
    );
    // One batched update: the differential re-reads `history` from this same encounter object,
    // so the HPI write and the refresh signal must land in the same render.
    onChange({
      history_of_present_illness: nextHpi,
      ai_clarifying_questions: { ...state, appended_to_hpi_at: new Date().toISOString() },
    });
    onRefineDdx?.();

    // NABH: a real clinical event (history-taking documented), not a system timestamp.
    // COUNTS ONLY — nabh_evidence_log is not patient-scoped, so no answer text may go in here.
    if (hospitalId) {
      void logNABHEvidence(
        hospitalId,
        "AAC.4",
        `AI clarifying questions: ${state.questions.length} generated, ${answeredCount} answered, appended to HPI by treating doctor`,
        "compliant",
      );
    }
    toast.success(`${answeredCount} answer${answeredCount > 1 ? "s" : ""} added to history. Refining differential…`);
  };

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/30 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <HelpCircle className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold shrink-0">AI Clarifying Questions</span>
          {state && state.questions.length > 0 && (
            <Badge variant="secondary" className="text-[9px]">
              {answeredCount}/{state.questions.length} answered
            </Badge>
          )}
          {/* PHI transparency: the doctor always sees when the conversation transcript is
              going to the model, and can exclude it with one click. */}
          {voiceTranscript && (
            <button
              onClick={() => setUseTranscript((v) => !v)}
              title={useTranscript ? "Click to exclude the voice transcript" : "Click to include the voice transcript"}
              className={cn(
                "flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors shrink-0",
                useTranscript
                  ? "bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100"
                  : "bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100",
              )}
            >
              <Mic className="h-2.5 w-2.5" />
              {useTranscript ? `Using voice transcript (${voiceTranscript.length} chars)` : "Voice transcript excluded"}
              {useTranscript && <X className="h-2.5 w-2.5" />}
            </button>
          )}
        </div>
        <Button
          size="sm"
          variant={state ? "ghost" : "default"}
          className="h-7 text-xs gap-1 shrink-0"
          onClick={generate}
          disabled={loading}
        >
          <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} />
          {loading ? "Generating..." : state ? "Regenerate" : "Generate Questions"}
        </Button>
      </div>

      <div className="p-3 space-y-2">
        {loading && !state && (
          <p className="text-[14px] text-muted-foreground animate-pulse">
            Analysing what is still unknown about this case...
          </p>
        )}

        {!loading && !state && !error && (
          <p className="text-[14px] text-muted-foreground">
            Click <b>Generate Questions</b> for the few highest-yield questions that would narrow
            this case, based on the complaint, vitals, examination and history recorded so far.
          </p>
        )}

        {error && (
          <div className="flex items-start justify-between gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-[14px] text-red-700">{error}</p>
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={generate} disabled={loading}>
              Retry
            </Button>
          </div>
        )}

        {isStale && (
          <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <p className="text-[14px] text-amber-700">
              The chief complaint changed after these questions were generated. Regenerate for an
              updated set — your answers are kept.
            </p>
          </div>
        )}

        {/* An empty list is a SUCCESS state, not a failure: the history already discriminates. */}
        {state && state.questions.length === 0 && (
          <div className="flex items-start gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[14px] text-emerald-700">
              No high-yield questions remain — the documented history already discriminates the
              differential.
            </p>
          </div>
        )}

        {state && state.already_known.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Already documented: {state.already_known.join(" · ")}
          </p>
        )}

        {state?.questions.map((q) => {
          const a = answers[q.id];
          return (
            <div
              key={q.id}
              className={cn(
                "border rounded-lg px-3 py-2.5 space-y-2",
                q.red_flag ? "border-red-200 bg-red-50/40" : "border-border",
              )}
            >
              <div className="flex items-start gap-2">
                {q.red_flag && <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium text-foreground">{q.question}</p>
                  {q.why && <p className="text-xs text-muted-foreground mt-0.5">{q.why}</p>}
                </div>
                <span className="text-xs font-semibold text-muted-foreground shrink-0" title="Estimated discriminating power">
                  {Math.round(q.yield * 100)}%
                </span>
              </div>

              {(q.rules_in.length > 0 || q.rules_out.length > 0) && (
                <div className="flex flex-wrap gap-1">
                  {q.rules_in.map((d, i) => (
                    <Badge key={`in-${i}`} variant="secondary" className="text-[9px] bg-emerald-50 text-emerald-700 border-emerald-200">
                      rules in: {d}
                    </Badge>
                  ))}
                  {q.rules_out.map((d, i) => (
                    <Badge key={`out-${i}`} variant="secondary" className="text-[9px] bg-amber-50 text-amber-700 border-amber-200">
                      rules out: {d}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-1.5">
                {ANSWER_LABELS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setAnswer(q.id, opt.value)}
                    className={cn(
                      "text-[14px] px-3 py-1 rounded-full border transition-colors",
                      a?.answer === opt.value
                        ? ANSWER_STYLES[opt.value]
                        : "bg-background border-slate-200 text-slate-600 hover:bg-muted",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
                {a && (
                  <input
                    value={a.note ?? ""}
                    onChange={(e) => setNote(q.id, e.target.value)}
                    placeholder="Add a note (optional)"
                    className="flex-1 min-w-[140px] h-8 px-2 border border-slate-200 rounded-md text-[14px] outline-none focus:border-primary"
                  />
                )}
              </div>
            </div>
          );
        })}

        {state && state.questions.length > 0 && (
          <div className="space-y-1 pt-1">
            <Button
              size="sm"
              className="h-8 text-xs w-full"
              disabled={answeredCount === 0}
              onClick={applyAndRefine}
            >
              Apply {answeredCount > 0 ? `${answeredCount} answer${answeredCount > 1 ? "s" : ""}` : "answers"} to History &amp; Refine Differential
            </Button>
            <p className="text-xs text-muted-foreground">
              Answers are added to the History of Present Illness as plain, editable text.
              Re-applying replaces the previous Clarifying Questions block.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClarifyingQuestionsPanel;
