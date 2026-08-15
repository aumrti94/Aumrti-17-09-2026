/**
 * Build-time guards. These exist so the deck's promises are enforced by the
 * build rather than by good intentions:
 *
 *   1. LIGHT THEME  — no slide background other than white, and no non-surface
 *                     fill larger than a rule, tick or dot.
 *   2. OVERFLOW     — every text box is measured against its content. A string
 *                     that would clip fails the build instead of shipping.
 *   3. DENSITY      — a hard ceiling on blocks and body words per slide, which
 *                     is what stops a slide becoming crowded.
 *
 * A violation throws with the slide name, so it is obvious what to shorten.
 */
import { SURFACES, TINT_MAX_ALPHA, C } from "./theme.mjs";

export const LIMITS = {
  blocksPerSlide: 6,
  wordsPerSlide: 225, // body copy; excludes appendix slides, which are reference sheets
  accentBarThin: 0.14, // a non-surface fill must be no thicker than this on its short edge
  accentDotMax: 0.16, // ...or no bigger than this, if it is a dot
  fitTolerance: 1.1, // allow 10% over the naive estimate before failing
};

const errors = [];
export const record = (msg) => errors.push(msg);
export function assertClean() {
  if (errors.length) {
    throw new Error(
      `\nDeck guard failed — ${errors.length} issue(s):\n` + errors.map((e) => `  • ${e}`).join("\n") + "\n"
    );
  }
}

/* ── Text measurement ────────────────────────────────────────────────────── */

/** Flattens pptxgenjs text (string | run[] ) into plain lines. */
function flatten(text) {
  if (typeof text === "string") return text;
  if (!Array.isArray(text)) return String(text ?? "");
  return text
    .map((r) => (typeof r === "string" ? r : r.text ?? ""))
    .join("")
    .replace(/\n{2,}/g, "\n");
}

/**
 * How many lines `text` wraps to in a box `w` inches wide.
 * Exported so blocks.mjs can size adaptive titles with the same arithmetic the
 * guard will later judge them by — the two can never disagree.
 */
export function linesFor(text, w, fontSize, { bullet = false, charSpacing = 0 } = {}) {
  const s = flatten(text);
  if (!s.trim()) return 0;
  // Segoe UI averages ~0.5em per glyph; charSpacing adds to that.
  const charW = fontSize * (96 / 72) * 0.5 + (charSpacing || 0) * (96 / 72);
  const boxPx = (w - (bullet ? 0.16 : 0)) * 96 - 10; // less internal margins
  const perLine = Math.max(6, Math.floor(boxPx / charW));
  return s.split("\n").reduce((n, para) => n + Math.max(1, Math.ceil(para.length / perLine)), 0);
}

/** Height in inches that `lines` of `fontSize` occupy at a given line spacing. */
export const heightFor = (lines, fontSize, spacing = 1.0) => (lines * fontSize * spacing * 1.2) / 72;

/** Whether `text` fits a box of w × h inches at the given options. */
function fits(text, { w, h, fontSize = 12, lineSpacingMultiple, bullet, charSpacing = 0 }) {
  if (!flatten(text).trim()) return true;
  const lines = linesFor(text, w, fontSize, { bullet, charSpacing });
  return heightFor(lines, fontSize, lineSpacingMultiple ?? 1.0) <= h * LIMITS.fitTolerance;
}

/* ── Fill validation ─────────────────────────────────────────────────────── */

function fillOk(fill, { w = 0, h = 0, shape = "" }) {
  if (!fill) return true;
  const color = (typeof fill === "string" ? fill : fill.color || "").toUpperCase();
  const alpha = typeof fill === "object" ? fill.transparency ?? 0 : 0;
  if (!color) return true;
  if (SURFACES.includes(color)) return true;
  if (alpha >= TINT_MAX_ALPHA) return true; // tinted paper, not a colour block
  // Accent marks: a rule or bar thin on its short edge, or a small dot.
  if (Math.min(w, h) <= LIMITS.accentBarThin) return true;
  if (shape === "ellipse" && w <= LIMITS.accentDotMax && h <= LIMITS.accentDotMax) return true;
  return false;
}

/* ── Slide wrapper ───────────────────────────────────────────────────────── */

/**
 * Wraps a pptxgenjs slide so every add* call is checked. `kind: 'reference'`
 * relaxes the word ceiling for appendix sheets, which are read, not presented.
 */
export function guardSlide(slide, name, kind = "main") {
  let blocks = 0;
  let words = 0;

  const api = {
    raw: slide,
    name,
    block() {
      blocks += 1;
      return api;
    },
    addText(text, opts = {}) {
      const s = flatten(text);
      words += s.split(/\s+/).filter(Boolean).length;
      if (!fits(text, opts)) {
        record(
          `${name}: text overflows its ${opts.w?.toFixed(2)}×${opts.h?.toFixed(2)}in box ` +
            `at ${opts.fontSize ?? 12}pt — "${s.slice(0, 58).replace(/\s+/g, " ")}…"`
        );
      }
      return slide.addText(text, opts);
    },
    addShape(type, opts = {}) {
      const shape = String(type);
      if (!fillOk(opts.fill, { w: opts.w, h: opts.h, shape })) {
        record(`${name}: non-light fill ${JSON.stringify(opts.fill)} on a ${opts.w}×${opts.h}in ${shape}`);
      }
      return slide.addShape(type, opts);
    },
    addTable(rows, opts = {}) {
      rows.flat().forEach((cell) => {
        const f = cell?.options?.fill;
        if (!fillOk(f, { h: 0 })) record(`${name}: table cell uses non-light fill ${JSON.stringify(f)}`);
        words += String(cell?.text ?? "").split(/\s+/).filter(Boolean).length;
      });
      return slide.addTable(rows, opts);
    },
    addChart(type, data, opts = {}) {
      return slide.addChart(type, data, opts);
    },
    addImage(opts) {
      return slide.addImage(opts);
    },
    finish() {
      if (slide.background && slide.background.color && slide.background.color.toUpperCase() !== C.white) {
        record(`${name}: slide background is not white (${slide.background.color})`);
      }
      if (blocks > LIMITS.blocksPerSlide) {
        record(`${name}: ${blocks} content blocks — ceiling is ${LIMITS.blocksPerSlide}`);
      }
      if (kind === "main" && words > LIMITS.wordsPerSlide) {
        record(`${name}: ${words} words — ceiling is ${LIMITS.wordsPerSlide}. Cut, do not shrink.`);
      }
      return { blocks, words };
    },
  };

  return api;
}
