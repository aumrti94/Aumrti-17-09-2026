/**
 * GST tax-invoice PDF builder (Deno / Supabase Edge).
 *
 * Why pdf-lib: Supabase Edge has no Chromium, so Puppeteer-style HTML→PDF is
 * impossible; a third-party render API would put a vendor on the revenue path.
 * pdf-lib is pure JS with no WASM and runs here unmodified. The cost is manual
 * positioned layout, which is acceptable for a fixed-format document.
 *
 * THE RUPEE TRAP
 * --------------
 * pdf-lib's 14 standard fonts are WinAnsi-encoded and cannot encode U+20B9 (₹).
 * Drawing it with Helvetica throws "WinAnsi cannot encode". A Unicode TTF must
 * be embedded via fontkit. The font is fetched from storage and memoised per
 * isolate rather than committed to the function directory (which would bloat
 * every deploy of every function sharing this module).
 *
 * If the font cannot be fetched we fall back to "Rs." with the standard fonts
 * rather than failing — an invoice that says Rs. is recoverable, a webhook that
 * 500s because a font CDN blipped is not.
 *
 * NO EXTERNAL CDN FALLBACK. This used to also try fetching NotoSans from jsdelivr when the
 * hospital's own storage bucket had no font uploaded yet. Found live (Phase 6 edge-function
 * testing): an external fetch returning HTTP 200 with corrupted/substituted content (a
 * captive-portal-style network response, a truncated download — anything short of a clean
 * network failure) is NOT recoverable by the try/catch around loadFonts(). fontkit's own
 * subsetting/encoding work runs partly in a deferred internal callback outside the awaited
 * promise chain, so a malformed font crashes the ENTIRE Deno worker
 * (InvalidWorkerResponse: "value argument is out of bounds") rather than rejecting a promise —
 * exactly the un-recoverable failure this module's own header says it exists to avoid. The
 * bucket path is trusted (an admin-uploaded, controlled file) and kept; the network fallback
 * is removed rather than made "more validated", because no practical byte-level check closes
 * every way an untrusted external fetch can return structurally-plausible-but-corrupt content.
 */

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "https://esm.sh/pdf-lib@1.17.1";
import fontkit from "https://esm.sh/@pdf-lib/fontkit@1.1.1";

export interface InvoicePdfInput {
  invoice_number: string;
  invoice_date: string;
  seller: {
    legal_name: string;
    gstin?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    pincode?: string | null;
    cin?: string | null;
    pan?: string | null;
    support_email?: string | null;
    website?: string | null;
  };
  buyer: {
    name: string;
    address?: string | null;
    gstin?: string | null;
    state?: string | null;
  };
  plan_name: string;
  billing_cycle?: string | null;
  billing_period_start?: string | null;
  billing_period_end?: string | null;
  sac_code: string;
  /** Tax-inclusive total actually charged. */
  total: number;
  base: number;
  cgst: number;
  sgst: number;
  igst: number;
  ratePct: number;
  interState: boolean;
  place_of_supply?: string | null;
  razorpay_payment_id?: string | null;
  payment_method?: string | null;
  payment_method_detail?: string | null;
  notes?: string | null;
}

/** Module-level cache: one fetch per isolate, not per invoice. */
let fontCache: { regular: Uint8Array; bold: Uint8Array } | null = null;
let fontFetchFailed = false;

// TrueType/OpenType magic-byte signatures. A response with any other leading bytes is not a
// usable font — a truncated download or an unexpected substitution. `rRes.ok` alone would not
// catch this (a fetch can 200 with a garbage body), so this is checked in addition to that —
// a floor, not a full validation: see the module header for why a deeper byte-level check was
// judged not worth attempting, and the external CDN path removed instead.
function looksLikeTrueTypeOrOpenType(bytes: Uint8Array): boolean {
  if (bytes.length < 4) return false;
  const sig = bytes.slice(0, 4);
  const matches = (s: string) => s.split("").every((c, i) => sig[i] === c.charCodeAt(0));
  return (
    (sig[0] === 0x00 && sig[1] === 0x01 && sig[2] === 0x00 && sig[3] === 0x00) || // TrueType
    matches("OTTO") || // OpenType/CFF
    matches("true") || // legacy TrueType (macOS)
    matches("ttcf")    // TrueType Collection
  );
}

/**
 * Loads a Unicode TTF/OTF from the hospital's own storage bucket. No external network
 * fallback — see the module header for why. Returns null (triggering the "Rs." standard-font
 * fallback) whenever no font has been uploaded there yet.
 */
async function loadFonts(
  bucketFetch?: (name: string) => Promise<Uint8Array | null>,
): Promise<{ regular: Uint8Array; bold: Uint8Array } | null> {
  if (fontCache) return fontCache;
  if (fontFetchFailed) return null;
  if (!bucketFetch) return null;

  try {
    const [r, b] = await Promise.all([bucketFetch("NotoSans-Regular.ttf"), bucketFetch("NotoSans-Bold.ttf")]);
    if (r && b && looksLikeTrueTypeOrOpenType(r) && looksLikeTrueTypeOrOpenType(b)) {
      fontCache = { regular: r, bold: b };
      return fontCache;
    }
    return null;
  } catch (e) {
    console.error("Invoice font load failed, falling back to 'Rs.':", (e as Error).message);
    fontFetchFailed = true;
    return null;
  }
}

const A4 = { w: 595.28, h: 841.89 };
const M = 48; // margin
const INK = rgb(0.1, 0.12, 0.16);
const MUTED = rgb(0.42, 0.45, 0.5);
const LINE = rgb(0.85, 0.87, 0.9);
const BRAND = rgb(0.102, 0.184, 0.353); // #1A2F5A

const fmtDate = (iso?: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

/** Indian digit grouping, e.g. 1,50,000.00 */
const groupINR = (n: number): string => {
  const fixed = Math.abs(n).toFixed(2);
  const [int, dec] = fixed.split(".");
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3);
  const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${n < 0 ? "-" : ""}${grouped}.${dec}`;
};

export async function buildInvoicePdf(
  input: InvoicePdfInput,
  bucketFetch?: (name: string) => Promise<Uint8Array | null>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);

  const fonts = await loadFonts(bucketFetch);
  let regular: PDFFont;
  let bold: PDFFont;
  let rupee: string;

  if (fonts) {
    regular = await doc.embedFont(fonts.regular, { subset: true });
    bold = await doc.embedFont(fonts.bold, { subset: true });
    rupee = "₹";
  } else {
    regular = await doc.embedFont(StandardFonts.Helvetica);
    bold = await doc.embedFont(StandardFonts.HelveticaBold);
    rupee = "Rs. ";   // Helvetica cannot encode ₹ — this is the safe degradation
  }

  const money = (n: number) => `${rupee}${groupINR(n)}`;
  const page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - M;

  const text = (
    s: string,
    opts: { x?: number; size?: number; font?: PDFFont; color?: typeof INK; right?: number } = {},
  ) => {
    const size = opts.size ?? 10;
    const font = opts.font ?? regular;
    let x = opts.x ?? M;
    if (opts.right !== undefined) x = opts.right - font.widthOfTextAtSize(s, size);
    page.drawText(s, { x, y, size, font, color: opts.color ?? INK });
  };

  /**
   * Hard-wraps to a pixel width. The bill-to block sits at x=48 and the invoice
   * meta column starts at x≈337, so an unbounded address would run straight
   * through it. Wrapping is measured, not character-counted, because the font is
   * proportional.
   */
  const wrap = (s: string, font: PDFFont, size: number, maxW: number): string[] => {
    const words = s.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3); // an invoice is not the place for a 5-line address
  };

  const rule = (yy: number) =>
    page.drawLine({ start: { x: M, y: yy }, end: { x: A4.w - M, y: yy }, thickness: 0.7, color: LINE });

  // ── Header ──
  text(input.seller.legal_name, { size: 18, font: bold, color: BRAND });
  text("TAX INVOICE", { size: 14, font: bold, right: A4.w - M });
  y -= 16;

  const sellerLines = [
    input.seller.address,
    [input.seller.city, input.seller.state, input.seller.pincode].filter(Boolean).join(", "),
    input.seller.gstin ? `GSTIN: ${input.seller.gstin}` : null,
    input.seller.cin ? `CIN: ${input.seller.cin}` : null,
    input.seller.pan ? `PAN: ${input.seller.pan}` : null,
    input.seller.support_email,
  ].filter(Boolean) as string[];

  for (const l of sellerLines) { text(l, { size: 8.5, color: MUTED }); y -= 11; }

  y -= 6;
  rule(y);
  y -= 18;

  // ── Invoice meta (right) + Bill-to (left) ──
  const metaTop = y;
  text("BILL TO", { size: 8, font: bold, color: MUTED });
  y -= 13;
  const BILLTO_W = A4.w - M - 210 - M - 12; // stop short of the meta column
  for (const l of wrap(input.buyer.name, bold, 11, BILLTO_W)) {
    text(l, { size: 11, font: bold });
    y -= 13;
  }
  if (input.buyer.address) {
    for (const l of wrap(input.buyer.address, regular, 8.5, BILLTO_W)) {
      text(l, { size: 8.5, color: MUTED });
      y -= 11;
    }
  }
  if (input.buyer.gstin) {
    text(`GSTIN: ${input.buyer.gstin}`, { size: 8.5, color: MUTED });
    y -= 11;
  }
  const leftEnd = y;

  y = metaTop;
  const metaRight = A4.w - M;
  const metaRow = (k: string, v: string) => {
    text(k, { size: 8.5, color: MUTED, x: A4.w - M - 210 });
    text(v, { size: 9, font: bold, right: metaRight });
    y -= 13;
  };
  metaRow("Invoice No.", input.invoice_number);
  metaRow("Invoice Date", fmtDate(input.invoice_date));
  if (input.place_of_supply) metaRow("Place of Supply", input.place_of_supply);
  if (input.razorpay_payment_id) metaRow("Payment Ref", input.razorpay_payment_id);

  y = Math.min(leftEnd, y) - 12;
  rule(y);
  y -= 20;

  // ── Line item table ──
  const colDesc = M;
  const colSac = 330;
  const colQty = 400;
  const colAmt = A4.w - M;

  text("DESCRIPTION", { size: 8, font: bold, color: MUTED, x: colDesc });
  text("SAC", { size: 8, font: bold, color: MUTED, x: colSac });
  text("QTY", { size: 8, font: bold, color: MUTED, x: colQty });
  text("AMOUNT", { size: 8, font: bold, color: MUTED, right: colAmt });
  y -= 8;
  rule(y);
  y -= 16;

  const cycleWord = input.billing_cycle === "yearly" ? "Annual" : "Monthly";
  text(`Aumrti HMS — ${input.plan_name} Plan (${cycleWord})`, { size: 10, x: colDesc });
  text(input.sac_code, { size: 9, x: colSac });
  text("1", { size: 9, x: colQty });
  text(money(input.base), { size: 10, right: colAmt });
  y -= 12;

  if (input.billing_period_start) {
    text(
      `Billing period: ${fmtDate(input.billing_period_start)} – ${fmtDate(input.billing_period_end)}`,
      { size: 8.5, color: MUTED, x: colDesc },
    );
    y -= 14;
  }

  y -= 4;
  rule(y);
  y -= 18;

  // ── Totals ──
  const totalRow = (label: string, value: string, opts: { bold?: boolean; size?: number } = {}) => {
    const f = opts.bold ? bold : regular;
    const s = opts.size ?? 9.5;
    text(label, { size: s, font: f, color: opts.bold ? INK : MUTED, x: A4.w - M - 220 });
    text(value, { size: s, font: f, right: A4.w - M });
    y -= 15;
  };

  totalRow("Taxable Value", money(input.base));
  if (input.interState) {
    totalRow(`IGST @ ${input.ratePct}%`, money(input.igst));
  } else {
    totalRow(`CGST @ ${input.ratePct / 2}%`, money(input.cgst));
    totalRow(`SGST @ ${input.ratePct / 2}%`, money(input.sgst));
  }
  y -= 4;
  rule(y);
  y -= 16;
  totalRow("Total (incl. GST)", money(input.total), { bold: true, size: 11.5 });

  y -= 6;
  if (input.payment_method) {
    const detail = input.payment_method_detail ? ` · ${input.payment_method_detail}` : "";
    text(`Paid via ${input.payment_method.toUpperCase()}${detail}`, { size: 8.5, color: MUTED });
    y -= 12;
  }

  // ── Footer ──
  const footY = M + 26;
  page.drawLine({ start: { x: M, y: footY + 16 }, end: { x: A4.w - M, y: footY + 16 }, thickness: 0.7, color: LINE });
  y = footY;
  text(
    input.notes ?? "This is a computer-generated invoice and does not require a signature.",
    { size: 8, color: MUTED },
  );
  y -= 10;
  text(
    [input.seller.website, input.seller.support_email].filter(Boolean).join(" · "),
    { size: 8, color: MUTED },
  );

  return await doc.save();
}
