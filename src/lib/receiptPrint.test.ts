import { describe, it, expect } from "vitest";
import { renderReceiptHtml } from "./receiptPrint";

describe("renderReceiptHtml", () => {
  it("renders the core receipt fields", () => {
    const html = renderReceiptHtml({
      title: "ADVANCE / DEPOSIT RECEIPT",
      receiptNumber: "ADV-0001",
      date: "2026-07-24",
      patientName: "K Elisha",
      uhid: "VGLC-0001",
      amountReceived: 3000,
      paymentMode: "upi",
    });
    expect(html).toContain("ADVANCE / DEPOSIT RECEIPT");
    expect(html).toContain("ADV-0001");
    expect(html).toContain("K Elisha");
    expect(html).toContain("VGLC-0001");
    expect(html).toContain("₹3,000.00");
    expect(html).toContain("Paid (upi)");
  });

  it("defaults the title to RECEIPT and receivedFrom to patientName", () => {
    const html = renderReceiptHtml({ receiptNumber: "R1", patientName: "Asha", amountReceived: 500 });
    expect(html).toContain(">RECEIPT<");
    expect(html).toContain("Asha");
  });

  it("writes the amount in words with the given prefix", () => {
    const html = renderReceiptHtml({
      receiptNumber: "R2",
      amountReceived: 1600,
      amountInWordsPrefix: "Received Rupees",
    });
    expect(html).toContain("Received Rupees One Thousand Six Hundred Only");
  });

  it("omits the words line when the prefix is null", () => {
    const html = renderReceiptHtml({ receiptNumber: "R3", amountReceived: 100, amountInWordsPrefix: null });
    expect(html).not.toContain("Rupees");
  });

  it("renders a charges-covered breakup and total when line items are given", () => {
    const html = renderReceiptHtml({
      receiptNumber: "R4",
      amountReceived: 5000,
      lineItems: [
        { description: "Upper GI Endoscopy", rate: 2300, quantity: 1, amount: 2300 },
        { description: "Biopsy", rate: 2700, quantity: 1, amount: 2700 },
      ],
      totalCharges: 5000,
    });
    expect(html).toContain("Charges Covered");
    expect(html).toContain("Upper GI Endoscopy");
    expect(html).toContain("Biopsy");
    expect(html).toContain("Total Charges");
  });

  it("shows a red balance row only when balance > 0", () => {
    const withBalance = renderReceiptHtml({ receiptNumber: "R5", amountReceived: 3000, balance: 1600 });
    expect(withBalance).toContain("Balance Payable");
    expect(withBalance).toContain("₹1,600.00");

    const settled = renderReceiptHtml({ receiptNumber: "R6", amountReceived: 3000, balance: 0 });
    expect(settled).not.toContain("Balance Payable");
  });

  it("escapes HTML in free-text fields", () => {
    const html = renderReceiptHtml({
      receiptNumber: "R7",
      patientName: "<script>alert(1)</script>",
      amountReceived: 100,
    });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
