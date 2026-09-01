import { describe, it, expect } from "vitest";
import {
  adherencePercent,
  adherenceBand,
  toISODate,
  type AdherenceRow,
} from "./chronicAdherence";

const row = (scheduled_date: string, adherence_status: string): AdherenceRow => ({
  id: `${scheduled_date}-${adherence_status}`,
  drug_name: "Metformin 500mg",
  scheduled_date,
  dispensed_at: null,
  adherence_status,
});

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return toISODate(d);
};

const daysAhead = (n: number) => daysAgo(-n);

describe("adherencePercent", () => {
  it("returns null when nothing is due yet, distinguishing no-data from 0%", () => {
    expect(adherencePercent([])).toBeNull();
    expect(adherencePercent([row(daysAhead(3), "unknown")])).toBeNull();
  });

  it("counts only doses already due, ignoring future scheduling", () => {
    // Scheduling 30 days ahead must not read as 3% adherence on day one.
    const rows = [
      row(daysAgo(1), "taken"),
      ...Array.from({ length: 29 }, (_, i) => row(daysAhead(i + 1), "unknown")),
    ];
    expect(adherencePercent(rows)).toBe(100);
  });

  it("computes a straight taken/due percentage", () => {
    expect(adherencePercent([
      row(daysAgo(4), "taken"),
      row(daysAgo(3), "taken"),
      row(daysAgo(2), "missed"),
      row(daysAgo(1), "taken"),
    ])).toBe(75);
  });

  it("counts an unmarked past dose against adherence, not for it", () => {
    expect(adherencePercent([
      row(daysAgo(2), "taken"),
      row(daysAgo(1), "unknown"),
    ])).toBe(50);
  });

  it("reports 0 when every due dose was missed", () => {
    expect(adherencePercent([row(daysAgo(1), "missed")])).toBe(0);
  });

  it("includes a dose due today", () => {
    expect(adherencePercent([row(toISODate(new Date()), "taken")])).toBe(100);
  });
});

describe("adherenceBand", () => {
  it("bands on the clinical 80 / 50 thresholds", () => {
    expect(adherenceBand(100)).toBe("good");
    expect(adherenceBand(80)).toBe("good");
    expect(adherenceBand(79)).toBe("suboptimal");
    expect(adherenceBand(50)).toBe("suboptimal");
    expect(adherenceBand(49)).toBe("poor");
    expect(adherenceBand(0)).toBe("poor");
  });
});
