# Print patterns — detail

## The three-step pipeline

```typescript
import { fetchHospitalBrand, printHeader, printDocument } from "@/lib/printUtils";

export async function printSomethingDoc(hospitalId: string, input: SomethingInput) {
  const brand = await fetchHospitalBrand(supabase, hospitalId);          // 1. load + cache brand
  const body = `${printHeader(brand.name, brand.address || undefined)}${renderSomethingHtml(input)}`;
  printDocument(`Something — ${input.number}`, body, { width: 800, height: 600 });
}
```

1. **`fetchHospitalBrand`** loads the hospital's logo, name, colours, font and tagline, and
   populates the module-level brand cache.
2. **`printHeader`** builds the letterhead from that cache (`headerLayout` chooses the arrangement).
3. **`printDocument`** opens a window, wraps your body in a full HTML document with the brand's
   font, colours, footer and handwriting CSS, and prints.

Call `fetchHospitalBrand` **before** `printHeader` and `printDocument`. Both read the cache
populated by that call — skip it and the document prints with default colours and no logo, which
looks like a bug to the hospital.

Renderers return **strings**, so keep them pure and testable. Composition is string concatenation;
there is no React in this path.

## Popups

`printDocument` uses `window.open` and alerts "Please allow popups to print documents" when it is
blocked. Two implications:

- The call must be in the **direct** call stack of a user gesture. An `await` before it can lose the
  gesture in some browsers — do the data fetching first, then print, rather than printing inside a
  long promise chain kicked off much earlier.
- Never trigger printing automatically on page load or on a timer; it will be blocked and the user
  gets an alert they didn't ask for.

## Page breaks

Paper paginates; screens don't. The CSS that matters:

```css
@media print {
  .page-break   { page-break-after: always; }
  .no-break     { page-break-inside: avoid; }   /* totals block, signature block */
  thead         { display: table-header-group; } /* repeat headers across pages */
  tfoot         { display: table-footer-group; }
  .no-print     { display: none; }
}
```

`display: table-header-group` on `thead` is what stops a multi-page bill's second page starting
with unlabelled numbers. Wrap the totals and signature blocks in `.no-break` — a total orphaned onto
its own page is the single most common print complaint.

Test with a long document. A bill with 4 line items always looks fine; one with 60 is where the
layout fails.

## Escaping

```typescript
escapeHtml(patient.name)
```

Every interpolated value, every time — names, addresses, notes, drug names, remarks. `&` in a
hospital name (`Smith & Sons Nursing Home`) corrupts the document, and a free-text clinical note is
attacker-influenced content reaching an HTML template.

`printDocument` escapes the `title` itself, but nothing in your `bodyHtml`. That is yours.

## Amount in words

`amountInWords` uses the **Indian system** — lakh and crore, not million and billion. It takes a
whole rupee amount and returns words with no wrapper:

```typescript
`Rupees ${amountInWords(Math.round(total))} Only`
```

Worth testing at the boundaries the Indian system makes awkward: 0, 100, 1,00,000 (one lakh),
1,00,00,000 (one crore), and the teens (13 → "Thirteen", not "Ten Three"). `payslipPrint.ts` keeps
its own variant that returns the full statutory sentence — leave it separate.

## Handwriting sections

```typescript
import { resolveHandwriting, hw, HANDWRITING_SECTION_LABELS } from "@/lib/printUtils";
```

Sections — `wardRounds`, `nursingNotes`, `medications`, `dischargeSummary` — can print in a script
face with configurable size, colour and slant, or leave deliberate blank space to be written in by
hand. This reflects how Indian wards actually work; a doctor signs and annotates on paper.

`resolveHandwriting(brand)` gives the effective config, `hw()` wraps content in the `.hw` class, and
`printDocument` only loads the script font when handwriting is enabled. Respect the per-section
setting rather than printing dense text where space was requested.

## Thermal receipts

`printReceiptDoc` defaults to `480×680` rather than the `800×600` used for A4 documents. Thermal
rolls are 58mm or 80mm wide: single column, no wide tables, larger type, minimal graphics. A
receipt laid out for A4 prints as an unreadable sliver.

## Greyscale

Most ward and counter printers are monochrome. Any status conveyed only by colour disappears — pair
colour with a label, a symbol, or a border. This is the print counterpart of the `StatusBadge` rule
in [react-component](../../react-component/SKILL.md).

## Stored files

```typescript
import { BUCKETS, resolveStorageUrl, openStoredFile } from "@/lib/storageUrls";
```

`BUCKETS` constants, never a literal. Patient documents live in private buckets and need signed,
expiring URLs — `resolveStorageUrl` handles that. A public URL to a scanned discharge summary is a
PHI disclosure that survives logout, indexing, and sharing.

`storagePathFromPublicUrl` recovers a path from a legacy public URL; `openStoredFile` opens with a
fallback.

## Exports

`exceljs` for spreadsheets; `tallyXmlGenerator.ts` + `email-tally-xml` for accounting. Bulk clinical
exports are Edge Functions (`export-lab-reports`, `export-nursing-notes`, `export-drug-chart`,
`fhir-export`).

Every bulk PHI export gets an audit row: who, what range, what purpose. Stream or paginate large
exports rather than materialising everything — an Edge Function has a memory ceiling, and a
year-wide lab export will meet it.

Column headers on an export are read by people and by Tally's importer. Changing one silently breaks
a hospital's downstream reconciliation, so treat header names as an interface.

## Checklist

- [ ] `fetchHospitalBrand` called before `printHeader` / `printDocument`
- [ ] Every interpolated value through `escapeHtml`
- [ ] Print triggered by a direct user gesture; never automatic
- [ ] `amt` / `rupees` for money — two decimals, `en-IN`, never compacted
- [ ] Printed figures derive from the same source as the screen
- [ ] Statutory content present (GSTIN, HSN/SAC, tax split, amount in words, registration numbers)
- [ ] Hospital branding, not Aumrti branding, on patient-facing documents
- [ ] Page breaks: repeating table headers, `.no-break` totals — verified on a long document
- [ ] Legible in greyscale
- [ ] Private buckets, signed URLs, bulk PHI exports audited
