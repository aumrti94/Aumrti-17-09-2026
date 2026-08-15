// AI History Digest — merges every extracted outside record into one patient timeline.
//
// Runs once, after ai-history-ingest finishes reading the pages. Reads the structured events
// those chunks produced and turns them into the thing a doctor actually looks at: a
// date-ordered history with an active-problem list, a current-medication list, red flags,
// conflicts and gaps.
//
// ── CUMULATIVE, NOT PER-JOB ─────────────────────────────────────────────────────────────
// The digest covers EVERYTHING ever scanned for this patient, not just the batch that
// triggered this run. That is the whole compounding value of the feature: the second visit
// inherits what the first visit's scan built, and a bag scanned today merges with a bag
// scanned last year rather than replacing it.
//
// ── WHAT THE MODEL IS AND IS NOT ALLOWED TO DO ──────────────────────────────────────────
// IT DOES NOT SORT. Ordering is done in TypeScript below. A model asked to sort 400 events
// quietly drops some, and a dropped event is indistinguishable from one that was never there.
// IT DOES NOT RESOLVE CONFLICTS. When two documents disagree on a dose, both are surfaced
// with their dates and sources. A silently-resolved medication conflict is a prescribing
// error wearing a confident face (Dr. Ramesh).
// IT DOES NOT DELETE. Merging two duplicate events keeps the richer one and unions their
// sources; nothing leaves the timeline.
//
// SaMD Class B (Decision Support): the summary asserts an active-problem and medication list
// a doctor could act on. Hence the reviewed_by/reviewed_at attestation on the digest row, and
// the "unverified" labelling everywhere until a doctor presses it.
//
// PHI (Ananya): never console.log the request body, a storage path, event text, or model
// output. Error names and counts only.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveAiConfig,
  resolveAiConfigFromEnv,
  callAiChatWithUsage,
  AIDisabledError,
  type AiConfig,
} from "../_shared/ai-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FEATURE_KEY = "history_digest";
const EXTRACT_FEATURE_KEY = "history_document_extract";
const BUCKET = "patient-documents";
const MAX_TOKENS = 4000;
const PROMPT_VERSION = 1;

/**
 * Events per AI call. A batch is ~120 compact one-liners, comfortably inside the input
 * budget while leaving room for the summary. Above one batch the reduce goes hierarchical.
 */
const BATCH_SIZE = 120;

/**
 * Hard ceiling on events considered. A patient with fifteen years of scanned records will
 * exceed any single context window, so the NEWEST events win — recent history is what
 * changes today's management. The digest says so explicitly under `gaps` rather than
 * pretending it read everything.
 */
const MAX_EVENTS = 600;

const FALLBACK_SYSTEM_PROMPT =
  `You are a senior physician preparing a case summary for a colleague who has four minutes ` +
  `before seeing this patient in an Indian OPD. You are given clinical events already extracted ` +
  `from the outside medical records the patient brought with them. Your job is to merge them ` +
  `into one coherent history. ` +
  `MERGE AND DE-DUPLICATE. The same visit often appears in two documents — a prescription and ` +
  `the discharge summary that references it. Collapse genuine duplicates into one event, keeping ` +
  `the richer detail and ALL contributing sources. Two similar events on different dates are two ` +
  `events, not a duplicate. ` +
  `BUILD THE MEDICATION PICTURE. Work out what the patient is most likely taking NOW versus what ` +
  `was stopped, using prescription dates and durations. State your reasoning in one clause. When ` +
  `the records genuinely do not say, put the drug in current_medications and note the ` +
  `uncertainty — never silently drop a drug the patient may still be swallowing. ` +
  `SURFACE CONFLICTS, DO NOT RESOLVE THEM. When two documents disagree — different dose of the ` +
  `same drug, contradictory diagnoses, an allergy recorded in one and not another — list it ` +
  `under "conflicts" with both values, both dates and both sources. Do NOT pick a winner. The ` +
  `treating doctor resolves it by asking the patient. ` +
  `NAME THE GAPS. Say plainly what the records do NOT cover: "no records between 2019 and 2023", ` +
  `"no lab reports at all", "diabetes mentioned but no HbA1c on file". A doctor needs to know ` +
  `the shape of what is missing as much as what is present. ` +
  `DO NOT SORT the events — the calling system orders them by date. Return them as given. ` +
  `DO NOT INVENT. Every item in your summary must trace back to a supplied event. If the records ` +
  `do not establish something, leave the field empty rather than inferring it. ` +
  `Use Indian English spelling. Keep the one-liner under 200 characters — it is read in a glance. ` +
  `RED FLAGS: only what would change management TODAY. Fewer is better. ` +
  `Return ONLY valid JSON — no markdown, no code fences, no prose before or after the object: ` +
  `{"one_liner":"<age/sex, main active problems, most important caveat>",` +
  `"active_problems":[{"problem":"<string>","since":"<YYYY-MM-DD or null>","note":"<string or ` +
  `null>"}],"current_medications":[{"name":"<string>","dose":"<string or null>","frequency":` +
  `"<string or null>","since":"<YYYY-MM-DD or null>","certainty":"documented|likely|unclear"}],` +
  `"past_medications":[{"name":"<string>","stopped":"<YYYY-MM-DD or null>","why":"<string or ` +
  `null>"}],"allergies":[{"substance":"<string>","reaction":"<string or null>","source_date":` +
  `"<YYYY-MM-DD or null>"}],"surgeries":[{"procedure":"<string>","date":"<YYYY-MM-DD or null>",` +
  `"facility":"<string or null>"}],"key_investigations":[{"name":"<string>","value":"<string>",` +
  `"date":"<YYYY-MM-DD or null>","trend":"<string or null>"}],"red_flags":["<string>"],` +
  `"conflicts":[{"topic":"<string>","versions":[{"value":"<string>","date":"<YYYY-MM-DD or ` +
  `null>","source":"<document name>"}]}],"gaps":["<string>"],"event_ids_merged":[["<id>","<id>"]]}. ` +
  `This is a reading aid for a doctor who has no time to read 200 pages. It is never a diagnosis ` +
  `and never a treatment plan. The doctor verifies it against the patient in front of them.`;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

function parseModelJson(raw: string): Record<string, unknown> {
  const cleaned = raw.replace(/```json\n?/gi, "").replace(/```\n?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  return JSON.parse(start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned);
}

interface TimelineEvent {
  id: string;
  date: string | null;
  date_confidence: string;
  type: string;
  facility: string | null;
  title: string;
  detail: string;
  values: Array<{ name: string; value: string; unit: string | null; ref: string | null }>;
  medications: Array<{ name: string; dose: string | null; frequency: string | null; duration: string | null }>;
  significance: string;
  red_flag: boolean;
  verbatim: string | null;
  source: { source_id: string; source_name: string; page_from: number; page_to: number };
  /** Populated when duplicates from other documents were folded in. */
  also_in?: Array<{ source_id: string; source_name: string; page_from: number; page_to: number }>;
}

const SIGNIFICANCE_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Deterministic ordering. Newest first; undated events last because they cannot be placed
 * on the timeline at all — burying them at the top with a fabricated date would be worse.
 * Ties break on red flag, then significance, then title, so the same input always renders
 * the same way. Doing this in code rather than asking the model is deliberate: see header.
 *
 * TWIN of sortHistoryTimeline() in src/lib/historyDigest.ts — keep the two in lockstep.
 * That copy is the unit-tested one (Deno source cannot be imported by vitest) and is also
 * applied defensively at render time. Any change to these rules must land in both.
 */
function sortTimeline(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort((a, b) => {
    if (!a.date && !b.date) return cmpTiebreak(a, b);
    if (!a.date) return 1;
    if (!b.date) return -1;
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return cmpTiebreak(a, b);
  });
}

function cmpTiebreak(a: TimelineEvent, b: TimelineEvent): number {
  if (a.red_flag !== b.red_flag) return a.red_flag ? -1 : 1;
  const sa = SIGNIFICANCE_RANK[a.significance] ?? 1;
  const sb = SIGNIFICANCE_RANK[b.significance] ?? 1;
  if (sa !== sb) return sa - sb;
  return a.title.localeCompare(b.title);
}

/** One compact line per event — what the model dedupes on. Full detail stays server-side. */
function compactEvent(e: TimelineEvent): string {
  const bits = [
    `[${e.id}]`,
    e.date ? `${e.date}${e.date_confidence === "approximate" ? "~" : ""}` : "undated",
    e.type,
    e.facility ? `@${e.facility}` : null,
    e.title,
    e.detail ? e.detail.slice(0, 200) : null,
    e.values.length ? `vals: ${e.values.slice(0, 6).map((v) => `${v.name} ${v.value}${v.unit ?? ""}`).join("; ")}` : null,
    e.medications.length ? `rx: ${e.medications.slice(0, 8).map((m) => `${m.name} ${m.dose ?? ""} ${m.frequency ?? ""}`.trim()).join("; ")}` : null,
    e.red_flag ? "RED-FLAG" : null,
    `src:${e.source.source_name} p${e.source.page_from}`,
  ].filter(Boolean);
  return bits.join(" | ");
}

/**
 * Fold duplicate groups the model identified.
 *
 * The survivor is the RICHEST event (most detail + structured values), not the first — the
 * discharge summary's version of a visit usually beats the prescription's. Merged-away
 * events do not vanish: their document and page land in the survivor's `also_in`, so a
 * doctor can still see every place a finding was recorded.
 */
function applyMerges(events: TimelineEvent[], groups: string[][]): TimelineEvent[] {
  const byId = new Map(events.map((e) => [e.id, e]));
  const absorbed = new Set<string>();

  for (const group of groups) {
    const members = group.map((id) => byId.get(id)).filter((e): e is TimelineEvent => !!e && !absorbed.has(e.id));
    if (members.length < 2) continue;

    const richness = (e: TimelineEvent) =>
      e.detail.length + e.values.length * 40 + e.medications.length * 40 + (e.verbatim?.length ?? 0) / 4;
    const survivor = members.reduce((best, e) => (richness(e) > richness(best) ? e : best), members[0]);

    survivor.also_in = survivor.also_in ?? [];
    for (const m of members) {
      if (m.id === survivor.id) continue;
      absorbed.add(m.id);
      survivor.also_in.push(m.source);
      // A date the survivor lacks, or a red flag only the duplicate spotted, is information —
      // keep it. Merging must never lose a fact that one of the copies carried.
      if (!survivor.date && m.date) { survivor.date = m.date; survivor.date_confidence = m.date_confidence; }
      if (m.red_flag) survivor.red_flag = true;
    }
  }
  return events.filter((e) => !absorbed.has(e.id));
}

const str = (v: unknown, max = 600): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
};

const strList = (v: unknown, max = 20): string[] =>
  Array.isArray(v) ? v.map((x) => str(x)).filter((x): x is string => !!x).slice(0, max) : [];

const objList = (v: unknown, max = 40): Record<string, unknown>[] =>
  Array.isArray(v)
    ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").slice(0, max)
    : [];

/** Normalise whatever the model returned into the summary shape the UI relies on. */
function clampSummary(raw: Record<string, unknown>): Record<string, unknown> {
  return {
    one_liner: str(raw.one_liner, 400) ?? "",
    active_problems: objList(raw.active_problems, 25).map((p) => ({
      problem: str(p.problem, 200) ?? "", since: str(p.since, 12), note: str(p.note, 300),
    })).filter((p) => p.problem),
    current_medications: objList(raw.current_medications, 40).map((m) => ({
      name: str(m.name, 160) ?? "", dose: str(m.dose, 80), frequency: str(m.frequency, 80),
      since: str(m.since, 12),
      certainty: ["documented", "likely", "unclear"].includes(String(m.certainty)) ? String(m.certainty) : "unclear",
    })).filter((m) => m.name),
    past_medications: objList(raw.past_medications, 40).map((m) => ({
      name: str(m.name, 160) ?? "", stopped: str(m.stopped, 12), why: str(m.why, 200),
    })).filter((m) => m.name),
    allergies: objList(raw.allergies, 20).map((a) => ({
      substance: str(a.substance, 160) ?? "", reaction: str(a.reaction, 200), source_date: str(a.source_date, 12),
    })).filter((a) => a.substance),
    surgeries: objList(raw.surgeries, 25).map((s) => ({
      procedure: str(s.procedure, 200) ?? "", date: str(s.date, 12), facility: str(s.facility, 160),
    })).filter((s) => s.procedure),
    key_investigations: objList(raw.key_investigations, 30).map((i) => ({
      name: str(i.name, 160) ?? "", value: str(i.value, 120) ?? "", date: str(i.date, 12), trend: str(i.trend, 160),
    })).filter((i) => i.name),
    red_flags: strList(raw.red_flags, 12),
    conflicts: objList(raw.conflicts, 20).map((c) => ({
      topic: str(c.topic, 200) ?? "",
      versions: objList(c.versions, 6).map((v) => ({
        value: str(v.value, 200) ?? "", date: str(v.date, 12), source: str(v.source, 160),
      })).filter((v) => v.value),
    })).filter((c) => c.topic && c.versions.length > 1),
    gaps: strList(raw.gaps, 12),
  };
}

// ── Staging purge (see 20261013000012 for why the API and not SQL) ──────────────────────

/**
 * Restore the job's terminal status, then delete its staged scans. ORDER MATTERS.
 *
 * ai-history-ingest parks the job on 'reducing' while this function runs, and 'reducing' is
 * NOT a terminal state — so mark_history_job_purged()'s stalled-worker fallback would see a
 * non-terminal job with pages read and downgrade a perfectly complete run to 'partial'.
 * finalize_history_job() recomputes the true verdict from the chunk rows first (all of which
 * are terminal by now), so the purge finds a terminal status and leaves it alone.
 *
 * Runs on the failure path too: a digest that threw must still surrender its staging, and the
 * job must still report what the PAGES actually did rather than staying 'reducing' forever.
 */
async function finalizeAndPurge(sb: ReturnType<typeof admin>, jobId: string, hospitalId: string) {
  await sb.rpc("finalize_history_job", { p_job_id: jobId });
  await purgeJobStaging(sb, jobId, hospitalId);
}

async function purgeJobStaging(sb: ReturnType<typeof admin>, jobId: string, hospitalId: string) {
  const { data: sources } = await sb
    .from("patient_history_sources")
    .select("staged_path")
    .eq("job_id", jobId).eq("hospital_id", hospitalId)
    .not("staged_path", "is", null);

  const paths = (sources ?? []).map((s: { staged_path: string }) => s.staged_path).filter(Boolean);
  if (paths.length === 0) {
    await sb.rpc("mark_history_job_purged", { p_job_id: jobId });
    return;
  }

  const { error } = await sb.storage.from(BUCKET).remove(paths);
  if (error && !/not.?found/i.test(error.message || "")) {
    // Leave the job unpurged so the hourly sweep retries. Never stamp purged_at on a
    // removal that did not happen — the DB must not claim a binary is gone while it is
    // still fetchable.
    console.error(`ai-history-digest staging purge deferred: ${error.name || "StorageError"}`);
    return;
  }
  await sb.rpc("mark_history_job_purged", { p_job_id: jobId });
}

// ── Main ────────────────────────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  let jobIdForCleanup: string | null = null;
  let hospitalForCleanup: string | null = null;

  try {
    const { job_id } = await req.json().catch(() => ({}));
    if (!job_id) return json({ error: "job_id is required" }, 400);

    const sb = admin();

    const { data: job } = await sb
      .from("patient_history_ingest_jobs")
      .select("id, hospital_id, patient_id, encounter_id, started_at")
      .eq("id", String(job_id))
      .maybeSingle();
    if (!job) return json({ error: "Job not found." }, 404);

    // Tenant comes from the job row, never the request body (Ananya).
    const hospitalId = job.hospital_id as string;
    const patientId = job.patient_id as string;
    jobIdForCleanup = job.id as string;
    hospitalForCleanup = hospitalId;

    // ── Gather every extracted chunk for this PATIENT, not just this job ───────────────
    const { data: chunkRows } = await sb
      .from("patient_history_source_chunks")
      .select("id, extracted, created_at")
      .eq("patient_id", patientId).eq("hospital_id", hospitalId)
      .eq("status", "extracted")
      .order("created_at", { ascending: false })
      .limit(400);

    const events: TimelineEvent[] = [];
    let truncated = false;
    for (const row of (chunkRows ?? []) as Array<{ id: string; extracted: { events?: unknown[] } }>) {
      const list = Array.isArray(row.extracted?.events) ? row.extracted!.events! : [];
      for (let i = 0; i < list.length; i++) {
        if (events.length >= MAX_EVENTS) { truncated = true; break; }
        // Stable id: chunk row + index. Survives re-runs, so a merge decision made on one
        // digest still refers to the same events on the next.
        events.push({ ...(list[i] as object), id: `${row.id.slice(0, 8)}_${i}` } as TimelineEvent);
      }
      if (truncated) break;
    }

    // ── Coverage, cumulative across every scan this patient has had ───────────────────
    const { data: allSources } = await sb
      .from("patient_history_sources")
      .select("id, source_name, page_count, ingest_status")
      .eq("patient_id", patientId).eq("hospital_id", hospitalId);

    const { data: failedChunks } = await sb
      .from("patient_history_source_chunks")
      .select("source_id, page_from, page_to")
      .eq("patient_id", patientId).eq("hospital_id", hospitalId)
      .eq("status", "failed");

    const sourceName = new Map((allSources ?? []).map((s: any) => [s.id, s.source_name as string]));
    const pagesTotal = (allSources ?? []).reduce((n: number, s: any) => n + (s.page_count || 0), 0);
    const pagesUnreadable = (failedChunks ?? [])
      .reduce((n: number, c: any) => n + (c.page_to - c.page_from + 1), 0);

    const coverage = {
      documents_total: (allSources ?? []).length,
      pages_total: pagesTotal,
      pages_read: Math.max(pagesTotal - pagesUnreadable, 0),
      pages_unreadable: pagesUnreadable,
      unreadable_refs: (failedChunks ?? []).slice(0, 40).map((c: any) => ({
        source_name: sourceName.get(c.source_id) ?? "Unknown document",
        page_from: c.page_from,
        page_to: c.page_to,
      })),
      events_truncated: truncated,
    };

    // ── Nothing extracted: still write a digest ────────────────────────────────────────
    // A digest whose coverage says "0 of 40 pages read" is far more useful than no digest:
    // it tells the doctor the scan happened and failed, instead of leaving the History tab
    // looking like nobody ever tried.
    if (events.length === 0) {
      await writeDigest(sb, {
        hospitalId, patientId, jobId: job.id as string,
        timeline: [], summary: clampSummary({}), coverage,
        promptVersion: PROMPT_VERSION, model: null,
      });
      await finalizeAndPurge(sb, job.id as string, hospitalId);
      return json({ status: "empty", events: 0 });
    }

    // ── AI config ─────────────────────────────────────────────────────────────────────
    const config: AiConfig | null =
      (await resolveAiConfig(hospitalId, FEATURE_KEY, MAX_TOKENS)) ??
      resolveAiConfigFromEnv(MAX_TOKENS, hospitalId, FEATURE_KEY);
    if (!config) return json({ error: "No AI provider configured. Go to Settings → API Hub." }, 503);
    if (config.meter) {
      config.meter = {
        ...config.meter,
        patientId,
        encounterId: (job.encounter_id as string | null) ?? undefined,
      };
    }

    const { data: reg } = await sb
      .from("prompt_registry")
      .select("system_prompt, version")
      .eq("feature_key", FEATURE_KEY)
      .eq("is_active", true)
      .maybeSingle();
    const systemPrompt = (reg?.system_prompt as string) || FALLBACK_SYSTEM_PROMPT;
    const promptVersion = Number(reg?.version) || PROMPT_VERSION;

    // ── Hierarchical reduce ───────────────────────────────────────────────────────────
    // Wave 1: one pass per batch of events → merge groups + a partial summary.
    // Wave 2: one pass over the partial summaries → the final summary.
    // With a single batch, wave 2 is skipped and its summary IS the final one — the common
    // case (120 events is a big bag) pays for exactly one AI call.
    const batches: TimelineEvent[][] = [];
    for (let i = 0; i < events.length; i += BATCH_SIZE) batches.push(events.slice(i, i + BATCH_SIZE));

    const mergeGroups: string[][] = [];
    const partialSummaries: Record<string, unknown>[] = [];

    for (let b = 0; b < batches.length; b++) {
      const header = batches.length > 1
        ? `This is part ${b + 1} of ${batches.length} of this patient's extracted records. `
        : "";
      const { content } = await callAiChatWithUsage(
        config,
        [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              `${header}Clinical events extracted from the outside medical records this patient ` +
              `brought with them, one per line:\n\n${batches[b].map(compactEvent).join("\n")}\n\n` +
              `Merge duplicates and produce the summary. Reference events only by their [id]. ` +
              `Return the JSON object described in your instructions and nothing else.`,
          },
        ],
        MAX_TOKENS,
        0.2,
      );

      let parsed: Record<string, unknown>;
      try {
        parsed = parseModelJson(content);
      } catch {
        // One unparseable batch must not lose the other batches' work, and it must never
        // lose the TIMELINE — the events are already in hand. Skip this batch's summary.
        console.error("ai-history-digest batch summary unparseable — continuing");
        continue;
      }

      const groups = Array.isArray(parsed.event_ids_merged) ? parsed.event_ids_merged : [];
      for (const g of groups) {
        if (Array.isArray(g) && g.length > 1) mergeGroups.push(g.map(String).slice(0, 8));
      }
      partialSummaries.push(clampSummary(parsed));
    }

    let summary: Record<string, unknown>;
    if (partialSummaries.length === 0) {
      summary = clampSummary({});
    } else if (partialSummaries.length === 1) {
      summary = partialSummaries[0];
    } else {
      try {
        const { content } = await callAiChatWithUsage(
          config,
          [
            { role: "system", content: systemPrompt },
            {
              role: "user",
              content:
                `These are partial summaries of the same patient's records, each built from a ` +
                `different part of the bundle. Merge them into ONE summary covering the whole ` +
                `patient. Reconcile nothing that genuinely conflicts — list it under conflicts. ` +
                `Return the same JSON object and nothing else.\n\n` +
                JSON.stringify(partialSummaries),
            },
          ],
          MAX_TOKENS,
          0.2,
        );
        summary = clampSummary(parseModelJson(content));
      } catch {
        // Fall back to the first partial rather than nothing. Incomplete beats absent when
        // a doctor is waiting, and the coverage banner still tells the honest story.
        console.error("ai-history-digest final merge failed — falling back to first partial");
        summary = partialSummaries[0];
      }
    }

    if (truncated) {
      const gaps = Array.isArray(summary.gaps) ? (summary.gaps as string[]) : [];
      summary.gaps = [
        `Only the ${MAX_EVENTS} most recent findings were summarised — older scanned records exist but are not reflected here.`,
        ...gaps,
      ];
    }

    const timeline = sortTimeline(applyMerges(events, mergeGroups));

    await writeDigest(sb, {
      hospitalId, patientId, jobId: job.id as string,
      timeline, summary, coverage, promptVersion, model: config.model,
    });

    // ── Actual cost, for the estimate audit ───────────────────────────────────────────
    // ai_usage_logs has no job_id, so this is scoped by patient + feature + this job's
    // start. Close enough to audit the estimate honestly, which is its only purpose.
    if (job.started_at) {
      const { data: usage } = await sb
        .from("ai_usage_logs")
        .select("estimated_cost_inr")
        .eq("hospital_id", hospitalId)
        .eq("patient_id", patientId)
        .in("feature_key", [EXTRACT_FEATURE_KEY, FEATURE_KEY])
        .gte("created_at", job.started_at as string);
      const total = (usage ?? []).reduce((n: number, r: any) => n + Number(r.estimated_cost_inr || 0), 0);
      await sb.from("patient_history_ingest_jobs")
        .update({ actual_cost_inr: Number(total.toFixed(2)) })
        .eq("id", job.id);
    }

    // ── NABH evidence: COUNTS ONLY ────────────────────────────────────────────────────
    // nabh_evidence_log is not patient-scoped, so no clinical text may go in it — same
    // constraint the Clarifying Questions card observes.
    await sb.from("nabh_evidence_log").insert({
      hospital_id: hospitalId,
      criterion_number: "MOM.1",
      description:
        `Outside medical records ingested: ${coverage.documents_total} document(s), ` +
        `${coverage.pages_read}/${coverage.pages_total} pages transcribed, ` +
        `${timeline.length} clinical events on the merged history. Pending clinician attestation.`,
      compliance_status: coverage.pages_unreadable > 0 ? "partially_compliant" : "compliant",
      source: "module_event",
    }).then(undefined, () => { /* accreditation logging must never fail a clinical job */ });

    await finalizeAndPurge(sb, job.id as string, hospitalId);

    return json({
      status: "complete",
      events: timeline.length,
      merged: events.length - timeline.length,
      coverage,
    });
  } catch (err) {
    if (err instanceof AIDisabledError) {
      return json({ error: err.message, disabled: true }, 403);
    }
    const name = err instanceof Error ? err.name : "UnknownError";
    console.error(`ai-history-digest failed: ${name}`);

    // The digest failed, but the SCAN still has to go. Leaving PHI in staging because the
    // summariser threw would be a retention breach caused by an unrelated bug.
    if (jobIdForCleanup && hospitalForCleanup) {
      try { await finalizeAndPurge(admin(), jobIdForCleanup, hospitalForCleanup); } catch { /* the sweep will retry */ }
    }
    return json({ error: "Could not build the history summary." }, 500);
  }
});

/**
 * Write the new digest and retire the previous one.
 *
 * Order matters: the partial unique index allows exactly one is_current row per patient, so
 * the old one is retired FIRST. Append-only — a digest a doctor already attested to is never
 * rewritten, it is superseded, so their attestation always refers to what they actually read.
 */
async function writeDigest(
  sb: ReturnType<typeof admin>,
  d: {
    hospitalId: string; patientId: string; jobId: string;
    timeline: unknown[]; summary: Record<string, unknown>; coverage: Record<string, unknown>;
    promptVersion: number; model: string | null;
  },
) {
  const { data: prev } = await sb
    .from("patient_history_digests")
    .select("version")
    .eq("patient_id", d.patientId).eq("hospital_id", d.hospitalId)
    .order("version", { ascending: false })
    .limit(1);

  const nextVersion = Number((prev ?? [])[0]?.version || 0) + 1;

  await sb.from("patient_history_digests")
    .update({ is_current: false })
    .eq("patient_id", d.patientId).eq("hospital_id", d.hospitalId).eq("is_current", true);

  await sb.from("patient_history_digests").insert({
    hospital_id: d.hospitalId,
    patient_id: d.patientId,
    job_id: d.jobId,
    version: nextVersion,
    prompt_version: d.promptVersion,
    model_used: d.model,
    timeline: d.timeline,
    summary: d.summary,
    coverage: d.coverage,
    is_current: true,
  });
}
