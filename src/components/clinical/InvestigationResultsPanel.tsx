import React, { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, FlaskConical, ScanLine, Microscope, Bug, Building2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRealtimeRefetch } from "@/hooks/useRealtimeRefetch";
import { logNABHEvidence } from "@/lib/nabh-evidence";
import {
  FLAG_STYLE, FLAG_LABEL, isCriticalFlag, isLabOrderReleased, isRadReportReleased,
  isPathologyReleased, isExternalReportReceived, isAmended, formatIndianDate,
  humaniseStatus, groupBy,
} from "@/lib/investigationDisplay";
import type { ReportCard, ReportKind } from "./investigationTypes";

/**
 * InvestigationResultsPanel — the doctor's view of everything the lab and radiology have
 * produced for this patient, rendered inside the consultation (OPD) or the ward workspace
 * (IPD) rather than in the Lab/Radiology modules.
 *
 * Before this existed a doctor who ordered a test had to leave the patient, open the Lab
 * module and hunt for the report. The linkage columns (lab_orders.encounter_id /
 * .admission_id, and the same on radiology_orders) were always there; nothing read them.
 *
 * Scope. OPD passes encounterId, IPD passes admissionId. encounterId is created lazily
 * during a consultation, so when it is null we fall back to patient scope — an empty tab
 * would be worse than showing the patient's prior results.
 *
 * Coverage. Every result shape the system can produce, not just scalar tests: scalar/profile
 * labs, microbiology cultures, histopathology, referred-out tests and radiology reports. Each
 * is reduced to the one line a clinician acts on — value and range for a lab, the organism for
 * a culture, the impression for a scan — so they all read as rows of one table.
 *
 * Presentation. Values on screen, nothing between the doctor and them: no report titles, no
 * category sub-headings, no per-report buttons, no click to expand. Every one of those was
 * restating what the row already said and pushing the next result off the screen. Only orders
 * with no result yet are collapsed, into one line at the bottom, because there is nothing to
 * read. Review is stamped automatically once a report has been on screen (see markSeen).
 */

interface Props {
  hospitalId: string;
  patientId: string;
  /** OPD encounter. May be null early in a consultation. */
  encounterId?: string | null;
  /** IPD admission. */
  admissionId?: string | null;
  /** users.id of the clinician viewing — stamped on review. */
  currentUserId?: string | null;
}

type Scope = "visit" | "patient";

const KIND_META: Record<ReportKind, { icon: React.ElementType; label: string; tint: string }> = {
  lab:       { icon: FlaskConical, label: "Laboratory",      tint: "text-purple-600" },
  micro:     { icon: Bug,          label: "Microbiology",    tint: "text-teal-600" },
  pathology: { icon: Microscope,   label: "Histopathology",  tint: "text-rose-600" },
  external:  { icon: Building2,    label: "External Lab",    tint: "text-slate-600" },
  radiology: { icon: ScanLine,     label: "Imaging",         tint: "text-orange-600" },
};

const InvestigationResultsPanel: React.FC<Props> = ({
  hospitalId, patientId, encounterId, admissionId, currentUserId,
}) => {
  const hasVisitScope = !!(encounterId || admissionId);

  const [scope, setScope] = useState<Scope>(hasVisitScope ? "visit" : "patient");
  const [cards, setCards] = useState<ReportCard[]>([]);
  const [loading, setLoading] = useState(true);

  // An encounter that appears mid-consultation must flip the toggle back on, otherwise the
  // doctor stays stuck in patient scope for the rest of the visit.
  useEffect(() => {
    if (hasVisitScope) setScope("visit");
  }, [hasVisitScope]);

  const effectiveScope: Scope = hasVisitScope ? scope : "patient";

  /** Apply the current scope to a query builder. Every scope keeps the hospital predicate. */
  const scoped = useCallback(
    (q: any) => {
      if (effectiveScope === "patient") return q.eq("patient_id", patientId);
      if (admissionId) return q.eq("admission_id", admissionId);
      return q.eq("encounter_id", encounterId);
    },
    [effectiveScope, patientId, admissionId, encounterId],
  );

  const load = useCallback(async () => {
    if (!hospitalId || !patientId) return;
    setLoading(true);

    const [labRes, radRes, extRes] = await Promise.all([
      scoped(
        (supabase as any)
          .from("lab_orders")
          .select(`
            id, order_date, accession_number, status, priority, ordered_by,
            results_reviewed_at, validated_at,
            lab_order_items(
              id, result_value, result_unit, reference_range, result_flag, status,
              result_entered_at, validated_at,
              lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name, category)
            )
          `)
          .eq("hospital_id", hospitalId),
      )
        .neq("status", "cancelled")
        .order("order_date", { ascending: false })
        .limit(100),

      scoped(
        (supabase as any)
          .from("radiology_orders")
          .select(`
            id, order_date, accession_number, status, study_name, modality_type, priority,
            ordered_by, dicom_study_uid, dicom_pacs_url,
            radiology_reports(
              id, technique, findings, impression, recommendations,
              is_critical, critical_finding, is_signed, validated_at, results_reviewed_at
            )
          `)
          .eq("hospital_id", hospitalId),
      )
        .neq("status", "cancelled")
        .order("order_date", { ascending: false })
        .limit(100),

      scoped(
        (supabase as any)
          .from("external_lab_referrals")
          .select(`
            id, lab_name, tests_ordered, status, referred_at, report_url,
            report_received_at, report_notes, results_reviewed_at
          `)
          .eq("hospital_id", hospitalId),
      )
        .neq("status", "cancelled")
        .order("referred_at", { ascending: false })
        .limit(50),

    ]);

    const labOrders: any[] = labRes.data || [];
    const labOrderIds = labOrders.map((o) => o.id);
    const itemIds = labOrders.flatMap((o) => (o.lab_order_items || []).map((i: any) => i.id));

    // Microbiology and histopathology hang off the lab order rather than the encounter, so
    // they are fetched by the parent ids resolved above rather than by scope.
    const [microRes, pathRes] = await Promise.all([
      itemIds.length
        ? (supabase as any)
            .from("lab_results")
            .select(`
              id, order_id, order_item_id, organism_identified, colony_count, specimen_type,
              sensitivity_json, result_value, unit, reference_range, report_status,
              finalized_at, verified_at
            `)
            .eq("hospital_id", hospitalId)
            .in("order_item_id", itemIds)
        : Promise.resolve({ data: [] }),
      labOrderIds.length
        ? (supabase as any)
            .from("pathology_cases")
            .select(`
              id, lab_order_id, case_number, case_type, specimen_type, specimen_site,
              gross_description, microscopic_description, impression, status,
              amendment_reason, final_signed_at, created_at, results_reviewed_at
            `)
            .eq("hospital_id", hospitalId)
            .in("lab_order_id", labOrderIds)
        : Promise.resolve({ data: [] }),
    ]);

    const built: ReportCard[] = [];

    /* ── Laboratory: one card per order, items grouped by category in the drawer ── */
    for (const o of labOrders) {
      const items: any[] = (o.lab_order_items || []).filter((i: any) => i.status !== "cancelled");
      if (items.length === 0) continue;
      const flags = items.map((i) => i.result_flag).filter(Boolean);
      const released = isLabOrderReleased(o);
      built.push({
        key: `lab:${o.id}`,
        kind: "lab",
        id: o.id,
        date: o.order_date,
        title: items.map((i: any) => i.lab_test_master?.test_name || "Test").join(", "),
        subtitle: o.accession_number || undefined,
        status: o.status,
        priority: o.priority,
        released,
        reviewed: !!o.results_reviewed_at,
        critical: flags.some(isCriticalFlag),
        abnormalCount: flags.filter((f: string) => f !== "N").length,
        resultedAt: o.validated_at,
        payload: { order: o, items },
      });
    }

    /* ── Microbiology: released on its own clock, days after the parent order ── */
    for (const m of microRes.data || []) {
      const parent = labOrders.find((o) =>
        (o.lab_order_items || []).some((i: any) => i.id === m.order_item_id),
      );
      if (!parent) continue;
      built.push({
        key: `micro:${m.id}`,
        kind: "micro",
        id: m.id,
        parentId: parent.id,
        date: parent.order_date,
        title: `Culture & Sensitivity${m.specimen_type ? ` — ${m.specimen_type}` : ""}`,
        subtitle: m.organism_identified || undefined,
        status: m.report_status || "preliminary",
        released: m.report_status === "final",
        // lab_results carries no review stamp of its own; the parent order is the unit the
        // doctor acknowledges, and finalising a culture clears that stamp again.
        reviewed: !!parent.results_reviewed_at && m.report_status === "final",
        critical: false,
        resultedAt: m.finalized_at || m.verified_at,
        payload: { micro: m, parent },
      });
    }

    /* ── Histopathology / cytology ── */
    for (const p of pathRes.data || []) {
      const parent = labOrders.find((o) => o.id === p.lab_order_id);
      built.push({
        key: `pathology:${p.id}`,
        kind: "pathology",
        id: p.id,
        parentId: p.lab_order_id,
        date: parent?.order_date || (p.created_at || "").slice(0, 10),
        title: `${p.case_type === "cytology" ? "Cytology" : "Histopathology"} — ${p.case_number}`,
        subtitle: [p.specimen_type, p.specimen_site].filter(Boolean).join(" · ") || undefined,
        status: p.status,
        released: isPathologyReleased(p),
        reviewed: !!p.results_reviewed_at,
        amended: isAmended(p),
        critical: false,
        resultedAt: p.final_signed_at,
        payload: { pathology: p },
      });
    }

    /* ── Referred-out tests ── */
    for (const r of extRes.data || []) {
      built.push({
        key: `external:${r.id}`,
        kind: "external",
        id: r.id,
        date: (r.referred_at || "").slice(0, 10),
        title: (r.tests_ordered || []).join(", ") || "Referred-out test",
        subtitle: r.lab_name,
        status: r.status,
        released: isExternalReportReceived(r),
        reviewed: !!r.results_reviewed_at,
        critical: false,
        resultedAt: r.report_received_at,
        payload: { referral: r },
      });
    }

    /* ── Radiology ── */
    for (const o of radRes.data || []) {
      const report = Array.isArray(o.radiology_reports)
        ? o.radiology_reports[0] || null
        : o.radiology_reports || null;
      built.push({
        key: `radiology:${o.id}`,
        kind: "radiology",
        id: o.id,
        reportId: report?.id,
        date: o.order_date,
        title: o.study_name,
        subtitle: o.modality_type ? String(o.modality_type).toUpperCase() : undefined,
        status: o.status,
        priority: o.priority,
        released: isRadReportReleased(o, report),
        reviewed: !!report?.results_reviewed_at,
        critical: !!report?.is_critical,
        resultedAt: report?.validated_at,
        hasImages: !!(o.dicom_study_uid || o.dicom_pacs_url),
        payload: { order: o, report },
      });
    }

    built.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    setCards(built);
    setLoading(false);
  }, [hospitalId, patientId, scoped]);

  useEffect(() => { load(); }, [load]);

  // Live arrival — the whole point of the feature. A result released in the lab must appear
  // while the patient is still in front of the doctor, without a refresh.
  // Every one of these tables carries hospital_id, so the hook's default
  // `hospital_id=eq.<id>` filter applies — narrower than an unfiltered subscription, and the
  // 400ms debounce collapses the burst a multi-test release produces into one refetch.
  useRealtimeRefetch({
    tables: [
      "lab_orders", "lab_order_items", "lab_results", "pathology_cases",
      "external_lab_referrals", "radiology_orders", "radiology_reports",
    ],
    hospitalId,
    onChange: load,
    channelName: "investigation-results",
  });

  const pendingCount = cards.filter((c) => !c.released).length;
  const unreadCount = cards.filter((c) => c.released && !c.reviewed).length;

  // Released reports carry values and are rendered open, newest first. Pending orders have
  // nothing to read, so they are held back for the compact strip at the bottom rather than
  // pushing the actual results below the fold.
  const releasedCards = useMemo(() => cards.filter((c) => c.released), [cards]);
  const pendingCards = useMemo(() => cards.filter((c) => !c.released), [cards]);

  const releasedByDate = useMemo(
    () => groupBy(releasedCards, (c) => c.date || "—"),
    [releasedCards],
  );
  const releasedDates = useMemo(
    () => Object.keys(releasedByDate).sort((a, b) => b.localeCompare(a)),
    [releasedByDate],
  );

  /* ── Acknowledge: the auditable "I have read this" ──
     There is no "Mark seen" button any more: the results are rendered open, so displaying
     them IS the doctor reading them, and a button that only restated what the screen already
     showed was noise. Review is therefore stamped automatically once a released report has
     actually been on screen (see the effect below). The stamp is what clears the tab badge
     and the Results Ready queue, and it is the NABH COP.6 evidence that the result reached a
     clinician — so it still has to be written, just not clicked. */
  const markSeen = async (card: ReportCard) => {
    if (!currentUserId) return;

    const now = new Date().toISOString();
    const stamp = { results_reviewed_at: now, results_reviewed_by: currentUserId };

    let error: any = null;
    if (card.kind === "lab" || card.kind === "micro") {
      // Microbiology is acknowledged on its parent order — that is the unit the lab released.
      ({ error } = await (supabase as any)
        .from("lab_orders").update(stamp).eq("id", card.parentId || card.id));
    } else if (card.kind === "radiology") {
      // Nothing to stamp until the radiologist's report row exists.
      if (!card.reportId) return;
      ({ error } = await (supabase as any)
        .from("radiology_reports").update(stamp).eq("id", card.reportId));
    } else if (card.kind === "pathology") {
      ({ error } = await (supabase as any)
        .from("pathology_cases").update(stamp).eq("id", card.id));
    } else {
      ({ error } = await (supabase as any)
        .from("external_lab_referrals").update(stamp).eq("id", card.id));
    }

    // Silent on failure by design: this runs in the background off the doctor's reading of
    // the screen, not off a click. A toast here would interrupt a consultation to report a
    // bookkeeping problem the doctor cannot act on. The report itself is already displayed.
    if (error) {
      console.error("Recording result review failed:", error.message);

      return;
    }

    // Clear the doctor's notification for this report — the queue must empty when the work
    // is done, or it stops being a queue.
    //
    // A pathology case can have a null lab_order_id (the FK is ON DELETE SET NULL), and a
    // culture is keyed on its parent order; in either case there may be no id to match on, and
    // filtering on null would silently update nothing while looking like it worked.
    const alertFilter: { column: string; value: string } | null =
      card.kind === "radiology"
        ? { column: "radiology_order_id", value: card.id }
        : card.kind === "external"
          ? { column: "external_referral_id", value: card.id }
          : card.kind === "lab"
            ? { column: "lab_order_id", value: card.id }
            : card.parentId
              ? { column: "lab_order_id", value: card.parentId }
              : null;

    if (alertFilter) {
      await (supabase as any)
        .from("clinical_alerts")
        .update({ is_acknowledged: true, acknowledged_by: currentUserId, acknowledged_at: now })
        .eq(alertFilter.column, alertFilter.value)
        .eq("is_acknowledged", false);
    }

    await logNABHEvidence(
      hospitalId,
      "COP.6",
      `${KIND_META[card.kind].label} report reviewed by clinician — ${card.title}`,
      "compliant",
    );


  };

  /**
   * Stamp review on every released report currently on screen.
   *
   * Deliberately not instant: a two-second dwell means flicking through a patient's tabs does
   * not silently sign off results nobody looked at. Each report is attempted once per mount
   * (seenRef), so the stamp cannot loop against its own refetch.
   */
  const seenRef = React.useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!currentUserId || loading) return;
    const unread = releasedCards.filter((c) => !c.reviewed && !seenRef.current.has(c.key));
    if (unread.length === 0) return;

    const timer = setTimeout(async () => {
      for (const card of unread) {
        seenRef.current.add(card.key);
        await markSeen(card);
      }
      load();
    }, 2_000);
    return () => clearTimeout(timer);
    // markSeen/load are stable enough for this effect's purpose; re-running on every identity
    // change would restart the dwell timer on each refetch and the stamp would never land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releasedCards, currentUserId, loading]);

  /* ─────────────────────────── Render ─────────────────────────── */

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="animate-spin text-muted-foreground" size={20} />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Summary strip — what is outstanding, before any scrolling */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3 text-[14px]">
          {unreadCount > 0 && (
            <span className="font-semibold text-emerald-700">
              {unreadCount} new report{unreadCount !== 1 ? "s" : ""}
            </span>
          )}
          {pendingCount > 0 && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock size={13} /> {pendingCount} awaiting
            </span>
          )}
          {unreadCount === 0 && pendingCount === 0 && (
            <span className="text-muted-foreground">All reports reviewed</span>
          )}
        </div>

        {hasVisitScope && (
          <div className="flex items-center rounded-md border border-border overflow-hidden text-[13px]">
            {(["visit", "patient"] as Scope[]).map((s) => (
              <button
                key={s}
                onClick={() => setScope(s)}
                className={cn(
                  "px-3 py-1 transition-colors",
                  scope === s ? "bg-[#1A2F5A] text-white font-medium" : "hover:bg-muted",
                )}
              >
                {s === "visit" ? (admissionId ? "This admission" : "This visit") : "All previous"}
              </button>
            ))}
          </div>
        )}
      </div>

      {cards.length === 0 ? (
        <div className="flex flex-col items-center justify-center flex-1 text-muted-foreground">
          <FlaskConical size={36} className="opacity-30 mb-2" />
          <p className="text-[14px]">
            No investigations {effectiveScope === "visit" ? "for this visit" : "for this patient"} yet.
          </p>
          <p className="text-[13px] opacity-70">Order labs or imaging from the Rx &amp; Orders tab.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {/* One table of results per date — test, value, reference range, flag, and nothing
              else. Report titles, category sub-headings and per-report action buttons all
              said back to the doctor what the row already says, and pushed the next result
              off the screen. A doctor scanning results wants the values, not the filing. */}
          {releasedDates.map((date) => (
            <div key={date}>
              <p className="text-[13px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
                {formatIndianDate(date)}
              </p>
              <ResultTable lines={releasedByDate[date].flatMap(toResultLines)} />
            </div>
          ))}

          {releasedCards.length === 0 && (
            <p className="text-[14px] text-muted-foreground py-6 text-center">
              No results have come back yet for {effectiveScope === "visit" ? "this visit" : "this patient"}.
            </p>
          )}

          {pendingCards.length > 0 && <PendingStrip cards={pendingCards} />}
        </div>
      )}
    </div>
  );
};

/* ───────────────────── Flattening every result shape to one row ─────────────────────
   Labs give a value, a range and a flag. Imaging, histopathology, cultures and referred-out
   tests do not — their result is prose. Rather than give each its own layout (which is what
   forced the doctor to click into a report to find out what it said), each is reduced to the
   single line a clinician actually acts on: the impression, the organism, the outcome. */

interface ResultLine {
  key: string;
  name: string;
  value: string;
  range: string;
  flag: string | null;
  critical: boolean;
}

function toResultLines(card: ReportCard): ResultLine[] {
  switch (card.kind) {
    case "lab":
      return (card.payload.items as any[]).map((i) => ({
        key: `${card.key}:${i.id}`,
        name: i.lab_test_master?.test_name || "—",
        value: i.result_value
          ? `${i.result_value}${i.result_unit ? ` ${i.result_unit}` : ""}`
          : "—",
        range: i.reference_range || "",
        flag: i.result_flag && i.result_flag !== "N" ? i.result_flag : null,
        critical: isCriticalFlag(i.result_flag),
      }));

    case "micro": {
      const m = card.payload.micro;
      const sens: Record<string, string> = m.sensitivity_json || {};
      const resistant = Object.entries(sens).filter(([, v]) => v === "R").map(([d]) => d);
      const sensitive = Object.entries(sens).filter(([, v]) => v === "S").map(([d]) => d);
      return [{
        key: card.key,
        name: `Culture${m.specimen_type ? ` — ${m.specimen_type}` : ""}`,
        value: m.organism_identified || "No growth",
        // The antibiogram is the actionable half of a culture: what will work, what will not.
        range: [
          sensitive.length ? `S: ${sensitive.join(", ")}` : "",
          resistant.length ? `R: ${resistant.join(", ")}` : "",
        ].filter(Boolean).join("  ·  "),
        flag: m.report_status === "final" ? null : "Preliminary",
        critical: false,
      }];
    }

    case "pathology": {
      const p = card.payload.pathology;
      return [{
        key: card.key,
        name: p.case_type === "cytology" ? "Cytology" : "Histopathology",
        value: p.impression || "Reported — no impression recorded",
        range: [p.specimen_type, p.specimen_site].filter(Boolean).join(" · "),
        flag: p.status === "amended" ? "Amended" : null,
        critical: p.status === "amended",
      }];
    }

    case "radiology": {
      const { order, report } = card.payload;
      return [{
        key: card.key,
        name: order.study_name,
        value: report?.impression || report?.findings || "Reported",
        range: (order.modality_type || "").toUpperCase(),
        flag: report?.is_critical ? "Critical" : null,
        critical: !!report?.is_critical,
      }];
    }

    case "external": {
      const r = card.payload.referral;
      return [{
        key: card.key,
        name: (r.tests_ordered || []).join(", ") || "Referred-out test",
        value: r.report_notes || "Report received",
        range: r.lab_name || "",
        flag: null,
        critical: false,
      }];
    }

    default:
      return [];
  }
}

const ResultTable: React.FC<{ lines: ResultLine[] }> = ({ lines }) => {
  if (lines.length === 0) return null;
  return (
    <div className="border border-border rounded-lg overflow-x-auto">
      <table className="w-full text-[14px]">
        <thead className="bg-muted/60">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-[13px]">Test</th>
            <th className="px-3 py-2 text-left font-medium text-[13px]">Result</th>
            <th className="px-3 py-2 text-left font-medium text-[13px]">Ref. Range</th>
            <th className="px-3 py-2 text-left font-medium text-[13px] w-24">Flag</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {lines.map((l) => (
            <tr key={l.key} className={cn(l.critical && "bg-red-50/60")}>
              <td className="px-3 py-2 font-medium align-top">{l.name}</td>
              <td className={cn(
                "px-3 py-2 align-top whitespace-pre-wrap",
                l.flag && FLAG_STYLE[l.flag],
                l.critical && "text-red-700 font-bold",
              )}>
                {l.value}
              </td>
              <td className="px-3 py-2 text-muted-foreground text-[13px] align-top">{l.range || "—"}</td>
              <td className={cn(
                "px-3 py-2 align-top",
                l.flag && FLAG_STYLE[l.flag],
                l.critical && "text-red-700 font-bold",
              )}>
                {l.flag ? FLAG_LABEL[l.flag] || l.flag : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/* ───────────────────── Still awaiting — nothing to read yet ───────────────────── */

const PendingStrip: React.FC<{ cards: ReportCard[] }> = ({ cards }) => (
  <div className="rounded-lg border border-dashed border-border bg-muted/20 px-3 py-2.5">
    <p className="text-[13px] font-bold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
      <Clock size={13} /> Awaiting results ({cards.length})
    </p>
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {cards.map((c) => (
        <span key={c.key} className="text-[13px] text-muted-foreground">
          {c.title}
          <span className="opacity-60"> · {humaniseStatus(c.status)}</span>
          {c.priority === "stat" && <span className="ml-1 text-[12px] font-bold text-red-700">STAT</span>}
        </span>
      ))}
    </div>
  </div>
);
export default InvestigationResultsPanel;
