/**
 * Phase 1 — revenue tier, the rounding contract (PHASED_TEST_PLAN.md §8, Phase 1).
 *
 * `roundCurrency` is the bottom of the money stack: billTotals, gst and every line-item
 * calculation route through it. Its rounding behaviour is the rounding behaviour of the whole
 * product, so it is asserted here once rather than re-derived per caller.
 */
import { describe, it, expect } from "vitest";
import {
  roundCurrency,
  calcGST,
  calcLineTotal,
  formatINR,
  formatINRExact,
  formatINRPrecise,
  formatINRCompact,
  formatCurrency,
} from "@/lib/currency";

describe("roundCurrency", () => {
  it("rounds to two decimal places", () => {
    expect(roundCurrency(1234.5678)).toBe(1234.57);
    expect(roundCurrency(1234.5612)).toBe(1234.56);
    expect(roundCurrency(100)).toBe(100);
  });

  it("rounds a half-paisa UP, away from zero — it is NOT banker's rounding", () => {
    // The file's own header says "banker's rounding". It is not: the implementation is
    // Math.round(x * 100) / 100, which is half-up. Banker's rounding would give 0.12 for
    // 0.125 and 0.14 for 0.135; half-up gives 0.13 and 0.14. Pinned because auditors
    // reconcile against the stated convention, and the comment is the thing that is wrong.
    expect(roundCurrency(0.125)).toBe(0.13);
    expect(roundCurrency(0.135)).toBe(0.14);
    expect(roundCurrency(0.155)).toBe(0.16);
  });

  it("rounds negative halves toward zero, as Math.round does", () => {
    // Math.round(-12.5) is -12, not -13. Relevant to refunds and credit notes.
    expect(roundCurrency(-0.125)).toBe(-0.12);
    expect(roundCurrency(-1.005)).toBe(-1);
  });

  it("inherits binary floating-point representation, so half-up is not reliable at the half", () => {
    // Multiplying by 100 first means the "half" is whatever IEEE-754 made of the decimal.
    // 0.145 × 100 is 14.499999999999998 and rounds DOWN to 0.14, while 0.135 × 100 is
    // exactly 13.5 and rounds up. 1.005 → 1.00 and 8.575 → 8.57 for the same reason.
    //
    // Asserted deliberately rather than avoided: this is the source of the classic one-paisa
    // invoice discrepancy, and any future move to integer paise must be a conscious decision
    // with these cases in front of whoever makes it, not a surprise found in a GST return.
    expect(roundCurrency(0.145)).toBe(0.14);
    expect(roundCurrency(1.005)).toBe(1);
    expect(roundCurrency(1.015)).toBe(1.01);
    expect(roundCurrency(8.575)).toBe(8.57);
  });

  it("leaves a whole rupee untouched", () => {
    expect(roundCurrency(0)).toBe(0);
    expect(roundCurrency(4720)).toBe(4720);
  });
});

describe("calcGST", () => {
  it.each([
    [1000, 0, 0],
    [1000, 5, 50],
    [1000, 12, 120],
    [1000, 18, 180],
  ])("₹%i at %i%% → ₹%i", (amount, percent, gst) => {
    expect(calcGST(amount, percent)).toBe(gst);
  });

  it("rounds the tax to two decimals", () => {
    expect(calcGST(999.99, 18)).toBe(180);
    expect(calcGST(333.33, 12)).toBe(40);
    expect(calcGST(101, 5)).toBe(5.05);
  });

  it("returns 0 on an exempt line rather than a token amount", () => {
    // Healthcare services are mostly 0%. A nonzero result here puts tax on an exempt supply.
    expect(calcGST(50000, 0)).toBe(0);
  });
});

describe("calcLineTotal", () => {
  it("returns the tax and the tax-inclusive total together", () => {
    expect(calcLineTotal(1000, 12)).toEqual({ gst: 120, total: 1120 });
    expect(calcLineTotal(4000, 18)).toEqual({ gst: 720, total: 4720 });
  });

  it("keeps total === taxable + gst after each is rounded", () => {
    // The invariant a line item must satisfy, or the printed invoice does not add up.
    for (const taxable of [1, 33.33, 101, 999.99, 12345.67]) {
      for (const percent of [0, 5, 12, 18]) {
        const { gst, total } = calcLineTotal(taxable, percent);
        expect(total, `${taxable} @ ${percent}%`).toBe(roundCurrency(taxable + gst));
      }
    }
  });

  it("leaves an exempt line's total equal to its taxable value", () => {
    expect(calcLineTotal(4720, 0)).toEqual({ gst: 0, total: 4720 });
  });
});

describe("formatINRExact — the figure users reconcile against", () => {
  it("groups in the Indian system — lakh, not thousand", () => {
    expect(formatINRExact(150000)).toBe("₹1,50,000");
    expect(formatINRExact(10000000)).toBe("₹1,00,00,000");
    expect(formatINRExact(1000)).toBe("₹1,000");
  });

  it("distinguishes ₹1,49,999 from ₹1,50,001", () => {
    // The exact regression the function was written for: a hand-rolled (n/100000).toFixed(1)
    // rendered both as "₹1.5L". Amounts people reconcile against cannot be rounded away.
    expect(formatINRExact(149999)).toBe("₹1,49,999");
    expect(formatINRExact(150001)).toBe("₹1,50,001");
    expect(formatINRExact(149999)).not.toBe(formatINRExact(150001));
  });

  it("shows ₹23,700 as itself, not as ₹23.7K", () => {
    expect(formatINRExact(23700)).toBe("₹23,700");
  });

  it("rounds to whole rupees", () => {
    expect(formatINRExact(1234.49)).toBe("₹1,234");
    expect(formatINRExact(1234.5)).toBe("₹1,235");
  });

  it("renders zero", () => {
    expect(formatINRExact(0)).toBe("₹0");
  });
});

describe("formatINR / formatCurrency", () => {
  it("keeps up to two decimals and groups in the Indian system", () => {
    expect(formatINR(150000)).toBe("₹1,50,000");
    expect(formatINR(1234.5)).toBe("₹1,234.5");
    expect(formatINR(1234.56)).toBe("₹1,234.56");
  });

  it("is what formatCurrency aliases", () => {
    // CLAUDE.md requires money to render via formatCurrency, never a raw number. The alias
    // must not drift away from the function it points at.
    expect(formatCurrency).toBe(formatINR);
    expect(formatCurrency(150000)).toBe("₹1,50,000");
  });
});

describe("formatINRPrecise — unit costs that may be under ₹1", () => {
  it("keeps sub-rupee amounts visible instead of rounding them to ₹0", () => {
    // An AI encounter costing ₹0.34 rendering as "₹0" reads as free — and that is the number
    // an admin sets pricing from.
    expect(formatINRPrecise(0.34)).toBe("₹0.34");
    expect(formatINRPrecise(0.5)).toBe("₹0.50");
  });

  it("uses four decimals below one paisa", () => {
    expect(formatINRPrecise(0.0034)).toBe("₹0.0034");
    expect(formatINRPrecise(0.009)).toBe("₹0.0090");
  });

  it("switches to the whole-rupee form at exactly ₹1", () => {
    // So a page never mixes two grouping styles for the same kind of figure.
    expect(formatINRPrecise(1)).toBe("₹1");
    expect(formatINRPrecise(1500)).toBe("₹1,500");
  });

  it("renders exact zero as ₹0, not ₹0.0000", () => {
    expect(formatINRPrecise(0)).toBe("₹0");
  });

  it("keeps the sign on a negative unit cost", () => {
    expect(formatINRPrecise(-0.5)).toBe("-₹0.50");
    expect(formatINRPrecise(-0.001)).toBe("-₹0.0010");
  });
});

describe("formatINRCompact — chart axis ticks only", () => {
  it.each([
    [500, "₹500"],
    [999, "₹999"],
    [1000, "₹1.0K"],
    [23700, "₹23.7K"],
    [100000, "₹1.0L"],
    [150000, "₹1.5L"],
    [10000000, "₹1.0Cr"],
    [25000000, "₹2.5Cr"],
  ])("₹%i → %s", (amount, expected) => {
    expect(formatINRCompact(amount)).toBe(expected);
  });

  it("keeps the sign on negatives", () => {
    expect(formatINRCompact(-150000)).toBe("-₹1.5L");
    expect(formatINRCompact(-500)).toBe("-₹500");
  });

  it("loses precision by design — which is why it is banned outside axis labels", () => {
    // ₹1,49,999 and ₹1,50,001 collapse to the same label here. That is acceptable on a tick
    // and unacceptable anywhere a user reads an amount; formatINRExact is the one for that.
    expect(formatINRCompact(149999)).toBe(formatINRCompact(150001));
  });
});
