import { describe, it, expect } from "vitest";
import { calcGST, calcLineTotal, roundCurrency, formatINR } from "./currency";

describe("roundCurrency", () => {
  it("rounds to 2 decimal places", () => {
    expect(roundCurrency(10.555)).toBe(10.56);
    expect(roundCurrency(10.554)).toBe(10.55);
  });

  it("handles integers without adding decimals", () => {
    expect(roundCurrency(1000)).toBe(1000);
  });

  it("handles 0", () => {
    expect(roundCurrency(0)).toBe(0);
  });
});

describe("calcGST", () => {
  it("0% GST on any amount returns 0", () => {
    expect(calcGST(1000, 0)).toBe(0);
    expect(calcGST(5000, 0)).toBe(0);
  });

  it("5% GST on ₹1000 = ₹50", () => {
    expect(calcGST(1000, 5)).toBe(50);
  });

  it("12% GST on ₹1000 = ₹120", () => {
    expect(calcGST(1000, 12)).toBe(120);
  });

  it("18% GST on ₹1000 = ₹180", () => {
    expect(calcGST(1000, 18)).toBe(180);
  });

  it("28% GST on ₹500 = ₹140", () => {
    expect(calcGST(500, 28)).toBe(140);
  });

  it("avoids floating-point drift on ₹333.33 × 18%", () => {
    // 333.33 * 18 / 100 = 59.9994 → rounds to 60
    expect(calcGST(333.33, 18)).toBe(60);
  });

  it("calculates 18% on ₹10,000 as ₹1,800", () => {
    expect(calcGST(10000, 18)).toBe(1800);
  });

  it("handles fractional input amounts with correct rounding", () => {
    // 99.99 * 18% = 17.9982 → rounds to 18
    expect(calcGST(99.99, 18)).toBe(18);
  });
});

describe("calcLineTotal", () => {
  it("returns gst + total for 18% on ₹1000", () => {
    const { gst, total } = calcLineTotal(1000, 18);
    expect(gst).toBe(180);
    expect(total).toBe(1180);
  });

  it("returns { gst: 0, total: base } when rate is 0%", () => {
    const { gst, total } = calcLineTotal(500, 0);
    expect(gst).toBe(0);
    expect(total).toBe(500);
  });

  it("total = taxable + gst (no hidden rounding gap)", () => {
    const taxable = 750;
    const { gst, total } = calcLineTotal(taxable, 12);
    expect(total).toBe(roundCurrency(taxable + gst));
  });
});

describe("formatINR", () => {
  it("formats 1000 as ₹1,000", () => {
    expect(formatINR(1000)).toBe("₹1,000");
  });

  it("formats 100000 in Indian lakh notation ₹1,00,000", () => {
    expect(formatINR(100000)).toBe("₹1,00,000");
  });

  it("formats 0 as ₹0", () => {
    expect(formatINR(0)).toBe("₹0");
  });

  it("formats decimal amount with up to 2 places", () => {
    expect(formatINR(1500.50)).toBe("₹1,500.5");
  });
});
