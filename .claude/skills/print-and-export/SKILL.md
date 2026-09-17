---
name: print-and-export
description: Use when building anything a hospital prints, downloads, or exports — patient bills and invoices, receipts, prescriptions, discharge summaries, lab and radiology reports, payslips, drug charts, nursing notes, Tally/Excel exports, or stored-file downloads. Covers the HTML-string print pipeline, statutory content requirements, and why the Zero Scroll law does not apply on paper.
---

# Printing and export

Printed output is where the software becomes a legal and clinical document. A bill is a tax
invoice, a discharge summary follows the patient to the next hospital, and a payslip is a statutory
record. None of them can be "close enough".

## The print pipeline

Printing here builds an **HTML string** and hands it to the browser — not React, not a PDF library
in the client. Renderers return strings (`renderBillSummaryTable`, `renderReceiptHtml`) and a
`print*Doc` function opens and prints them.

Two consequences:

```typescript
import { escapeHtml, amt, rupees, amountInWords, groupLineItems } from "@/lib/billPrint";
```

- **Escape every interpolated value with `escapeHtml`.** A patient name containing `&` or `<`
  otherwise corrupts the document — and any user-supplied string reaching an HTML template
  unescaped is an injection surface.
- **The Zero Scroll law does not apply on paper.** Page shells are `h-full overflow-hidden` for
  screens; a printed document paginates. Don't carry screen containment into a print template, and
  don't try to fit a bill on one screen-height.

Server-side PDFs are `_shared/invoice-pdf.ts` with `pdf-split.ts` for multi-page work. Use the
server path when the artefact must be identical for everyone (a tax invoice), the client path when
it is a convenience reprint.

## Money on paper

```typescript
amt(1234.5)            // "1,234.50"  — table cells, no symbol
rupees(1234.5)         // "₹1,234.50" — totals block
amountInWords(1234)    // Indian-system words, no wrapper
```

`amt` always shows **exactly two decimals** and Indian grouping. Never compact to L/Cr on a
document — a patient checking a bill needs the actual figure, which is why `formatINRCompact` is
chart-axis-only.

`amountInWords` is pure and returns the words **without** a "Rupees … Only" wrapper, because the
bill and the payslip word it differently — supply your own. `payslipPrint.ts` deliberately keeps its
own variant returning the full statutory sentence; don't merge them.

Every printed figure must match the figure on screen. If the bill screen shows ₹12,340 and the
print shows ₹12,345, the screen and the printer are reading different sources — fix the source, not
the template. Both should derive from `computeBillMoney` / `computeBillTotals`; see
[billing-and-gst](../billing-and-gst/SKILL.md).

## What a document must carry

**Tax invoice / bill** — hospital name, address and **GSTIN**; invoice number and date; patient
name and UHID; HSN/SAC per line; taxable value, CGST/SGST/IGST shown **separately**, and the total;
amount in words; payment status. `groupLineItems` groups by category so a long bill reads as
sections rather than one undifferentiated list. E-invoice IRN and QR where applicable
(`gst-irn-generate`).

**Receipt** — receipt number, date, amount, payment mode, what it settles, and the resulting
balance. A receipt that doesn't state the remaining balance generates a phone call.

**Prescription** — prescriber name and **registration number**, patient identifiers, drug with
strength/dose/route/frequency/duration, date, and signature. Schedule H/H1/X drugs carry their
statutory markings; NDPS items have additional requirements.

**Discharge summary** — admission and discharge dates, diagnosis, procedures, medications on
discharge, follow-up instructions, and the treating consultant. It travels with the patient.

**Lab / radiology report** — patient identifiers, sample and report timestamps, reference ranges,
abnormal values flagged, and the verifying pathologist or radiologist. Never print an unverified
result without marking it provisional.

**Payslip** — statutory: PF, ESI, professional tax, TDS, with the full amount-in-words sentence.

## Branding and hospital identity

```typescript
import { resolveHandwriting, hw, type BrandConfig } from "@/lib/printUtils";
```

Documents carry the **hospital's** identity — its logo, name, address and GSTIN — not Aumrti's.
`@/lib/brand.ts` holds Aumrti's own product identity (`APP_DOMAIN`, `SUPPORT_EMAIL`) and belongs on
platform invoices, never on a patient's bill.

`printUtils` also carries the handwriting-space configuration: `HANDWRITING_FONTS`,
`DEFAULT_HANDWRITING`, `resolveHandwriting`, and `hw()`. Sections like ward rounds, nursing notes,
medications, and discharge summaries can be printed with deliberate blank space for a clinician to
write on — an Indian ward reality, not a styling quirk. Respect the configured section settings
rather than printing dense text into space meant to be written in.

## Stored files

```typescript
import { BUCKETS, resolveStorageUrl, openStoredFile, storagePathFromPublicUrl } from "@/lib/storageUrls";
```

Use `BUCKETS` constants, never a bucket-name string. `resolveStorageUrl` handles signed URLs for
private buckets; `openStoredFile` is the open-with-fallback path.

Patient documents are private. A public URL to a scanned report is a PHI disclosure that outlives
the session — signed, expiring URLs only.

## Data exports

`exceljs` backs spreadsheet exports; Tally integration is `tallyXmlGenerator.ts` and
`email-tally-xml`. Bulk clinical exports run as Edge Functions (`export-lab-reports`,
`export-nursing-notes`, `export-drug-chart`, `fhir-export`).

Every bulk PHI export is an audited event: who exported, what range, why. A patient's own data
export is a DPDP portability right and must be honoured — but it still gets audited.

## Locale

`en-IN` throughout: `DD/MM/YYYY` dates via `@/lib/dateUtils`, Indian digit grouping, Indian English
spelling (Anaesthesia, Gynaecology). A4 is the paper size; thermal receipt widths are the exception.

## Before you call it done

Print it. Check page breaks don't split a table row from its header or orphan a totals block, that
nothing is clipped at the margin, and that it is legible in greyscale — most ward printers are not
colour, so a status conveyed only by colour disappears.

```bash
npm run lint
npm run check:db-contract
```

`amountInWords`, `amt`, `groupLineItems`, and `escapeHtml` are pure — test them, especially
amount-in-words at lakh/crore boundaries and zero.

Template structure, page-break control, and thermal printing:
[references/patterns.md](references/patterns.md).
