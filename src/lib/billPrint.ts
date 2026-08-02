/**
 * billPrint — the ONE itemised hospital bill renderer.
 *
 * Why this exists
 * ---------------
 * Five surfaces each hand-built their own bill HTML, so the same bill printed differently
 * depending on where you printed it from: the Bill Editor showed a flat #/Description/Qty/Rate
 * table, the Patient Print Hub a different flat table, the patient portal no line items at all,
 * and day care had no bill print whatsoever — its only paper was an advance receipt reading
 * "Amount Received ₹51,500" with nothing to say what the ₹51,500 bought.
 *
 * A hospital bill has to be readable by a patient who is being asked to pay it, so this follows
 * the layout Indian hospitals actually issue:
 *   • a PROVISIONAL/FINAL BILL summary — one row per charge category, and
 *   • a DETAILED BREAKUP — every line under its category, with a per-category subtotal.
 * The two sections are generated from the SAME grouping, so the summary can never disagree
 * with the detail beneath it.
 *
 * Money comes from computeBillMoney (lib/billMoney.ts) — the presentation contract the screens
 * already use — so paper and screen cannot drift. Never read bills.patient_payable here: three
 * write paths have populated it with three incompatible meanings.
 */

import { supabase } from "@/integrations/supabase/client";
import { computeBillMoney, type BillMoney } from "@/lib/billMoney";
import { fetchAdvanceLedger } from "@/lib/advanceLedger";
import { fetchHospitalBrand, printDocument, printHeader } from "@/lib/printUtils";
import { findAdmissionBill } from "@/lib/admissionBill";

type Money = number | string | null | undefined;

const num = (v: Money): number => {
  const n = typeof v === "string" ? parseFloat(v) : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Exact rupees in Indian grouping, no symbol — for table cells.
 * Never compacted to L/Cr: a patient checking a bill needs the actual figure.
 */
export function amt(v: Money): string {
  return num(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Same, with the rupee symbol — for the totals block. */
export function rupees(v: Money): string {
  return `₹${amt(v)}`;
}

// ─── Amount in words ──────────────────────────────────────────────────────────
const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen",
  "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

/**
 * PURE. Indian-system words for a whole rupee amount, WITHOUT the "Rupees … Only" wrapper —
 * callers supply that, because the bill and the payslip word it differently.
 * (lib/payslipPrint.ts keeps its own variant deliberately: it returns the full statutory
 * sentence required on a payslip.)
 */
export function amountInWords(n: number): string {
  const whole = Math.floor(Math.abs(num(n)));
  if (whole === 0) return "Zero";
  const convert = (v: number): string => {
    if (v < 20) return ONES[v];
    if (v < 100) return TENS[Math.floor(v / 10)] + (v % 10 ? " " + ONES[v % 10] : "");
    if (v < 1000) return ONES[Math.floor(v / 100)] + " Hundred" + (v % 100 ? " " + convert(v % 100) : "");
    if (v < 100000) return convert(Math.floor(v / 1000)) + " Thousand" + (v % 1000 ? " " + convert(v % 1000) : "");
    if (v < 10000000) return convert(Math.floor(v / 100000)) + " Lakh" + (v % 100000 ? " " + convert(v % 100000) : "");
    return convert(Math.floor(v / 10000000)) + " Crore" + (v % 10000000 ? " " + convert(v % 10000000) : "");
  };
  return convert(whole);
}

// ─── Grouping ─────────────────────────────────────────────────────────────────

export interface BillPrintLineItem {
  item_type?: string | null;
  description?: string | null;
  quantity?: Money;
  unit?: string | null;
  unit_rate?: Money;
  taxable_amount?: Money;
  gst_amount?: Money;
  total_amount?: Money;
  discount_percent?: Money;
  gst_percent?: Money;
  service_date?: string | null;
  created_at?: string | null;
  hsn_code?: string | null;
}

export interface BillCategoryGroup {
  key: string;
  label: string;
  rows: BillPrintLineItem[];
  subtotal: number;
}

/**
 * Category order is FIXED here, not taken from insertion order: two prints of the same bill
 * must be identical, and a bill re-fetched in a different order would otherwise reshuffle.
 * Order follows how Indian hospital bills read — bed and nursing first, then theatre,
 * then diagnostics, then consumables, professional fees last before "other".
 */
const CATEGORY_ORDER: Array<{ key: string; label: string; types: string[] }> = [
  { key: "room",         label: "Room / Bed Charges",       types: ["room_charge"] },
  { key: "nursing",      label: "Nursing Charges",          types: ["nursing"] },
  { key: "procedure",    label: "Procedure & OT Charges",   types: ["procedure", "surgery"] },
  { key: "package",      label: "Packages",                 types: ["package"] },
  { key: "lab",          label: "Laboratory Charges",       types: ["lab"] },
  { key: "radiology",    label: "Radiology & Imaging",      types: ["radiology"] },
  { key: "pharmacy",     label: "Pharmacy & Medicines",     types: ["pharmacy"] },
  { key: "consumable",   label: "Consumables & Supplies",   types: ["consumable"] },
  { key: "blood",        label: "Blood Bank Charges",       types: ["blood"] },
  { key: "oxygen",       label: "Oxygen Charges",           types: ["oxygen"] },
  { key: "consultation", label: "Professional Fees",        types: ["consultation"] },
  { key: "other",        label: "Other Charges",            types: ["other", "service"] },
];

const TYPE_TO_GROUP = new Map<string, { key: string; label: string }>();
for (const g of CATEGORY_ORDER) {
  for (const t of g.types) TYPE_TO_GROUP.set(t, { key: g.key, label: g.label });
}

/**
 * PURE. Group line items into printable categories.
 * An unrecognised item_type falls into "Other Charges" rather than being dropped — a charge
 * missing from the bill is money the patient is asked to pay with no explanation.
 */
export function groupLineItems(items: BillPrintLineItem[]): BillCategoryGroup[] {
  const buckets = new Map<string, BillCategoryGroup>();

  for (const item of items || []) {
    const mapped = TYPE_TO_GROUP.get(String(item.item_type || "").toLowerCase());
    const key = mapped?.key ?? "other";
    const label = mapped?.label ?? "Other Charges";
    if (!buckets.has(key)) buckets.set(key, { key, label, rows: [], subtotal: 0 });
    const bucket = buckets.get(key)!;
    bucket.rows.push(item);
    bucket.subtotal += num(item.total_amount);
  }

  for (const b of buckets.values()) b.subtotal = Math.round((b.subtotal + Number.EPSILON) * 100) / 100;

  return CATEGORY_ORDER
    .map(g => buckets.get(g.key))
    .filter((g): g is BillCategoryGroup => !!g);
}

// ─── Table renderers ──────────────────────────────────────────────────────────

/** PURE. The category summary — what the patient reads first. */
export function renderBillSummaryTable(groups: BillCategoryGroup[]): string {
  if (groups.length === 0) {
    return `<p style="color:#94a3b8;font-size:12px;">No charges have been posted to this bill yet.</p>`;
  }
  const rows = groups.map(g =>
    `<tr><td>${escapeHtml(g.label)}</td><td style="text-align:right" class="amount">${amt(g.subtotal)}</td></tr>`
  ).join("");
  return `<table class="bp-table">
  <thead><tr><th>Particulars</th><th style="text-align:right;width:30%">Amount</th></tr></thead>
  <tbody>${rows}</tbody>
</table>`;
}

function itemDateCell(item: BillPrintLineItem): string {
  const raw = item.service_date || item.created_at;
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return escapeHtml(raw);
  const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" });
  // service_date is a DATE column — midnight is "no time recorded", not "00:00".
  const hasTime = !!item.created_at && !item.service_date;
  const time = hasTime
    ? new Date(item.created_at as string).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })
    : "";
  return time ? `${date}<br/><span style="color:#94a3b8;font-size:10px">${time}</span>` : date;
}

function qtyCell(item: BillPrintLineItem): string {
  const q = num(item.quantity) || 1;
  const unit = (item.unit || "").trim();
  const shown = Number.isInteger(q) ? String(q) : String(q);
  return unit && unit.toLowerCase() !== "nos" ? `${shown} ${escapeHtml(unit)}` : shown;
}

/** PURE. Every line, under its category, with per-category subtotals. */
export function renderBillDetailTable(groups: BillCategoryGroup[]): string {
  if (groups.length === 0) return "";
  const showHsn = groups.some(g => g.rows.some(r => !!r.hsn_code));

  const sections = groups.map(g => {
    const rows = g.rows.map(item => `<tr>
      <td style="white-space:nowrap">${itemDateCell(item)}</td>
      ${showHsn ? `<td class="amount" style="font-size:10px">${escapeHtml(item.hsn_code || "")}</td>` : ""}
      <td>${escapeHtml(item.description || "—")}</td>
      <td style="text-align:right" class="amount">${amt(item.unit_rate)}</td>
      <td style="text-align:center">${qtyCell(item)}</td>
      <td style="text-align:right" class="amount">${amt(item.total_amount)}</td>
    </tr>`).join("");

    const span = showHsn ? 5 : 4;
    return `<tr class="bp-group"><td colspan="${span + 1}">${escapeHtml(g.label)}</td></tr>
${rows}
<tr class="bp-subtotal"><td colspan="${span}" style="text-align:right">Subtotal</td><td style="text-align:right" class="amount">${amt(g.subtotal)}</td></tr>`;
  }).join("");

  return `<table class="bp-table">
  <thead><tr>
    <th style="width:14%">Date</th>
    ${showHsn ? `<th style="width:10%">HSN</th>` : ""}
    <th>Particulars</th>
    <th style="text-align:right;width:14%">Rate</th>
    <th style="text-align:center;width:10%">Units</th>
    <th style="text-align:right;width:16%">Amount</th>
  </tr></thead>
  <tbody>${sections}</tbody>
</table>`;
}

// ─── Full document ────────────────────────────────────────────────────────────

export interface BillPrintPatient {
  name?: string | null;
  uhid?: string | null;
  age?: string | null;
  gender?: string | null;
  phone?: string | null;
  address?: string | null;
}

export interface BillPrintAdmission {
  admissionNumber?: string | null;
  admittedAt?: string | null;
  dischargedAt?: string | null;
  ward?: string | null;
  bed?: string | null;
  doctor?: string | null;
}

export interface BillPrintInput {
  billNumber: string;
  billDate?: string | null;
  billType?: string | null;
  billStatus?: string | null;
  patient: BillPrintPatient;
  admission?: BillPrintAdmission | null;
  payerType?: string | null;
  lineItems: BillPrintLineItem[];
  money: BillMoney;
  /** Extra rows appended into the bill-details grid — e.g. OPD token/department/doctor. */
  extraMeta?: { label: string; value?: string | null }[];
  /** Extra HTML appended after the totals — e.g. the discount authorisation trail. */
  extraSections?: string;
}

/** A bill is PROVISIONAL until it is finalised — saying otherwise mid-stay is a false statement. */
export function billPrintTitle(billStatus?: string | null): string {
  const s = String(billStatus || "").toLowerCase();
  return s === "final" || s === "irn_locked" ? "FINAL BILL" : "PROVISIONAL BILL";
}

function detailRow(label: string, value?: string | null): string {
  if (!value) return "";
  return `<div class="bp-kv"><span class="bp-k">${escapeHtml(label)}</span><span class="bp-v">${escapeHtml(value)}</span></div>`;
}

function totalRow(label: string, value: string, opts?: { strong?: boolean; color?: string }): string {
  return `<div class="bp-total ${opts?.strong ? "bp-total-strong" : ""}" ${opts?.color ? `style="color:${opts.color}"` : ""}>
    <span>${escapeHtml(label)}</span><span class="amount">${value}</span></div>`;
}

const BILL_PRINT_STYLES = `<style>
  .bp-table { width:100%; border-collapse:collapse; margin:4px 0 8px; }
  .bp-table th { background:#f1f5f9; padding:4px 6px; text-align:left; font-size:10px;
                 text-transform:uppercase; color:#475569; border-bottom:1.5px solid #cbd5e1; }
  .bp-table td { padding:3px 6px; border-bottom:1px solid #f1f5f9; font-size:11.5px; vertical-align:top; }
  .bp-group td { background:#f8fafc; font-weight:700; font-size:11px; text-transform:uppercase;
                 letter-spacing:0.3px; padding-top:4px; }
  .bp-subtotal td { font-weight:700; font-size:11px; border-bottom:1.5px solid #cbd5e1; background:#fcfdfe; }
  .bp-section { font-size:12.5px; font-weight:700; letter-spacing:0.5px; text-align:center;
                background:#f1f5f9; padding:3px 0; margin:8px 0 3px; border-radius:3px; }
  .bp-meta { display:flex; flex-wrap:wrap; gap:1px 24px; margin-bottom:6px;
             border:1px solid #e2e8f0; border-radius:4px; padding:5px 8px; }
  .bp-kv { display:flex; gap:8px; min-width:46%; font-size:11px; padding:0.5px 0; }
  .bp-k { color:#64748b; min-width:96px; }
  .bp-v { font-weight:600; }
  .bp-totals { margin-left:auto; width:60%; }
  .bp-total { display:flex; justify-content:space-between; font-size:12px; padding:1.5px 0; }
  .bp-total-strong { font-weight:700; font-size:14px; border-top:1.5px solid #94a3b8;
                     border-bottom:1.5px solid #94a3b8; padding:3px 0; margin:2px 0; }
  .bp-words { margin-top:6px; font-size:11px; font-style:italic; color:#475569;
              border-top:1px dashed #cbd5e1; padding-top:5px; }
</style>`;

/**
 * PURE. The bill body, minus the hospital header — callers prepend printHeader() so the
 * hospital's configured branding (logo, layout, colours, footer) applies automatically.
 */
export function renderBillHtml(input: BillPrintInput): string {
  const groups = groupLineItems(input.lineItems);
  const m = input.money;
  const adm = input.admission;

  const billDate = input.billDate
    ? new Date(input.billDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const fmtStamp = (s?: string | null) =>
    s ? new Date(s).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

  const meta = [
    detailRow("Bill No.", input.billNumber),
    detailRow("Bill Date", billDate),
    detailRow("Patient", input.patient.name),
    detailRow("UHID", input.patient.uhid),
    detailRow("Age / Gender", [input.patient.age, input.patient.gender].filter(Boolean).join(" / ") || null),
    detailRow("Phone", input.patient.phone),
    detailRow("Address", input.patient.address),
    detailRow("Bill Type", input.billType ? String(input.billType).replace(/_/g, " ").toUpperCase() : null),
    detailRow("Payer", input.payerType ? String(input.payerType).replace(/_/g, " ").toUpperCase() : null),
    detailRow("Admission No.", adm?.admissionNumber),
    detailRow("Admitted", fmtStamp(adm?.admittedAt)),
    detailRow("Discharged", fmtStamp(adm?.dischargedAt)),
    detailRow("Ward / Bed", [adm?.ward, adm?.bed].filter(Boolean).join(" · ") || null),
    detailRow("Consulting Doctor", adm?.doctor ? `Dr. ${adm.doctor}` : null),
    // Caller-supplied rows (e.g. OPD token / department / doctor) — kept in the details grid
    // rather than a separate banner so a simple bill stays compact.
    ...(input.extraMeta || []).map((r) => detailRow(r.label, r.value)),
  ].join("");

  // A fully-settled bill needs no Paid/Balance rows — the patient has paid in full. Those
  // lines only carry information while money is still outstanding (partial) or owed back
  // (refund). See computeBillMoney for the settlement fields.
  const fullyPaid = m.balanceDue <= 0 && m.refundDue <= 0 && m.totalCredits > 0;

  const totals = [
    totalRow("Gross Charges", rupees(m.grossCharges)),
    m.discount > 0 ? totalRow("Discount", `- ${rupees(m.discount)}`) : "",
    m.insuranceCovered > 0 ? totalRow("Insurance / TPA Covered", `- ${rupees(m.insuranceCovered)}`) : "",
    totalRow("Total Payable", rupees(m.patientPayable), { strong: true }),
    !fullyPaid && m.netAdvance > 0 ? totalRow("Advance / Deposit", `- ${rupees(m.netAdvance)}`) : "",
    !fullyPaid && m.directPaid > 0 ? totalRow("Paid", `- ${rupees(m.directPaid)}`) : "",
    m.balanceDue > 0
      ? totalRow("Balance Due", rupees(m.balanceDue), { strong: true, color: "#dc2626" })
      : m.refundDue > 0
        ? totalRow("Refund Due to Patient", rupees(m.refundDue), { strong: true, color: "#047857" })
        : fullyPaid
          ? totalRow("Status", "PAID IN FULL", { strong: true, color: "#047857" })
          : "",
  ].join("");

  // The PARTICULARS summary earns its space only with 2+ categories; for a single-category
  // bill it just duplicates the one DETAILED BREAKUP subtotal, so it is dropped.
  const summarySection =
    groups.length === 0
      ? renderBillSummaryTable(groups)
      : groups.length >= 2
        ? `<div class="bp-section">PARTICULARS</div>\n${renderBillSummaryTable(groups)}`
        : "";

  return `${BILL_PRINT_STYLES}
<div class="bp-section">${billPrintTitle(input.billStatus)}</div>
<div class="bp-meta">${meta}</div>

${summarySection}

${groups.length > 0 ? `<div class="bp-section">DETAILED BREAKUP</div>
${renderBillDetailTable(groups)}` : ""}

<div class="bp-totals">${totals}</div>
<div class="bp-words">Total payable: Rupees ${escapeHtml(amountInWords(m.patientPayable))} Only</div>
${input.extraSections || ""}`;
}

// ─── I/O ──────────────────────────────────────────────────────────────────────

/**
 * Fetch everything the renderer needs for one bill.
 *
 * This is what removes the divergence: every print surface calls this rather than assembling
 * its own query, so all of them show the same patient block, the same categories and the same
 * money. `includeAdmission: false` is for callers whose RLS cannot reach `admissions`
 * (the patient portal) — the bill still prints, just without the stay header.
 */
export async function fetchBillForPrint(
  billId: string,
  hospitalId: string | null | undefined,
  opts?: { includeAdmission?: boolean }
): Promise<BillPrintInput | null> {
  const { data: bill } = await (supabase as any)
    .from("bills")
    .select("*, bill_line_items(*), bill_payments(amount, is_advance)")
    .eq("id", billId)
    .maybeSingle();
  if (!bill) return null;

  const lineItems: BillPrintLineItem[] = bill.bill_line_items || [];

  // Direct payments only. bills.paid_amount is inflated by advance sync, and the advance is
  // counted separately below — using it here would credit the deposit twice.
  const directPaid = (bill.bill_payments || [])
    .filter((p: any) => !p.is_advance)
    .reduce((s: number, p: any) => s + num(p.amount), 0);

  const includeAdmission = opts?.includeAdmission !== false;

  const [patientRes, admissionRes, ledger] = await Promise.all([
    (supabase as any)
      .from("patients")
      .select("full_name, uhid, dob, gender, phone, address")
      .eq("id", bill.patient_id)
      .maybeSingle(),
    bill.admission_id && includeAdmission
      ? (supabase as any)
          .from("admissions")
          .select(`
            admission_number, admitted_at, discharged_at,
            beds!admissions_bed_id_fkey(bed_number, bed_category),
            wards!admissions_ward_id_fkey(name),
            users!admissions_admitting_doctor_id_fkey(full_name)
          `)
          .eq("id", bill.admission_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    // Admission-scoped, never patient-scoped: a patient's other stays' advances would
    // otherwise be credited here and invent a refund that is not owed.
    fetchAdvanceLedger(bill.admission_id, hospitalId),
  ]);

  const p = (patientRes as any)?.data || {};
  const a = (admissionRes as any)?.data || null;

  const money = computeBillMoney({
    lineItems,
    discountAmount: bill.discount_amount,
    insuranceAmount: bill.insurance_amount,
    netAdvance: ledger.netAdvance,
    directPaid,
  });

  return {
    billNumber: bill.bill_number,
    billDate: bill.bill_date,
    billType: bill.bill_type,
    billStatus: bill.bill_status,
    payerType: bill.payer_type,
    patient: {
      name: p.full_name || bill.patient_name,
      uhid: p.uhid || bill.uhid,
      age: p.dob ? `${Math.floor((Date.now() - new Date(p.dob).getTime()) / 31557600000)} yrs` : null,
      gender: p.gender ? String(p.gender).charAt(0).toUpperCase() + String(p.gender).slice(1) : null,
      phone: p.phone || null,
      address: p.address || null,
    },
    admission: a
      ? {
          admissionNumber: a.admission_number,
          admittedAt: a.admitted_at,
          dischargedAt: a.discharged_at,
          ward: a.wards?.name || null,
          bed: a.beds?.bed_number || null,
          doctor: a.users?.full_name || null,
        }
      : null,
    lineItems,
    money,
  };
}

/**
 * Fetch + render + open the print window. The one call every surface makes.
 *
 * fetchHospitalBrand() must run before printHeader()/printDocument() — it populates the brand
 * cache those two read for the logo, header layout, font and footer.
 *
 * Returns false when the bill could not be loaded, so the caller can toast rather than
 * silently opening a blank window.
 */
export async function printBillById(
  billId: string,
  hospitalId: string,
  opts?: { extraSections?: string; includeAdmission?: boolean; extraMeta?: { label: string; value?: string | null }[] }
): Promise<boolean> {
  const [brand, input] = await Promise.all([
    fetchHospitalBrand(supabase, hospitalId),
    fetchBillForPrint(billId, hospitalId, { includeAdmission: opts?.includeAdmission }),
  ]);
  if (!input) return false;

  if (opts?.extraSections) input.extraSections = opts.extraSections;
  if (opts?.extraMeta) input.extraMeta = opts.extraMeta;

  const body = `${printHeader(brand.name, brand.address || undefined)}${renderBillHtml(input)}`;
  printDocument(`${billPrintTitle(input.billStatus)} — ${input.billNumber}`, body);
  return true;
}

/**
 * Print the bill for an admission (IPD or day care).
 *
 * Resolves the bill through findAdmissionBill with `paymentStatuses: []` — identity, not
 * "a bill open for charges": a settled day care bill is exactly the one the patient wants
 * printed. Never `.eq("bill_type","ipd")`, which is what made 18 modules miss day care bills.
 *
 * Returns "no-bill" (rather than throwing) when nothing has been billed yet, so the caller
 * can say so plainly.
 */
export async function printAdmissionBill(
  admissionId: string,
  hospitalId: string
): Promise<"ok" | "no-bill" | "failed"> {
  const found = await findAdmissionBill(hospitalId, admissionId, { paymentStatuses: [] });
  if (!found) return "no-bill";
  return (await printBillById(found.id, hospitalId)) ? "ok" : "failed";
}
