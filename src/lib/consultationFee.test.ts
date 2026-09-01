import { describe, it, expect } from "vitest";
import {
  computeConsultationFee,
  daysBetween,
  type ConsultationRate,
  type FeeEpisode,
} from "./consultationFee";

/** Dr. Menon from the bug report: ₹700 full, ₹300 follow-up, 10-day validity, 1 follow-up. */
const MENON: ConsultationRate = {
  fee: 700,
  followUpFee: 300,
  followUpValidityDays: 10,
  followUpMaxVisits: 1,
  emergencyFee: 1000,
  source: "doctor",
};

const noEpisode: FeeEpisode = {
  anchorDate: null,
  anchorTokenId: null,
  anchorDoctorName: null,
  followUpsUsed: 0,
  withinValidity: false,
  capReached: false,
  daysSinceAnchor: null,
};

/** Build an episode as the DB layer would, so the cap rule is exercised, not restated. */
function episode(
  daysSinceAnchor: number,
  followUpsUsed: number,
  rate: ConsultationRate = MENON
): FeeEpisode {
  return {
    anchorDate: "2026-08-01",
    anchorTokenId: "tok-anchor",
    anchorDoctorName: "Menon",
    followUpsUsed,
    withinValidity: daysSinceAnchor >= 0 && daysSinceAnchor <= rate.followUpValidityDays,
    capReached: rate.followUpMaxVisits != null && followUpsUsed >= rate.followUpMaxVisits,
    daysSinceAnchor,
  };
}

describe("episode-anchored follow-up pricing", () => {
  it("charges the full fee when there is no prior visit", () => {
    const r = computeConsultationFee({ rate: MENON, episode: noEpisode, visitType: "new" });
    expect(r.fee).toBe(700);
    expect(r.tier).toBe("new");
  });

  it("charges the follow-up fee inside validity with allowance left", () => {
    const r = computeConsultationFee({ rate: MENON, episode: episode(4, 0), visitType: "new" });
    expect(r.fee).toBe(300);
    expect(r.tier).toBe("follow_up");
    expect(r.reason).toContain("visit 1 of 1");
  });

  it("reverts to the full fee once the allowance is spent, even inside validity", () => {
    // The reported scenario: doctor allows ONE follow-up, patient comes a third time.
    const r = computeConsultationFee({ rate: MENON, episode: episode(7, 1), visitType: "new" });
    expect(r.fee).toBe(700);
    expect(r.tier).toBe("new");
    expect(r.reason).toContain("allowance used");
  });

  it("reverts to the full fee once validity expires, even with allowance left", () => {
    const r = computeConsultationFee({ rate: MENON, episode: episode(11, 0), visitType: "new" });
    expect(r.fee).toBe(700);
    expect(r.tier).toBe("new");
    expect(r.reason).toContain("outside the 10-day validity");
  });

  it("treats the last day of validity as still inside it", () => {
    expect(computeConsultationFee({ rate: MENON, episode: episode(10, 0), visitType: "new" }).fee).toBe(300);
    expect(computeConsultationFee({ rate: MENON, episode: episode(11, 0), visitType: "new" }).fee).toBe(700);
  });

  it("honours a larger allowance across consecutive follow-ups", () => {
    const rate = { ...MENON, followUpMaxVisits: 3 };
    expect(computeConsultationFee({ rate, episode: episode(2, 0, rate), visitType: "new" }).fee).toBe(300);
    expect(computeConsultationFee({ rate, episode: episode(5, 1, rate), visitType: "new" }).fee).toBe(300);
    expect(computeConsultationFee({ rate, episode: episode(8, 2, rate), visitType: "new" }).fee).toBe(300);
    expect(computeConsultationFee({ rate, episode: episode(9, 3, rate), visitType: "new" }).fee).toBe(700);
  });

  it("never caps when followUpMaxVisits is null (legacy unlimited behaviour)", () => {
    const rate = { ...MENON, followUpMaxVisits: null };
    const r = computeConsultationFee({ rate, episode: episode(9, 12, rate), visitType: "new" });
    expect(r.fee).toBe(300);
    expect(r.reason).toContain("of unlimited");
  });
});

describe("manual desk selection", () => {
  it("applies the follow-up rate when marked manually and there is no history", () => {
    const r = computeConsultationFee({ rate: MENON, episode: noEpisode, visitType: "followup" });
    expect(r.fee).toBe(300);
    expect(r.reason).toContain("marked manually");
  });

  it("cannot override an expired validity window", () => {
    const r = computeConsultationFee({ rate: MENON, episode: episode(40, 0), visitType: "followup" });
    expect(r.fee).toBe(700);
  });

  it("cannot override a spent allowance", () => {
    const r = computeConsultationFee({ rate: MENON, episode: episode(3, 1), visitType: "followup" });
    expect(r.fee).toBe(700);
  });

  it("falls back to the full fee when the doctor has no follow-up rate", () => {
    const rate = { ...MENON, followUpFee: null };
    const r = computeConsultationFee({ rate, episode: episode(2, 0, rate), visitType: "followup" });
    expect(r.fee).toBe(700);
    expect(r.reason).toContain("no follow-up rate configured");
  });
});

describe("zero-value rates are configuration, not absence", () => {
  it("bills ₹0 for a deliberately free follow-up instead of falling back to the full fee", () => {
    const rate = { ...MENON, followUpFee: 0 };
    const r = computeConsultationFee({ rate, episode: episode(3, 0, rate), visitType: "new" });
    expect(r.fee).toBe(0);
    expect(r.tier).toBe("follow_up");
  });

  it("honours a doctor configured at exactly the ₹500 default without falling through", () => {
    // ConsultationWorkspace used `fee === 500` as a "not resolved yet" sentinel, so this
    // doctor's own rate was overwritten by the department/global tiers. Resolution is now
    // tracked by `source`, never by the value.
    const rate: ConsultationRate = { ...MENON, fee: 500, source: "doctor" };
    const r = computeConsultationFee({ rate, episode: noEpisode, visitType: "new" });
    expect(r.fee).toBe(500);
    expect(r.tier).toBe("new");
  });

  it("bills ₹0 for a doctor deliberately configured as free", () => {
    const rate: ConsultationRate = { ...MENON, fee: 0, followUpFee: null, source: "doctor" };
    expect(computeConsultationFee({ rate, episode: noEpisode, visitType: "new" }).fee).toBe(0);
  });
});

describe("emergency precedence", () => {
  it("outranks the follow-up rate even well inside validity", () => {
    const r = computeConsultationFee({ rate: MENON, episode: episode(1, 0), visitType: "emergency" });
    expect(r.fee).toBe(1000);
    expect(r.tier).toBe("emergency");
  });

  it("falls back to the full fee when no emergency rate is configured", () => {
    const rate = { ...MENON, emergencyFee: 0 };
    const r = computeConsultationFee({ rate, episode: noEpisode, visitType: "emergency" });
    expect(r.fee).toBe(700);
    expect(r.tier).toBe("emergency");
  });
});

describe("opd_revisit_rules discounts", () => {
  const rules = {
    enabled: true,
    rules: [{ within_days: 5, same_doctor: true, discount_type: "percent" as const, amount: 50 }],
  };

  it("applies only after the follow-up rate has been ruled out", () => {
    // Allowance spent → base fee → then the hospital-wide revisit courtesy applies.
    const r = computeConsultationFee({
      rate: MENON, episode: episode(3, 1), visitType: "revisit", visitPurpose: "revisit", revisitRules: rules,
    });
    expect(r.fee).toBe(350);
    expect(r.revisitDiscount).toBe(350);
    expect(r.tier).toBe("new");
  });

  it("does not apply when the follow-up rate already won", () => {
    const r = computeConsultationFee({
      rate: MENON, episode: episode(3, 0), visitType: "revisit", visitPurpose: "revisit", revisitRules: rules,
    });
    expect(r.fee).toBe(300);
    expect(r.revisitDiscount).toBe(0);
  });

  it("ignores rules whose window has passed", () => {
    const r = computeConsultationFee({
      rate: MENON, episode: episode(20, 1), visitType: "revisit", visitPurpose: "revisit", revisitRules: rules,
    });
    expect(r.fee).toBe(700);
  });
});

describe("daysBetween", () => {
  it("counts whole calendar days", () => {
    expect(daysBetween("2026-08-01", "2026-08-11")).toBe(10);
    expect(daysBetween("2026-08-01", "2026-08-01")).toBe(0);
  });

  it("is stable across a month boundary and a DST-style shift", () => {
    expect(daysBetween("2026-02-25", "2026-03-05")).toBe(8);
    expect(daysBetween("2026-03-28", "2026-04-02")).toBe(5);
  });
});
