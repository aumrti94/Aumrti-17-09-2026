import { describe, it, expect } from "vitest";
import {
  computeConsultationFee,
  toDateKey,
  daysBetween,
  NO_EPISODE,
  FALLBACK_RATE,
  DEFAULT_CONSULTATION_FEE,
  type ConsultationRate,
  type FeeEpisode,
} from "@/lib/consultationFee";

const rate = (over: Partial<ConsultationRate> = {}): ConsultationRate => ({
  ...FALLBACK_RATE,
  fee: 500,
  ...over,
});

const episode = (over: Partial<FeeEpisode> = {}): FeeEpisode => ({ ...NO_EPISODE, ...over });

describe("toDateKey / daysBetween", () => {
  it("formats a local date as YYYY-MM-DD without a UTC shift", () => {
    expect(toDateKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("computes whole days between two date keys", () => {
    expect(daysBetween("2026-01-01", "2026-01-08")).toBe(7);
    expect(daysBetween("2026-01-08", "2026-01-01")).toBe(-7);
  });

  it("returns 0 for an unparseable key instead of NaN", () => {
    expect(daysBetween("not-a-date", "2026-01-08")).toBe(0);
  });
});

describe("computeConsultationFee — precedence: emergency > follow-up > revisit discount > base", () => {
  it("emergency uses the configured emergency rate", () => {
    const r = computeConsultationFee({
      rate: rate({ emergencyFee: 1000 }), episode: NO_EPISODE, visitType: "emergency",
    });
    expect(r.fee).toBe(1000);
    expect(r.tier).toBe("emergency");
  });

  it("emergency with no configured emergency rate charges the full fee, not a discount", () => {
    const r = computeConsultationFee({
      rate: rate({ emergencyFee: 0, fee: 500 }), episode: NO_EPISODE, visitType: "emergency",
    });
    expect(r.fee).toBe(500);
    expect(r.reason).toMatch(/no emergency rate configured/);
  });

  it("emergency outranks an otherwise-valid follow-up window", () => {
    const r = computeConsultationFee({
      rate: rate({ followUpFee: 100, emergencyFee: 800 }),
      episode: episode({ anchorDate: "2026-01-01", withinValidity: true, capReached: false }),
      visitType: "emergency",
    });
    expect(r.fee).toBe(800);
    expect(r.tier).toBe("emergency");
  });

  it("a valid follow-up episode bills the follow-up fee, not the base fee", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: 100, followUpMaxVisits: 3 }),
      episode: episode({ anchorDate: "2026-01-01", withinValidity: true, capReached: false, followUpsUsed: 1, daysSinceAnchor: 3 }),
      visitType: "revisit",
      visitPurpose: "revisit",
    });
    expect(r.fee).toBe(100);
    expect(r.tier).toBe("follow_up");
  });

  it("a configured ₹0 follow-up fee bills free, distinct from null (no follow-up configured)", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: 0 }),
      episode: episode({ anchorDate: "2026-01-01", withinValidity: true, capReached: false }),
      visitType: "revisit",
    });
    expect(r.fee).toBe(0);
    expect(r.tier).toBe("follow_up");
  });

  it("an exhausted follow-up allowance bills full fee and starts a new episode", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: 100, followUpMaxVisits: 2 }),
      episode: episode({ anchorDate: "2026-01-01", withinValidity: true, capReached: true, followUpsUsed: 2, daysSinceAnchor: 3 }),
      visitType: "revisit",
    });
    expect(r.fee).toBe(500);
    expect(r.tier).toBe("new");
    expect(r.reason).toMatch(/allowance used/);
  });

  it("an expired validity window bills full fee even with allowance remaining", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: 100, followUpValidityDays: 7 }),
      episode: episode({ anchorDate: "2026-01-01", withinValidity: false, capReached: false, followUpsUsed: 0, daysSinceAnchor: 20 }),
      visitType: "revisit",
    });
    expect(r.fee).toBe(500);
    expect(r.reason).toMatch(/outside the 7-day validity/);
  });

  it("the desk's manual follow-up selection is trusted only when there is no history to evaluate", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: 100 }),
      episode: NO_EPISODE,
      visitType: "followup",
    });
    expect(r.fee).toBe(100);
    expect(r.reason).toMatch(/marked manually/);
  });

  it("a manual follow-up selection cannot override an expired window — the doctor's setting wins", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: 100, followUpValidityDays: 7 }),
      episode: episode({ anchorDate: "2026-01-01", withinValidity: false, capReached: false, daysSinceAnchor: 30 }),
      visitType: "followup",
    });
    expect(r.fee).toBe(500);
  });

  it("no follow-up rate configured (null) always falls through to full fee", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: null }),
      episode: episode({ anchorDate: "2026-01-01", withinValidity: true, capReached: false }),
      visitType: "followup",
    });
    expect(r.fee).toBe(500);
    expect(r.reason).toMatch(/no follow-up rate configured/);
  });
});

describe("computeConsultationFee — revisit-discount rules (hospital_settings 'opd_revisit_rules')", () => {
  const baseEpisode = episode({ anchorDate: "2026-01-01", withinValidity: false, capReached: false, daysSinceAnchor: 5 });

  it("applies a free discount within the configured window", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: null }),
      episode: baseEpisode,
      visitType: "revisit",
      visitPurpose: "revisit",
      revisitRules: { enabled: true, rules: [{ within_days: 7, same_doctor: true, discount_type: "free", amount: 0 }] },
    });
    expect(r.fee).toBe(0);
    expect(r.revisitDiscount).toBe(500);
  });

  it("applies a percent discount and rounds the result", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 501, followUpFee: null }),
      episode: baseEpisode,
      visitType: "revisit",
      visitPurpose: "revisit",
      revisitRules: { enabled: true, rules: [{ within_days: 7, same_doctor: true, discount_type: "percent", amount: 10 }] },
    });
    expect(r.fee).toBe(Math.round(501 * 0.9));
    expect(r.revisitDiscount).toBe(501 - r.fee);
  });

  it("applies a fixed discount, clamped at zero", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 300, followUpFee: null }),
      episode: baseEpisode,
      visitType: "revisit",
      visitPurpose: "revisit",
      revisitRules: { enabled: true, rules: [{ within_days: 7, same_doctor: true, discount_type: "fixed", amount: 1000 }] },
    });
    expect(r.fee).toBe(0);
  });

  it("a visit outside the rule's within_days window gets no discount", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: null }),
      episode: episode({ anchorDate: "2026-01-01", withinValidity: false, capReached: false, daysSinceAnchor: 30 }),
      visitType: "revisit",
      visitPurpose: "revisit",
      revisitRules: { enabled: true, rules: [{ within_days: 7, same_doctor: true, discount_type: "free", amount: 0 }] },
    });
    expect(r.fee).toBe(500);
    expect(r.revisitDiscount).toBe(0);
  });

  it("disabling the rule set (enabled: false) turns the discount off for the identical visit", () => {
    const on = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: null }),
      episode: baseEpisode,
      visitType: "revisit",
      visitPurpose: "revisit",
      revisitRules: { enabled: true, rules: [{ within_days: 7, same_doctor: true, discount_type: "free", amount: 0 }] },
    });
    const off = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: null }),
      episode: baseEpisode,
      visitType: "revisit",
      visitPurpose: "revisit",
      revisitRules: { enabled: false, rules: [{ within_days: 7, same_doctor: true, discount_type: "free", amount: 0 }] },
    });
    expect(on.fee).toBe(0);
    expect(off.fee).toBe(500);
  });

  it("does not apply the discount when the visit was not marked as a revisit", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: null }),
      episode: baseEpisode,
      visitType: "new",
      visitPurpose: "new",
      revisitRules: { enabled: true, rules: [{ within_days: 7, same_doctor: true, discount_type: "free", amount: 0 }] },
    });
    expect(r.fee).toBe(500);
    expect(r.revisitDiscount).toBe(0);
  });

  it("requires an anchor date — a fresh patient with no history gets no revisit discount", () => {
    const r = computeConsultationFee({
      rate: rate({ fee: 500, followUpFee: null }),
      episode: NO_EPISODE,
      visitType: "revisit",
      visitPurpose: "revisit",
      revisitRules: { enabled: true, rules: [{ within_days: 7, same_doctor: true, discount_type: "free", amount: 0 }] },
    });
    expect(r.fee).toBe(500);
  });
});

describe("FALLBACK_RATE / DEFAULT_CONSULTATION_FEE", () => {
  it("the documented last-resort fee is what FALLBACK_RATE actually carries", () => {
    expect(FALLBACK_RATE.fee).toBe(DEFAULT_CONSULTATION_FEE);
    expect(FALLBACK_RATE.source).toBe("default");
  });
});
