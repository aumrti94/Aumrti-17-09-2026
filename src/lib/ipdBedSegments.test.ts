import { describe, it, expect } from "vitest";
import { computeBedSegments, totalStayDays, formatSegmentDateRange, type BedTransferRecord } from "./ipdBedSegments";

const WARD_ICU = "ward-icu";
const BED_ICU = "bed-icu-02";
const WARD_PRIVATE = "ward-private";
const BED_PRIVATE = "bed-pri-03";

function transfer(overrides: Partial<BedTransferRecord>): BedTransferRecord {
  return {
    from_ward_id: WARD_ICU,
    from_bed_id: BED_ICU,
    to_ward_id: WARD_PRIVATE,
    to_bed_id: BED_PRIVATE,
    transferred_at: "2026-08-29T10:00:00Z",
    ...overrides,
  };
}

describe("totalStayDays", () => {
  it("matches the pre-existing whole-stay formula, including sub-day remainders", () => {
    expect(totalStayDays("2026-08-26T00:00:00Z", "2026-08-29T00:00:00Z")).toBe(3);
    expect(totalStayDays("2026-08-26T10:00:00Z", "2026-08-26T14:00:00Z")).toBe(1);
    expect(totalStayDays("2026-08-26T23:00:00Z", "2026-08-27T01:00:00Z")).toBe(1);
    expect(totalStayDays("2026-08-26T00:00:00Z", null, new Date("2026-08-29T00:00:00Z"))).toBe(3);
  });
});

describe("computeBedSegments", () => {
  it("returns one segment covering the whole stay when there are no transfers", () => {
    const segs = computeBedSegments({
      admittedAt: "2026-08-26T11:00:00Z",
      dischargedAt: "2026-08-29T09:00:00Z",
      currentWardId: WARD_ICU,
      currentBedId: BED_ICU,
      transfers: [],
    });
    expect(segs).toHaveLength(1);
    expect(segs[0].wardId).toBe(WARD_ICU);
    expect(segs[0].bedId).toBe(BED_ICU);
    expect(segs[0].days).toBe(totalStayDays("2026-08-26T11:00:00Z", "2026-08-29T09:00:00Z"));
  });

  it("splits a mid-stay transfer: old ward keeps the transfer day, new ward starts the next day", () => {
    // Admitted 26 Aug 00:00, discharged 31 Aug 00:00 -> 5 total days (Aug 26-30 nights).
    // Transferred on 28 Aug -> ICU keeps 26,27,28 (3 days), Private gets 29,30 (2 days).
    const segs = computeBedSegments({
      admittedAt: "2026-08-26T00:00:00Z",
      dischargedAt: "2026-08-31T00:00:00Z",
      currentWardId: WARD_PRIVATE,
      currentBedId: BED_PRIVATE,
      transfers: [transfer({ transferred_at: "2026-08-28T15:00:00Z" })],
    });
    expect(segs).toHaveLength(2);
    expect(segs[0]).toMatchObject({ wardId: WARD_ICU, bedId: BED_ICU, days: 3 });
    expect(segs[1]).toMatchObject({ wardId: WARD_PRIVATE, bedId: BED_PRIVATE, days: 2 });
    const total = totalStayDays("2026-08-26T00:00:00Z", "2026-08-31T00:00:00Z");
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(total);
  });

  it("bills exactly 1 day to the old ward when transferred the same day as admission", () => {
    const segs = computeBedSegments({
      admittedAt: "2026-08-26T08:00:00Z",
      dischargedAt: "2026-08-29T00:00:00Z",
      currentWardId: WARD_PRIVATE,
      currentBedId: BED_PRIVATE,
      transfers: [transfer({ transferred_at: "2026-08-26T20:00:00Z" })],
    });
    expect(segs[0]).toMatchObject({ wardId: WARD_ICU, days: 1 });
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(
      totalStayDays("2026-08-26T08:00:00Z", "2026-08-29T00:00:00Z")
    );
  });

  it("drops the new-ward segment when transferred on/after the discharge day", () => {
    const segs = computeBedSegments({
      admittedAt: "2026-08-26T00:00:00Z",
      dischargedAt: "2026-08-29T00:00:00Z",
      currentWardId: WARD_PRIVATE,
      currentBedId: BED_PRIVATE,
      transfers: [transfer({ transferred_at: "2026-08-29T00:00:00Z" })],
    });
    expect(segs).toHaveLength(1);
    expect(segs[0].wardId).toBe(WARD_ICU);
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(
      totalStayDays("2026-08-26T00:00:00Z", "2026-08-29T00:00:00Z")
    );
  });

  it("collapses two same-day transfers to a single effective boundary", () => {
    const WARD_STEPDOWN = "ward-stepdown";
    const BED_STEPDOWN = "bed-sd-01";
    const segs = computeBedSegments({
      admittedAt: "2026-08-26T00:00:00Z",
      dischargedAt: "2026-08-30T00:00:00Z",
      currentWardId: WARD_PRIVATE,
      currentBedId: BED_PRIVATE,
      transfers: [
        transfer({
          transferred_at: "2026-08-28T09:00:00Z",
          to_ward_id: WARD_STEPDOWN,
          to_bed_id: BED_STEPDOWN,
        }),
        transfer({
          from_ward_id: WARD_STEPDOWN,
          from_bed_id: BED_STEPDOWN,
          transferred_at: "2026-08-28T18:00:00Z",
          to_ward_id: WARD_PRIVATE,
          to_bed_id: BED_PRIVATE,
        }),
      ],
    });
    // The step-down ward was only occupied for part of one calendar day, so its segment
    // collapses to zero length and is dropped — only ICU and Private appear.
    expect(segs.map((s) => s.wardId)).toEqual([WARD_ICU, WARD_PRIVATE]);
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(
      totalStayDays("2026-08-26T00:00:00Z", "2026-08-30T00:00:00Z")
    );
  });

  it("prices an ongoing (undischarged) stay against an explicit now", () => {
    const segs = computeBedSegments({
      admittedAt: "2026-08-26T00:00:00Z",
      dischargedAt: null,
      currentWardId: WARD_PRIVATE,
      currentBedId: BED_PRIVATE,
      transfers: [transfer({ transferred_at: "2026-08-28T00:00:00Z" })],
      now: new Date("2026-08-30T00:00:00Z"),
    });
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(
      totalStayDays("2026-08-26T00:00:00Z", null, new Date("2026-08-30T00:00:00Z"))
    );
  });

  it("freezes the ICU charge at the transfer and accrues the private room from the next day", () => {
    // The worked example this feature exists for: ICU @ ₹10,000/day + ₹500/day nursing for
    // 3 days, then a transfer to a Private room @ ₹5,000/day. On day 4 the ICU side must
    // stay at 3 days (₹30,000 + ₹1,500) — it stops growing the moment the patient leaves —
    // and the private room bills its first single day (₹5,000), NOT the whole stay at the
    // private rate and NOT the whole stay at the ICU rate.
    const segs = computeBedSegments({
      admittedAt: "2026-08-26T00:00:00Z",
      dischargedAt: null,
      currentWardId: WARD_PRIVATE,
      currentBedId: BED_PRIVATE,
      transfers: [transfer({ transferred_at: "2026-08-28T16:00:00Z" })],
      now: new Date("2026-08-29T12:00:00Z"),
    });

    expect(segs).toHaveLength(2);
    const [icu, priv] = segs;
    expect(icu).toMatchObject({ wardId: WARD_ICU, days: 3 });
    expect(priv).toMatchObject({ wardId: WARD_PRIVATE, days: 1 });

    const ICU_RATE = 10_000, PRIVATE_RATE = 5_000, ICU_NURSING = 500;
    expect(icu.days * ICU_RATE).toBe(30_000);
    expect(icu.days * ICU_NURSING).toBe(1_500);
    expect(priv.days * PRIVATE_RATE).toBe(5_000);
    expect(icu.days * ICU_RATE + priv.days * PRIVATE_RATE).toBe(35_000);
  });

  it("sums to totalStayDays across three or more transfers", () => {
    const WARD_A = "ward-a", BED_A = "bed-a";
    const WARD_B = "ward-b", BED_B = "bed-b";
    const WARD_C = "ward-c", BED_C = "bed-c";
    const admittedAt = "2026-08-01T00:00:00Z";
    const dischargedAt = "2026-08-20T00:00:00Z";
    const segs = computeBedSegments({
      admittedAt,
      dischargedAt,
      currentWardId: WARD_C,
      currentBedId: BED_C,
      transfers: [
        { from_ward_id: WARD_A, from_bed_id: BED_A, to_ward_id: WARD_B, to_bed_id: BED_B, transferred_at: "2026-08-05T00:00:00Z" },
        { from_ward_id: WARD_B, from_bed_id: BED_B, to_ward_id: WARD_C, to_bed_id: BED_C, transferred_at: "2026-08-12T00:00:00Z" },
        { from_ward_id: WARD_C, from_bed_id: BED_C, to_ward_id: WARD_A, to_bed_id: BED_A, transferred_at: "2026-08-16T00:00:00Z" },
      ],
    });
    expect(segs.reduce((s, x) => s + x.days, 0)).toBe(totalStayDays(admittedAt, dischargedAt));
    expect(segs.length).toBeGreaterThan(1);
  });
});

describe("formatSegmentDateRange", () => {
  it("shows a single date when the segment is one day", () => {
    expect(formatSegmentDateRange("2026-08-26", "2026-08-26")).toBe("26 Aug");
  });

  it("shows a range when the segment spans multiple days", () => {
    expect(formatSegmentDateRange("2026-08-26", "2026-08-28")).toBe("26 Aug – 28 Aug");
  });
});
