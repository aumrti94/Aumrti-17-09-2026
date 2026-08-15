import { describe, it, expect } from "vitest";
import {
  formatDigestForPrompt,
  sortHistoryTimeline,
  digestComorbidities,
  estimateTierCost,
  DIGEST_PROMPT_MAX_CHARS,
  type HistoryDigest,
  type HistoryEvent,
  type HistorySummary,
  type HistoryCoverage,
} from "./historyDigest";

// ── Fixtures ────────────────────────────────────────────────────────────────

const emptySummary: HistorySummary = {
  one_liner: "", active_problems: [], current_medications: [], past_medications: [],
  allergies: [], surgeries: [], key_investigations: [], red_flags: [], conflicts: [], gaps: [],
};

const emptyCoverage: HistoryCoverage = {
  documents_total: 0, pages_total: 0, pages_read: 0, pages_unreadable: 0, unreadable_refs: [],
};

const makeDigest = (
  summary: Partial<HistorySummary> = {},
  over: Partial<HistoryDigest> = {},
): HistoryDigest => ({
  id: "d1",
  patient_id: "p1",
  job_id: "j1",
  version: 1,
  model_used: "gemini-2.0-flash",
  timeline: [],
  summary: { ...emptySummary, ...summary },
  coverage: { ...emptyCoverage },
  reviewed_by: null,
  reviewed_at: null,
  created_at: "2026-08-01T00:00:00Z",
  ...over,
});

const ev = (over: Partial<HistoryEvent> = {}): HistoryEvent => ({
  id: "e1",
  date: "2024-03-11",
  date_confidence: "exact",
  type: "diagnosis",
  facility: null,
  title: "Event",
  detail: "",
  values: [],
  medications: [],
  significance: "medium",
  red_flag: false,
  verbatim: null,
  source: { source_id: "s1", source_name: "Doc", page_from: 1, page_to: 1 },
  ...over,
});

// ── formatDigestForPrompt ───────────────────────────────────────────────────

describe("formatDigestForPrompt", () => {
  it("returns undefined when there is no digest, so callers omit the field entirely", () => {
    expect(formatDigestForPrompt(null)).toBeUndefined();
    expect(formatDigestForPrompt(undefined)).toBeUndefined();
  });

  it("returns undefined for a digest whose summary is empty rather than sending an empty block", () => {
    // A scan that read nothing must not spend tokens telling three separate prompts so.
    expect(formatDigestForPrompt(makeDigest())).toBeUndefined();
  });

  it("marks an unattested digest as NOT hospital-verified", () => {
    const out = formatDigestForPrompt(makeDigest({ one_liner: "44F, T2DM" }))!;
    expect(out).toContain("NOT hospital-verified");
    expect(out).not.toContain("reviewed and accepted");
  });

  it("marks an attested digest as doctor-reviewed", () => {
    const out = formatDigestForPrompt(
      makeDigest({ one_liner: "44F, T2DM" }, { reviewed_at: "2026-08-02T10:00:00Z", reviewed_by: "u1" }),
    )!;
    expect(out).toContain("reviewed and accepted by a treating doctor");
    expect(out).not.toContain("NOT hospital-verified");
  });

  it("carries the coverage figure, so the model knows how complete the evidence is", () => {
    const digest = makeDigest({ one_liner: "44F, T2DM" });
    digest.coverage = { ...emptyCoverage, documents_total: 3, pages_total: 40, pages_read: 31, pages_unreadable: 9 };
    expect(formatDigestForPrompt(digest)).toContain("[31/40 scanned pages readable]");
  });

  it("puts allergies before every other list", () => {
    const out = formatDigestForPrompt(makeDigest({
      one_liner: "44F",
      allergies: [{ substance: "Penicillin", reaction: "rash", source_date: null }],
      active_problems: [{ problem: "Hypertension", since: null, note: null }],
      current_medications: [{ name: "Telma", dose: "40mg", frequency: "OD", since: null, certainty: "documented" }],
    }))!;
    expect(out.indexOf("ALLERGIES:")).toBeLessThan(out.indexOf("Active problems:"));
    expect(out.indexOf("ALLERGIES:")).toBeLessThan(out.indexOf("Current medications:"));
  });

  it("flags a medication whose certainty is not documented", () => {
    const out = formatDigestForPrompt(makeDigest({
      one_liner: "x",
      current_medications: [
        { name: "Metformin", dose: "500mg", frequency: "BD", since: null, certainty: "documented" },
        { name: "Glimepiride", dose: "1mg", frequency: "OD", since: null, certainty: "unclear" },
      ],
    }))!;
    expect(out).toContain("Glimepiride 1mg OD [unclear]");
    expect(out).not.toContain("Metformin 500mg BD [documented]");
  });

  it("caps the whole block at the budget", () => {
    const out = formatDigestForPrompt(makeDigest({
      one_liner: "x".repeat(400),
      active_problems: Array.from({ length: 40 }, (_, i) => ({ problem: `Problem ${i} ${"y".repeat(50)}`, since: null, note: null })),
      red_flags: Array.from({ length: 12 }, (_, i) => `Flag ${i} ${"z".repeat(80)}`),
    }))!;
    expect(out.length).toBeLessThanOrEqual(DIGEST_PROMPT_MAX_CHARS);
  });

  it("keeps the provenance prefix intact when the body is trimmed", () => {
    // The cap must never be allowed to eat the warning: a model handed an unlabelled,
    // AI-transcribed medication list will treat it as this hospital's own record.
    const out = formatDigestForPrompt(makeDigest({
      one_liner: "x".repeat(5000),
    }))!;
    expect(out.startsWith("Prior records (AI-extracted")).toBe(true);
    expect(out).toContain("NOT hospital-verified");
    expect(out.length).toBeLessThanOrEqual(DIGEST_PROMPT_MAX_CHARS);
    expect(out).toMatch(/…$/);
  });

  it("honours a caller-supplied budget", () => {
    const out = formatDigestForPrompt(makeDigest({ one_liner: "x".repeat(2000) }), 400)!;
    expect(out.length).toBeLessThanOrEqual(400);
  });

  it("surfaces disagreements between documents", () => {
    const out = formatDigestForPrompt(makeDigest({
      one_liner: "x",
      conflicts: [{
        topic: "Metformin dose",
        versions: [
          { value: "500mg BD", date: "2024-01-01", source: "Apollo Rx" },
          { value: "1000mg BD", date: "2024-06-01", source: "Local clinic Rx" },
        ],
      }],
    }))!;
    expect(out).toContain("Records disagree on: Metformin dose");
  });

  it("includes at most 8 dated timeline events and skips undated ones", () => {
    const digest = makeDigest({ one_liner: "x" });
    digest.timeline = [
      ...Array.from({ length: 12 }, (_, i) =>
        ev({ id: `e${i}`, date: `2024-0${(i % 9) + 1}-01`, title: `Dated ${i}` })),
      ev({ id: "u1", date: null, date_confidence: "unknown", title: "Undated one" }),
    ];
    const out = formatDigestForPrompt(digest, 6000)!;
    expect(out).not.toContain("Undated one");
    expect(out.match(/Dated \d+/g)!.length).toBe(8);
  });
});

// ── sortHistoryTimeline ─────────────────────────────────────────────────────

describe("sortHistoryTimeline", () => {
  it("orders newest first", () => {
    const out = sortHistoryTimeline([
      ev({ id: "old", date: "2019-01-01" }),
      ev({ id: "new", date: "2024-06-01" }),
      ev({ id: "mid", date: "2021-03-15" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["new", "mid", "old"]);
  });

  it("puts undated events last — they cannot be placed, and implying a position would lie", () => {
    const out = sortHistoryTimeline([
      ev({ id: "undated", date: null, date_confidence: "unknown" }),
      ev({ id: "ancient", date: "1999-01-01" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["ancient", "undated"]);
  });

  it("keeps undated events in a stable, deterministic order among themselves", () => {
    const out = sortHistoryTimeline([
      ev({ id: "b", date: null, title: "Bravo" }),
      ev({ id: "a", date: null, title: "Alpha" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("puts a red flag above a non-red-flag event on the same date", () => {
    const out = sortHistoryTimeline([
      ev({ id: "routine", date: "2024-03-11", title: "Routine review" }),
      ev({ id: "flag", date: "2024-03-11", title: "Zebra anaphylaxis", red_flag: true, significance: "low" }),
    ]);
    expect(out[0].id).toBe("flag");
  });

  it("breaks a same-date tie on significance, then title", () => {
    const out = sortHistoryTimeline([
      ev({ id: "low", date: "2024-03-11", significance: "low", title: "A low" }),
      ev({ id: "high", date: "2024-03-11", significance: "high", title: "Z high" }),
      ev({ id: "med", date: "2024-03-11", significance: "medium", title: "M med" }),
    ]);
    expect(out.map((e) => e.id)).toEqual(["high", "med", "low"]);
  });

  it("is deterministic — the same input always renders identically", () => {
    const input = [
      ev({ id: "a", date: "2024-03-11", title: "Alpha" }),
      ev({ id: "b", date: "2024-03-11", title: "Bravo" }),
      ev({ id: "c", date: null, title: "Charlie" }),
      ev({ id: "d", date: "2020-01-01", title: "Delta" }),
    ];
    const first = sortHistoryTimeline(input).map((e) => e.id);
    const second = sortHistoryTimeline([...input].reverse()).map((e) => e.id);
    expect(second).toEqual(first);
  });

  it("does not mutate the input array", () => {
    const input = [ev({ id: "old", date: "2019-01-01" }), ev({ id: "new", date: "2024-01-01" })];
    sortHistoryTimeline(input);
    expect(input.map((e) => e.id)).toEqual(["old", "new"]);
  });

  it("loses no events — every input appears in the output exactly once", () => {
    // The whole coverage promise is that nothing silently disappears. Ordering is the one
    // step that touches every event, so it is the one most able to drop one.
    const input = Array.from({ length: 50 }, (_, i) =>
      ev({ id: `e${i}`, date: i % 7 === 0 ? null : `20${10 + (i % 15)}-0${(i % 9) + 1}-01` }));
    const out = sortHistoryTimeline(input);
    expect(out).toHaveLength(input.length);
    expect(new Set(out.map((e) => e.id)).size).toBe(input.length);
  });
});

// ── digestComorbidities ─────────────────────────────────────────────────────

describe("digestComorbidities", () => {
  it("appends digest problems to the hospital's own chronic conditions", () => {
    const digest = makeDigest({ active_problems: [{ problem: "CKD Stage 3", since: null, note: null }] });
    expect(digestComorbidities(digest, ["Hypertension"])).toEqual(["Hypertension", "CKD Stage 3"]);
  });

  it("deduplicates case-insensitively against what the hospital already recorded", () => {
    const digest = makeDigest({
      active_problems: [
        { problem: "diabetes", since: null, note: null },
        { problem: "CKD", since: null, note: null },
      ],
    });
    expect(digestComorbidities(digest, ["Diabetes"])).toEqual(["Diabetes", "CKD"]);
  });

  it("returns the existing list untouched when there is no digest", () => {
    expect(digestComorbidities(null, ["Asthma"])).toEqual(["Asthma"]);
    expect(digestComorbidities(null)).toEqual([]);
  });
});

// ── estimateTierCost ────────────────────────────────────────────────────────

describe("estimateTierCost", () => {
  it("never quotes below the real figure — always rounds up", () => {
    // 10 pages on fast is ₹0.20; a doctor must not be shown ₹0 and then billed.
    expect(estimateTierCost(10, "fast")).toBe(1);
    expect(estimateTierCost(1, "fast")).toBe(1);
  });

  it("prices Accurate far above Fast, which is what makes the choice meaningful", () => {
    expect(estimateTierCost(300, "accurate")).toBeGreaterThan(estimateTierCost(300, "fast") * 10);
  });

  it("does not inflate a figure that is already a whole rupee", () => {
    // 100 x 0.55 is 55.00000000000001 in IEEE-754, so a bare Math.ceil quotes ₹56 —
    // and does it at round page counts, exactly where someone would notice.
    expect(estimateTierCost(100, "accurate")).toBe(55);
    expect(estimateTierCost(200, "accurate")).toBe(110);
    expect(estimateTierCost(100, "fast")).toBe(2);
  });
});
