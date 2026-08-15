import React, { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ScanLine, Loader2, X, FileText, Image as ImageIcon, AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useAIFeature } from "@/hooks/useAIFeature";
import { prepareDocumentInput, classifyFile } from "@/lib/documentAI";
import { BUCKETS } from "@/lib/storageUrls";
import {
  estimateTierCost, TIER_LABELS, isJobRunning,
  type HistoryModelTier, type HistoryJob, type HistoryJobStatus,
} from "@/lib/historyDigest";

/**
 * Scan a patient's bag of outside medical records.
 *
 * WHO USES THIS, AND WHY IT MATTERS: the front desk, during registration — not the
 * doctor. A consultant with four minutes will not scan 100 pages, so a version of
 * this feature that only lives inside the consultation screen gets a great demo and
 * ~8% adoption (Rohit). It is therefore mounted in BOTH the OPD History tab and the
 * Patient Details drawer, and the copy is written for a receptionist, not a clinician.
 *
 * THE SCANS ARE NOT KEPT. Files are staged in the private patient-documents bucket
 * only so the extraction worker can read them, and are purged the moment the job
 * finishes. What is retained is the transcribed text and the timeline built from it.
 * The panel says so out loud — a hospital must not discover this from a migration.
 *
 * THE COST GATE. Nothing is spent until the user picks a tier and presses Analyse
 * with a rupee figure in front of them. Accurate costs ~25x Fast, so the per-document
 * override is the difference between ₹12 and ₹172 on a typical bag.
 */

const BUCKET = BUCKETS.patientDocuments;

/** One phone photo of a prescription is ~3MB; a 300-page scan is the real ceiling. */
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 40;

interface Props {
  patientId: string;
  hospitalId: string;
  userId: string;
  /** Which consultation triggered the scan. Null when the front desk scans at registration. */
  encounterId?: string | null;
  /** Fired when a job reaches a terminal state, so the timeline can reload. */
  onIngestComplete?: () => void;
  defaultTier?: HistoryModelTier;
}

interface StagedFile {
  key: string;
  file: File;
  /** Text pulled client-side for DOCX/TXT — staged as .txt so the worker needs no Office parser. */
  extractedText: string | null;
  pageCount: number;
  tier: HistoryModelTier;
  contentHash: string;
  duplicate: boolean;
  unsupported: string | null;
}

const sanitise = (name: string) =>
  name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-80) || "scan";

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Page count drives BOTH the chunking and the cost estimate the doctor confirms, so it
 * must match what the worker will actually do (see _shared/pdf-split.ts). An unreadable
 * PDF returns 0, which marks the file unsupported and keeps it VISIBLE in the ledger
 * rather than dropping it from the total.
 */
async function countPages(file: File, buf: ArrayBuffer): Promise<number> {
  const { kind } = classifyFile(file);
  if (kind !== "pdf") return 1;
  try {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
    return doc.getPageCount();
  } catch {
    return 0;
  }
}

const STATUS_LABEL: Record<HistoryJobStatus, string> = {
  uploading: "Uploading scans…",
  queued: "Queued…",
  running: "Reading pages…",
  reducing: "Building the history…",
  complete: "Done",
  partial: "Done — some pages unreadable",
  failed: "Could not read these records",
  cancelled: "Cancelled",
};

const PatientHistoryUploadPanel: React.FC<Props> = ({
  patientId, hospitalId, userId, encounterId, onIngestComplete, defaultTier = "fast",
}) => {
  const aiOn = useAIFeature("history_document_extract");
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [staged, setStaged] = useState<StagedFile[]>([]);
  const [reading, setReading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [job, setJob] = useState<HistoryJob | null>(null);
  const [showPerDoc, setShowPerDoc] = useState(false);

  // ── Resume an in-flight job ────────────────────────────────────────────────
  // The worker runs server-side, so a scan started at the front desk is still
  // progressing when the doctor opens the same patient. Picking up the newest job on
  // mount is what makes that visible instead of looking like nothing happened.
  const loadJob = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("patient_history_ingest_jobs")
      .select("id, status, documents_total, pages_total, pages_extracted, pages_failed, estimated_cost_inr, actual_cost_inr, error_name, created_at")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setJob(data ?? null);
    return data as HistoryJob | null;
  }, [patientId]);

  useEffect(() => { void loadJob(); }, [loadJob]);

  // ── Poll while running ─────────────────────────────────────────────────────
  // `notifiedRef` keeps onIngestComplete to exactly one call per job. Without it the
  // parent timeline would refetch on every poll tick after a job settles.
  const notifiedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!job || !isJobRunning(job.status)) return;
    const t = setInterval(async () => {
      const next = await loadJob();
      if (next && !isJobRunning(next.status) && notifiedRef.current !== next.id) {
        notifiedRef.current = next.id;
        onIngestComplete?.();
        if (next.status === "failed") toast.error("Could not read these records.");
        else if (next.status === "partial") toast.warning(`Read ${next.pages_extracted} of ${next.pages_total} pages — some were unreadable.`);
        else toast.success(`History built from ${next.pages_extracted} page${next.pages_extracted === 1 ? "" : "s"}.`);
      }
    }, 3000);
    return () => clearInterval(t);
  }, [job, loadJob, onIngestComplete]);

  if (!aiOn) {
    return (
      <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
        <ScanLine className="h-4 w-4 text-muted-foreground" />
        <span className="text-[14px] text-muted-foreground">
          Old-records scanning is disabled by your administrator.
        </span>
      </div>
    );
  }

  // ── File selection ─────────────────────────────────────────────────────────

  const addFiles = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setReading(true);
    try {
      const incoming = Array.from(list).slice(0, MAX_FILES - staged.length);
      const next: StagedFile[] = [];

      for (const file of incoming) {
        if (file.size > MAX_FILE_BYTES) {
          toast.error(`${file.name} is larger than 50MB — split it and scan again.`);
          continue;
        }
        const buf = await file.arrayBuffer();
        const contentHash = await sha256Hex(buf);
        const { kind } = classifyFile(file);

        // DOCX/TXT are turned into plain text HERE, using the reader the app already
        // ships, and staged as .txt. That keeps every Office format out of the Deno
        // worker entirely rather than duplicating mammoth server-side.
        let extractedText: string | null = null;
        let unsupported: string | null = null;
        if (kind === "docx" || kind === "text") {
          const prepared = await prepareDocumentInput(file);
          extractedText = prepared.inlineText;
          if (!extractedText) unsupported = prepared.error ?? "No readable text in this file.";
        } else if (kind === "unsupported") {
          unsupported = `${file.name.split(".").pop()?.toUpperCase() || "This"} files cannot be read automatically.`;
        }

        const pageCount = extractedText ? 1 : await countPages(file, buf);
        if (!unsupported && pageCount === 0) unsupported = "This PDF could not be opened.";

        next.push({
          key: `${contentHash}_${file.name}`,
          file, extractedText,
          pageCount: Math.max(pageCount, 1),
          tier: defaultTier,
          contentHash,
          duplicate: false,
          unsupported,
        });
      }

      // ── Dedupe against everything ever scanned for this patient ────────────
      // A patient re-presenting the same discharge summary next visit must not be
      // read — or charged for — twice.
      const hashes = next.map((f) => f.contentHash);
      if (hashes.length > 0) {
        const { data: existing } = await (supabase as any)
          .from("patient_history_sources")
          .select("content_hash")
          .eq("patient_id", patientId)
          .in("content_hash", hashes);
        const seen = new Set((existing ?? []).map((r: { content_hash: string }) => r.content_hash));
        for (const f of next) if (seen.has(f.contentHash)) f.duplicate = true;
      }

      setStaged((prev) => {
        // Also dedupe within this selection — picking the same file twice is common
        // when someone photographs a page, checks it, and photographs it again.
        const known = new Set(prev.map((f) => f.contentHash));
        return [...prev, ...next.filter((f) => !known.has(f.contentHash))];
      });

      const dupes = next.filter((f) => f.duplicate).length;
      if (dupes > 0) toast.info(`${dupes} document${dupes === 1 ? " is" : "s are"} already on file and will be skipped.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read those files.");
    } finally {
      setReading(false);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  };

  const usable = staged.filter((f) => !f.duplicate && !f.unsupported);
  const totalPages = usable.reduce((n, f) => n + f.pageCount, 0);
  const totalCost = usable.reduce((n, f) => n + estimateTierCost(f.pageCount, f.tier), 0);
  const mixedTiers = new Set(usable.map((f) => f.tier)).size > 1;

  const setAllTiers = (tier: HistoryModelTier) =>
    setStaged((prev) => prev.map((f) => ({ ...f, tier })));

  const setTier = (key: string, tier: HistoryModelTier) =>
    setStaged((prev) => prev.map((f) => (f.key === key ? { ...f, tier } : f)));

  const remove = (key: string) => setStaged((prev) => prev.filter((f) => f.key !== key));

  // ── Start the job ──────────────────────────────────────────────────────────
  //
  // Order matters: the job row is created FIRST because its id is part of the staging
  // path, and it starts as 'uploading' so the worker ignores it until every file has
  // landed. Nothing is spent before the final flip to 'queued'.

  const analyse = async () => {
    if (usable.length === 0) return;
    setStarting(true);

    let jobId: string | null = null;
    const uploaded: string[] = [];

    try {
      const { data: created, error: jobErr } = await (supabase as any)
        .from("patient_history_ingest_jobs")
        .insert({
          hospital_id: hospitalId,
          patient_id: patientId,
          encounter_id: encounterId ?? null,
          status: "uploading",
          model_tier: mixedTiers ? "mixed" : (usable[0]?.tier ?? "fast"),
          documents_total: usable.length,
          pages_total: totalPages,
          estimated_cost_inr: totalCost,
          requested_by: userId,
        })
        .select("id")
        .single();
      if (jobErr) throw jobErr;
      jobId = created.id as string;

      const sourceRows: Record<string, unknown>[] = [];
      for (let i = 0; i < usable.length; i++) {
        const f = usable[i];
        const isText = !!f.extractedText;
        const ext = isText ? "txt" : (f.file.name.split(".").pop() || "bin").toLowerCase();
        const path = `${hospitalId}/${patientId}/_staging/${jobId}/${i}_${sanitise(f.file.name)}.${ext}`;

        const body: Blob = isText
          ? new Blob([f.extractedText!], { type: "text/plain" })
          : f.file;

        const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, body, { upsert: true });
        if (upErr) throw upErr;
        uploaded.push(path);

        sourceRows.push({
          hospital_id: hospitalId,
          patient_id: patientId,
          job_id: jobId,
          source_name: f.file.name,
          source_type: "other",
          page_count: f.pageCount,
          content_hash: f.contentHash,
          model_tier: f.tier,
          ingest_status: "pending",
          staged_path: path,
        });
      }

      const { error: srcErr } = await (supabase as any).from("patient_history_sources").insert(sourceRows);
      if (srcErr) throw srcErr;

      await (supabase as any).from("patient_history_ingest_jobs")
        .update({ status: "queued" }).eq("id", jobId);

      // Fire-and-forget. The worker re-invokes itself until the bag is read, and the
      // poll above is what reports progress — awaiting this would block the UI for
      // the entire first 90-second batch.
      void supabase.functions.invoke("ai-history-ingest", { body: { job_id: jobId } });

      setStaged([]);
      notifiedRef.current = null;
      await loadJob();
      toast.success(`Reading ${totalPages} page${totalPages === 1 ? "" : "s"}…`);
    } catch (err) {
      // Clean up whatever landed, so a failed start does not leave patient PHI sitting
      // in staging with no job pointing at it.
      if (uploaded.length > 0) {
        try { await supabase.storage.from(BUCKET).remove(uploaded); } catch { /* the sweep will retry */ }
      }
      if (jobId) {
        await (supabase as any).from("patient_history_ingest_jobs")
          .update({ status: "failed", error_name: "StartFailed", finished_at: new Date().toISOString() })
          .eq("id", jobId);
      }
      toast.error(err instanceof Error ? err.message : "Could not start reading these records.");
    } finally {
      setStarting(false);
    }
  };

  const retryFailed = async () => {
    if (!job) return;
    await supabase.functions.invoke("ai-history-ingest", { body: { job_id: job.id, retry_failed: true } });
    notifiedRef.current = null;
    await loadJob();
    toast.info("Retrying the pages that could not be read…");
  };

  const running = isJobRunning(job?.status);
  const progressPct = job && job.pages_total > 0
    ? Math.round(((job.pages_extracted + job.pages_failed) / job.pages_total) * 100)
    : 0;

  return (
    <div className="border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/30 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ScanLine className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold shrink-0">Old Records from Other Hospitals</span>
          {staged.length > 0 && (
            <Badge variant="secondary" className="text-[9px]">{usable.length} to read</Badge>
          )}
        </div>
        {!running && (
          <div className="flex gap-1 shrink-0">
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={() => cameraRef.current?.click()} disabled={reading}>
              <ImageIcon className="h-3 w-3" /> Photo
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={() => fileRef.current?.click()} disabled={reading}>
              {reading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
              Choose files
            </Button>
          </div>
        )}
      </div>

      <input ref={fileRef} type="file" multiple className="hidden"
        accept="image/jpeg,image/png,image/webp,application/pdf,.docx,.doc,text/plain,.csv"
        onChange={(e) => void addFiles(e.target.files)} />
      {/* A rural clinic has no flatbed scanner. The phone camera IS the scanner. */}
      <input ref={cameraRef} type="file" multiple accept="image/*" capture="environment" className="hidden"
        onChange={(e) => void addFiles(e.target.files)} />

      <div className="p-3 space-y-2">
        {/* ── In-flight job ─────────────────────────────────────────────────── */}
        {running && job && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
              <span className="text-[14px] text-foreground">{STATUS_LABEL[job.status]}</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {job.pages_extracted + job.pages_failed} / {job.pages_total} pages
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div className="h-full bg-primary transition-all" style={{ width: `${progressPct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">
              This continues in the background — you can close this screen and come back to it.
            </p>
          </div>
        )}

        {/* ── Last job result ───────────────────────────────────────────────── */}
        {!running && job && job.status === "partial" && (
          <div className="flex items-start justify-between gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-start gap-2 min-w-0">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[14px] text-amber-800">
                Read {job.pages_extracted} of {job.pages_total} pages. The rest could not be made out —
                they are listed on the history below.
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0 gap-1" onClick={retryFailed}>
              <RefreshCw className="h-3 w-3" /> Retry
            </Button>
          </div>
        )}
        {!running && job && job.status === "failed" && (
          <div className="flex items-start justify-between gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-[14px] text-red-700">
              None of these pages could be read. Re-scan them with better lighting, or choose the
              Accurate setting.
            </p>
            <Button size="sm" variant="outline" className="h-7 text-xs shrink-0" onClick={retryFailed}>
              Retry
            </Button>
          </div>
        )}

        {/* ── Nothing staged, nothing running ───────────────────────────────── */}
        {!running && staged.length === 0 && (
          <p className="text-[14px] text-muted-foreground">
            Photograph or upload the prescriptions, discharge summaries and reports the patient has
            brought from other hospitals. Every page is read and turned into a dated history.
            <span className="block mt-1 text-xs">
              Best done at registration — a 100-page bundle takes a few minutes to read.
              The scans themselves are not stored; only the extracted text is kept.
            </span>
          </p>
        )}

        {/* ── Staged files ──────────────────────────────────────────────────── */}
        {staged.length > 0 && (
          <div className="space-y-1.5">
            {staged.map((f) => (
              <div key={f.key} className={cn(
                "flex items-center gap-2 border rounded-lg px-2.5 py-1.5",
                f.duplicate || f.unsupported ? "bg-muted/40 border-dashed" : "border-border",
              )}>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] text-foreground truncate">{f.file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {f.duplicate
                      ? "Already on file — will be skipped"
                      : f.unsupported
                        ? f.unsupported
                        : `${f.pageCount} page${f.pageCount === 1 ? "" : "s"} · approx ₹${estimateTierCost(f.pageCount, f.tier)}`}
                  </p>
                </div>

                {showPerDoc && !f.duplicate && !f.unsupported && (
                  <select
                    value={f.tier}
                    onChange={(e) => setTier(f.key, e.target.value as HistoryModelTier)}
                    className="h-7 text-xs border border-slate-200 rounded px-1 bg-background shrink-0"
                    aria-label={`Reading quality for ${f.file.name}`}
                  >
                    <option value="fast">{TIER_LABELS.fast.label}</option>
                    <option value="accurate">{TIER_LABELS.accurate.label}</option>
                  </select>
                )}

                <button onClick={() => remove(f.key)} className="text-muted-foreground hover:text-destructive shrink-0"
                  aria-label={`Remove ${f.file.name}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* ── Tier + cost gate ──────────────────────────────────────────────── */}
        {usable.length > 0 && (
          <div className="border rounded-lg p-2.5 space-y-2 bg-muted/20">
            <div className="flex flex-wrap items-center gap-1.5">
              {(["fast", "accurate"] as HistoryModelTier[]).map((tier) => {
                const active = !mixedTiers && usable[0]?.tier === tier;
                return (
                  <button
                    key={tier}
                    onClick={() => setAllTiers(tier)}
                    title={TIER_LABELS[tier].hint}
                    className={cn(
                      "text-[14px] px-3 py-1 rounded-full border transition-colors",
                      active
                        ? "bg-primary/10 border-primary text-primary font-medium"
                        : "bg-background border-slate-200 text-slate-600 hover:bg-muted",
                    )}
                  >
                    {TIER_LABELS[tier].label} · ₹{estimateTierCost(totalPages, tier)}
                  </button>
                );
              })}
              <button
                onClick={() => setShowPerDoc((v) => !v)}
                className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground ml-1"
              >
                {showPerDoc ? "Hide per-document" : "Set per document"}
              </button>
            </div>

            <p className="text-xs text-muted-foreground">
              {TIER_LABELS[mixedTiers ? "accurate" : (usable[0]?.tier ?? "fast")].hint}
              {mixedTiers && " · Mixed settings across documents"}
            </p>

            <Button size="sm" className="h-8 text-xs w-full" onClick={analyse} disabled={starting}>
              {starting
                ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" /> Starting…</>
                : <>Read {usable.length} document{usable.length === 1 ? "" : "s"} · {totalPages} page{totalPages === 1 ? "" : "s"} · approx ₹{totalCost}</>}
            </Button>
          </div>
        )}

        {!running && job && job.status === "complete" && staged.length === 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            Last scan read {job.pages_extracted} page{job.pages_extracted === 1 ? "" : "s"} from{" "}
            {job.documents_total} document{job.documents_total === 1 ? "" : "s"}.
          </div>
        )}
      </div>
    </div>
  );
};

export default PatientHistoryUploadPanel;
