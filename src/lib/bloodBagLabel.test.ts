/**
 * Phase 1 — patient-safety tier (PHASED_TEST_PLAN.md §8, Phase 1):
 * "A mislabelled bag defeats a correct cross-match."
 *
 * bloodCompatibility.test.ts proves the cross-match maths. That proof is worth nothing if the
 * label on the bag says something else, or if a quarantined unit prints a green "available"
 * banner. QRCode and the print window are mocked; the label CONTENT is not.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  toDataURL: vi.fn(),
  printDocument: vi.fn(),
}));

vi.mock("qrcode", () => ({ default: { toDataURL: mocks.toDataURL } }));
vi.mock("@/lib/printUtils", () => ({ printDocument: mocks.printDocument }));

import { buildQRString, generateQRDataUrl, printBloodBagLabel } from "@/lib/bloodBagLabel";

const HOSPITAL = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.toDataURL.mockResolvedValue("data:image/png;base64,QRSTUB");
});

describe("buildQRString", () => {
  it("encodes hospital prefix, bag number and collection date", () => {
    // Local Date components, not an ISO string — a date-only string parses as UTC midnight
    // and can format as the previous day west of Greenwich.
    expect(buildQRString(HOSPITAL, "BB-2026-0042", new Date(2026, 8, 11))).toBe(
      "BB-a1b2c3d4-BB-2026-0042-20260911",
    );
  });

  it("uses only the first 8 characters of the hospital id", () => {
    const qr = buildQRString(HOSPITAL, "U1", new Date(2026, 8, 11));
    expect(qr).toContain("a1b2c3d4");
    expect(qr).not.toContain("e5f6");
  });

  it("accepts a timestamp string", () => {
    const qr = buildQRString(HOSPITAL, "U1", new Date(2026, 0, 5, 14, 30).toISOString());
    expect(qr).toBe("BB-a1b2c3d4-U1-20260105");
  });

  it("zero-pads month and day so every code is the same length", () => {
    // Scanners and any fixed-width parsing downstream depend on this.
    expect(buildQRString(HOSPITAL, "U1", new Date(2026, 0, 5))).toContain("-20260105");
    expect(buildQRString(HOSPITAL, "U1", new Date(2026, 11, 31))).toContain("-20261231");
  });

  it("is deterministic — the same bag always scans to the same code", () => {
    const a = buildQRString(HOSPITAL, "BB-2026-0042", new Date(2026, 8, 11));
    const b = buildQRString(HOSPITAL, "BB-2026-0042", new Date(2026, 8, 11, 23, 59));
    expect(a).toBe(b);
  });

  it("distinguishes two bags collected on the same day", () => {
    const a = buildQRString(HOSPITAL, "BB-2026-0042", new Date(2026, 8, 11));
    const b = buildQRString(HOSPITAL, "BB-2026-0043", new Date(2026, 8, 11));
    expect(a).not.toBe(b);
  });

  it("distinguishes the same bag number across two hospitals", () => {
    // Bag numbering is per-tenant, so the hospital prefix is what stops a scanner in
    // hospital B resolving hospital A's unit.
    const a = buildQRString(HOSPITAL, "BB-0001", new Date(2026, 8, 11));
    const b = buildQRString("ffffffff-0000-4000-8000-000000000000", "BB-0001", new Date(2026, 8, 11));
    expect(a).not.toBe(b);
  });

  it("tolerates a hospital id shorter than 8 characters", () => {
    expect(buildQRString("abc", "U1", new Date(2026, 8, 11))).toBe("BB-abc-U1-20260911");
  });
});

describe("generateQRDataUrl", () => {
  it("renders at a size and error-correction level a ward scanner can read", () => {
    // 144px of print area at level M. Dropping to level L would fit more data and stop
    // scanning reliably off a bag that has been handled, refrigerated and condensated.
    return generateQRDataUrl("BB-test").then((url) => {
      expect(url).toBe("data:image/png;base64,QRSTUB");
      expect(mocks.toDataURL).toHaveBeenCalledWith("BB-test", {
        width: 220,
        margin: 1,
        errorCorrectionLevel: "M",
      });
    });
  });
});

describe("printBloodBagLabel", () => {
  const bag = {
    hospitalName: "Ashwini General Hospital",
    unitNumber: "BB-2026-0042",
    component: "whole_blood",
    bloodGroup: "A",
    rhFactor: "negative",
    collectedAt: new Date(2026, 8, 11).toISOString(),
    expiryAt: new Date(2026, 9, 16).toISOString(),
    qrCode: "BB-a1b2c3d4-BB-2026-0042-20260911",
    ttiStatus: "available" as const,
  };

  /** The HTML body handed to the print window. */
  const printedBody = () => String(mocks.printDocument.mock.calls[0][1]);

  it("prints the blood group in the cross-match notation, not the raw column values", () => {
    // THE ASSERTION THIS FILE EXISTS FOR. The bedside check compares this string against the
    // patient's group. "A" with rhFactor "negative" must read A−, never A or A+.
    return printBloodBagLabel(bag).then(() => {
      const body = printedBody();
      expect(body).toContain("A-");
      expect(body).not.toContain("A+");
    });
  });

  it.each([
    ["A", "positive", "A+"],
    ["A", "negative", "A-"],
    ["O", "negative", "O-"],
    ["AB", "positive", "AB+"],
    ["B", "negative", "B-"],
  ])("labels a %s %s unit as %s", (bloodGroup, rhFactor, expected) => {
    return printBloodBagLabel({ ...bag, bloodGroup, rhFactor }).then(() => {
      expect(printedBody()).toContain(`>\n        ${expected}\n      <`);
    });
  });

  it("never prints a bare Rh value that could be read as positive", () => {
    // An empty or unexpected rhFactor must render '-', the restrictive label. A unit
    // mislabelled '+' can be issued to an Rh-negative patient.
    return printBloodBagLabel({ ...bag, bloodGroup: "O", rhFactor: "" }).then(() => {
      const body = printedBody();
      expect(body).toContain("O-");
      expect(body).not.toContain("O+");
    });
  });

  it("shows a quarantined unit as DO NOT ISSUE, with the reason", () => {
    return printBloodBagLabel({
      ...bag,
      ttiStatus: "quarantine",
      quarantineReason: "HBsAg reactive on repeat",
    }).then(() => {
      const body = printedBody();
      expect(body).toContain("QUARANTINED — DO NOT ISSUE");
      expect(body).toContain("HBsAg reactive on repeat");
    });
  });

  it("NEVER shows a quarantined unit as available for issue", () => {
    // The banner is the only status a nurse reads before hanging a unit. A quarantined bag
    // carrying the green banner is a transfusion-transmitted infection.
    return printBloodBagLabel({ ...bag, ttiStatus: "quarantine", quarantineReason: "HIV reactive" }).then(() => {
      const body = printedBody();
      expect(body).not.toContain("AVAILABLE FOR ISSUE");
      expect(body).not.toContain("TTI CLEAR");
      expect(body).not.toContain("TTI PENDING");
    });
  });

  it("quarantines without a reason rather than falling back to available", () => {
    return printBloodBagLabel({ ...bag, ttiStatus: "quarantine", quarantineReason: null }).then(() => {
      expect(printedBody()).toContain("QUARANTINED — DO NOT ISSUE");
      expect(printedBody()).not.toContain("AVAILABLE FOR ISSUE");
    });
  });

  it("shows a TTI-cleared unit as available", () => {
    return printBloodBagLabel({ ...bag, ttiStatus: "available" }).then(() => {
      const body = printedBody();
      expect(body).toContain("TTI CLEAR — AVAILABLE FOR ISSUE");
      expect(body).not.toContain("DO NOT ISSUE");
    });
  });

  it("shows an untested unit as TTI PENDING — distinct from both cleared and quarantined", () => {
    // Three states, three banners. Collapsing pending into either of the others either
    // blocks a usable unit or releases an untested one.
    return printBloodBagLabel({ ...bag, ttiStatus: "pending_tti" }).then(() => {
      const body = printedBody();
      expect(body).toContain("TTI PENDING");
      expect(body).not.toContain("AVAILABLE FOR ISSUE");
      expect(body).not.toContain("DO NOT ISSUE");
    });
  });

  it("renders dates as DD/MM/YYYY per the en-IN rule", () => {
    return printBloodBagLabel(bag).then(() => {
      const body = printedBody();
      expect(body).toContain("11/09/2026"); // collected
      expect(body).toContain("16/10/2026"); // expires
    });
  });

  it("prints the expiry in the alert colour", () => {
    // An expired unit is unusable; the date has to catch the eye at the fridge.
    return printBloodBagLabel(bag).then(() => {
      expect(printedBody()).toMatch(/Expires:.*#b91c1c/s);
    });
  });

  it("prints the bag number and the component name", () => {
    return printBloodBagLabel(bag).then(() => {
      const body = printedBody();
      expect(body).toContain("BB-2026-0042");
      expect(body).toContain("WHOLE BLOOD");
      expect(body).toContain("Ashwini General Hospital");
    });
  });

  it.each([
    ["whole_blood", "WHOLE BLOOD"],
    ["rbc", "RBC"],
    ["ffp", "FFP"],
    ["platelets", "PLATELETS"],
    ["cryoprecipitate", "CRYOPRECIPITATE"],
  ])("renders component %s as %s", (component, expected) => {
    return printBloodBagLabel({ ...bag, component }).then(() => {
      expect(printedBody()).toContain(expected);
    });
  });

  it("embeds the QR image and prints the code as readable text underneath", () => {
    // The printed text is the fallback when the QR will not scan — a smudged label must
    // still be reconcilable by hand.
    return printBloodBagLabel(bag).then(() => {
      const body = printedBody();
      expect(body).toContain("data:image/png;base64,QRSTUB");
      expect(body).toContain("BB-a1b2c3d4-BB-2026-0042-20260911");
      expect(mocks.toDataURL).toHaveBeenCalledWith(bag.qrCode, expect.anything());
    });
  });

  it("titles the print job with the unit number so a print queue is traceable", () => {
    return printBloodBagLabel(bag).then(() => {
      expect(mocks.printDocument).toHaveBeenCalledWith(
        "Blood Bag Label - BB-2026-0042",
        expect.any(String),
        { width: 480, height: 640 },
      );
    });
  });

  it("does not print at all when the QR cannot be generated", () => {
    // A label with no QR cannot be scanned into the issue workflow, so printing one is worse
    // than printing none — it looks valid at the fridge and fails at the bedside.
    mocks.toDataURL.mockRejectedValue(new Error("qr encode failed"));
    return expect(printBloodBagLabel(bag)).rejects.toThrow("qr encode failed").then(() => {
      expect(mocks.printDocument).not.toHaveBeenCalled();
    });
  });
});
