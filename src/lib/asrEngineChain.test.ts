import { describe, it, expect } from "vitest";
import {
  buildChain, resolveNoteLanguage, transcriptIsPreTranslated, SARVAM_AUTODETECT,
  sarvamModeFor, transcribeRetryLeg, type AsrLeg,
} from "./asrEngineChain";

const engines = (input: Parameters<typeof buildChain>[0]) => buildChain(input).map(l => l.engine);

describe("buildChain — auto (multilingual)", () => {
  it("leads with Sarvam auto-detect, translating until the language is known", () => {
    const chain = buildChain({ selected: "auto" });
    expect(chain[0]).toEqual({
      engine: "sarvam", langCode: SARVAM_AUTODETECT, preTranslates: true, mode: "translate",
    });
  });

  it("drops the Bhashini leg when no language can be resolved", () => {
    // Bhashini ASR cannot auto-detect, and transcribing against a guessed language produces
    // confident nonsense — worse in a clinical note than an honest failure.
    expect(engines({ selected: "auto" })).toEqual(["sarvam"]);
  });

  it("uses the language Sarvam reported hearing for the Bhashini leg", () => {
    const chain = buildChain({ selected: "auto", detected: "ta-IN" });
    expect(chain.map(l => l.engine)).toEqual(["sarvam", "bhashini"]);
    expect(chain[1].langCode).toBe("ta");
  });

  it("falls back to the hospital default when nothing was detected yet", () => {
    const chain = buildChain({ selected: "auto", hospitalDefault: "bn-IN" });
    expect(chain[1]).toEqual({ engine: "bhashini", langCode: "bn", preTranslates: false });
  });

  it("prefers a live detection over the hospital default", () => {
    const chain = buildChain({ selected: "auto", detected: "ml-IN", hospitalDefault: "hi-IN" });
    expect(chain[1].langCode).toBe("ml");
  });

  it("never routes auto to Web Speech, which cannot report what it heard", () => {
    expect(engines({ selected: "auto", webSpeechSupported: true })).not.toContain("web_speech");
  });
});

describe("buildChain — explicit languages", () => {
  it("gives English three legs, cheapest first", () => {
    expect(engines({ selected: "en-IN", webSpeechSupported: true }))
      .toEqual(["web_speech", "sarvam", "bhashini"]);
  });

  it("skips Web Speech where the browser lacks it", () => {
    expect(engines({ selected: "en-IN", webSpeechSupported: false }))
      .toEqual(["sarvam", "bhashini"]);
  });

  it("gives every Indic language a Sarvam leg and a Bhashini leg", () => {
    for (const code of ["ta-IN", "kn-IN", "ml-IN", "bn-IN", "mr-IN", "gu-IN", "pa-IN", "hi-IN", "te-IN"]) {
      expect(engines({ selected: code }), `${code} must have a fallback`)
        .toEqual(["sarvam", "bhashini"]);
    }
  });

  it("routes the previously-broken codes correctly to both providers", () => {
    // od-IN/brx-IN are the codes that used to be or-IN/bo-IN. Sarvam and Bhashini disagree
    // on both, which is exactly what the per-provider map is for.
    expect(buildChain({ selected: "od-IN" }).map(l => l.langCode)).toEqual(["od-IN", "or"]);
    expect(buildChain({ selected: "brx-IN" }).map(l => l.langCode)).toEqual(["brx-IN", "brx"]);
  });

  it("omits a Sarvam leg for a code Sarvam rejects", () => {
    // The old catalogue values. They must not produce a doomed request.
    expect(engines({ selected: "or-IN" })).not.toContain("sarvam");
    expect(engines({ selected: "bo-IN" })).not.toContain("sarvam");
  });

  it("marks Sarvam as pre-translating for Indic input but not for English", () => {
    expect(buildChain({ selected: "ta-IN" })[0].preTranslates).toBe(true);
    expect(buildChain({ selected: "en-IN" }).find(l => l.engine === "sarvam")!.preTranslates)
      .toBe(false);
  });

  it("transcribes English rather than translating it", () => {
    // The bug this whole change exists for. mode=translate runs a generative
    // speech-translation decoder, which paraphrases English instead of transcribing it —
    // dropping words and substituting near-miss clinical terms ("neck pain" → "headache").
    expect(buildChain({ selected: "en-IN" }).find(l => l.engine === "sarvam")!.mode)
      .toBe("transcribe");
  });

  it("keeps translate mode for every Indic language", () => {
    // Saaras returning English in the same call is a real saving downstream; this path is
    // unchanged and must stay that way.
    for (const code of ["ta-IN", "kn-IN", "ml-IN", "bn-IN", "mr-IN", "hi-IN", "te-IN"]) {
      expect(buildChain({ selected: code })[0].mode, code).toBe("translate");
    }
  });

  it("keeps mode and preTranslates consistent on every Sarvam leg", () => {
    // These two must never disagree: preTranslates drives whether ai-clinical-voice still
    // translates, so a leg claiming one and doing the other produces a half-translated note.
    for (const code of ["auto", "en-IN", "ta-IN", "hi-IN", "od-IN", "brx-IN"]) {
      const leg = buildChain({ selected: code }).find(l => l.engine === "sarvam");
      if (!leg) continue;
      expect(leg.preTranslates, code).toBe(leg.mode === "translate");
    }
  });

  it("never marks Bhashini as pre-translating — it returns native script", () => {
    for (const code of ["ta-IN", "hi-IN", "en-IN", "auto"]) {
      const leg = buildChain({ selected: code, detected: "hi-IN" }).find(l => l.engine === "bhashini");
      if (leg) expect(leg.preTranslates, `${code}`).toBe(false);
    }
  });
});

describe("buildChain — admin engine pin", () => {
  it("moves the pinned engine first without removing the alternatives", () => {
    // A pin is a preference. Dropping the other legs would turn a provider outage into an
    // outage for the whole hospital, which is the failure this chain exists to prevent.
    expect(engines({ selected: "ta-IN", adminEngine: "bhashini" }))
      .toEqual(["bhashini", "sarvam"]);
  });

  it("ignores a pin for an engine this language cannot use", () => {
    expect(engines({ selected: "ta-IN", adminEngine: "web_speech" }))
      .toEqual(["sarvam", "bhashini"]);
  });

  it("ignores an unrecognised pin", () => {
    expect(engines({ selected: "ta-IN", adminEngine: "whisper" }))
      .toEqual(["sarvam", "bhashini"]);
  });
});

describe("resolveNoteLanguage", () => {
  it("passes an explicit language straight through", () => {
    expect(resolveNoteLanguage({ selected: "ta-IN" })).toBe("ta-IN");
  });

  it("never returns the literal 'auto'", () => {
    // "auto" is not a language. It used to reach Sarvam's translate endpoint as a source
    // language, where it was rejected and translation silently degraded.
    for (const input of [
      { selected: "auto" },
      { selected: "auto", detected: null },
      { selected: "auto", detected: "unknown" },
      { selected: "auto", hospitalDefault: "auto" },
    ]) {
      expect(resolveNoteLanguage(input)).not.toBe("auto");
    }
  });

  it("reports what Sarvam actually heard", () => {
    expect(resolveNoteLanguage({ selected: "auto", detected: "bn-IN" })).toBe("bn-IN");
  });

  it("falls back to the hospital default, then to English", () => {
    expect(resolveNoteLanguage({ selected: "auto", hospitalDefault: "kn-IN" })).toBe("kn-IN");
    expect(resolveNoteLanguage({ selected: "auto" })).toBe("en-IN");
  });

  it("ignores a detected value Sarvam would not recognise", () => {
    expect(resolveNoteLanguage({ selected: "auto", detected: "xx-YY", hospitalDefault: "hi-IN" }))
      .toBe("hi-IN");
  });
});

describe("sarvamModeFor — mid-dictation switch under auto", () => {
  const autoLeg = buildChain({ selected: "auto" })[0];

  it("starts on translate, because nothing has been heard yet", () => {
    expect(sarvamModeFor(autoLeg, { selected: "auto", detected: null })).toBe("translate");
  });

  it("switches later segments to transcribe once English is detected", () => {
    // An English dictation left on the default "Auto" setting is the exact case the doctor
    // reported: it never reaches Web Speech (buildChain skips it for auto), so without this
    // every segment goes through the translation decoder.
    expect(sarvamModeFor(autoLeg, { selected: "auto", detected: "en-IN" })).toBe("transcribe");
  });

  it("stays on translate for a detected Indic language", () => {
    expect(sarvamModeFor(autoLeg, { selected: "auto", detected: "te-IN" })).toBe("translate");
  });

  it("never overrides an explicitly chosen language", () => {
    const tamil = buildChain({ selected: "ta-IN" })[0];
    expect(sarvamModeFor(tamil, { selected: "ta-IN", detected: "en-IN" })).toBe("translate");
  });

  it("leaves non-Sarvam legs alone", () => {
    const bhashini = buildChain({ selected: "ta-IN" }).find(l => l.engine === "bhashini")!;
    expect(sarvamModeFor(bhashini, { selected: "auto", detected: "en-IN" })).toBe("translate");
  });
});

describe("transcribeRetryLeg — the low-resource language rescue", () => {
  it("offers a transcribe retry for a translating Sarvam leg", () => {
    // Saaras frequently returns NOTHING when asked to translate a low-resource language.
    // Because the app never retried, those languages read as "voice not detected".
    const retry = transcribeRetryLeg(buildChain({ selected: "sat-IN" })[0]);
    expect(retry).toEqual({
      engine: "sarvam", langCode: "sat-IN", preTranslates: false, mode: "transcribe",
    });
  });

  it("does not retry a leg that already transcribed", () => {
    const english = buildChain({ selected: "en-IN" }).find(l => l.engine === "sarvam")!;
    expect(transcribeRetryLeg(english)).toBeNull();
  });

  it("does not retry a non-Sarvam leg", () => {
    const bhashini = buildChain({ selected: "ta-IN" }).find(l => l.engine === "bhashini")!;
    expect(transcribeRetryLeg(bhashini)).toBeNull();
  });

  it("marks the retry as NOT pre-translated", () => {
    // transcribe mode returns native script. Claiming otherwise makes ai-clinical-voice
    // skip translation and the note comes back in Devanagari.
    expect(transcribeRetryLeg(buildChain({ selected: "hi-IN" })[0])!.preTranslates).toBe(false);
  });
});

describe("transcriptIsPreTranslated", () => {
  const sarvam = { engine: "sarvam" as const, langCode: "ta-IN", preTranslates: true };
  const bhashini = { engine: "bhashini" as const, langCode: "ta", preTranslates: false };

  it("is false when a segment fell back to transcribe mode", () => {
    // The subtle correctness risk in the retry: a dictation part-translated by Saaras and
    // part-transcribed is MIXED, so pre_translated_by must be withheld and the structuring
    // step left to translate the remainder.
    const retried = transcribeRetryLeg(buildChain({ selected: "hi-IN" })[0]) as AsrLeg;
    expect(transcriptIsPreTranslated([sarvam, retried])).toBe(false);
  });

  it("is true only when every segment came from a translating engine", () => {
    expect(transcriptIsPreTranslated([sarvam, sarvam])).toBe(true);
  });

  it("is false for a mixed transcript", () => {
    // One Bhashini segment means part of the text is still in native script. Claiming
    // otherwise makes ai-clinical-voice skip translation and the note comes out half in
    // Devanagari.
    expect(transcriptIsPreTranslated([sarvam, bhashini])).toBe(false);
    expect(transcriptIsPreTranslated([bhashini, sarvam])).toBe(false);
  });

  it("is false when nothing was transcribed", () => {
    expect(transcriptIsPreTranslated([])).toBe(false);
  });
});
