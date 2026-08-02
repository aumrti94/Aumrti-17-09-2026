#!/usr/bin/env node
/**
 * Aumrti HMS QA Tracker builder
 * -----------------------------
 * Reads every docs/qa/cases/phase-*.csv and produces
 * docs/qa/tracker/AUMRTI_QA_TRACKER.xlsx
 *
 * SAFE TO RE-RUN. Results you have typed into the workbook are preserved:
 * the script reads the existing workbook first and merges your answers back
 * on to the freshly generated rows, matching on TC#.
 *
 *   node docs/qa/tracker/build-tracker.mjs
 *   node docs/qa/tracker/build-tracker.mjs --no-merge   (regenerate blank)
 *
 * Sheets produced:
 *   Summary            per-phase pass %, open defects, phase GATE
 *   Scenario Status    one row per scenario across the whole app
 *   Go-Live Readiness   the must-pass subset with a single verdict
 *   Phase NN ...       one sheet per phase, the test cases
 *   Defect Log         your bug list (never overwritten)
 */

import ExcelJS from 'exceljs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QA_DIR = path.resolve(__dirname, '..');
const CASES_DIR = path.join(QA_DIR, 'cases');
const OUT_FILE = path.join(__dirname, 'AUMRTI_QA_TRACKER.xlsx');
const MERGE = !process.argv.includes('--no-merge');

/* ------------------------------------------------------------------ *
 * Column contract — the 14 you specified, then the 7 additions.
 * Order here is the order in the sheet. Do not reorder without also
 * updating the CSVs.
 * ------------------------------------------------------------------ */
const COLUMNS = [
  { key: 'TC#',                                                 width: 16 },
  { key: 'Section',                                             width: 20 },
  { key: 'Priority',                                            width: 9  },
  { key: 'Test Case',                                           width: 46 },
  { key: 'Steps',                                               width: 68, wrap: true },
  { key: 'Expected Result',                                     width: 52, wrap: true },
  { key: 'Status(PASS/FAIL/BLOCKED)',                           width: 15, user: true },
  { key: 'mock data',                                           width: 30, wrap: true },
  { key: 'Cross-Module Link',                                   width: 22 },
  { key: 'Settings need to set before entering to the module',  width: 30, wrap: true },
  { key: 'Actual Result(What happened)',                        width: 46, wrap: true, user: true },
  { key: 'Console Error(Copy-paste red text)',                  width: 46, wrap: true, user: true },
  { key: 'Screenshot(Y/N)',                                     width: 13, user: true },
  { key: 'Notes',                                               width: 36, wrap: true, user: true },
  { key: 'Journey Scenario',                                    width: 16 },
  { key: 'Why This Exists',                                     width: 68, wrap: true },
  { key: 'Test Type',                                           width: 12 },
  { key: 'Role/Login',                                          width: 20 },
  { key: 'Supabase Verify',                                     width: 40, wrap: true },
  { key: 'Playwright Spec',                                     width: 48 },
  { key: 'Defect ID',                                           width: 14, user: true },
];
const COL = Object.fromEntries(COLUMNS.map((c, i) => [c.key, i + 1]));
/** Columns the tester fills in — these are what we merge back on re-run. */
const USER_COLS = COLUMNS.filter(c => c.user).map(c => c.key);
/**
 * The columns that constitute an actual recorded RESULT. Used only for the
 * "preserving N cases" message, so it reports real testing progress rather
 * than counting the guidance text this script itself seeded into Notes.
 */
const RESULT_COLS = [
  'Status(PASS/FAIL/BLOCKED)',
  'Actual Result(What happened)',
  'Console Error(Copy-paste red text)',
  'Screenshot(Y/N)',
  'Defect ID',
];

const PHASE_TITLES = {
  '01': 'Foundation & Access',      '02': 'Settings & Masters',
  '03': 'Patient & Records',        '04': 'OPD Journey',
  '05': 'Lab & Radiology',          '06': 'Pharmacy',
  '07': 'IPD Journey',              '08': 'Billing & Accounts',
  '09': 'Insurance & Schemes',      '10': 'Emergency OT & Ops',
  '11': 'Back Office',              '12': 'Specialty Clinical',
  '13': 'Quality NABH IPC ABDM',    '14': 'Analytics & AI',
  '15': 'Platform & Regression',
};

/* Theme ------------------------------------------------------------- */
const NAVY   = 'FF1A2F5A';
const TEAL   = 'FF0E7B7B';
const GREEN  = 'FFC6EFCE', GREEN_T  = 'FF006100';
const RED    = 'FFFFC7CE', RED_T    = 'FF9C0006';
const AMBER  = 'FFFFEB9C', AMBER_T  = 'FF9C6500';
const GREY   = 'FFF2F4F7';

/* ------------------------------------------------------------------ *
 * Minimal RFC-4180 CSV parser (handles quotes, escaped quotes, and
 * newlines inside quoted fields).
 * ------------------------------------------------------------------ */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const s = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim() !== ''));
}

function readPhaseCSVs() {
  if (!fs.existsSync(CASES_DIR)) return [];
  return fs.readdirSync(CASES_DIR)
    .filter(f => /^phase-\d{2}.*\.csv$/i.test(f))
    .sort()
    .map(file => {
      const num = file.match(/^phase-(\d{2})/)[1];
      const rows = parseCSV(fs.readFileSync(path.join(CASES_DIR, file), 'utf8'));
      if (!rows.length) return null;
      const header = rows[0].map(h => h.trim());
      const data = rows.slice(1).map(r => {
        const o = {};
        header.forEach((h, i) => { o[h] = (r[i] ?? '').trim(); });
        return o;
      });

      // Fail loudly on a header drift rather than silently writing to the
      // wrong columns — a misaligned tracker is worse than no tracker.
      const missing = COLUMNS.map(c => c.key).filter(k => !header.includes(k));
      if (missing.length) {
        console.error(`\n  ✗ ${file} is missing column(s):`);
        missing.forEach(m => console.error(`      "${m}"`));
        console.error('    Fix the CSV header to match the 21-column contract.\n');
        process.exit(1);
      }
      return { file, num, title: PHASE_TITLES[num] ?? `Phase ${num}`, data };
    })
    .filter(Boolean);
}

/* ------------------------------------------------------------------ *
 * Read back what the tester has already typed, so we never destroy it.
 * ------------------------------------------------------------------ */
async function readExistingAnswers() {
  const answers = new Map();      // TC# -> { col: value }
  let defects = [];
  if (!MERGE || !fs.existsSync(OUT_FILE)) return { answers, defects };

  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(OUT_FILE);

    wb.eachSheet(sheet => {
      if (!/^Phase \d{2}/.test(sheet.name)) return;
      const header = [];
      sheet.getRow(1).eachCell((cell, c) => { header[c] = String(cell.value ?? '').trim(); });
      const tcCol = header.indexOf('TC#');
      if (tcCol < 1) return;

      sheet.eachRow((row, rowNum) => {
        if (rowNum === 1) return;
        const tc = String(row.getCell(tcCol).value ?? '').trim();
        if (!tc) return;
        const kept = {};
        USER_COLS.forEach(key => {
          const c = header.indexOf(key);
          if (c < 1) return;
          const v = row.getCell(c).value;
          const str = v && typeof v === 'object' && 'result' in v ? v.result : v;
          if (str !== null && str !== undefined && String(str).trim() !== '') {
            kept[key] = String(str).trim();
          }
        });
        if (Object.keys(kept).length) answers.set(tc, kept);
      });
    });

    const dl = wb.getWorksheet('Defect Log');
    if (dl) {
      dl.eachRow((row, n) => {
        if (n === 1) return;
        const vals = [];
        row.eachCell({ includeEmpty: true }, (cell, c) => {
          const v = cell.value;
          vals[c - 1] = v && typeof v === 'object' && 'result' in v ? v.result : v;
        });
        if (vals.some(v => v !== null && v !== undefined && String(v).trim() !== '')) defects.push(vals);
      });
    }
  } catch (e) {
    console.warn(`  ! Could not read the existing workbook (${e.message}).`);
    console.warn('    Generating fresh. Your old file has NOT been deleted — rename it if you need it.');
    return { answers: new Map(), defects: [] };
  }
  return { answers, defects };
}

/* ------------------------------------------------------------------ *
 * Sheet builders
 * ------------------------------------------------------------------ */
function styleHeader(sheet, fill = NAVY) {
  const row = sheet.getRow(1);
  row.height = 34;
  row.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
  });
  row.commit();
  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
}

function buildPhaseSheet(wb, phase, answers) {
  const sheet = wb.addWorksheet(`Phase ${phase.num} ${phase.title}`.slice(0, 31), {
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = COLUMNS.map(c => ({ header: c.key, key: c.key, width: c.width }));
  styleHeader(sheet);

  phase.data.forEach(rec => {
    const merged = { ...rec, ...(answers.get(rec['TC#']) ?? {}) };
    const row = sheet.addRow(COLUMNS.map(c => merged[c.key] ?? ''));
    row.alignment = { vertical: 'top', wrapText: false };
    COLUMNS.forEach((c, i) => {
      if (c.wrap) row.getCell(i + 1).alignment = { vertical: 'top', wrapText: true };
    });
    // P1 rows get a tinted priority cell so the safety/money cases stand out
    if (merged['Priority'] === 'P1') {
      row.getCell(COL['Priority']).font = { bold: true, color: { argb: RED_T } };
    }
  });

  const last = sheet.rowCount;
  if (last < 2) return sheet;

  // Filter across everything — the point is to collapse to one scenario
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to:   { row: last, column: COLUMNS.length },
  };

  const range = (colKey) => {
    const L = sheet.getColumn(COL[colKey]).letter;
    return `${L}2:${L}${last}`;
  };
  const dv = (colKey, list) => {
    for (let r = 2; r <= last; r++) {
      sheet.getCell(r, COL[colKey]).dataValidation = {
        type: 'list', allowBlank: true, formulae: [`"${list.join(',')}"`],
        showErrorMessage: true, errorStyle: 'warning',
        errorTitle: 'Not a valid value', error: `Choose one of: ${list.join(', ')}`,
      };
    }
  };
  dv('Status(PASS/FAIL/BLOCKED)', ['PASS', 'FAIL', 'BLOCKED', 'N/A']);
  dv('Screenshot(Y/N)', ['Y', 'N']);
  dv('Priority', ['P1', 'P2', 'P3']);
  dv('Test Type', ['Positive', 'Negative', 'Boundary', 'RBAC', 'Cross-Module']);

  const statusRange = range('Status(PASS/FAIL/BLOCKED)');
  const statusCol = sheet.getColumn(COL['Status(PASS/FAIL/BLOCKED)']).letter;
  const rowFmt = (op, text, fill, font) => ({
    type: 'expression',
    formulae: [`$${statusCol}2="${text}"`],
    style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: fill } },
             font: { color: { argb: font } } },
  });

  // Colour the Status cell itself...
  sheet.addConditionalFormatting({
    ref: statusRange,
    rules: [
      { type: 'cellIs', operator: 'equal', formulae: ['"PASS"'],    priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } }, font: { color: { argb: GREEN_T }, bold: true } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"FAIL"'],    priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } },   font: { color: { argb: RED_T },   bold: true } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"BLOCKED"'], priority: 3,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: AMBER } }, font: { color: { argb: AMBER_T }, bold: true } } },
    ],
  });

  // ...and tint the whole row on FAIL so it's impossible to scroll past.
  const wholeRow = `A2:${sheet.getColumn(COLUMNS.length).letter}${last}`;
  sheet.addConditionalFormatting({
    ref: wholeRow,
    rules: [rowFmt('equal', 'FAIL', 'FFFFF0F0', RED_T)].map((r, i) => ({ ...r, priority: 10 + i })),
  });

  return sheet;
}

function buildSummary(wb, phases) {
  const sheet = wb.addWorksheet('Summary', { properties: { defaultRowHeight: 18 } });
  sheet.columns = [
    { header: 'Phase', key: 'p', width: 34 },
    { header: 'Cases', key: 'c', width: 10 },
    { header: 'Run', key: 'r', width: 10 },
    { header: 'PASS', key: 'pa', width: 10 },
    { header: 'FAIL', key: 'f', width: 10 },
    { header: 'BLOCKED', key: 'b', width: 11 },
    { header: 'Not run', key: 'n', width: 10 },
    { header: '% Run', key: 'pr', width: 10 },
    { header: '% Pass', key: 'pp', width: 10 },
    { header: 'P1 cases', key: 'p1', width: 10 },
    { header: 'P1 FAIL', key: 'p1f', width: 10 },
    { header: 'GATE', key: 'g', width: 28 },
  ];
  styleHeader(sheet);

  phases.forEach(ph => {
    const name = `Phase ${ph.num} ${ph.title}`.slice(0, 31);
    const q = `'${name}'!`;
    const n = ph.data.length;
    const lastRow = n + 1;
    const S = `${q}$G$2:$G$${lastRow}`;   // Status column (G = 7th)
    const P = `${q}$C$2:$C$${lastRow}`;   // Priority column (C = 3rd)

    const row = sheet.addRow({
      p: name, c: n,
      r:  { formula: `COUNTIF(${S},"PASS")+COUNTIF(${S},"FAIL")+COUNTIF(${S},"BLOCKED")` },
      pa: { formula: `COUNTIF(${S},"PASS")` },
      f:  { formula: `COUNTIF(${S},"FAIL")` },
      b:  { formula: `COUNTIF(${S},"BLOCKED")` },
      n:  { formula: `${n}-(COUNTIF(${S},"PASS")+COUNTIF(${S},"FAIL")+COUNTIF(${S},"BLOCKED"))` },
      pr: { formula: `IF(${n}=0,0,(COUNTIF(${S},"PASS")+COUNTIF(${S},"FAIL")+COUNTIF(${S},"BLOCKED"))/${n})` },
      pp: { formula: `IF((COUNTIF(${S},"PASS")+COUNTIF(${S},"FAIL")+COUNTIF(${S},"BLOCKED"))=0,0,COUNTIF(${S},"PASS")/(COUNTIF(${S},"PASS")+COUNTIF(${S},"FAIL")+COUNTIF(${S},"BLOCKED")))` },
      p1: { formula: `COUNTIF(${P},"P1")` },
      p1f:{ formula: `COUNTIFS(${P},"P1",${S},"FAIL")` },
      g:  { formula:
        `IF(COUNTIFS(${P},"P1",${S},"FAIL")>0,"BLOCKED - open P1",` +
        `IF((COUNTIF(${S},"PASS")+COUNTIF(${S},"FAIL")+COUNTIF(${S},"BLOCKED"))<${n},"IN PROGRESS",` +
        `IF(COUNTIF(${S},"FAIL")>0,"BLOCKED - open defects","PASSED")))` },
    });
    row.getCell('pr').numFmt = '0%';
    row.getCell('pp').numFmt = '0%';
    row.getCell('g').font = { bold: true };
  });

  const last = sheet.rowCount;
  sheet.addConditionalFormatting({
    ref: `L2:L${last}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'PASSED', priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } }, font: { color: { argb: GREEN_T }, bold: true } } },
      { type: 'containsText', operator: 'containsText', text: 'BLOCKED', priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } }, font: { color: { argb: RED_T }, bold: true } } },
      { type: 'containsText', operator: 'containsText', text: 'IN PROGRESS', priority: 3,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: AMBER } }, font: { color: { argb: AMBER_T }, bold: true } } },
    ],
  });

  sheet.addRow([]);
  const t = sheet.addRow(['TOTAL',
    { formula: `SUM(B2:B${last})` }, { formula: `SUM(C2:C${last})` },
    { formula: `SUM(D2:D${last})` }, { formula: `SUM(E2:E${last})` },
    { formula: `SUM(F2:F${last})` }, { formula: `SUM(G2:G${last})` },
    { formula: `IF(B${last + 2}=0,0,C${last + 2}/B${last + 2})` },
    { formula: `IF(C${last + 2}=0,0,D${last + 2}/C${last + 2})` },
    { formula: `SUM(J2:J${last})` }, { formula: `SUM(K2:K${last})` },
    { formula: `IF(K${last + 2}>0,"NOT READY - open P1","")` },
  ]);
  t.font = { bold: true };
  t.getCell(8).numFmt = '0%';
  t.getCell(9).numFmt = '0%';
  t.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: GREY } }; });

  sheet.addRow([]);
  const note = sheet.addRow(['A phase is DONE only when: every case has a Status, zero open P1 defects, and every P1 case has a passing Playwright spec.']);
  note.font = { italic: true, color: { argb: 'FF666666' }, size: 9 };
  sheet.mergeCells(`A${sheet.rowCount}:L${sheet.rowCount}`);
  return sheet;
}

function buildScenarioStatus(wb, phases) {
  const sheet = wb.addWorksheet('Scenario Status', { properties: { defaultRowHeight: 18 } });
  sheet.columns = [
    { header: 'Journey Scenario', key: 's', width: 18 },
    { header: 'Phase', key: 'p', width: 30 },
    { header: 'Cases', key: 'c', width: 9 },
    { header: 'PASS', key: 'pa', width: 9 },
    { header: 'FAIL', key: 'f', width: 9 },
    { header: 'Not run', key: 'n', width: 10 },
    { header: 'Scenario Verdict', key: 'v', width: 24 },
  ];
  styleHeader(sheet, TEAL);

  phases.forEach(ph => {
    const name = `Phase ${ph.num} ${ph.title}`.slice(0, 31);
    const q = `'${name}'!`;
    const lastRow = ph.data.length + 1;
    const scenarios = [...new Set(ph.data.map(r => r['Journey Scenario']).filter(Boolean))].sort();

    scenarios.forEach(sc => {
      const SC = `${q}$O$2:$O$${lastRow}`;   // Journey Scenario column (O = 15th)
      const S  = `${q}$G$2:$G$${lastRow}`;   // Status column
      const row = sheet.addRow({
        s: sc, p: name,
        c:  { formula: `COUNTIF(${SC},"${sc}")` },
        pa: { formula: `COUNTIFS(${SC},"${sc}",${S},"PASS")` },
        f:  { formula: `COUNTIFS(${SC},"${sc}",${S},"FAIL")` },
        n:  { formula: `COUNTIF(${SC},"${sc}")-COUNTIFS(${SC},"${sc}",${S},"PASS")-COUNTIFS(${SC},"${sc}",${S},"FAIL")-COUNTIFS(${SC},"${sc}",${S},"BLOCKED")` },
        v:  { formula:
          `IF(COUNTIFS(${SC},"${sc}",${S},"FAIL")>0,"FAIL",` +
          `IF(COUNTIFS(${SC},"${sc}",${S},"PASS")=COUNTIF(${SC},"${sc}"),"PASS",` +
          `IF(COUNTIFS(${SC},"${sc}",${S},"PASS")+COUNTIFS(${SC},"${sc}",${S},"BLOCKED")>0,"IN PROGRESS","NOT STARTED")))` },
      });
      row.getCell('v').font = { bold: true };
    });
  });

  const last = sheet.rowCount;
  if (last > 1) {
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: 7 } };
    sheet.addConditionalFormatting({
      ref: `G2:G${last}`,
      rules: [
        { type: 'cellIs', operator: 'equal', formulae: ['"PASS"'], priority: 1,
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } }, font: { color: { argb: GREEN_T }, bold: true } } },
        { type: 'cellIs', operator: 'equal', formulae: ['"FAIL"'], priority: 2,
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } }, font: { color: { argb: RED_T }, bold: true } } },
        { type: 'cellIs', operator: 'equal', formulae: ['"IN PROGRESS"'], priority: 3,
          style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: AMBER } }, font: { color: { argb: AMBER_T }, bold: true } } },
      ],
    });
  }

  sheet.addRow([]);
  const note = sheet.addRow(['Scenarios for phases not yet written appear once their CSV is added. Full list of ~230 scenarios: docs/qa/JOURNEY_SCENARIOS.md']);
  note.font = { italic: true, color: { argb: 'FF666666' }, size: 9 };
  return sheet;
}

/** The must-pass subset from GO_LIVE_READINESS.md. */
const GO_LIVE = [
  ['Patient safety', 'P4-S11',  'Drug allergy prescription is blocked; override is audited'],
  ['Patient safety', 'P4-S10',  'Drug interaction alert fires'],
  ['Patient safety', 'P5-S07',  'Critical lab value raises an immediate alert'],
  ['Patient safety', 'P5-S06',  'Rejected sample re-queues without double-charging'],
  ['Patient safety', 'P5-S10',  'Dual-validation test cannot be released by one person'],
  ['Patient safety', 'P6-S04',  'FEFO batch selection picks the earliest expiry'],
  ['Patient safety', 'P6-S05',  'Expired batch cannot be dispensed'],
  ['Patient safety', 'P6-S07',  'NDPS dispensing requires dual sign-off'],
  ['Patient safety', 'P6-S08',  'NDPS with a single signature is blocked'],
  ['Patient safety', 'P7-S06',  'ICU flowsheet, ventilator and sedation records save'],
  ['Patient safety', 'P10-OT',  'WHO surgical checklist cannot be bypassed'],
  ['Patient safety', 'P10-BB',  'Blood cross-match is traceable donor to recipient'],
  ['Patient safety', 'P10-CSSD','Failed sterilisation cycle triggers recall'],
  ['Patient safety', 'P14-AI',  'Clinical AI output can be rejected; clinician value is recorded'],
  ['Money', 'P7-S14', 'Discharge sweep collects every charge exactly once'],
  ['Money', 'P7-S15', 'Excess advance produces a refund payable'],
  ['Money', 'P7-S16', 'Pharmacy return restores stock and reduces the bill'],
  ['Money', 'P7-S17', 'Discharge blocked on unbilled OT, with audited override'],
  ['Money', 'P7-S13', 'Stay crossing a locked cash-closure day does not drop charges'],
  ['Money', 'P7-S12', 'Pre-paid and post-paid ancillary both bill correctly'],
  ['Money', 'P8-S01', 'Cash bill totals, rounds and receipts correctly'],
  ['Money', 'P8-S09', 'Advance adjusts against the final bill without double-counting'],
  ['Money', 'P8-S10', 'Discount below threshold applies directly'],
  ['Money', 'P8-S11', 'Discount above threshold enforces approval'],
  ['Money', 'P8-S13', 'Refund follows the approval chain'],
  ['Money', 'P8-S15', 'Paid bill cannot be voided without reversal'],
  ['Money', 'P8-S16', 'Day closure locks the day and blocks later edits'],
  ['Money', 'P8-S18', 'Finalised bill posts a balanced journal entry'],
  ['Money', 'P8-S20', 'Bill numbers have no duplicates and no gaps'],
  ['Money', 'P9-S07', 'Room-rent ceiling breach applies the correct deduction'],
  ['Money', 'P6-S02', 'Pharmacy stock decrements exactly once'],
  ['Legal', 'P4-S13',  'PCPNDT — obstetric USG produces a complete Form F'],
  ['Legal', 'P5-S13',  'PCPNDT — Form F complete in the register'],
  ['Legal', 'P5-S14',  'PCPNDT — non-obstetric USG does NOT produce a Form F'],
  ['Legal', 'P6-S07b', 'NDPS — register entry written on dispense'],
  ['Legal', 'P8-S07',  'GST — finalisation blocked when HSN is missing'],
  ['Legal', 'P8-S06',  'GST — room charge bands correct; ICU exempt'],
  ['Legal', 'P9-S15',  'CGHS — no referral means no bill finalisation'],
  ['Legal', 'P4-S23',  'MLC record cannot be skipped'],
  ['Legal', 'P7-S19',  'Death produces an MCCD'],
  ['Legal', 'P3-S10',  'DPDP — erasure soft-deletes and excludes from search'],
  ['Legal', 'P13-NABH','NABH evidence carries real timestamps and identities'],
  ['Security', 'P3-S12',  'Cross-tenant patient open by UUID is blocked'],
  ['Security', 'R7',      'Every module blocked cross-tenant'],
  ['Security', 'P1-1H-a', 'Direct API query returns no cross-tenant rows'],
  ['Security', 'P1-1H-b', 'Stale session after a hospital move does not leak'],
  ['Security', 'P14-PHI', 'No PHI in console, errors or AI logs'],
  ['Access', 'P1-1E', 'Every role lands correctly and is blocked correctly'],
  ['Access', 'P1-1F', 'Receptionist cannot Complete & Bill or Admit'],
  ['Access', 'P1-1G', 'Starter plan cannot open a Professional module'],
  ['Access', 'P1-1C', 'Deactivated user is signed out and cannot return'],
  ['Regression', 'R1', 'Cash outpatient end to end'],
  ['Regression', 'R2', 'Insured inpatient end to end'],
  ['Regression', 'R3', 'PMJAY inpatient end to end'],
  ['Regression', 'R7', 'Cross-tenant sweep'],
];

function buildGoLive(wb) {
  const sheet = wb.addWorksheet('Go-Live Readiness', { properties: { defaultRowHeight: 18 } });
  sheet.columns = [
    { header: 'Category', key: 'c', width: 16 },
    { header: 'Scenario', key: 's', width: 14 },
    { header: 'What must be true', key: 'w', width: 68 },
    { header: 'Status', key: 'st', width: 14 },
    { header: 'Evidence / Notes', key: 'n', width: 44 },
  ];
  styleHeader(sheet, TEAL);

  GO_LIVE.forEach(([c, s, w]) => {
    const row = sheet.addRow({ c, s, w, st: '', n: '' });
    row.getCell('w').alignment = { wrapText: true, vertical: 'top' };
    row.getCell('n').alignment = { wrapText: true, vertical: 'top' };
  });

  const last = sheet.rowCount;
  for (let r = 2; r <= last; r++) {
    sheet.getCell(r, 4).dataValidation = {
      type: 'list', allowBlank: true, formulae: ['"PASS,FAIL,NOT RUN"'],
      showErrorMessage: true, errorStyle: 'warning',
    };
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: last, column: 5 } };
  sheet.addConditionalFormatting({
    ref: `D2:D${last}`,
    rules: [
      { type: 'cellIs', operator: 'equal', formulae: ['"PASS"'], priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } }, font: { color: { argb: GREEN_T }, bold: true } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"FAIL"'], priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } }, font: { color: { argb: RED_T }, bold: true } } },
    ],
  });

  sheet.addRow([]);
  const v = sheet.addRow(['VERDICT', '', 'All must-pass items green AND zero open P1 defects anywhere',
    { formula: `IF(COUNTIF(D2:D${last},"PASS")=${GO_LIVE.length},"READY TO GO LIVE","NOT READY")` }, '']);
  v.font = { bold: true, size: 12 };
  v.height = 26;
  const vr = sheet.rowCount;
  sheet.addConditionalFormatting({
    ref: `D${vr}:D${vr}`,
    rules: [
      { type: 'containsText', operator: 'containsText', text: 'READY TO GO LIVE', priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } }, font: { color: { argb: GREEN_T }, bold: true } } },
      { type: 'containsText', operator: 'containsText', text: 'NOT READY', priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } }, font: { color: { argb: RED_T }, bold: true } } },
    ],
  });
  return sheet;
}

const DEFECT_COLS = [
  { header: 'Defect ID', width: 16 }, { header: 'Date', width: 12 },
  { header: 'Phase', width: 10 }, { header: 'Section', width: 20 },
  { header: 'Module', width: 18 }, { header: 'Severity', width: 12 },
  { header: 'Summary', width: 50 }, { header: 'Steps to Reproduce', width: 60 },
  { header: 'Console Error', width: 44 }, { header: 'Related TC#', width: 16 },
  { header: 'Owner', width: 16 }, { header: 'Status', width: 14 },
  { header: 'Fixed in / Notes', width: 40 },
];

function buildDefectLog(wb, defects) {
  const sheet = wb.addWorksheet('Defect Log', { properties: { defaultRowHeight: 18 } });
  sheet.columns = DEFECT_COLS.map(c => ({ header: c.header, width: c.width }));
  styleHeader(sheet, 'FFB91C1C');

  defects.forEach(vals => sheet.addRow(vals));
  const dataEnd = Math.max(sheet.rowCount, 1);
  const validateTo = dataEnd + 200;      // room to keep typing

  for (let r = 2; r <= validateTo; r++) {
    sheet.getCell(r, 6).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: ['"P1 - Critical,P2 - Major,P3 - Minor"'],
      showErrorMessage: true, errorStyle: 'warning',
    };
    sheet.getCell(r, 11).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: ['"Priya,Ravi,Meera,Kiran,Ananya,Arjun,Dr. Ramesh,Dr. Nalini,Sunita"'],
      showErrorMessage: true, errorStyle: 'warning',
    };
    sheet.getCell(r, 12).dataValidation = {
      type: 'list', allowBlank: true,
      formulae: ['"Open,Fixing,Fixed,Verified,Reopened,Won\'t fix"'],
      showErrorMessage: true, errorStyle: 'warning',
    };
  }
  sheet.addConditionalFormatting({
    ref: `L2:L${validateTo}`,
    rules: [
      { type: 'cellIs', operator: 'equal', formulae: ['"Verified"'], priority: 1,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: GREEN } }, font: { color: { argb: GREEN_T } } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"Open"'], priority: 2,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } }, font: { color: { argb: RED_T } } } },
      { type: 'cellIs', operator: 'equal', formulae: ['"Reopened"'], priority: 3,
        style: { fill: { type: 'pattern', pattern: 'solid', bgColor: { argb: RED } }, font: { color: { argb: RED_T }, bold: true } } },
    ],
  });
  return sheet;
}

/* ------------------------------------------------------------------ */
async function main() {
  console.log('\nAumrti HMS — QA tracker builder\n');

  const phases = readPhaseCSVs();
  if (!phases.length) {
    console.error(`  ✗ No phase CSVs found in ${CASES_DIR}`);
    process.exit(1);
  }

  const { answers, defects } = await readExistingAnswers();

  /*
   * Notes is a shared column: this script seeds guidance into it from the CSV,
   * and the tester adds their own. Keep the tester's version only where it
   * actually differs from the CSV, so updated guidance still reaches them
   * while anything they typed is never lost.
   */
  const csvByTc = new Map();
  phases.forEach(p => p.data.forEach(r => csvByTc.set(r['TC#'], r)));
  for (const [tc, kept] of answers) {
    const csv = csvByTc.get(tc);
    if (csv && kept['Notes'] !== undefined && kept['Notes'] === (csv['Notes'] ?? '').trim()) {
      delete kept['Notes'];
    }
    if (!Object.keys(kept).length) answers.delete(tc);
  }

  const withResults = [...answers.values()]
    .filter(k => RESULT_COLS.some(c => k[c])).length;
  const notesOnly = answers.size - withResults;

  if (MERGE && withResults) {
    console.log(`  Preserving recorded results for ${withResults} test case(s).`);
  }
  if (MERGE && notesOnly) {
    console.log(`  Preserving edited notes on ${notesOnly} further case(s).`);
  }
  if (defects.length) console.log(`  Preserving ${defects.length} defect log row(s).`);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'Aumrti QA';
  wb.created = new Date();

  buildSummary(wb, phases);
  buildScenarioStatus(wb, phases);
  buildGoLive(wb);
  phases.forEach(ph => buildPhaseSheet(wb, ph, answers));
  buildDefectLog(wb, defects);

  await wb.xlsx.writeFile(OUT_FILE);

  const total = phases.reduce((n, p) => n + p.data.length, 0);
  console.log('');
  phases.forEach(p => console.log(`  Phase ${p.num}  ${String(p.data.length).padStart(4)} cases   ${p.title}`));
  console.log(`  ${'—'.repeat(46)}`);
  console.log(`  TOTAL     ${String(total).padStart(4)} cases across ${phases.length} phase(s)\n`);
  console.log(`  Written: ${path.relative(process.cwd(), OUT_FILE)}\n`);
  if (phases.length < 15) {
    console.log(`  ${15 - phases.length} phase(s) still to be written — see docs/qa/PHASE_MAP.md\n`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
