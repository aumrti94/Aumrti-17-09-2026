import { describe, it, expect } from "vitest";
import { extractCompleteFields } from "./voiceScribeStream";

describe("extractCompleteFields", () => {
  it("returns only fields whose value has FINISHED streaming", () => {
    // "examination_findings" is still being written — showing it now would flicker a
    // half-sentence into a clinical field.
    const partial = '{"chief_complaint": "fever for 15 days", "examination_findings": "chest cle';
    expect(extractCompleteFields(partial)).toEqual({ chief_complaint: "fever for 15 days" });
  });

  it("picks up each field as it completes", () => {
    const a = '{"chief_complaint": "fever"';
    const b = '{"chief_complaint": "fever", "history_of_present_illness": "3 days"';
    expect(Object.keys(extractCompleteFields(a))).toEqual(["chief_complaint"]);
    expect(Object.keys(extractCompleteFields(b))).toEqual(["chief_complaint", "history_of_present_illness"]);
  });

  it("decodes escapes rather than leaking raw JSON", () => {
    const partial = '{"plan": "\\u2022 Rest\\n\\u2022 Fluids"';
    expect(extractCompleteFields(partial).plan).toBe("• Rest\n• Fluids");
  });

  it("does not mistake an escaped quote for the end of a value", () => {
    const partial = '{"diagnosis": "so-called \\"viral\\" fever", "plan": "rest"';
    const f = extractCompleteFields(partial);
    expect(f.diagnosis).toBe('so-called "viral" fever');
    expect(f.plan).toBe("rest");
  });

  it("handles an empty or not-yet-started stream", () => {
    expect(extractCompleteFields("")).toEqual({});
    expect(extractCompleteFields("{")).toEqual({});
    expect(extractCompleteFields('{"chief_com')).toEqual({});
  });

  it("reads a complete document unchanged", () => {
    const full = '{"chief_complaint": "fever", "diagnosis": "", "follow_up": "review in 5 days"}';
    expect(extractCompleteFields(full)).toEqual({
      chief_complaint: "fever", diagnosis: "", follow_up: "review in 5 days",
    });
  });

  it("ignores non-string values, which are not progressive-fill targets", () => {
    const partial = '{"chief_complaint": "fever", "confidence": 0.9, "investigations": ["CBC"]';
    const f = extractCompleteFields(partial);
    expect(f.chief_complaint).toBe("fever");
    expect(f.confidence).toBeUndefined();
  });

  it("surfaces the new systemic_examination field", () => {
    const partial = '{"examination_findings": "afebrile", "systemic_examination": "CVS: S1 S2 heard"';
    expect(extractCompleteFields(partial)).toEqual({
      examination_findings: "afebrile",
      systemic_examination: "CVS: S1 S2 heard",
    });
  });
});
