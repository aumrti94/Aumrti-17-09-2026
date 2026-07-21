import { describe, it, expect } from "vitest";
import {
  amountInWords,
  amt,
  billPrintTitle,
  groupLineItems,
  renderBillDetailTable,
  renderBillHtml,
  renderBillSummaryTable,
} from "./billPrint";
import { computeBillMoney } from "./billMoney";

const item = (
  item_type: string,
  description: string,
  unit_rate: number,
  quantity = 1,
  extra: Record<string, unknown> = {}
) => ({
  item_type,
  description,
  unit_rate,
  quantity,
  taxable_amount: unit_rate * quantity,
  gst_amount: 0,
  total_amount: unit_rate * quantity,
  ...extra,
});

describe("groupLineItems", () => {
  it("groups by item_type and subtotals each category", () => {
    const groups = groupLineItems([
      item("room_charge", "Bed - GENERAL", 200, 2),
      item("nursing", "Nursing Fees", 200),
      item("nursing", "Nebulization", 100),
    ]);
    expect(groups.map(g => g.label)).toEqual(["Room / Bed Charges", "Nursing Charges"]);
    expect(groups[0].subtotal).toBe(400);
    expect(groups[1].subtotal).toBe(300);
  });

  it("orders categories by the fixed print order, not insertion order", () => {
    // Guards the regression this file exists to prevent: the same bill re-fetched in a
    // different row order must print identically.
    const forward = groupLineItems([
      item("room_charge", "Bed", 100),
      item("consultation", "Dr. fee", 500),
    ]);
    const reversed = groupLineItems([
      item("consultation", "Dr. fee", 500),
      item("room_charge", "Bed", 100),
    ]);
    expect(forward.map(g => g.key)).toEqual(reversed.map(g => g.key));
    expect(forward.map(g => g.key)).toEqual(["room", "consultation"]);
  });

  it("folds surgery into the procedure group", () => {
    const groups = groupLineItems([
      item("procedure", "Day Care: Cataract", 45000),
      item("surgery", "Major OT Charge", 1000),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Procedure & OT Charges");
    expect(groups[0].subtotal).toBe(46000);
  });

  it("never drops an unrecognised item_type — it lands in Other Charges", () => {
    const groups = groupLineItems([
      item("teleportation", "Mystery charge", 999),
      item(null as unknown as string, "No type", 1),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("Other Charges");
    expect(groups[0].subtotal).toBe(1000);
  });

  it("returns nothing for an empty bill", () => {
    expect(groupLineItems([])).toEqual([]);
  });

  it("category subtotals add up to the bill total", () => {
    const items = [
      item("room_charge", "Bed", 250, 1),
      item("nursing", "Nursing", 200, 7),
      item("surgery", "OT", 1000),
      item("consultation", "Dr. Akshara Raje", 500),
    ];
    const groups = groupLineItems(items);
    const summed = groups.reduce((s, g) => s + g.subtotal, 0);
    const billTotal = items.reduce((s, i) => s + i.total_amount, 0);
    expect(summed).toBe(billTotal);
  });
});

describe("renderBillSummaryTable / renderBillDetailTable", () => {
  const groups = groupLineItems([
    item("procedure", "Day Care: Cataract", 45000),
    item("procedure", "Day Care: Endoscopy", 6500),
  ]);

  it("prints one summary row per category with its subtotal", () => {
    const html = renderBillSummaryTable(groups);
    expect(html).toContain("Procedure &amp; OT Charges");
    expect(html).toContain("51,500.00");
  });

  it("prints every line with rate, units and amount, plus a subtotal", () => {
    const html = renderBillDetailTable(groups);
    expect(html).toContain("Day Care: Cataract");
    expect(html).toContain("Day Care: Endoscopy");
    expect(html).toContain("45,000.00");
    expect(html).toContain("6,500.00");
    expect(html).toContain("Subtotal");
  });

  it("says so rather than printing an empty table when nothing is billed", () => {
    expect(renderBillSummaryTable([])).toContain("No charges");
    expect(renderBillDetailTable([])).toBe("");
  });

  it("adds the HSN column only when a line actually carries one", () => {
    expect(renderBillDetailTable(groups)).not.toContain(">HSN<");
    const withHsn = groupLineItems([item("pharmacy", "Paracetamol", 12, 10, { hsn_code: "3004" })]);
    expect(renderBillDetailTable(withHsn)).toContain(">HSN<");
    expect(renderBillDetailTable(withHsn)).toContain("3004");
  });

  it("escapes description text rather than injecting it as markup", () => {
    const html = renderBillDetailTable(groupLineItems([item("lab", "CBC <script>x</script>", 300)]));
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("amountInWords", () => {
  it("handles zero", () => {
    expect(amountInWords(0)).toBe("Zero");
  });

  it("uses the Indian system (Lakh / Crore)", () => {
    expect(amountInWords(51500)).toBe("Fifty One Thousand Five Hundred");
    expect(amountInWords(150000)).toBe("One Lakh Fifty Thousand");
    expect(amountInWords(23700)).toBe("Twenty Three Thousand Seven Hundred");
    expect(amountInWords(10000000)).toBe("One Crore");
  });

  it("ignores paise — the bill states the rupee figure", () => {
    expect(amountInWords(3650.75)).toBe("Three Thousand Six Hundred Fifty");
  });
});

describe("amt", () => {
  it("formats exact rupees in Indian grouping, never compacted", () => {
    expect(amt(150000)).toBe("1,50,000.00");
    expect(amt(23700)).toBe("23,700.00");
    expect(amt(null)).toBe("0.00");
  });
});

describe("billPrintTitle", () => {
  it("is PROVISIONAL until the bill is finalised", () => {
    expect(billPrintTitle("draft")).toBe("PROVISIONAL BILL");
    expect(billPrintTitle("pending_approval")).toBe("PROVISIONAL BILL");
    expect(billPrintTitle(null)).toBe("PROVISIONAL BILL");
    expect(billPrintTitle("final")).toBe("FINAL BILL");
    expect(billPrintTitle("irn_locked")).toBe("FINAL BILL");
  });
});

describe("renderBillHtml", () => {
  const lineItems = [
    item("procedure", "Day Care: Cataract", 45000),
    item("procedure", "Day Care: Endoscopy", 6500),
  ];

  const build = (overrides: Partial<Parameters<typeof renderBillHtml>[0]> = {}) =>
    renderBillHtml({
      billNumber: "DC-20260721-0005",
      billDate: "2026-07-21",
      billType: "day_care",
      billStatus: "draft",
      patient: { name: "Sravani Beg", uhid: "UHID000055" },
      lineItems,
      money: computeBillMoney({ lineItems, netAdvance: 51500 }),
      ...overrides,
    });

  it("prints both sections, the patient block and the amount in words", () => {
    const html = build();
    expect(html).toContain("PROVISIONAL BILL");
    expect(html).toContain("DETAILED BREAKUP");
    expect(html).toContain("Sravani Beg");
    expect(html).toContain("UHID000055");
    expect(html).toContain("Rupees Fifty One Thousand Five Hundred Only");
  });

  it("credits the advance and settles the balance to zero", () => {
    const html = build();
    expect(html).toContain("Advance / Deposit");
    expect(html).toContain("Balance Due");
    expect(html).not.toContain("Refund Due to Patient");
  });

  it("shows a refund rather than a negative balance when over-collected", () => {
    const html = build({ money: computeBillMoney({ lineItems, netAdvance: 60000 }) });
    expect(html).toContain("Refund Due to Patient");
    expect(html).toContain("8,500.00");
  });

  it("still renders a bill with no line items", () => {
    const html = build({ lineItems: [], money: computeBillMoney({ lineItems: [] }) });
    expect(html).toContain("No charges");
    expect(html).not.toContain("DETAILED BREAKUP");
  });

  it("includes the admission header when the stay is known", () => {
    const html = build({
      admission: {
        admissionNumber: "DC-20260721-0005",
        admittedAt: "2026-07-21T06:30:00Z",
        ward: "Day Care",
        bed: "DC-01",
        doctor: "Akshara Raje",
      },
    });
    expect(html).toContain("Admission No.");
    expect(html).toContain("Dr. Akshara Raje");
    expect(html).toContain("Day Care · DC-01");
  });
});
