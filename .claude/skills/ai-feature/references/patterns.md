# AI patterns — detail

## Voice scribe and ASR

The ASR path is a **fallback chain**, not a single engine:

```typescript
import { transcribeRetryLeg, type AsrEngine, SARVAM_AUTODETECT, AUTO } from "@/lib/asrEngineChain";
// AsrEngine = "web_speech" | "sarvam" | "bhashini"
```

`web_speech` is free and browser-local; `sarvam` and `bhashini` are metered Indian-language ASR
services with their own Edge Functions (`sarvam-transcribe`, `bhashini-transcribe`,
`bhashini-patient-transcribe`). `transcribeRetryLeg` produces the next leg when one fails — a leg
returning nothing is expected, not exceptional, and the chain exists because a nurse station's
network and accent mix defeats any single engine.

Sarvam supports `"transcribe"` and `"translate"` modes. `SARVAM_AUTODETECT` (`"unknown"`) and `AUTO`
are the language-autodetect sentinels — pass them rather than guessing a language code.

**Metering.** ASR is billed by audio duration, not tokens:

```typescript
import { recordAsrUsage, estimateAudioSeconds, ASR_FEATURE_KEY } from "../_shared/asr-metering.ts";
```

`ASR_FEATURE_KEY` is `"voice_asr_engine"` — the same key gates entitlement and meters spend.
`resolveHospitalFromJwt` is how an ASR function derives the tenant, since audio uploads carry no
hospital in the body worth trusting.

**Transcript assembly.** Streamed chunks overlap:

```typescript
import { mergeTranscriptChunk, joinTranscriptChunks, collapseRepetitionLoops } from "@/lib/transcriptMerge";
```

`mergeTranscriptChunk` de-overlaps consecutive chunks (4 words by default);
`collapseRepetitionLoops` handles the stutter loops ASR engines fall into. Never concatenate raw
chunks — the duplicated phrases end up in a clinical note.

**Medical terms.** `@/lib/medicalLexicon` provides `phoneticNormalize`, `phoneticKey`,
`levenshtein`, and `similarityRatio` for recovering drug and condition names the engine mangled.
`voice_scribe_rescue` is a distinct AI feature that re-hears only low-confidence segments with a
multimodal model — it has its own feature key and its own entitlement.

**Confidence.** `@/lib/scribeConfidence` scores per section (`SCRIBE_SECTIONS`), returning
`ScribeConfidence` with per-section detail. Surface low-confidence sections visually so the
clinician's attention lands where the machine was unsure. A uniformly-styled note hides exactly the
parts most likely to be wrong.

## Streaming

```typescript
import { structureWithStreaming, extractCompleteFields } from "@/lib/voiceScribeStream";
```

`extractCompleteFields` pulls the fields that have finished from a partial response, so the UI fills
in progressively instead of blocking on the whole generation. Render partial output as visibly
provisional — a half-formed clinical note that looks final is worse than a spinner.

## Attachments and vision

```typescript
const res = await callAI({
  featureKey: "document_ocr",
  prompt: "Extract the lab values from this report",
  hospitalId,
  attachments: [{ kind: "image", mediaType: "image/png", data: base64 }],
});
```

`kind` is `"image" | "pdf"`; `data` is base64 **without** the `data:...;base64,` prefix — including
it is the usual bug. `pdf-split.ts` in `_shared` handles multi-page documents.

Vision features that read patient documents are still PHI paths: the image goes to the model, the
log does not.

## Provider and model configuration

`PROVIDER_MODELS` lists known models per provider; `getCustomModels` / `saveCustomModels` /
`getMergedModels` let the platform admin add models without a deploy. `PROVIDER_TO_SERVICE_KEY` maps
a provider to its credential entry.

Providers: `claude`, `openai`, `azure_openai` (labelled "Azure (India Central)" — data residency is
the reason), `gemini`, `perplexity`, `openrouter`, `ollama` (local).

Config lives in `platform_ai_provider_config`, keyed by `feature_key`, with `global_default` as the
fallback row. It is **platform-level, not per hospital** — a hospital chooses whether AI is on, not
which model runs.

## The Edge Function side

`ai-proxy` is the single egress. Per-feature functions (`ai-clinical-voice`, `ai-discharge-summary`,
`ai-icd-suggest`, `ai-differential-diagnosis`, `ai-radiology-impression`, `ai-safety-guard`,
`ai-nabh-assistant`, `ai-revenue-leak-detector`, …) route through it rather than holding provider
keys themselves.

```typescript
import { AIDisabledError, normalizeProviderKey, azureMaxOutputTokens,
         buildAzureUrl, azureHeaders, resolveAzureSurface } from "../_shared/ai-config.ts";
```

`AIDisabledError` is expected control flow when AI is off for a hospital — catch it and degrade,
never let it surface as a 500. Azure needs `resolveAzureSurface` (`openai | anthropic |
foundry_models`) plus `buildAzureUrl` / `azureHeaders`; `azureMaxOutputTokens` clamps a requested
token count to what the surface allows.

Provider API keys are `Deno.env` secrets, server-side only. A key reaching the browser is an
incident, which is why `callAI` refuses to guess a provider when no config row exists.

## Failure behaviour

AI is an assistive layer. Every AI feature degrades to the manual workflow:

- Provider down, budget exceeded, entitlement off, model returns nonsense → the clinician does what
  they did before, with no blocked screen.
- Never block a clinical action on an AI response.
- Never retry silently in a way that multiplies spend.
- Surface a plain sentence, never a raw provider error.

Safety-class features are the sharpest case: they are exempt from budget precisely so they cannot be
throttled, but they are still assistive. `checkDrugSafety` — deterministic, non-AI — remains the
real gate.

## Checklist

- [ ] Feature registered in `AI_FEATURE_DEFS`; same `featureKey` in `callAI`, `useAIFeature`, and the audit row
- [ ] Called via `callAI` — no direct provider call, no client-side key
- [ ] UI gated with `useAIFeature`; `res.error` handled as degradation
- [ ] Safety-class feature? Confirm it is excluded from budget in all three mirrored places
- [ ] Output presented as a suggestion, visually distinct, clinician-editable, never auto-applied
- [ ] `checkDrugSafety` still runs on any AI-suggested prescription
- [ ] `logAudit` on accepted / overridden / rejected / flagged — all four
- [ ] Full context to the model, `sanitizeForLog` on anything logged
- [ ] Degrades to the manual workflow on every failure path
