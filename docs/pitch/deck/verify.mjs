/**
 * Structural check of the generated .pptx. The build guards check the deck we
 * intended to write; this checks the file we actually wrote.
 *
 * Run:  npm run verify
 */
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readFileSync, statSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "../../..");
const FILE = resolve(HERE, "../Aumrti_RTIH_Amaravati_Pitch_Deck.pptx");

// jszip is already a dependency of the host project; no new install needed.
const require = createRequire(resolve(REPO, "package.json"));
const JSZip = require("jszip");

const EXPECTED_SLIDES = 23;
const EMU_PER_IN = 914400;

const fail = [];
const ok = (cond, msg) => (cond ? true : (fail.push(msg), false));

const zip = await JSZip.loadAsync(readFileSync(FILE));
const names = Object.keys(zip.files);

/* ── Slide count ─────────────────────────────────────────────────────────── */
const slides = names
  .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

ok(slides.length === EXPECTED_SLIDES, `expected ${EXPECTED_SLIDES} slides, found ${slides.length}`);

/* ── Canvas is 16:9 at 13.333 × 7.5in ────────────────────────────────────── */
const pres = await zip.file("ppt/presentation.xml").async("string");
const size = pres.match(/<p:sldSz\s+cx="(\d+)"\s+cy="(\d+)"/);
if (ok(size, "presentation.xml has no slide size")) {
  const [w, h] = [Number(size[1]) / EMU_PER_IN, Number(size[2]) / EMU_PER_IN];
  ok(Math.abs(w - 13.333) < 0.02, `slide width is ${w.toFixed(3)}in, expected 13.333`);
  ok(Math.abs(h - 7.5) < 0.02, `slide height is ${h.toFixed(3)}in, expected 7.5`);
  ok(Math.abs(w / h - 16 / 9) < 0.01, `aspect ratio is ${(w / h).toFixed(3)}, expected 1.778`);
}

/* ── Geometry: nothing off-canvas, no text box sitting on another ────────── */
const CANVAS = { w: 13.333 * EMU_PER_IN, h: 7.5 * EMU_PER_IN };
const SLOP = 0.02 * EMU_PER_IN;

/** Pulls every positioned element out of a slide with its box and its text. */
function elements(xml) {
  const out = [];
  const re = /<(p:sp|p:graphicFrame|p:pic)\b[\s\S]*?<\/\1>/g;
  for (const [chunk, tag] of xml.matchAll(re)) {
    const off = chunk.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
    const ext = chunk.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
    if (!off || !ext) continue;
    const text = [...chunk.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join("").trim();
    out.push({
      tag,
      x: +off[1], y: +off[2], w: +ext[1], h: +ext[2],
      hasText: text.length > 0,
      label: text.slice(0, 40).replace(/\s+/g, " "),
    });
  }
  return out;
}

const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));

/* ── Every slide carries text, is light, and is laid out cleanly ─────────── */
const report = [];
for (const path of slides) {
  const xml = await zip.file(path).async("string");
  const text = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(" ");
  const n = Number(path.match(/\d+/)[0]);

  ok(text.trim().length > 0, `slide ${n} contains no text`);

  // Slide-level background must be white if it is set at all.
  const bg = xml.match(/<p:bg>[\s\S]*?<a:srgbClr val="([0-9A-Fa-f]{6})"/);
  if (bg) ok(bg[1].toUpperCase() === "FFFFFF", `slide ${n} background is #${bg[1]}, not white`);

  const els = elements(xml);

  // (a) nothing may run off the canvas
  for (const e of els) {
    if (e.x < -SLOP || e.y < -SLOP || e.x + e.w > CANVAS.w + SLOP || e.y + e.h > CANVAS.h + SLOP) {
      fail.push(`slide ${n}: element runs off-canvas — "${e.label || e.tag}"`);
    }
  }

  // (b) two text boxes may not sit on top of each other
  const texts = els.filter((e) => e.hasText && e.tag === "p:sp");
  for (let i = 0; i < texts.length; i++) {
    for (let j = i + 1; j < texts.length; j++) {
      const a = texts[i], b = texts[j];
      const smaller = Math.min(a.w * a.h, b.w * b.h);
      if (smaller > 0 && overlapArea(a, b) / smaller > 0.2) {
        fail.push(`slide ${n}: text boxes overlap — "${a.label}" / "${b.label}"`);
      }
    }
  }

  report.push({ slide: n, chars: text.length, words: text.split(/\s+/).filter(Boolean).length });
}

/* ── The logo made it in ─────────────────────────────────────────────────── */
const media = names.filter((n) => n.startsWith("ppt/media/"));
ok(media.length >= 1, "no media embedded — the logo did not make it into the file");

/* ── Report ──────────────────────────────────────────────────────────────── */
const kb = (statSync(FILE).size / 1024).toFixed(0);
console.log(`\nVerifying ${FILE}\n`);
console.log(`  ${slides.length} slides · ${kb} KB · ${media.length} embedded asset(s)`);

const main = report.slice(0, 14);
const appendix = report.slice(14);
const avg = (a) => Math.round(a.reduce((s, r) => s + r.words, 0) / a.length);
console.log(`  main deck   ${main.length} slides, ${avg(main)} words/slide average`);
console.log(`  appendix    ${appendix.length} slides, ${avg(appendix)} words/slide average`);

const busiest = [...report].sort((a, b) => b.words - a.words)[0];
console.log(`  busiest     slide ${busiest.slide} at ${busiest.words} words\n`);

if (fail.length) {
  console.error(`FAILED — ${fail.length} issue(s):`);
  fail.forEach((f) => console.error(`  • ${f}`));
  process.exit(1);
}
console.log("  All structural checks passed.\n");
