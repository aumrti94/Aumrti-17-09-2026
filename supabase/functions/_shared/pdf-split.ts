// @ts-nocheck
// ── PDF page slicing for chunked document ingestion ─────────────────────────
//
// A patient's bag of outside records can be 300+ pages. No model reads that in
// one call, and no edge function invocation survives trying. The extraction
// worker therefore processes fixed page ranges, which means physically cutting a
// sub-PDF out of the original before sending it.
//
// pdf-lib is used rather than pdf.js because this module only ever needs to
// RE-PACKAGE pages, never to render or rasterise them — the model reads the PDF
// natively. pdf-lib is pure JS with no canvas/worker dependency, which pdf.js
// cannot say in Deno.
//
// Used by: supabase/functions/ai-history-ingest/index.ts
// Client twin: src/components/clinical/PatientHistoryUploadPanel.tsx imports
// pdf-lib directly for the page COUNT, which is what the cost estimate is built
// from. Keep the two in step — a count that disagrees with what the worker
// actually chunks makes the doctor's cost estimate wrong.

import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";

/** Default pages per AI call. See PAGES_PER_CHUNK in ai-history-ingest. */
export const DEFAULT_PAGES_PER_CHUNK = 15;

/**
 * base64 without blowing the stack.
 *
 * `btoa(String.fromCharCode(...bytes))` is the obvious one-liner and it throws
 * RangeError on anything past ~100KB, because spreading a Uint8Array into apply()
 * puts one argument on the stack per BYTE. A 15-page scan is several megabytes,
 * so the naive version fails on every real input and works on every test fixture.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32KB of arguments at a time
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Load a PDF, tolerating the ones real hospitals actually hand out.
 *
 * `ignoreEncryption` is not laziness: Indian diagnostic labs routinely email
 * owner-locked PDFs (print/copy restricted, no user password). Those open fine in
 * any viewer, and refusing them would reject a large share of genuine lab reports
 * for a restriction that was never about reading.
 */
async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
}

/**
 * Page count, or 0 when the file cannot be parsed as a PDF.
 *
 * Returns 0 rather than throwing so the caller can record the source as
 * `unsupported` and keep it VISIBLE in the coverage ledger. A corrupt scan that
 * vanishes from the page count is exactly the silent loss this feature exists to
 * prevent — the doctor must see "1 document could not be read", not a total that
 * quietly excludes it.
 */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  try {
    return (await load(bytes)).getPageCount();
  } catch {
    return 0;
  }
}

/**
 * Cut pages [pageFrom, pageTo] (1-indexed, inclusive) into a standalone PDF.
 *
 * The range is clamped to the document rather than validated, because page counts
 * are recorded when the file is staged and re-read here on a later invocation —
 * a mismatch must degrade to "extract the pages that do exist" rather than fail
 * a chunk and burn its three retries on an off-by-one.
 */
export async function slicePdf(
  bytes: Uint8Array,
  pageFrom: number,
  pageTo: number,
): Promise<Uint8Array> {
  const src = await load(bytes);
  const total = src.getPageCount();

  const from = Math.max(1, Math.min(pageFrom, total));
  const to = Math.max(from, Math.min(pageTo, total));

  // Whole document — skip the copy entirely. Most scans are a single photographed
  // page or a short report, so this is the common path, not an optimisation.
  if (from === 1 && to === total) return bytes;

  const out = await PDFDocument.create();
  const indices = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  const pages = await out.copyPages(src, indices);
  for (const p of pages) out.addPage(p);
  return await out.save();
}

/**
 * Page ranges covering a document exactly once, with no gaps and no overlaps.
 *
 * This is the arithmetic behind "412 of 412 pages read". The coverage ledger's
 * integrity starts here: SUM(to - from + 1) across the returned ranges MUST equal
 * pageCount. A zero/negative count still yields one range so a file that could
 * not be paginated is represented by a chunk row that can FAIL VISIBLY, rather
 * than by no row at all.
 */
export function pageRanges(
  pageCount: number,
  perChunk: number = DEFAULT_PAGES_PER_CHUNK,
): Array<{ page_from: number; page_to: number }> {
  const total = Math.max(1, pageCount | 0);
  const size = Math.max(1, perChunk | 0);
  const ranges: Array<{ page_from: number; page_to: number }> = [];
  for (let start = 1; start <= total; start += size) {
    ranges.push({ page_from: start, page_to: Math.min(start + size - 1, total) });
  }
  return ranges;
}
