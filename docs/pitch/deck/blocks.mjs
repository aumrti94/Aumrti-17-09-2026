/**
 * Reusable layout primitives. Every slide is built from this vocabulary, which
 * is what keeps 23 slides looking like one deck.
 *
 * All fills come from theme.SURFACES. Colour tints appear only as text, hairlines
 * or thin ticks — never as a filled block. See theme.mjs for why.
 */
import { C, T, t, card, CONTENT_W, M } from "./theme.mjs";
import { linesFor, heightFor } from "./guard.mjs";

/**
 * Height a title needs in a column `w` inches wide. Uses the same arithmetic the
 * overflow guard applies, so a title box can never be sized to something the
 * guard will then reject.
 */
const titleH = (text, w, fontSize, charSpacing = 0) =>
  heightFor(linesFor(text, w, fontSize, { charSpacing }), fontSize) + 0.05;

/* ── Card grid ───────────────────────────────────────────────────────────── */
/**
 * items: [{ title, body, accent?, stat? }]
 * Lays out `cols` per row inside (x,y,w,h), gutters included.
 */
export function cardGrid(slide, pptx, { items, cols, x, y, w, h, gap = 0.2, pad = 0.22 }) {
  const rows = Math.ceil(items.length / cols);
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;

  items.forEach((it, i) => {
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + gap);
    card(slide, pptx, { x: cx, y: cy, w: cw, h: ch, accent: it.accent });

    let ty = cy + pad;

    if (it.kicker) {
      slide.addText(it.kicker.toUpperCase(), {
        x: cx + pad,
        y: ty,
        w: cw - pad * 2,
        h: 0.2,
        ...t(T.kicker, { fontSize: 8, color: C.faint, charSpacing: 1.1 }),
        valign: "middle",
      });
      ty += 0.24;
    }

    if (it.stat) {
      slide.addText(it.stat, {
        x: cx + pad,
        y: ty,
        w: cw - pad * 2,
        h: 0.42,
        ...t(T.stat, { fontSize: 21 }),
        valign: "middle",
      });
      ty += 0.44;
    }

    const tw = cw - pad * 2;
    const th = titleH(it.title, tw, T.cardTitle.fontSize);

    slide.addText(it.title, {
      x: cx + pad,
      y: ty,
      w: tw,
      h: th,
      ...t(T.cardTitle),
      valign: "top",
    });

    if (it.body) {
      slide.addText(it.body, {
        x: cx + pad,
        y: ty + th + 0.04,
        w: tw,
        h: ch - (ty - cy) - th - 0.04 - pad + 0.08,
        ...t(T.body, { fontSize: 10.5, color: C.muted }),
        valign: "top",
        lineSpacingMultiple: 1.14,
      });
    }
  });
}

/* ── Journey strip ───────────────────────────────────────────────────────── */
/**
 * steps: [{ num, title, body, broken? }]
 * A horizontal numbered flow. `broken: true` marks a hand-off that drops today —
 * rendered as a rose caret between cards, never as a filled block.
 */
export function journeyStrip(slide, pptx, { steps, x, y, w, h }) {
  const gap = 0.16;
  const cw = (w - gap * (steps.length - 1)) / steps.length;

  steps.forEach((s, i) => {
    const cx = x + i * (cw + gap);
    card(slide, pptx, { x: cx, y, w: cw, h });

    slide.addText(s.num, {
      x: cx + 0.16,
      y: y + 0.14,
      w: cw - 0.32,
      h: 0.2,
      ...t(T.kicker, { fontSize: 8, color: C.faint, charSpacing: 1.1 }),
      valign: "middle",
    });
    const sw = cw - 0.32;
    const sth = titleH(s.title, sw, 11.5);
    slide.addText(s.title, {
      x: cx + 0.16,
      y: y + 0.34,
      w: sw,
      h: sth,
      ...t(T.cardTitle, { fontSize: 11.5 }),
      valign: "top",
    });
    slide.addText(s.body, {
      x: cx + 0.16,
      y: y + 0.36 + sth,
      w: sw,
      h: h - 0.5 - sth,
      ...t(T.body, { fontSize: 9.5, color: C.muted }),
      valign: "top",
      lineSpacingMultiple: 1.12,
    });

    if (i < steps.length - 1) {
      slide.addText(steps[i].broken ? "⇢" : "→", {
        x: cx + cw - 0.04,
        y: y + h / 2 - 0.14,
        w: gap + 0.08,
        h: 0.28,
        ...t(T.body, {
          fontSize: 12,
          color: steps[i].broken ? C.rose : C.faint,
          align: "center",
          bold: true,
        }),
        valign: "middle",
      });
    }
  });
}

/* ── Layer stack ─────────────────────────────────────────────────────────── */
/**
 * layers: [{ name, note, items: [string] }]
 * Stacked architecture bands. The band is a light card; the layer name sits in
 * navy on the left, its components as chips across the right.
 */
export function layerStack(slide, pptx, { layers, x, y, w, h, gap = 0.16 }) {
  const lh = (h - gap * (layers.length - 1)) / layers.length;
  const nameW = 2.5;

  layers.forEach((L, i) => {
    const ly = y + i * (lh + gap);
    card(slide, pptx, { x, y: ly, w, h: lh, accent: L.accent });

    slide.addText(L.name, {
      x: x + 0.22,
      y: ly + 0.16,
      w: nameW,
      h: 0.28,
      ...t(T.cardTitle, { fontSize: 12 }),
      valign: "top",
    });
    slide.addText(L.note, {
      x: x + 0.22,
      y: ly + 0.44,
      w: nameW,
      h: lh - 0.56,
      ...t(T.body, { fontSize: 9, color: C.muted }),
      valign: "top",
      lineSpacingMultiple: 1.1,
    });

    // Vertical hairline separating the label column from the components.
    slide.addShape(pptx.ShapeType.rect, {
      x: x + nameW + 0.32,
      y: ly + 0.18,
      w: 0.006,
      h: lh - 0.36,
      fill: { color: C.line },
      line: { type: "none" },
    });

    const ix = x + nameW + 0.56;
    const iw = w - (nameW + 0.56) - 0.22;
    const cols = L.items.length <= 3 ? L.items.length : Math.ceil(L.items.length / 2);
    const rows = Math.ceil(L.items.length / cols);
    const ciw = iw / cols;
    const cih = (lh - 0.3) / rows;

    L.items.forEach((it, j) => {
      const cix = ix + (j % cols) * ciw;
      const ciy = ly + 0.16 + Math.floor(j / cols) * cih;
      const [head, ...rest] = it.split("|");
      slide.addText(
        [
          { text: head.trim(), options: t(T.body, { fontSize: 10, bold: true, color: C.ink }) },
          ...(rest.length
            ? [{ text: "\n" + rest.join("|").trim(), options: t(T.body, { fontSize: 8.8, color: C.muted }) }]
            : []),
        ],
        { x: cix, y: ciy, w: ciw - 0.16, h: cih, valign: "top", lineSpacingMultiple: 1.1 }
      );
    });
  });
}

/* ── Comparison table ────────────────────────────────────────────────────── */
/**
 * Light table: navy header text on the panel wash, hairline gridlines, no dark bands.
 * rows: [[cell, ...]] where a cell may be a string or { text, tone: 'yes'|'no'|'part' }
 */
export function compareTable(slide, pptx, { headers, rows, x, y, w, colW, highlightCol = null }) {
  const toneColor = { yes: C.teal, no: C.faint, part: C.amber };

  const head = headers.map((hd, i) => ({
    text: hd,
    options: {
      fontFace: "Segoe UI",
      fontSize: 10,
      bold: true,
      color: i === highlightCol ? C.navy : C.muted,
      fill: { color: C.panel },
      align: i === 0 ? "left" : "center",
      valign: "middle",
    },
  }));

  const body = rows.map((r) =>
    r.map((cell, i) => {
      const isObj = typeof cell === "object";
      const text = isObj ? cell.text : cell;
      const tone = isObj ? cell.tone : null;
      return {
        text,
        options: {
          fontFace: "Segoe UI",
          fontSize: i === 0 ? 10 : 10,
          bold: i === highlightCol,
          color: tone ? toneColor[tone] : i === 0 ? C.ink : C.muted,
          fill: { color: i === highlightCol ? C.panel : C.white },
          align: i === 0 ? "left" : "center",
          valign: "middle",
        },
      };
    })
  );

  slide.addTable([head, ...body], {
    x,
    y,
    w,
    colW,
    border: { type: "solid", color: C.line, pt: 0.75 },
    rowH: 0.34,
    margin: [0.06, 0.1, 0.06, 0.1],
  });
}

/* ── KPI row ─────────────────────────────────────────────────────────────── */
/** stats: [{ value, label }] — big navy number over a muted label, on white. */
export function kpiRow(slide, pptx, { stats, x, y, w, h = 0.86, divider = true }) {
  const cw = w / stats.length;
  stats.forEach((s, i) => {
    const cx = x + i * cw;
    slide.addText(s.value, {
      x: cx,
      y,
      w: cw - 0.12,
      h: 0.44,
      ...t(T.stat, { fontSize: 22 }),
      valign: "middle",
    });
    slide.addText(s.label.toUpperCase(), {
      x: cx,
      y: y + 0.44,
      w: cw - 0.12,
      h: 0.24,
      ...t(T.statLabel),
      valign: "top",
    });
    if (divider && i > 0) {
      slide.addShape(pptx.ShapeType.rect, {
        x: cx - 0.1,
        y: y + 0.06,
        w: 0.006,
        h: h - 0.16,
        fill: { color: C.line },
        line: { type: "none" },
      });
    }
  });
}

/* ── Bullet panel ────────────────────────────────────────────────────────── */
/** A titled card holding short bullets. bullets: [string] */
export function bulletPanel(slide, pptx, { title, bullets, x, y, w, h, note = null, accent = null }) {
  card(slide, pptx, { x, y, w, h, accent });

  slide.addText(title, {
    x: x + 0.24,
    y: y + 0.18,
    w: w - 0.48,
    h: 0.28,
    ...t(T.cardTitle),
    valign: "top",
  });

  slide.addText(
    bullets.map((b) => ({
      text: b,
      options: { bullet: { code: "2022", indent: 12 }, breakLine: true },
    })),
    {
      x: x + 0.24,
      y: y + 0.5,
      w: w - 0.48,
      h: h - 0.5 - (note ? 0.46 : 0.14),
      ...t(T.body, { fontSize: 10.5, color: C.muted }),
      valign: "top",
      lineSpacingMultiple: 1.2,
      paraSpaceAfter: 4,
    }
  );

  if (note) {
    slide.addText(note, {
      x: x + 0.24,
      y: y + h - 0.42,
      w: w - 0.48,
      h: 0.3,
      ...t(T.caption),
      valign: "middle",
    });
  }
}

/* ── Quote panel ─────────────────────────────────────────────────────────── */
/** A pull-quote: amber vertical tick, navy italic text, muted attribution. */
export function quotePanel(slide, pptx, { text, attrib, x, y, w, h }) {
  card(slide, pptx, { x, y, w, h, fill: C.panel });
  slide.addShape(pptx.ShapeType.rect, {
    x: x + 0.2,
    y: y + 0.2,
    w: 0.028,
    h: h - 0.4,
    fill: { color: C.amber },
    line: { type: "none" },
  });
  slide.addText(text, {
    x: x + 0.38,
    y: y + 0.18,
    w: w - 0.6,
    h: h - 0.6,
    ...t(T.body, { fontSize: 12, color: C.navy, italic: true }),
    valign: "middle",
    lineSpacingMultiple: 1.2,
  });
  slide.addText(attrib, {
    x: x + 0.38,
    y: y + h - 0.42,
    w: w - 0.6,
    h: 0.26,
    ...t(T.caption, { italic: false }),
    valign: "middle",
  });
}

/* ── Chip grid ───────────────────────────────────────────────────────────── */
/** chips: [{ label, note }] — compact capability chips, one line of detail each. */
export function chipGrid(slide, pptx, { chips, cols, x, y, w, h, gap = 0.16 }) {
  const rows = Math.ceil(chips.length / cols);
  const cw = (w - gap * (cols - 1)) / cols;
  const ch = (h - gap * (rows - 1)) / rows;

  chips.forEach((c, i) => {
    const cx = x + (i % cols) * (cw + gap);
    const cy = y + Math.floor(i / cols) * (ch + gap);
    card(slide, pptx, { x: cx, y: cy, w: cw, h: ch });

    slide.addShape(pptx.ShapeType.ellipse, {
      x: cx + 0.2,
      y: cy + 0.28,
      w: 0.09,
      h: 0.09,
      fill: { color: C.amber },
      line: { type: "none" },
    });
    const lw = cw - 0.56;
    const lh = Math.max(0.3, titleH(c.label, lw, 11.5));
    slide.addText(c.label, {
      x: cx + 0.38,
      y: cy + 0.17,
      w: lw,
      h: lh,
      ...t(T.cardTitle, { fontSize: 11.5 }),
      valign: "middle",
    });
    slide.addText(c.note, {
      x: cx + 0.38,
      y: cy + 0.19 + lh,
      w: lw,
      h: ch - 0.32 - lh,
      ...t(T.body, { fontSize: 9.3, color: C.muted }),
      valign: "top",
      lineSpacingMultiple: 1.12,
    });
  });
}

/* ── Column lists ────────────────────────────────────────────────────────── */
/**
 * columns: [{ name, count, items: [string] }]
 * The breadth slide: labelled domain columns rather than a wall of module names.
 */
export function columnLists(slide, pptx, { columns, x, y, w, h, gap = 0.18 }) {
  const cw = (w - gap * (columns.length - 1)) / columns.length;

  columns.forEach((col, i) => {
    const cx = x + i * (cw + gap);
    card(slide, pptx, { x: cx, y, w: cw, h });

    slide.addText(String(col.count), {
      x: cx + 0.18,
      y: y + 0.16,
      w: cw - 0.36,
      h: 0.4,
      ...t(T.stat, { fontSize: 20 }),
      valign: "middle",
    });
    // A two-word domain name wraps at these column widths, so the rule below it
    // is placed from the measured name height rather than a fixed offset.
    const nw = cw - 0.36;
    const nh = Math.max(0.2, titleH(col.name.toUpperCase(), nw, 8.2, 1.0));
    slide.addText(col.name.toUpperCase(), {
      x: cx + 0.18,
      y: y + 0.54,
      w: nw,
      h: nh,
      ...t(T.kicker, { fontSize: 8.2, color: C.muted, charSpacing: 1.0 }),
      valign: "top",
    });

    const ruleY = y + 0.58 + nh;
    slide.addShape(pptx.ShapeType.rect, {
      x: cx + 0.18,
      y: ruleY,
      w: nw,
      h: 0.006,
      fill: { color: C.line },
      line: { type: "none" },
    });

    slide.addText(
      col.items.map((m) => ({ text: m, options: { breakLine: true } })),
      {
        x: cx + 0.18,
        y: ruleY + 0.1,
        w: nw,
        h: y + h - ruleY - 0.26,
        ...t(T.body, { fontSize: 9.4, color: C.muted }),
        valign: "top",
        lineSpacingMultiple: 1.22,
      }
    );
  });
}

/* ── Assumption caption ──────────────────────────────────────────────────── */
/** Every modelled number carries one of these directly beneath it. */
export function assumption(slide, pptx, { text, x, y, w }) {
  slide.addText(text, {
    x,
    y,
    w,
    h: 0.24,
    ...t(T.caption),
    valign: "middle",
  });
}

/* ── Fill-in marker ──────────────────────────────────────────────────────── */
/** Founder-only facts that cannot be modelled. Amber so they are unmissable. */
export const fillIn = (label) => `[ ${label} ]`;

export function fillInRun(label) {
  return {
    text: fillIn(label),
    options: { fontFace: "Segoe UI", color: C.amber, bold: true },
  };
}

export { M, CONTENT_W };
