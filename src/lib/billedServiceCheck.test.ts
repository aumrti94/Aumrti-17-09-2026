/**
 * Phase 2 — extraction 1 (PHASED_TEST_PLAN.md §8, Phase 2).
 *
 * The plan's framing: "Two implementations of one question that can disagree **is** the
 * leakage risk." So the assertions that matter are the four real-world cases where the old
 * description matching gave the wrong answer — each of them silent, each of them either
 * lost revenue or a double-billed patient.
 */
import { describe, it, expect } from "vitest";
import {
  VOIDED_BILL_STATUSES,
  autoSelectable,
  buildDedupeKey,
  indexChargedKeys,
  isVoidedLine,
  splitBilledServices,
  type BillableCandidate,
  type ChargedLine,
} from "@/lib/billedServiceCheck";

const candidate = (dedupeKey: string, description: string): BillableCandidate => ({
  dedupeKey,
  description,
});

describe("buildDedupeKey", () => {
  it("matches the format chargePosting writes", () => {
    // chargePosting.ts:90 — `${sourceModule}:${sourceId}`. A different shape here means the
    // scanner looks up keys that the charge path never wrote, and every service reads unbilled.
    expect(buildDedupeKey("lab", "order-item-1")).toBe("lab:order-item-1");
    expect(buildDedupeKey("radiology", "ro-9")).toBe("radiology:ro-9");
  });

  it("appends a segment for sources that bill several lines", () => {
    // One OT case bills a theatre charge, a surgeon fee, an anaesthesia fee and each implant.
    // Without the segment they would collide on one key and only the first would ever bill.
    expect(buildDedupeKey("ot", "case-1", "surgeon_fee")).toBe("ot:case-1:surgeon_fee");
    expect(buildDedupeKey("ot", "case-1", "ot_charge")).toBe("ot:case-1:ot_charge");
    expect(buildDedupeKey("ot", "case-1", "surgeon_fee")).not.toBe(buildDedupeKey("ot", "case-1", "ot_charge"));
  });

  it("is deterministic", () => {
    expect(buildDedupeKey("lab", "x")).toBe(buildDedupeKey("lab", "x"));
  });
});

describe("isVoidedLine", () => {
  it.each(["cancelled", "refunded", "CANCELLED", "  Refunded  "])(
    "treats a line on a %s bill as not a live claim",
    (billStatus) => {
      expect(isVoidedLine({ source_dedupe_key: "lab:1", billStatus })).toBe(true);
    },
  );

  it.each(["draft", "final", "paid", "partially_paid", "refund_pending"])(
    "treats a line on a %s bill as live",
    (billStatus) => {
      expect(isVoidedLine({ source_dedupe_key: "lab:1", billStatus })).toBe(false);
    },
  );

  it("treats refund_pending as still billed — the money has not gone back yet", () => {
    // Distinct from `refunded`. The line is still a claim until the refund completes;
    // re-offering it now would bill the patient a second time mid-refund.
    expect(isVoidedLine({ source_dedupe_key: "lab:1", billStatus: "refund_pending" })).toBe(false);
    expect(VOIDED_BILL_STATUSES.has("refund_pending")).toBe(false);
  });

  it("assumes live when the caller did not join bill_status", () => {
    // The conservative read: treating an unknown status as voided would re-offer services
    // that are genuinely billed, and the modal pre-selects its results.
    expect(isVoidedLine({ source_dedupe_key: "lab:1" })).toBe(false);
    expect(isVoidedLine({ source_dedupe_key: "lab:1", billStatus: null })).toBe(false);
    expect(isVoidedLine({ source_dedupe_key: "lab:1", billStatus: "" })).toBe(false);
  });
});

describe("indexChargedKeys", () => {
  it("records a key as live when any live line carries it", () => {
    // A service re-billed onto a fresh bill after the original was cancelled has two lines.
    // It is billed. Reading only the first line would re-offer it and double-bill.
    const { live, voidedOnly } = indexChargedKeys([
      { source_dedupe_key: "lab:1", billStatus: "cancelled" },
      { source_dedupe_key: "lab:1", billStatus: "final" },
    ]);
    expect(live.has("lab:1")).toBe(true);
    expect(voidedOnly.has("lab:1")).toBe(false);
  });

  it("records a key as voided-only when every line carrying it is voided", () => {
    const { live, voidedOnly } = indexChargedKeys([
      { source_dedupe_key: "lab:1", billStatus: "cancelled" },
      { source_dedupe_key: "lab:1", billStatus: "refunded" },
    ]);
    expect(live.has("lab:1")).toBe(false);
    expect(voidedOnly.has("lab:1")).toBe(true);
  });

  it("ignores lines with no dedupe key", () => {
    // Manually-typed bill lines have no source. They cannot mark anything as billed.
    const { live } = indexChargedKeys([
      { source_dedupe_key: null, billStatus: "final" },
      { billStatus: "final" },
      { source_dedupe_key: "", billStatus: "final" },
    ]);
    expect(live.size).toBe(0);
  });

  it("handles a null or empty line list", () => {
    for (const lines of [null, undefined, []] as (ChargedLine[] | null | undefined)[]) {
      const { live, voidedOnly } = indexChargedKeys(lines);
      expect(live.size).toBe(0);
      expect(voidedOnly.size).toBe(0);
    }
  });
});

// ── The four cases description matching got wrong ────────────────────────────

describe("cases where description matching gave the wrong answer", () => {
  it("bills a separate test whose name is a substring of a billed one", () => {
    // THE CASE THE PLAN NAMES FIRST. LeakageScanner used
    // `existingDesc.some(d => d.includes(testName))`, so billing "Blood Sugar Fasting" made a
    // separate "Blood Sugar" order read as billed. The hospital is never paid for it, and the
    // scanner that exists to catch exactly this reported a clean bill.
    const candidates = [candidate("lab:order-item-1", "Blood Sugar")];
    const charged: ChargedLine[] = [{ source_dedupe_key: "lab:order-item-2", billStatus: "final" }];

    const split = splitBilledServices(candidates, charged);

    expect(split.unbilled).toHaveLength(1);
    expect(split.unbilled[0].candidate.description).toBe("Blood Sugar");
    expect(split.billed).toHaveLength(0);
  });

  it("bills the second dispense of the same drug in one admission", () => {
    // Two Paracetamol dispenses, identical descriptions, different dispense ids. Description
    // matching silently wrote off the second.
    const candidates = [
      candidate("pharmacy:dispense-item:a", "Paracetamol 650mg"),
      candidate("pharmacy:dispense-item:b", "Paracetamol 650mg"),
    ];
    const charged: ChargedLine[] = [
      { source_dedupe_key: "pharmacy:dispense-item:a", billStatus: "final" },
    ];

    const split = splitBilledServices(candidates, charged);

    expect(split.billed.map((c) => c.dedupeKey)).toEqual(["pharmacy:dispense-item:a"]);
    expect(split.unbilled.map((u) => u.candidate.dedupeKey)).toEqual(["pharmacy:dispense-item:b"]);
  });

  it("does not re-offer a service whose master-data name changed after billing", () => {
    // A test renamed in lab_test_master no longer matches its own bill line's description, so
    // description matching re-offered it — pre-selected — and billed the patient twice. The
    // dedupe key is derived from the order item id and does not move.
    const candidates = [candidate("lab:order-item-1", "Complete Blood Count (CBC)")];
    const charged: ChargedLine[] = [
      { source_dedupe_key: "lab:order-item-1", billStatus: "final" },
    ];

    const split = splitBilledServices(candidates, charged);

    expect(split.billed).toHaveLength(1);
    expect(split.unbilled).toHaveLength(0);
  });

  it("does not count a cancelled bill's lines as billed", () => {
    // The line still carries its description, so description matching read the service as
    // billed while the hospital held no valid claim on it.
    const candidates = [candidate("lab:order-item-1", "Serum Creatinine")];
    const charged: ChargedLine[] = [
      { source_dedupe_key: "lab:order-item-1", billStatus: "cancelled" },
    ];

    const split = splitBilledServices(candidates, charged);

    expect(split.billed).toHaveLength(0);
    expect(split.unbilled[0].reason).toBe("prior_bill_voided");
  });

  it("does not count a refunded bill's lines as billed", () => {
    const split = splitBilledServices(
      [candidate("radiology:ro-1", "Chest X-Ray")],
      [{ source_dedupe_key: "radiology:ro-1", billStatus: "refunded" }],
    );
    expect(split.unbilled[0].reason).toBe("prior_bill_voided");
  });
});

describe("splitBilledServices", () => {
  it("returns everything as never_billed when nothing is charged", () => {
    const candidates = [candidate("lab:1", "A"), candidate("lab:2", "B")];
    const split = splitBilledServices(candidates, []);
    expect(split.unbilled).toHaveLength(2);
    expect(split.unbilled.every((u) => u.reason === "never_billed")).toBe(true);
    expect(split.billed).toHaveLength(0);
  });

  it("preserves extra fields on the candidate", () => {
    // Callers attach the source row, a suggested rate, an OT schedule. The split must hand
    // them back untouched so the caller can bill from them.
    const withExtras = { dedupeKey: "ot:1:ot_charge", description: "OT", schedule: { id: "ot-1" }, rate: 15000 };
    const split = splitBilledServices([withExtras], []);
    expect(split.unbilled[0].candidate.schedule).toEqual({ id: "ot-1" });
    expect(split.unbilled[0].candidate.rate).toBe(15000);
  });

  it("skips a candidate with no dedupe key rather than guessing", () => {
    // Without an identity the question cannot be answered. Defaulting to "unbilled" would
    // offer it for billing on every scan, forever.
    const split = splitBilledServices(
      [{ dedupeKey: "", description: "Mystery" }, candidate("lab:1", "Real")],
      [],
    );
    expect(split.unbilled).toHaveLength(1);
    expect(split.unbilled[0].candidate.description).toBe("Real");
  });

  it("handles null candidate and charge lists", () => {
    expect(splitBilledServices(null, null)).toEqual({ unbilled: [], billed: [] });
    expect(splitBilledServices(undefined, undefined)).toEqual({ unbilled: [], billed: [] });
  });

  it("is order-independent", () => {
    const candidates = [candidate("lab:1", "A"), candidate("lab:2", "B")];
    const charged: ChargedLine[] = [{ source_dedupe_key: "lab:2", billStatus: "final" }];
    const forward = splitBilledServices(candidates, charged);
    const reversed = splitBilledServices([...candidates].reverse(), [...charged].reverse());
    expect(forward.billed.map((c) => c.dedupeKey)).toEqual(reversed.billed.map((c) => c.dedupeKey));
  });
});

describe("autoSelectable", () => {
  it("pre-selects only services that were never billed", () => {
    // UnbilledServicesModal ticks every row by default and bills on confirm. A pre-ticked
    // checkbox is a decision made for the user, so the one ambiguous case must not be ticked:
    // a voided-then-being-re-raised bill looks identical to a genuine void mid-correction.
    const split = splitBilledServices(
      [candidate("lab:1", "Never billed"), candidate("lab:2", "Was on a cancelled bill")],
      [{ source_dedupe_key: "lab:2", billStatus: "cancelled" }],
    );

    expect(split.unbilled).toHaveLength(2);
    expect(autoSelectable(split).map((c) => c.dedupeKey)).toEqual(["lab:1"]);
  });

  it("returns nothing when every unbilled service came off a voided bill", () => {
    const split = splitBilledServices(
      [candidate("lab:1", "A")],
      [{ source_dedupe_key: "lab:1", billStatus: "refunded" }],
    );
    expect(autoSelectable(split)).toEqual([]);
  });

  it("returns everything when nothing was ever billed", () => {
    const split = splitBilledServices([candidate("lab:1", "A"), candidate("lab:2", "B")], []);
    expect(autoSelectable(split)).toHaveLength(2);
  });
});
