/**
 * Printable investigation reports — lab, microbiology, histopathology and radiology.
 *
 * Lifted out of PatientTimelineDrawer so the OPD/IPD Reports panel and the timeline print
 * the same document. Previously the drawer held these as closures over its own component
 * state, which is why no other screen could offer "print this report".
 *
 * All four take a patient header block explicitly rather than reading component state, and
 * fetch hospital branding themselves via fetchHospitalBrand() — printHeader()/printDocument()
 * read that from their module cache, so it must be warmed before either is called.
 */

import { supabase } from "@/integrations/supabase/client";
import { printDocument, printHeader, fetchHospitalBrand } from "@/lib/printUtils";
import {
  FLAG_LABEL, isAbnormalFlag, isCriticalFlag, isLabItemReleased, isRadReportReleased,
} from "@/lib/investigationDisplay";

export interface PrintPatient {
  full_name: string;
  uhid?: string | null;
  gender?: string | null;
  dob?: string | null;
}

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function ageStr(dob: string | null | undefined): string {
  if (!dob) return "";
  const y = Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000));
  return Number.isFinite(y) ? `${y}y` : "";
}

function patientRow(patient: PrintPatient): string {
  const age = ageStr(patient.dob);
  return `<div class="row"><span class="label">Patient</span><span>${esc(patient.full_name)}${
    patient.uhid ? ` · <span style="font-family:monospace">${esc(patient.uhid)}</span>` : ""
  }${age ? ` · ${age}` : ""}${patient.gender ? ` / ${esc(patient.gender)}` : ""}</span></div>`;
}

async function header(hospitalId: string, subtitle: string): Promise<string> {
  const brand = await fetchHospitalBrand(supabase, hospitalId);
  return printHeader(brand.name, subtitle);
}

/* ────────────── Results summary, for embedding in a prescription ────────────── */

export interface InvestigationResultsBlock {
  /** Ready-to-embed HTML. "" when nothing has been released yet. */
  html: string;
  /**
   * Lowercased names of tests/studies that already have a released result. The caller drops
   * these from its "ordered" list so a test is not printed once as ordered and again with its
   * value — the sheet should say either "I asked for this" or "here is what came back".
   */
  resultedNames: Set<string>;
}

const EMPTY_RESULTS_BLOCK: InvestigationResultsBlock = { html: "", resultedNames: new Set() };

/**
 * Above this many results, print them as two Test/Result pairs side by side instead of one long
 * list. A full-width row for "HbA1c … 5 %" wastes most of the page: eleven tests ran to eleven
 * rows with two-thirds of each line blank, pushing the signature block onto a second sheet.
 *
 * Not lower than this: below ~7 rows the two columns are shorter than the header that labels
 * them, and a four-row list split into 2+2 reads worse than it did as 4.
 */
const RESULTS_TWO_COLUMN_MIN = 7;

/** One Test/Result table. Used alone, or twice side by side. */
function resultsTable(rows: string[]): string {
  return `<table style="width:100%;border-collapse:collapse;margin:0;">
    <thead><tr>
      <th style="text-align:left;">Test</th>
      <th style="text-align:right;">Result</th>
    </tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

/**
 * Lay the result rows out in one column, or two when there are enough to be worth splitting.
 *
 * The outer wrapper is a table rather than flex/CSS-columns on purpose: this HTML is handed to
 * a print window and then to a printer driver, and a two-cell table is the one layout every
 * print path renders identically. CSS `column-count` in particular is free to break a row
 * across the column boundary, which would put a test name in one column and its value in the
 * other — worse than the wasted space it set out to fix.
 *
 * The split is balanced with the taller half on the left, so an odd count leaves the ragged
 * edge at the bottom right where it reads as "end of list".
 */
function renderResultColumns(rows: string[]): string {
  if (!rows.length) return "";
  if (rows.length < RESULTS_TWO_COLUMN_MIN) return resultsTable(rows);

  const half = Math.ceil(rows.length / 2);
  const [left, right] = [rows.slice(0, half), rows.slice(half)];
  // The wrapper's own cells must shed the global `td` border and padding, or each column gets
  // an underline and 8px of inset it did not ask for.
  const cell = "border:none;padding:0;vertical-align:top;width:50%;";
  return `<table style="width:100%;border-collapse:collapse;margin:8px 0;">
    <tr>
      <td style="${cell}padding-right:16px;">${resultsTable(left)}</td>
      <td style="${cell}">${resultsTable(right)}</td>
    </tr>
  </table>`;
}

/**
 * Everything the lab and radiology have RELEASED for one visit, as a block to drop into the
 * OPD prescription.
 *
 * Why this belongs on the prescription: the patient walks out with one sheet. Before this, that
 * sheet listed the tests the doctor asked for and nothing about what came back, so a patient
 * whose sodium was 150 carried a page that did not say so. The results were on screen in the
 * Reports tab and nowhere on paper.
 *
 * ABNORMAL RESULTS ARE BOLD, and critical ones are bold and red with an explicit label. That is
 * the whole point of printing them: a row of numbers a patient cannot interpret is close to
 * useless, whereas "this one is out of range" survives being read in a corridor. The flag rules
 * come from lib/investigationDisplay so paper and screen can never disagree about what counts
 * as abnormal — a CH that renders red on screen and plain on paper is a patient-safety bug,
 * not a styling one.
 *
 * Only RELEASED results are included (isLabItemReleased / isRadReportReleased). A half-entered
 * value nobody has validated must never reach a patient's hands.
 */
export async function buildInvestigationResultsHtml(opts: {
  hospitalId: string;
  encounterId?: string | null;
}): Promise<InvestigationResultsBlock> {
  const { hospitalId, encounterId } = opts;
  if (!hospitalId || !encounterId) return EMPTY_RESULTS_BLOCK;

  const [{ data: labOrders }, { data: radOrders }] = await Promise.all([
    (supabase as any)
      .from("lab_orders")
      .select(`
        id, order_date,
        lab_order_items(
          result_value, result_unit, reference_range, result_flag, status,
          lab_test_master:lab_test_master!lab_order_items_test_id_fkey(test_name)
        )
      `)
      .eq("hospital_id", hospitalId)
      .eq("encounter_id", encounterId)
      .neq("status", "cancelled"),
    (supabase as any)
      .from("radiology_orders")
      .select("id, study_name, modality_type, status, radiology_reports(impression, is_critical, critical_finding, is_signed)")
      .eq("hospital_id", hospitalId)
      .eq("encounter_id", encounterId)
      .neq("status", "cancelled"),
  ]);

  const resultedNames = new Set<string>();

  const labRows: string[] = [];
  for (const order of labOrders || []) {
    for (const item of order.lab_order_items || []) {
      const name = item.lab_test_master?.test_name;
      if (!name || !isLabItemReleased(item) || !item.result_value) continue;
      resultedNames.add(name.toLowerCase().trim());

      const critical = isCriticalFlag(item.result_flag);
      const abnormal = isAbnormalFlag(item.result_flag);
      // Bold the whole row, not just the flag cell: the value is what the reader is scanning
      // for, and bolding only the far-right column loses the association on a printed page.
      const rowStyle = critical
        ? "font-weight:bold;color:#b91c1c;background:#fef2f2;"
        : abnormal
          ? "font-weight:bold;"
          : "";
      // Reference range and flag columns are deliberately not printed — the sheet carries the
      // value and whether it is abnormal, nothing more. Bold does the flag column's job.
      //
      // The one thing that does NOT collapse into bold is a CRITICAL value, so it is spelled
      // out beside the result instead of being dropped with the column. Red and bold alone do
      // not survive a monochrome printer or a photocopy, and "this number needs a doctor now"
      // is not a formatting detail.
      labRows.push(`<tr style="${rowStyle}">
        <td>${esc(name)}</td>
        <td style="text-align:right;white-space:nowrap;">${esc(item.result_value)}${item.result_unit ? ` ${esc(item.result_unit)}` : ""}${
          critical ? ` — ${esc(FLAG_LABEL[item.result_flag] || "CRITICAL")} — NOTIFY DOCTOR` : ""
        }</td>
      </tr>`);
    }
  }

  const radBlocks: string[] = [];
  for (const order of radOrders || []) {
    const report = Array.isArray(order.radiology_reports)
      ? order.radiology_reports[0] || null
      : order.radiology_reports || null;
    if (!report || !isRadReportReleased(order, report)) continue;
    const name = order.study_name;
    if (name) resultedNames.add(name.toLowerCase().trim());

    const critical = !!report.is_critical;
    radBlocks.push(`<div style="margin:0 0 8px 0;${critical ? "font-weight:bold;color:#b91c1c;" : ""}">
      <div><b>${esc(name || order.modality_type || "Study")}</b>${critical ? " — CRITICAL FINDING" : ""}</div>
      ${report.impression ? `<div style="white-space:pre-wrap;margin-left:12px;">${esc(report.impression)}</div>` : ""}
      ${critical && report.critical_finding ? `<div style="margin-left:12px;">${esc(report.critical_finding)}</div>` : ""}
    </div>`);
  }

  if (!labRows.length && !radBlocks.length) return EMPTY_RESULTS_BLOCK;

  const html = `
    <div class="section-title" style="margin-top:12px;">Investigation Results</div>
    ${renderResultColumns(labRows)}
    ${radBlocks.length
      ? `<div class="section-title" style="margin-top:10px;">Imaging Reports</div>${radBlocks.join("")}`
      : ""}
    <p style="font-size:10px;color:#64748b;margin-top:6px;">
      Results in <b>bold</b> are abnormal. Values marked CRITICAL require the treating doctor's
      attention immediately.
    </p>`;

  return { html, resultedNames };
}

/* ─────────────────────────── Lab report ─────────────────────────── */

/**
 * Full lab report for one order — every test grouped by category, abnormal rows tinted,
 * critical rows highlighted, with the validating pathologist named.
 */
export async function printLabReport(
  hospitalId: string,
  orderId: string,
  patient: PrintPatient,
): Promise<void> {
  const { data: order } = await (supabase as any)
    .from("lab_orders")
    .select(`
      id, order_date, accession_number, clinical_notes, interpretive_comment, validated_at,
      validator:users!lab_orders_validated_by_fkey(full_name),
      lab_order_items(
        result_value, result_unit, result_flag, reference_range,
        test:lab_test_master!lab_order_items_test_id_fkey(test_name, category, normal_min, normal_max)
      )
    `)
    .eq("id", orderId)
    .maybeSingle();

  const grouped: Record<string, any[]> = {};
  for (const item of order?.lab_order_items || []) {
    const cat = item.test?.category || "General";
    (grouped[cat] ||= []).push(item);
  }

  const sections = Object.entries(grouped)
    .map(([cat, items]) => {
      const rows = items
        .map((i: any) => {
          const flag = i.result_flag;
          const style =
            flag === "CH" || flag === "CL"
              ? "background:#fee2e2;font-weight:bold"
              : flag === "H" || flag === "L"
                ? "background:#fef3c7"
                : "";
          const range =
            i.reference_range ||
            (i.test?.normal_min != null ? `${i.test.normal_min}–${i.test.normal_max}` : "");
          return `<tr style="${style}">
            <td>${esc(i.test?.test_name || "—")}</td>
            <td style="text-align:right;font-family:monospace">${esc(i.result_value || "pending")}</td>
            <td>${esc(i.result_unit || "")}</td>
            <td>${esc(range)}</td>
            <td style="text-align:center">${flag ? `<b>${esc(flag)}</b>` : ""}</td>
          </tr>`;
        })
        .join("");
      return `<div class="section-title">${esc(cat)}</div>
        <table><thead><tr><th>Test</th><th style="text-align:right">Result</th><th>Unit</th><th>Ref Range</th><th>Flag</th></tr></thead>
        <tbody>${rows}</tbody></table>`;
    })
    .join("");

  printDocument(
    `Lab Report — ${patient.full_name}`,
    `${await header(hospitalId, "LAB REPORT")}
     ${patientRow(patient)}
     <div class="row"><span class="label">Order Date</span><span>${esc(order?.order_date || "—")}</span></div>
     ${order?.accession_number ? `<div class="row"><span class="label">Accession</span><span style="font-family:monospace">${esc(order.accession_number)}</span></div>` : ""}
     ${order?.clinical_notes ? `<div class="row"><span class="label">Clinical Notes</span><span>${esc(order.clinical_notes)}</span></div>` : ""}
     ${sections || "<p style='color:#94a3b8;font-style:italic'>No results recorded yet.</p>"}
     ${order?.interpretive_comment ? `<div class="section-title">Interpretation</div><pre>${esc(order.interpretive_comment)}</pre>` : ""}
     ${order?.validator?.full_name ? `<p style="margin-top:16px;font-size:11px;color:#64748b">Validated by Dr. ${esc(order.validator.full_name)}${order.validated_at ? ` on ${new Date(order.validated_at).toLocaleString("en-IN")}` : ""}</p>` : ""}`,
  );
}

/* ────────────────────── Microbiology / culture ────────────────────── */

/**
 * Culture & sensitivity report. The antibiogram lives in lab_results.sensitivity_json as
 * { [antibiotic]: "S" | "I" | "R" } — printed as a grid, since a culture is a matrix and a
 * prose summary, never a single number.
 */
export async function printMicrobiologyReport(
  hospitalId: string,
  labResultId: string,
  patient: PrintPatient,
): Promise<void> {
  const { data: res } = await (supabase as any)
    .from("lab_results")
    .select(`
      id, organism_identified, colony_count, specimen_type, sensitivity_json,
      result_value, reference_range, unit, report_status, finalized_at,
      verifier:users!lab_results_verified_by_fkey(full_name)
    `)
    .eq("id", labResultId)
    .maybeSingle();

  const sens = (res?.sensitivity_json || {}) as Record<string, string>;
  const SENS_LABEL: Record<string, string> = { S: "Sensitive", I: "Intermediate", R: "Resistant" };
  const rows = Object.entries(sens)
    .map(([drug, val]) => {
      const style = val === "R" ? "background:#fee2e2;font-weight:bold" : val === "I" ? "background:#fef3c7" : "";
      return `<tr style="${style}"><td>${esc(drug)}</td><td style="text-align:center"><b>${esc(val)}</b></td><td>${esc(SENS_LABEL[val] || "")}</td></tr>`;
    })
    .join("");

  printDocument(
    `Culture Report — ${patient.full_name}`,
    `${await header(hospitalId, "MICROBIOLOGY — CULTURE & SENSITIVITY")}
     ${patientRow(patient)}
     <div class="row"><span class="label">Specimen</span><span>${esc(res?.specimen_type || "—")}</span></div>
     <div class="row"><span class="label">Report Status</span><span style="text-transform:capitalize">${esc(res?.report_status || "preliminary")}</span></div>
     <div class="section-title">Organism</div>
     <p><b>${esc(res?.organism_identified || "No growth")}</b>${res?.colony_count ? ` · ${esc(res.colony_count)}` : ""}</p>
     ${rows
       ? `<div class="section-title">Antibiogram</div>
          <table><thead><tr><th>Antibiotic</th><th style="text-align:center">S/I/R</th><th>Interpretation</th></tr></thead><tbody>${rows}</tbody></table>`
       : "<p style='color:#94a3b8;font-style:italic'>No sensitivity panel recorded.</p>"}
     ${res?.verifier?.full_name ? `<p style="margin-top:16px;font-size:11px;color:#64748b">Verified by Dr. ${esc(res.verifier.full_name)}</p>` : ""}`,
  );
}

/* ────────────────────── Histopathology / cytology ────────────────────── */

export async function printPathologyReport(
  hospitalId: string,
  caseId: string,
  patient: PrintPatient,
): Promise<void> {
  const { data: kase } = await (supabase as any)
    .from("pathology_cases")
    .select(`
      id, case_number, case_type, specimen_type, specimen_site, clinical_history,
      gross_description, microscopic_description, impression, status,
      amendment_reason, first_signed_at, final_signed_at,
      first_signer:users!pathology_cases_first_signed_by_fkey(full_name),
      final_signer:users!pathology_cases_final_signed_by_fkey(full_name)
    `)
    .eq("id", caseId)
    .maybeSingle();

  printDocument(
    `Pathology — ${kase?.case_number || patient.full_name}`,
    `${await header(hospitalId, `${(kase?.case_type || "histopathology").toUpperCase()} REPORT`)}
     ${patientRow(patient)}
     <div class="row"><span class="label">Case No.</span><span style="font-family:monospace">${esc(kase?.case_number || "—")}</span></div>
     <div class="row"><span class="label">Specimen</span><span>${esc(kase?.specimen_type || "—")}${kase?.specimen_site ? ` · ${esc(kase.specimen_site)}` : ""}</span></div>
     ${kase?.clinical_history ? `<div class="row"><span class="label">Clinical History</span><span>${esc(kase.clinical_history)}</span></div>` : ""}
     ${kase?.status === "amended" ? `<p style="color:#dc2626;font-weight:bold;margin-top:12px">⚠️ AMENDED REPORT${kase?.amendment_reason ? ` — ${esc(kase.amendment_reason)}` : ""}</p>` : ""}
     ${kase?.gross_description ? `<div class="section-title">Gross Description</div><pre>${esc(kase.gross_description)}</pre>` : ""}
     ${kase?.microscopic_description ? `<div class="section-title">Microscopic Description</div><pre>${esc(kase.microscopic_description)}</pre>` : ""}
     ${kase?.impression ? `<div class="section-title">Impression</div><pre>${esc(kase.impression)}</pre>` : ""}
     ${
       kase?.final_signer?.full_name || kase?.first_signer?.full_name
         ? `<p style="margin-top:16px;font-size:11px;color:#64748b">
              ${kase?.first_signer?.full_name ? `Reported by Dr. ${esc(kase.first_signer.full_name)}` : ""}
              ${kase?.final_signer?.full_name ? ` · Signed out by Dr. ${esc(kase.final_signer.full_name)}` : ""}
            </p>`
         : ""
     }`,
  );
}

/* ─────────────────────────── Radiology ─────────────────────────── */

export async function printRadiologyReport(
  hospitalId: string,
  orderId: string,
  patient: PrintPatient,
): Promise<void> {
  const { data: order } = await (supabase as any)
    .from("radiology_orders")
    .select("*, radiology_reports(*)")
    .eq("id", orderId)
    .maybeSingle();

  const report = Array.isArray(order?.radiology_reports)
    ? order.radiology_reports[0] || null
    : order?.radiology_reports || null;

  printDocument(
    `Radiology — ${order?.study_name || "Report"}`,
    `${await header(hospitalId, "RADIOLOGY REPORT")}
     ${patientRow(patient)}
     <div class="row"><span class="label">Study</span><span>${esc(order?.study_name || "—")}</span></div>
     <div class="row"><span class="label">Modality</span><span style="text-transform:uppercase">${esc(order?.modality_type || "—")}</span></div>
     <div class="row"><span class="label">Date</span><span>${esc(order?.order_date || "—")}</span></div>
     ${order?.accession_number ? `<div class="row"><span class="label">Accession</span><span style="font-family:monospace">${esc(order.accession_number)}</span></div>` : ""}
     ${order?.indication ? `<div class="row"><span class="label">Indication</span><span>${esc(order.indication)}</span></div>` : ""}
     ${report?.technique ? `<div class="section-title">Technique</div><p>${esc(report.technique)}</p>` : ""}
     ${report?.findings ? `<div class="section-title">Findings</div><pre>${esc(report.findings)}</pre>` : ""}
     ${report?.impression ? `<div class="section-title">Impression</div><pre>${esc(report.impression)}</pre>` : ""}
     ${report?.recommendations ? `<div class="section-title">Recommendations</div><pre>${esc(report.recommendations)}</pre>` : ""}
     ${report?.is_critical ? `<p style="color:#dc2626;font-weight:bold;margin-top:12px">⚠️ CRITICAL FINDING: ${esc(report.critical_finding || "")}</p>` : ""}
     ${!report || !report.is_signed ? `<p style="color:#94a3b8;font-style:italic;margin-top:16px">Report not yet finalised — order status: ${esc(order?.status || "unknown")}</p>` : ""}`,
  );
}
