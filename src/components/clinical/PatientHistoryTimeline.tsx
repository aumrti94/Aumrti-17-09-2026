import React, { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, ShieldCheck,
  FileWarning, Pill, Copy, ClipboardPlus, Scale, Loader2,
} from "lucide-react";
import { sortHistoryTimeline, type HistoryDigest, type HistoryEvent } from "@/lib/historyDigest";

/**
 * The doctor-facing view of everything scanned from a patient's outside records.
 *
 * THE COVERAGE BANNER IS THE PRODUCT. Everything else here is a summary any OCR
 * tool could claim to produce. What makes this trustworthy is that it states, at the
 * top, exactly how many pages it managed to read — and names the ones it could not.
 * A green banner over an unread page is the single failure mode that would make the
 * whole feature worse than useless, because a doctor would stop double-checking.
 *
 * PROVENANCE WITHOUT THE FILE. The scans are purged after extraction, so every claim
 * expands to the verbatim transcribed line plus its document and page number. The
 * doctor verifies against the paper the patient is still holding, not against a
 * stored image.
 *
 * SaMD Class B — the summary asserts an active-problem and medication list a doctor
 * could act on. Nothing here writes to the record on its own: the apply actions are
 * explicit, and "Verify & accept" is the attestation gate.
 */

interface Props {
  digest: HistoryDigest | null;
  loading?: boolean;
  userId: string;
  onReviewed?: () => void;
  /** Consultation-only. Absent at registration, where there is no encounter to write to. */
  onInsertToHpi?: (text: string) => void;
  onAddChronicConditions?: (conditions: string[]) => void;
}

const MONTH_FMT = new Intl.DateTimeFormat("en-IN", { month: "long", year: "numeric" });
const DAY_FMT = new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric" });

const TYPE_DOT: Record<string, string> = {
  diagnosis: "bg-violet-500",
  medication: "bg-blue-500",
  investigation: "bg-cyan-500",
  procedure: "bg-orange-500",
  admission: "bg-rose-500",
  allergy: "bg-red-600",
  vaccination: "bg-emerald-500",
  visit: "bg-slate-400",
  note: "bg-slate-300",
};

const UNDATED = "__undated__";

/** Groups an already-sorted timeline by month. Order is preserved — never re-sorted here. */
function groupByMonth(events: HistoryEvent[]): Array<{ key: string; label: string; events: HistoryEvent[] }> {
  const out: Array<{ key: string; label: string; events: HistoryEvent[] }> = [];
  for (const e of events) {
    const key = e.date ? e.date.slice(0, 7) : UNDATED;
    const label = e.date ? MONTH_FMT.format(new Date(e.date)) : "Date not recorded";
    const last = out[out.length - 1];
    if (last && last.key === key) last.events.push(e);
    else out.push({ key, label, events: [e] });
  }
  return out;
}

const formatMedication = (m: { name: string; dose: string | null; frequency: string | null }) =>
  [m.name, m.dose, m.frequency].filter(Boolean).join(" ");

const PatientHistoryTimeline: React.FC<Props> = ({
  digest, loading, userId, onReviewed, onInsertToHpi, onAddChronicConditions,
}) => {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [attesting, setAttesting] = useState(false);
  const [showAll, setShowAll] = useState(false);

  // Re-sorted defensively: the digest is stored ordered, but a row written by an earlier
  // version of ai-history-digest must still render chronologically rather than at random.
  const groups = useMemo(() => groupByMonth(sortHistoryTimeline(digest?.timeline ?? [])), [digest]);
  const visibleGroups = showAll ? groups : groups.slice(0, 6);

  if (loading) {
    return (
      <div className="border rounded-lg px-3 py-2.5 bg-muted/30 flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <span className="text-[14px] text-muted-foreground">Loading previous records…</span>
      </div>
    );
  }
  if (!digest) return null;

  const { summary: s, coverage: c } = digest;
  const complete = c.pages_unreadable === 0 && c.pages_total > 0;
  const verified = !!digest.reviewed_at;

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const attest = async () => {
    setAttesting(true);
    const { error } = await (supabase as any)
      .from("patient_history_digests")
      .update({ reviewed_by: userId, reviewed_at: new Date().toISOString() })
      .eq("id", digest.id);
    setAttesting(false);
    if (error) { toast.error("Could not record your review."); return; }
    toast.success("History accepted. It will now be shown as doctor-verified.");
    onReviewed?.();
  };

  /** Plain text for the HPI. Explicitly labelled — it must never read as this hospital's own note. */
  const hpiText = () => {
    const parts: string[] = [`--- Previous records (from outside documents, ${DAY_FMT.format(new Date())}) ---`];
    if (s.one_liner) parts.push(s.one_liner);
    if (s.active_problems.length) parts.push(`Active problems: ${s.active_problems.map((p) => p.problem).join(", ")}`);
    if (s.current_medications.length) parts.push(`On: ${s.current_medications.map(formatMedication).join(", ")}`);
    if (s.allergies.length) parts.push(`Allergies: ${s.allergies.map((a) => a.substance).join(", ")}`);
    if (s.surgeries.length) parts.push(`Past surgery: ${s.surgeries.map((x) => x.procedure).join(", ")}`);
    parts.push(`(${c.pages_read}/${c.pages_total} scanned pages readable)`);
    parts.push("--- end ---");
    return parts.join("\n");
  };

  const copyMeds = () => {
    const text = s.current_medications.map(formatMedication).join("\n");
    void navigator.clipboard.writeText(text);
    toast.success("Medications copied.");
  };

  return (
    <div className="space-y-2">
      {/* ══ Coverage banner — always first, always honest ══════════════════════ */}
      <div className={cn(
        "flex items-start gap-2 px-3 py-2 rounded-lg border",
        complete ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200",
      )}>
        {complete
          ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
          : <FileWarning className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />}
        <div className="min-w-0 flex-1">
          <p className={cn("text-[14px] font-medium", complete ? "text-emerald-800" : "text-amber-900")}>
            {c.pages_read} of {c.pages_total} page{c.pages_total === 1 ? "" : "s"} read
            {" "}across {c.documents_total} document{c.documents_total === 1 ? "" : "s"}
          </p>
          {!complete && c.unreadable_refs.length > 0 && (
            <p className="text-xs text-amber-800 mt-0.5">
              Could not read:{" "}
              {c.unreadable_refs.slice(0, 6).map((r) =>
                `${r.source_name} p.${r.page_from}${r.page_to > r.page_from ? `–${r.page_to}` : ""}`).join(" · ")}
              {c.unreadable_refs.length > 6 && ` and ${c.unreadable_refs.length - 6} more`}
              {". Use Retry above, or check those pages against the patient's papers."}
            </p>
          )}
          {c.events_truncated && (
            <p className="text-xs text-amber-800 mt-0.5">
              Only the most recent findings are summarised — older scanned records exist.
            </p>
          )}
        </div>
        <Badge
          variant="secondary"
          className={cn("text-[9px] shrink-0", verified
            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
            : "bg-slate-100 text-slate-600 border-slate-200")}
        >
          {verified ? "Doctor-verified" : "Unverified"}
        </Badge>
      </div>

      {/* ══ Summary ═══════════════════════════════════════════════════════════ */}
      <div className="border rounded-lg bg-card p-3 space-y-2">
        {s.one_liner && <p className="text-[14px] font-medium text-foreground">{s.one_liner}</p>}

        {/* Allergies and red flags lead: they are the two things that change what the
            doctor does in the next five minutes. */}
        {s.allergies.length > 0 && (
          <div className="flex items-start gap-2 px-2.5 py-1.5 bg-red-50 border border-red-200 rounded-md">
            <AlertTriangle className="h-3.5 w-3.5 text-red-600 shrink-0 mt-0.5" />
            <p className="text-[14px] text-red-800">
              <span className="font-semibold">Allergies:</span>{" "}
              {s.allergies.map((a) => a.substance + (a.reaction ? ` (${a.reaction})` : "")).join(" · ")}
            </p>
          </div>
        )}
        {s.red_flags.length > 0 && (
          <ul className="space-y-0.5">
            {s.red_flags.map((f, i) => (
              <li key={i} className="flex items-start gap-2 text-[14px] text-red-700">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{f}
              </li>
            ))}
          </ul>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <SummaryList title="Active problems"
            items={s.active_problems.map((p) => p.problem + (p.since ? ` (since ${p.since.slice(0, 4)})` : ""))} />
          <SummaryList title="Current medications"
            items={s.current_medications.map((m) =>
              formatMedication(m) + (m.certainty !== "documented" ? ` — ${m.certainty}` : ""))} />
          <SummaryList title="Past surgery"
            items={s.surgeries.map((x) => x.procedure + (x.date ? ` (${x.date.slice(0, 4)})` : ""))} />
          <SummaryList title="Key results"
            items={s.key_investigations.map((i) => `${i.name} ${i.value}${i.date ? ` (${i.date.slice(0, 7)})` : ""}`)} />
        </div>

        {/* Conflicts are shown UNRESOLVED on purpose — the doctor settles them by asking
            the patient. Silently picking one dose is a prescribing error with a
            confident face on it. */}
        {s.conflicts.length > 0 && (
          <div className="px-2.5 py-1.5 bg-orange-50 border border-orange-200 rounded-md space-y-1">
            <p className="text-xs font-semibold text-orange-800 flex items-center gap-1">
              <Scale className="h-3 w-3" /> The records disagree — confirm with the patient
            </p>
            {s.conflicts.map((c2, i) => (
              <p key={i} className="text-[14px] text-orange-900">
                <span className="font-medium">{c2.topic}:</span>{" "}
                {c2.versions.map((v) => `${v.value}${v.source ? ` (${v.source})` : ""}`).join("  vs  ")}
              </p>
            ))}
          </div>
        )}

        {s.gaps.length > 0 && (
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold">Not covered:</span> {s.gaps.join(" · ")}
          </p>
        )}

        {/* ── Apply actions. Explicit, never automatic (Arnav). ─────────────── */}
        <div className="flex flex-wrap gap-1.5 pt-1">
          {onInsertToHpi && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={() => { onInsertToHpi(hpiText()); toast.success("Added to History of Present Illness."); }}>
              <ClipboardPlus className="h-3 w-3" /> Add to HPI
            </Button>
          )}
          {onAddChronicConditions && s.active_problems.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1"
              onClick={() => onAddChronicConditions(s.active_problems.map((p) => p.problem))}>
              <ShieldCheck className="h-3 w-3" /> Add to chronic conditions
            </Button>
          )}
          {s.current_medications.length > 0 && (
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={copyMeds}>
              <Copy className="h-3 w-3" /> Copy medications
            </Button>
          )}
          {!verified && (
            <Button size="sm" className="h-7 text-xs gap-1 ml-auto" onClick={attest} disabled={attesting}>
              {attesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ShieldCheck className="h-3 w-3" />}
              Verify &amp; accept
            </Button>
          )}
        </div>
        {!verified && (
          <p className="text-xs text-muted-foreground">
            Until a doctor accepts it, this is shown as unverified — including to the AI Guidance cards.
          </p>
        )}
      </div>

      {/* ══ Timeline ══════════════════════════════════════════════════════════ */}
      {digest.timeline.length > 0 && (
        <div className="space-y-2">
          {visibleGroups.map((g) => (
            <div key={g.key}>
              <p className="text-xs font-bold text-slate-600 mb-1">{g.label}</p>
              <div className="space-y-1">
                {g.events.map((e) => {
                  const open = expanded.has(e.id);
                  return (
                    <div key={e.id} className={cn(
                      "border rounded-lg px-2.5 py-1.5",
                      e.red_flag ? "border-red-200 bg-red-50/40" : "border-border bg-card",
                    )}>
                      <div className="flex items-start gap-2">
                        <span className={cn("h-2 w-2 rounded-full shrink-0 mt-1.5", TYPE_DOT[e.type] ?? "bg-slate-300")} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2 flex-wrap">
                            <span className="text-[14px] font-medium text-foreground">{e.title}</span>
                            {e.date && (
                              <span className="text-xs text-muted-foreground">
                                {DAY_FMT.format(new Date(e.date))}
                                {e.date_confidence === "approximate" && " (approx.)"}
                              </span>
                            )}
                            {e.facility && <span className="text-xs text-muted-foreground">· {e.facility}</span>}
                            {e.red_flag && (
                              <Badge variant="secondary" className="text-[9px] bg-red-100 text-red-700 border-red-200">
                                red flag
                              </Badge>
                            )}
                          </div>
                          {e.detail && <p className="text-[14px] text-slate-700 mt-0.5">{e.detail}</p>}

                          {e.values.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {e.values.map((v, i) => (
                                <Badge key={i} variant="secondary" className="text-[9px] font-normal">
                                  {v.name} {v.value}{v.unit ?? ""}{v.ref ? ` (ref ${v.ref})` : ""}
                                </Badge>
                              ))}
                            </div>
                          )}
                          {e.medications.length > 0 && (
                            <p className="text-xs text-slate-600 mt-1 flex items-start gap-1">
                              <Pill className="h-3 w-3 shrink-0 mt-0.5" />
                              {e.medications.map(formatMedication).join(" · ")}
                            </p>
                          )}

                          {/* Source chip. With the scan purged, expanding this is the only
                              way to see what the paper actually said — so it is a first-class
                              control, not a debug affordance. */}
                          <button
                            onClick={() => toggle(e.id)}
                            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                          >
                            {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            {e.source.source_name}, p.{e.source.page_from}
                            {e.source.page_to > e.source.page_from ? `–${e.source.page_to}` : ""}
                            {e.also_in?.length ? ` +${e.also_in.length} more` : ""}
                          </button>

                          {open && (
                            <div className="mt-1 px-2.5 py-1.5 bg-muted/50 border border-border rounded-md">
                              <p className="text-xs font-semibold text-slate-600 mb-0.5">As written on the page</p>
                              <p className="text-[14px] text-slate-700 whitespace-pre-wrap">
                                {e.verbatim || "No transcription was recorded for this entry."}
                              </p>
                              {e.also_in?.length ? (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Also recorded in:{" "}
                                  {e.also_in.map((a) => `${a.source_name} p.${a.page_from}`).join(" · ")}
                                </p>
                              ) : null}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {groups.length > visibleGroups.length && (
            <Button size="sm" variant="ghost" className="h-7 text-xs w-full" onClick={() => setShowAll(true)}>
              Show {groups.length - visibleGroups.length} earlier period
              {groups.length - visibleGroups.length === 1 ? "" : "s"}
            </Button>
          )}
        </div>
      )}
    </div>
  );
};

const SummaryList: React.FC<{ title: string; items: string[] }> = ({ title, items }) => {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-600">{title}</p>
      <ul className="mt-0.5 space-y-0.5">
        {items.map((t, i) => (
          <li key={i} className="text-[14px] text-slate-700 leading-snug">• {t}</li>
        ))}
      </ul>
    </div>
  );
};

export default PatientHistoryTimeline;
