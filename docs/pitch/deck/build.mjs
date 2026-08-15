/**
 * Composes the Aumrti RTIH Amaravati pitch deck.
 *
 * Run:  npm run build      (writes ../Aumrti_RTIH_Amaravati_Pitch_Deck.pptx)
 *
 * Layout only — every word and number comes from content.mjs, every colour and
 * measure from theme.mjs, and every slide is checked by guard.mjs before it ships.
 */
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import PptxGenJS from "pptxgenjs";

import { W, H, M, CONTENT_W, C, T, t, Y, chrome, footer, card } from "./theme.mjs";
import {
  cardGrid, journeyStrip, layerStack, compareTable, kpiRow,
  bulletPanel, quotePanel, chipGrid, columnLists, assumption,
} from "./blocks.mjs";
import * as K from "./content.mjs";
import { guardSlide, assertClean, record } from "./guard.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const OUT = resolve(HERE, "../Aumrti_RTIH_Amaravati_Pitch_Deck.pptx");
const LOGO = resolve(HERE, "../assets/aumrti-logo.png");

const CY = 2.15; // content top when a sub-head is present
const CB = 6.60; // safe content bottom, clear of the footer rule

/* ══════════════════════════════════════════════════════════════════════════
   Fact drift guard — the deck cannot outlive the code it describes
   ══════════════════════════════════════════════════════════════════════════ */
function verifyFacts() {
  const read = (p) => readFileSync(resolve(REPO, p), "utf8");

  const moduleKeys = new Set(
    [...read("src/lib/moduleKeys.ts").matchAll(/"\/[^"]*":\s*"([a-z_]+)"/g)].map((m) => m[1])
  );
  const modules = moduleKeys.size + 1; // + the ai_suite pseudo-module
  const roles = [...read("src/lib/appRoles.ts").matchAll(/value:\s*"([a-z_]+)"/g)].length;
  const aiFeatures = [...read("src/lib/aiFeatures.ts").matchAll(/\{\s*key:\s*"/g)].length;
  const languages = [...read("src/lib/voiceScribeLanguages.ts").matchAll(/code:\s*['"]/g)].length;

  const checks = [
    ["modules", modules, K.FACTS.modules, "src/lib/moduleKeys.ts"],
    ["roles", roles, K.FACTS.roles, "src/lib/appRoles.ts"],
    ["aiFeatures", aiFeatures, K.FACTS.aiFeatures, "src/lib/aiFeatures.ts"],
    ["languages", languages, K.FACTS.languages, "src/lib/voiceScribeLanguages.ts"],
  ];

  for (const [name, actual, claimed, src] of checks) {
    if (actual !== claimed) {
      record(`FACT DRIFT — content.mjs claims ${claimed} ${name}, ${src} now says ${actual}`);
    }
  }

  // The taxonomy on the depth slide must account for every module, exactly once.
  const taxonomy = K.DOMAINS.reduce((n, d) => n + d.items.length, 0);
  if (taxonomy !== K.FACTS.modules) {
    record(`Domain taxonomy lists ${taxonomy} modules; the fact base says ${K.FACTS.modules}`);
  }

  console.log(
    `  facts verified — ${modules} modules · ${roles} roles · ${aiFeatures} AI features · ${languages} languages`
  );
}

/* ══════════════════════════════════════════════════════════════════════════
   Deck
   ══════════════════════════════════════════════════════════════════════════ */
const pptx = new PptxGenJS();
pptx.defineLayout({ name: "AUMRTI_16x9", width: W, height: H });
pptx.layout = "AUMRTI_16x9";
pptx.author = "Yeswanth Gottumukkala";
pptx.company = "Aumrti";
pptx.title = "Aumrti — One system for every operation in the hospital";
pptx.subject = "Investor pitch deck prepared for the Ratan Tata Innovation Hub, Amaravati";

const S = pptx.ShapeType;
const TOTAL = 14 + K.APPENDIX.length;
let page = 0;

/** Opens a guarded slide with the standard white background and chrome. */
function slide(name, { kicker, headline, sub, note, kind = "main", chromed = true } = {}) {
  const raw = pptx.addSlide();
  raw.background = { color: C.white };
  const g = guardSlide(raw, name, kind);
  page += 1;
  if (chromed) {
    chrome(g, pptx, { kicker, headline, sub });
    footer(g, pptx, { page, total: TOTAL, note });
  }
  return g;
}

/* ── 1 · Title ───────────────────────────────────────────────────────────── */
function slideTitle() {
  const g = slide("01 Title", { chromed: false });
  const d = K.TITLE;

  if (existsSync(LOGO)) {
    g.addImage({ path: LOGO, x: M, y: 0.62, w: 1.9, h: 0.52, sizing: { type: "contain", w: 1.9, h: 0.52 } });
  } else {
    g.addText(d.wordmark, { x: M, y: 0.62, w: 3, h: 0.52, ...t(T.headline, { fontSize: 22 }), valign: "middle" });
  }

  g.addText("AI-NATIVE HOSPITAL OPERATING SYSTEM", {
    x: W - M - 5, y: 0.72, w: 5, h: 0.32, ...t(T.kicker, { align: "right" }), valign: "middle",
  });

  g.block().addText(d.headline, {
    x: M, y: 2.05, w: 9.6, h: 1.5, ...t(T.display, { fontSize: 42 }),
    valign: "top", lineSpacingMultiple: 1.06,
  });

  g.addShape(S.rect, { x: M, y: 3.66, w: 0.62, h: 0.036, fill: { color: C.amber }, line: { type: "none" } });

  g.block().addText(d.sub, {
    x: M, y: 3.92, w: 8.7, h: 0.92, ...t(T.subhead, { fontSize: 13.5 }),
    valign: "top", lineSpacingMultiple: 1.28,
  });

  g.block();
  kpiRow(g, pptx, { stats: d.stats, x: M, y: 5.12, w: 8.7 });

  g.addShape(S.rect, { x: M, y: 6.34, w: CONTENT_W, h: 0.006, fill: { color: C.line }, line: { type: "none" } });
  g.block().addText(d.prepared, {
    x: M, y: 6.46, w: 8.2, h: 0.28, ...t(T.small, { fontSize: 9.5 }), valign: "middle",
  });
  g.addText([{ text: d.founder + "\n", options: t(T.body, { fontSize: 10.5, bold: true, color: C.navy }) },
             { text: d.contact, options: t(T.small, { fontSize: 9.5 }) }], {
    x: W - M - 4.6, y: 6.4, w: 4.6, h: 0.5, align: "right", valign: "middle", lineSpacingMultiple: 1.2,
  });

  g.finish();
}

/* ── 2 · Problem ─────────────────────────────────────────────────────────── */
function slideProblem() {
  const d = K.PROBLEM;
  const g = slide("02 Problem", d);

  g.block();
  journeyStrip(g, pptx, { steps: d.steps, x: M, y: CY, w: CONTENT_W, h: 1.44 });

  g.block();
  cardGrid(g, pptx, { items: d.impacts, cols: 3, x: M, y: 3.76, w: CONTENT_W, h: 1.5 });

  g.block();
  quotePanel(g, pptx, { text: d.quote, attrib: d.quoteAttrib, x: M, y: 5.42, w: CONTENT_W, h: 1.16 });

  g.finish();
}

/* ── 3 · Solution ────────────────────────────────────────────────────────── */
function slideSolution() {
  const d = K.SOLUTION;
  const g = slide("03 Solution", d);

  g.block();
  cardGrid(g, pptx, { items: d.pillars, cols: 3, x: M, y: CY, w: CONTENT_W, h: 1.72 });

  g.block().addText("EVERY MODULE BELOW READS AND WRITES THAT SAME RECORD", {
    x: M, y: 4.02, w: CONTENT_W, h: 0.26, ...t(T.kicker, { fontSize: 8.2, color: C.muted }), valign: "middle",
  });

  g.block();
  cardGrid(g, pptx, { items: d.spokes, cols: 5, x: M, y: 4.36, w: CONTENT_W, h: 1.72, gap: 0.16 });

  g.finish();
}

/* ── 4 · Product in plain language ───────────────────────────────────────── */
function slideProduct() {
  const d = K.PRODUCT;
  const g = slide("04 Product", d);

  g.block();
  cardGrid(g, pptx, {
    items: d.steps.map((s) => ({ kicker: s.num, title: s.title, body: s.body })),
    cols: 3, x: M, y: CY, w: CONTENT_W, h: 3.52,
  });

  g.block().addText(d.close, {
    x: M, y: 5.86, w: CONTENT_W, h: 0.4,
    ...t(T.body, { fontSize: 12.5, color: C.navy, bold: true, align: "center" }), valign: "middle",
  });

  g.finish();
}

/* ── 5 · Depth: 61 modules ───────────────────────────────────────────────── */
function slideDepth() {
  const d = K.DEPTH;
  const g = slide("05 Depth", { kicker: d.kicker, headline: d.headline, sub: d.sub });

  const SHOW = 13;
  const columns = K.DOMAINS.map((dom) => {
    const shown = dom.items.slice(0, SHOW);
    const extra = dom.items.length - shown.length;
    return {
      name: dom.short,
      count: dom.items.length,
      items: extra > 0 ? [...shown, `+ ${extra} more — appendix`] : shown,
    };
  });

  g.block();
  columnLists(g, pptx, { columns, x: M, y: CY, w: CONTENT_W, h: 4.0 });

  g.block();
  assumption(g, pptx, { text: d.note, x: M, y: 6.22, w: CONTENT_W });

  g.finish();
}

/* ── 6 · How it was built ────────────────────────────────────────────────── */
function slideArchitecture() {
  const d = K.ARCHITECTURE;
  const g = slide("06 Architecture", d);

  g.block();
  layerStack(g, pptx, { layers: d.layers, x: M, y: CY, w: CONTENT_W, h: 3.72 });

  g.block().addText(
    `${K.FACTS.modules} modules, one schema — which is why a ward charge, a lab result and a claim line already point at the same encounter, and why this is one product rather than ${K.FACTS.modules} with an integration problem.`,
    { x: M, y: 6.02, w: CONTENT_W, h: 0.54, ...t(T.body, { fontSize: 11, color: C.navy }), valign: "middle", lineSpacingMultiple: 1.2 }
  );

  g.finish();
}

/* ── 7 · Built for India ─────────────────────────────────────────────────── */
function slideIndia() {
  const d = K.INDIA;
  const g = slide("07 India", d);

  g.block();
  chipGrid(g, pptx, { chips: d.chips, cols: 3, x: M, y: CY, w: CONTENT_W, h: 4.34 });

  g.finish();
}

/* ── 8 · USP ─────────────────────────────────────────────────────────────── */
function slideUSP() {
  const d = K.USP;
  const g = slide("08 USP", d);

  g.block();
  cardGrid(g, pptx, { items: d.points.slice(0, 2), cols: 2, x: M, y: CY, w: CONTENT_W, h: 1.82 });

  g.block();
  cardGrid(g, pptx, { items: d.points.slice(2), cols: 3, x: M, y: 4.15, w: CONTENT_W, h: 2.2 });

  g.finish();
}

/* ── 9 · Competition & barrier to entry ──────────────────────────────────── */
function slideCompetition() {
  const d = K.COMPETITION;
  const g = slide("09 Competition", {
    kicker: d.kicker,
    headline: d.headline,
    sub: "How today's alternatives compare, and what a fast follower would actually have to rebuild.",
  });

  const tw = 6.5;
  g.block();
  compareTable(g, pptx, {
    headers: d.headers, rows: d.rows, x: M, y: CY, w: tw,
    colW: [2.34, 1.04, 1.04, 1.04, 1.04], highlightCol: 4,
  });

  g.block();
  card(g.raw, pptx, { x: M, y: 4.86, w: tw, h: 1.3, fill: C.panel });
  g.addShape(S.rect, { x: M + 0.2, y: 5.06, w: 0.028, h: 0.9, fill: { color: C.amber }, line: { type: "none" } });
  g.addText(d.moat, {
    x: M + 0.4, y: 4.98, w: tw - 0.64, h: 1.06,
    ...t(T.body, { fontSize: 11.5, color: C.navy, bold: true }), valign: "middle", lineSpacingMultiple: 1.22,
  });

  g.block();
  bulletPanel(g, pptx, {
    title: d.rebuild.title, bullets: d.rebuild.bullets, note: d.rebuild.note,
    x: M + tw + 0.22, y: CY, w: CONTENT_W - tw - 0.22, h: 3.96,
  });

  g.finish();
}

/* ── 10 · Revenue model ──────────────────────────────────────────────────── */
function slideRevenue() {
  const d = K.REVENUE;
  const g = slide("10 Revenue", d);

  g.block();
  cardGrid(g, pptx, {
    items: d.lines.map((l) => ({ stat: l.stat, title: l.title, body: l.body })),
    cols: 3, x: M, y: CY, w: CONTENT_W, h: 1.5,
  });

  g.block();
  const cw = (CONTENT_W - 0.4) / 3;
  d.lines.forEach((l, i) => {
    g.addText(l.assumption, {
      x: M + i * (cw + 0.2), y: 3.7, w: cw, h: 0.52, ...t(T.caption), valign: "top", lineSpacingMultiple: 1.16,
    });
  });

  const chartW = 6.1;
  g.block();
  g.addChart(
    pptx.ChartType.bar,
    [{
      name: "Revenue",
      labels: K.PROJECTION.map((p) => `${p.year} · ${p.cum} hospitals`),
      values: K.PROJECTION.map((p) => Number((p.rev / 100000).toFixed(1))),
    }],
    {
      x: M, y: 4.3, w: chartW, h: 1.62,
      barDir: "bar", barGapWidthPct: 60,
      chartColors: [C.navy],
      plotArea: { fill: { color: C.white } },
      showLegend: false, showTitle: false,
      valAxisHidden: true, valGridLine: { style: "none" },
      catAxisLineShow: false, valAxisLineShow: false,
      catAxisLabelFontFace: "Segoe UI", catAxisLabelFontSize: 9, catAxisLabelColor: C.muted,
      showValue: true, dataLabelFontFace: "Segoe UI", dataLabelFontSize: 9,
      dataLabelColor: C.navy, dataLabelPosition: "outEnd", dataLabelFormatCode: '₹0.0" L"',
    }
  );
  g.addText(d.projectionAssumption, {
    x: M, y: 6.04, w: chartW, h: 0.5, ...t(T.caption), valign: "top", lineSpacingMultiple: 1.16,
  });

  g.block();
  bulletPanel(g, pptx, {
    title: d.burn.title, bullets: d.burn.bullets,
    x: M + chartW + 0.24, y: 4.3, w: CONTENT_W - chartW - 0.24, h: 2.28,
  });

  g.finish();
}

/* ── 11 · Target market ──────────────────────────────────────────────────── */
function slideMarket() {
  const d = K.MARKET;
  const g = slide("11 Market", d);

  const cw = (CONTENT_W - 0.4) / 3;
  g.block();
  d.funnel.forEach((f, i) => {
    const x = M + i * (cw + 0.2);
    card(g.raw, pptx, { x, y: CY, w: cw, h: 2.15 });
    g.addText(f.tier, { x: x + 0.22, y: CY + 0.14, w: cw - 0.44, h: 0.22, ...t(T.kicker, { fontSize: 8.4, color: C.muted }), valign: "middle" });
    g.addText(f.value, { x: x + 0.22, y: CY + 0.38, w: cw - 0.44, h: 0.44, ...t(T.stat, { fontSize: 20 }), valign: "middle" });
    g.addText(f.body, { x: x + 0.22, y: CY + 0.86, w: cw - 0.44, h: 0.52, ...t(T.body, { fontSize: 10.5, color: C.ink }), valign: "top", lineSpacingMultiple: 1.16 });
    g.addText(f.assumption, { x: x + 0.22, y: CY + 1.4, w: cw - 0.44, h: 0.68, ...t(T.caption), valign: "top", lineSpacingMultiple: 1.14 });
  });

  const half = (CONTENT_W - 0.24) / 2;
  g.block();
  bulletPanel(g, pptx, { title: d.buyer.title, bullets: d.buyer.bullets, x: M, y: 4.52, w: half, h: 2.06 });
  g.block();
  bulletPanel(g, pptx, { title: d.channels.title, bullets: d.channels.bullets, x: M + half + 0.24, y: 4.52, w: half, h: 2.06 });

  g.finish();
}

/* ── 12 · Milestones ─────────────────────────────────────────────────────── */
function slideMilestones() {
  const d = K.MILESTONES;
  const g = slide("12 Milestones", d);

  const lw = 5.2;
  g.block();
  bulletPanel(g, pptx, { title: d.achieved.title, bullets: d.achieved.bullets, x: M, y: CY, w: lw, h: 4.35 });

  g.block();
  cardGrid(g, pptx, { items: d.phases, cols: 2, x: M + lw + 0.24, y: CY, w: CONTENT_W - lw - 0.24, h: 4.35 });

  g.finish();
}

/* ── 13 · What we do not claim ───────────────────────────────────────────── */
function slideCandour() {
  const d = K.CANDOUR;
  const g = slide("13 Candour", d);

  g.block();
  cardGrid(g, pptx, { items: d.points, cols: 2, x: M, y: CY, w: CONTENT_W, h: 3.5 });

  g.block();
  card(g.raw, pptx, { x: M, y: 5.78, w: CONTENT_W, h: 0.8, fill: C.panel });
  g.addText(d.hardening, {
    x: M + 0.26, y: 5.86, w: CONTENT_W - 0.52, h: 0.64,
    ...t(T.body, { fontSize: 10.5, color: C.muted }), valign: "middle", lineSpacingMultiple: 1.18,
  });

  g.finish();
}

/* ── 14 · Team, funding and the ask ──────────────────────────────────────── */
function slideTeam() {
  const d = K.TEAM;
  const g = slide("14 Team & ask", { kicker: d.kicker, headline: d.headline, note: d.closing });
  const lw = 5.85;
  const rx = M + lw + 0.32;
  const rw = CONTENT_W - lw - 0.32;

  // Founder
  g.block();
  card(g.raw, pptx, { x: M, y: 1.88, w: lw, h: 1.66 });
  g.addText(d.founder.title, { x: M + 0.24, y: 2.02, w: lw - 0.48, h: 0.28, ...t(T.cardTitle), valign: "top" });
  g.addText(d.founder.body, { x: M + 0.24, y: 2.34, w: lw - 0.48, h: 0.78, ...t(T.body, { fontSize: 10.5, color: C.muted }), valign: "top", lineSpacingMultiple: 1.16 });
  g.addText(d.founder.note, { x: M + 0.24, y: 3.16, w: lw - 0.48, h: 0.28, ...t(T.caption, { italic: false, color: C.amber }), valign: "middle" });

  // First hires
  g.block();
  bulletPanel(g, pptx, { title: d.hires.title, bullets: d.hires.bullets, x: M, y: 3.68, w: lw, h: 1.48 });

  // Funding so far
  g.block();
  bulletPanel(g, pptx, { title: d.funding.title, bullets: d.funding.bullets, x: M, y: 5.24, w: lw, h: 1.34 });

  // The ask
  g.block();
  card(g.raw, pptx, { x: rx, y: 1.88, w: rw, h: 4.7, fill: C.panel });
  g.addText(d.ask.title, { x: rx + 0.26, y: 2.02, w: rw - 0.52, h: 0.26, ...t(T.cardTitle), valign: "top" });
  g.addText(d.ask.amount, { x: rx + 0.26, y: 2.3, w: 2.5, h: 0.6, ...t(T.stat, { fontSize: 30 }), valign: "middle" });
  g.addText(d.ask.horizon, { x: rx + 2.8, y: 2.44, w: rw - 3.06, h: 0.32, ...t(T.small, { fontSize: 10.5 }), valign: "middle" });

  g.addText(
    d.ask.bullets.map((b) => ({ text: b, options: { bullet: { code: "2022", indent: 12 }, breakLine: true } })),
    { x: rx + 0.26, y: 2.92, w: rw - 0.52, h: 1.16, ...t(T.body, { fontSize: 10.5, color: C.ink }), valign: "top", lineSpacingMultiple: 1.18, paraSpaceAfter: 4 }
  );

  g.addText("USE OF FUNDS", { x: rx + 0.26, y: 4.18, w: rw - 0.52, h: 0.22, ...t(T.kicker, { fontSize: 8, color: C.muted }), valign: "middle" });
  d.ask.use.forEach((u, i) => {
    const y = 4.46 + i * 0.34;
    g.addText(u.label, { x: rx + 0.26, y, w: 2.9, h: 0.24, ...t(T.body, { fontSize: 9.5, color: C.ink }), valign: "middle" });
    g.addText(`${u.pct}%`, { x: rx + rw - 0.76, y, w: 0.5, h: 0.24, ...t(T.body, { fontSize: 9.5, bold: true, color: C.navy, align: "right" }), valign: "middle" });
    const trackX = rx + 3.24;
    const trackW = rw - 4.1;
    g.addShape(S.rect, { x: trackX, y: y + 0.105, w: trackW, h: 0.03, fill: { color: C.line }, line: { type: "none" } });
    g.addShape(S.rect, { x: trackX, y: y + 0.095, w: (trackW * u.pct) / 100, h: 0.05, fill: { color: C.navy }, line: { type: "none" } });
  });
  g.addText(d.ask.assumption, { x: rx + 0.26, y: 5.94, w: rw - 0.52, h: 0.52, ...t(T.caption), valign: "top", lineSpacingMultiple: 1.16 });

  g.finish();
}

/* ── Appendix ────────────────────────────────────────────────────────────── */
function slideAppendix(a, i) {
  const g = slide(`A${i + 1} ${a.headline}`, {
    kicker: a.kicker, headline: a.headline, sub: a.intro, kind: "reference",
  });
  const top = a.intro ? CY : Y.content;

  if (a.cards) {
    g.block();
    cardGrid(g, pptx, { items: a.cards, cols: 2, x: M, y: top, w: CONTENT_W, h: (a.note ? 6.14 : CB) - top });
    if (a.note) {
      g.block();
      assumption(g, pptx, { text: a.note, x: M, y: 6.24, w: CONTENT_W });
    }
  } else {
    // A9 — the full index, six columns so nothing is truncated.
    const cols = K.DOMAINS.flatMap((d) =>
      d.items.length > 16
        ? [
            { name: d.short, count: 13, items: d.items.slice(0, 13) },
            { name: "Platform", count: d.items.length - 13, items: d.items.slice(13) },
          ]
        : [{ name: d.short, count: d.items.length, items: d.items }]
    );
    g.block();
    columnLists(g, pptx, { columns: cols, x: M, y: top, w: CONTENT_W, h: 4.24, gap: 0.14 });
    g.block();
    assumption(g, pptx, { text: a.note, x: M, y: 6.24, w: CONTENT_W });
  }

  g.finish();
}

/* ══════════════════════════════════════════════════════════════════════════ */
async function main() {
  console.log("\nAumrti — RTIH Amaravati pitch deck\n");
  verifyFacts();

  slideTitle();
  slideProblem();
  slideSolution();
  slideProduct();
  slideDepth();
  slideArchitecture();
  slideIndia();
  slideUSP();
  slideCompetition();
  slideRevenue();
  slideMarket();
  slideMilestones();
  slideCandour();
  slideTeam();
  K.APPENDIX.forEach(slideAppendix);

  assertClean();

  await pptx.writeFile({ fileName: OUT });
  console.log(`  ${page} slides written\n  → ${OUT}\n`);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
