import { describe, it, expect } from "vitest";
import { getCommitteeTemplate, ALL_TEMPLATES, GENERIC } from "./committeeTemplates";

describe("getCommitteeTemplate", () => {
  it("matches a committee name case-insensitively against a template's patterns", () => {
    expect(getCommitteeTemplate("Infection Control Committee").id).toBe("ipc");
    expect(getCommitteeTemplate("INFECTION PREVENTION").id).toBe("ipc");
  });

  it("matches on a substring anywhere in the name, not just an exact match", () => {
    expect(getCommitteeTemplate("Hospital Blood Bank & Transfusion Safety Committee").id).toBe("blood_transfusion");
  });

  it("falls back to the generic template when nothing matches", () => {
    expect(getCommitteeTemplate("Canteen Committee")).toBe(GENERIC);
  });

  it("resolves a name matching multiple templates' patterns to the first one in ALL_TEMPLATES order", () => {
    // "quality" is QUALITY_SAFETY's pattern but IPC's chapters/focus overlap in practice;
    // verify the documented precedence directly: broad templates are ordered last so a
    // name like "IPC & Quality Committee" should resolve to IPC, not the broad Quality one.
    expect(getCommitteeTemplate("IPC & Quality Committee").id).toBe("ipc");
  });

  it("resolves the broad 'quality' pattern only when no more specific template matches first", () => {
    expect(getCommitteeTemplate("Patient Safety Committee").id).toBe("quality_safety");
  });

  it("every template's minutesHtml embeds the shared action table and footer exactly once", () => {
    for (const t of ALL_TEMPLATES) {
      expect(t.minutesHtml.match(/Action Items Arising from This Meeting/g)).toHaveLength(1);
      expect(t.minutesHtml.match(/Minutes prepared by/g)).toHaveLength(1);
    }
  });

  it("every template declares at least one NABH chapter and a non-empty id/name", () => {
    for (const t of [...ALL_TEMPLATES, GENERIC]) {
      expect(t.id.length).toBeGreaterThan(0);
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.nabh_chapters.length).toBeGreaterThan(0);
    }
  });

  it("GENERIC has no match patterns, since it is only reached as the fallback", () => {
    expect(GENERIC.matchPatterns).toEqual([]);
  });
});
