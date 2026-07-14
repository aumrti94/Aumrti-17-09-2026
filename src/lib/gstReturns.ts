// ─────────────────────────────────────────────────────────────────────────────
// GST outward-supply register + GSTR-1 / GSTR-3B summaries for the sales side.
//
// Hospital bills store a single `gst_amount` (no CGST/SGST/IGST split on sales).
// Patient state of supply is not captured, so supplies default to INTRA-state
// (CGST + SGST) — the safe and overwhelmingly-common case for a hospital's local
// patients. IGST is only used when a registered buyer's state is known and
// differs from the hospital's. Mirrors splitGst() on the purchase side.
//
// These are the values a hospital's CA files GSTR-1 / GSTR-3B with; exempt/nil
// bills (gst_amount = 0) are excluded by the caller.
// ─────────────────────────────────────────────────────────────────────────────

export interface GstBillInput {
  bill_number: string;
  bill_date: string;               // yyyy-mm-dd
  party_name?: string | null;
  party_gstin?: string | null;     // usually null → B2C
  party_state_code?: string | null;
  taxable_amount: number;
  gst_amount: number;
  total_amount: number;
  hsn?: string | null;
}

export interface GstRegisterRow {
  bill_number: string;
  date: string;
  party: string;
  gstin: string;                   // "URP" when unregistered
  hsn: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  supply: "B2B" | "B2C";
  interState: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function stateCodeFromGstin(gstin?: string | null): string | null {
  if (!gstin || gstin.length < 2) return null;
  const code = gstin.slice(0, 2);
  return /^\d{2}$/.test(code) ? code : null;
}

function splitGstAmount(gst: number, interState: boolean) {
  if (interState) return { cgst: 0, sgst: 0, igst: round2(gst) };
  const cgst = round2(gst / 2);
  return { cgst, sgst: round2(gst - cgst), igst: 0 };
}

export function buildOutwardRegister(
  bills: GstBillInput[],
  opts: { sellerStateCode?: string | null } = {},
): GstRegisterRow[] {
  const seller = opts.sellerStateCode && /^\d{2}$/.test(opts.sellerStateCode) ? opts.sellerStateCode : null;
  return bills
    .filter((b) => Number(b.gst_amount || 0) > 0)
    .map((b) => {
      const gstin = (b.party_gstin && b.party_gstin.trim()) || "URP";
      const supply: "B2B" | "B2C" = gstin !== "URP" ? "B2B" : "B2C";
      const buyer = (b.party_state_code && /^\d{2}$/.test(b.party_state_code) ? b.party_state_code : null)
        || stateCodeFromGstin(b.party_gstin);
      // Only inter-state when both states are known and differ.
      const interState = !!seller && !!buyer && seller !== buyer;
      const gst = Number(b.gst_amount || 0);
      const { cgst, sgst, igst } = splitGstAmount(gst, interState);
      return {
        bill_number: b.bill_number,
        date: b.bill_date,
        party: b.party_name || "Patient",
        gstin,
        hsn: b.hsn || "9993",
        taxable: round2(Number(b.taxable_amount || 0)),
        cgst,
        sgst,
        igst,
        total: round2(Number(b.total_amount || 0)),
        supply,
        interState,
      };
    });
}

export interface GstSubtotal {
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  count: number;
}

export interface HsnSummaryRow {
  hsn: string;
  taxable: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
}

export interface Gstr1Summary {
  invoiceCount: number;
  b2b: GstSubtotal;
  b2c: GstSubtotal;
  hsn: HsnSummaryRow[];
  totalTaxable: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalTax: number;
}

const emptySub = (): GstSubtotal => ({ taxable: 0, cgst: 0, sgst: 0, igst: 0, count: 0 });

export function summariseGstr1(rows: GstRegisterRow[]): Gstr1Summary {
  const b2b = emptySub();
  const b2c = emptySub();
  const hsnMap: Record<string, HsnSummaryRow> = {};
  for (const r of rows) {
    const bucket = r.supply === "B2B" ? b2b : b2c;
    bucket.taxable += r.taxable; bucket.cgst += r.cgst; bucket.sgst += r.sgst; bucket.igst += r.igst; bucket.count += 1;
    if (!hsnMap[r.hsn]) hsnMap[r.hsn] = { hsn: r.hsn, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 };
    const h = hsnMap[r.hsn];
    h.taxable += r.taxable; h.cgst += r.cgst; h.sgst += r.sgst; h.igst += r.igst; h.total += r.total;
  }
  const fix = (s: GstSubtotal) => { s.taxable = round2(s.taxable); s.cgst = round2(s.cgst); s.sgst = round2(s.sgst); s.igst = round2(s.igst); };
  fix(b2b); fix(b2c);
  const hsn = Object.values(hsnMap).map((h) => ({
    hsn: h.hsn, taxable: round2(h.taxable), cgst: round2(h.cgst), sgst: round2(h.sgst), igst: round2(h.igst), total: round2(h.total),
  }));
  const totalTaxable = round2(b2b.taxable + b2c.taxable);
  const totalCgst = round2(b2b.cgst + b2c.cgst);
  const totalSgst = round2(b2b.sgst + b2c.sgst);
  const totalIgst = round2(b2b.igst + b2c.igst);
  return {
    invoiceCount: rows.length,
    b2b, b2c, hsn,
    totalTaxable, totalCgst, totalSgst, totalIgst,
    totalTax: round2(totalCgst + totalSgst + totalIgst),
  };
}

export interface Gstr3bOutward {
  // Table 3.1(a) — Outward taxable supplies (other than zero-rated, nil, exempt)
  taxableValue: number;
  igst: number;
  cgst: number;
  sgst: number;
  cess: number;
}

export function summariseGstr3b(rows: GstRegisterRow[]): Gstr3bOutward {
  const s = summariseGstr1(rows);
  return {
    taxableValue: s.totalTaxable,
    igst: s.totalIgst,
    cgst: s.totalCgst,
    sgst: s.totalSgst,
    cess: 0,
  };
}
