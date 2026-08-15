/**
 * Design tokens and shared slide furniture for the Aumrti pitch deck.
 *
 * THE DECK IS LIGHT. There is no dark slide anywhere — not the title, not the
 * dividers, not the closing. Colour appears only as text, hairlines and small
 * accent marks on white. It is never a full-bleed or full-panel fill.
 *
 * Every fill used anywhere must come from SURFACES (or a tint at <= TINT_MAX_ALPHA
 * transparency). build.mjs asserts this, so a dark fill fails the build.
 */

/* ── Canvas ──────────────────────────────────────────────────────────────── */
export const W = 13.333; // 16:9 widescreen, inches
export const H = 7.5;

export const M = 0.62; // left / right margin
export const CONTENT_W = W - M * 2; // 12.093

/* ── Colour ──────────────────────────────────────────────────────────────── */
// Drawn from the product's own tokens in src/index.css, used at light weight.
export const C = {
  white: "FFFFFF",
  panel: "F8FAFC", // lightest wash — separates a card without reading as colour
  card: "FCFDFE", // one step lighter still
  line: "E4E7EC", // hairline
  lineSoft: "EEF1F5",

  ink: "101828", // body text
  navy: "1B305A", // headlines — src/index.css --primary (220 54% 23%)
  muted: "667085",
  faint: "98A2B3",

  amber: "F5A310", // --accent (38 92% 50%) — short rules, dots, one emphasised word
  teal: "0E9F8F", // status only, as text or 1pt border
  rose: "D0455C", // status only, as text or 1pt border
};

/** The only fills any shape may use. Enforced by the light-theme guard. */
export const SURFACES = [C.white, C.panel, C.card];

/** Tints may be used as fills only at or above this transparency (percent). */
export const TINT_MAX_ALPHA = 92; // i.e. <= 8% opacity

/* ── Type ────────────────────────────────────────────────────────────────── */
export const FONT = "Segoe UI"; // guaranteed present on Windows PowerPoint

export const T = {
  display: { fontSize: 40, bold: true, color: C.navy },
  headline: { fontSize: 27, bold: true, color: C.navy },
  subhead: { fontSize: 16, color: C.muted },
  cardTitle: { fontSize: 13, bold: true, color: C.navy },
  body: { fontSize: 11.5, color: C.ink },
  small: { fontSize: 10, color: C.muted },
  caption: { fontSize: 8.5, color: C.faint, italic: true },
  kicker: { fontSize: 8.5, bold: true, color: C.amber, charSpacing: 1.6 },
  stat: { fontSize: 25, bold: true, color: C.navy },
  statLabel: { fontSize: 8.5, color: C.muted, charSpacing: 0.6 },
};

/** Applies the deck font to any text option bag. */
export const t = (base, extra = {}) => ({ fontFace: FONT, ...base, ...extra });

/* ── Vertical rhythm ─────────────────────────────────────────────────────── */
export const Y = {
  topbar: 0.32,
  kicker: 0.72,
  headline: 0.98, // one line at 27pt = 0.45in; headlines are kept to one line
  rule: 1.54,
  content: 1.86, // content top when there is no sub-head
  contentBottom: 6.72,
  footer: 6.92,
};

export const BODY_H = Y.contentBottom - Y.content; // 4.86

/* ── Furniture ───────────────────────────────────────────────────────────── */

/**
 * Standard slide chrome: brand mark, kicker, headline, and the hairline rule
 * with the short amber leading segment that echoes the Tata template's red rule.
 */
export function chrome(slide, pptx, { kicker, headline, sub, brand = "Aumrti" }) {
  slide.addText(brand, {
    x: M,
    y: Y.topbar,
    w: 3,
    h: 0.26,
    ...t(T.small, { color: C.navy, bold: true, charSpacing: 1.2 }),
    valign: "middle",
  });

  if (kicker) {
    slide.addText(kicker.toUpperCase(), {
      x: M,
      y: Y.kicker,
      w: CONTENT_W,
      h: 0.24,
      ...t(T.kicker),
      valign: "middle",
    });
  }

  slide.addText(headline, {
    x: M,
    y: Y.headline,
    w: CONTENT_W,
    h: 0.52,
    ...t(T.headline),
    valign: "top",
  });

  // Hairline rule: short amber segment, then the long navy hairline.
  slide.addShape(pptx.ShapeType.rect, {
    x: M,
    y: Y.rule,
    w: 0.46,
    h: 0.028,
    fill: { color: C.amber },
    line: { type: "none" },
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: M + 0.56,
    y: Y.rule + 0.011,
    w: CONTENT_W - 0.56,
    h: 0.006,
    fill: { color: C.line },
    line: { type: "none" },
  });

  if (sub) {
    // Two lines of sub-head fit between the rule and the content top (2.15in).
    slide.addText(sub, {
      x: M,
      y: Y.rule + 0.1,
      w: CONTENT_W,
      h: 0.46,
      ...t(T.subhead, { fontSize: 11.5 }),
      valign: "top",
      lineSpacingMultiple: 1.2,
    });
  }
}

/** Footer: wordmark, site, page number. Present on every slide but the title. */
export function footer(slide, pptx, { page, total, note }) {
  slide.addShape(pptx.ShapeType.rect, {
    x: M,
    y: Y.footer - 0.14,
    w: CONTENT_W,
    h: 0.006,
    fill: { color: C.lineSoft },
    line: { type: "none" },
  });

  slide.addText(note || "Aumrti — AI-native hospital operating system", {
    x: M,
    y: Y.footer,
    w: 7,
    h: 0.24,
    ...t(T.caption, { italic: false }),
    valign: "middle",
  });

  slide.addText("www.aumrti.com", {
    x: M + 7.1,
    y: Y.footer,
    w: 2.6,
    h: 0.24,
    ...t(T.caption, { italic: false, align: "center" }),
    valign: "middle",
  });

  slide.addText(`${page} / ${total}`, {
    x: W - M - 1.2,
    y: Y.footer,
    w: 1.2,
    h: 0.24,
    ...t(T.caption, { italic: false, align: "right", color: C.muted }),
    valign: "middle",
  });
}

/** A light card: panel wash with a hairline border. The only "surface" we draw. */
export function card(slide, pptx, { x, y, w, h, fill = C.card, accent = null }) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x,
    y,
    w,
    h,
    rectRadius: 0.04,
    fill: { color: fill },
    line: { color: C.line, width: 0.75 },
  });
  if (accent) {
    // A 3pt colour tick on the top-left edge — the only place a status tint appears.
    slide.addShape(pptx.ShapeType.rect, {
      x: x + 0.14,
      y,
      w: 0.34,
      h: 0.026,
      fill: { color: accent },
      line: { type: "none" },
    });
  }
}
