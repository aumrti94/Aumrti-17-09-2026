---
name: ai-feature
description: Use when building or modifying an AI-powered feature — voice scribe, clinical note generation, discharge summaries, ICD suggestion, radiology impressions, document OCR, differential diagnosis, executive digests, or any new call to an LLM. Covers the callAI choke point, entitlement and budget gating, why safety-class AI is never budget-capped, clinician-confirmation rules, and the AI audit trail.
---

# AI features

AI here is governed: entitlement-gated, budget-metered, safety-screened, and audited. Never call a
model provider directly — every path goes through the choke point.

## The choke point

```typescript
import { callAI } from "@/lib/aiProvider";

const res = await callAI({
  featureKey: "discharge_summary",   // must exist in AI_FEATURE_DEFS
  prompt,
  hospitalId,
  systemPrompt,
  patientId,                          // for audit linkage
  encounterId,
  maxTokens: 1000,
});

if (res.error) { /* degrade the feature — do not surface a raw provider error */ }
```

`callAI` enforces the hospital's AI entitlement *before* anything else, resolves the provider and
model, and routes through the `ai-proxy` Edge Function. It returns
`{ text, provider, model, tokens_used?, error? }` and **does not throw** — check `error`.

Two things follow from how it resolves config:

- **AI configuration is global and platform-controlled**, not per hospital. It reads
  `platform_ai_provider_config` for the feature key, falls back to `global_default`, and if neither
  exists lets `ai-proxy` pick a platform default server-side. Never guess a provider client-side and
  never leak which platform env keys exist to the browser.
- **A disabled feature returns `provider: "disabled"` with an error string**, not an exception.
  That is normal control flow — degrade the UI, don't treat it as a fault.

## Registering a feature

A new AI feature needs an entry in `AI_FEATURE_DEFS` in
[aiFeatures.ts](../../../src/lib/aiFeatures.ts) with `key`, `label`, and `description`. The key is
the single identifier used by `callAI`, the entitlement gate, the UI hook, and the audit row — they
must all match, or the feature is invisible to gating and billing.

## Gating the UI

```typescript
import { useAIFeature } from "@/hooks/useAIFeature";

if (!useAIFeature("voice_scribe")) return null;   // hide the button
```

`useAIFeature` is the **UI** gate: it hides AI controls when the `ai_suite` master module is off for
the hospital or the specific feature is withheld. It returns `true` optimistically while entitlement
loads, so AI UI doesn't flash off on every render.

`callAI` enforces the same rule for **functionality**. Both are required — the hook alone is
cosmetic, and the choke point alone leaves dead buttons on screen. `featureKey` must be identical in
the two places.

## Budget — and the safety-class exemption

```typescript
import { resolveAiBudgetStatus, APPROACHING_THRESHOLD } from "@/lib/aiBudget";
import { isSafetyAiFeature, SAFETY_AI_FEATURE_KEYS } from "@/lib/aiFeatures";
```

AI spend is metered per hospital against a plan budget. `resolveAiBudgetStatus` returns
`{ budgeted, usedInr, safetyInr, budgetInr, pctUsed, state, overageInr }` with state
`"ok" | "approaching" | "over"`, nudging from 80% (`APPROACHING_THRESHOLD`).

**Safety-class AI is never counted against the budget and never gated on wallet balance.**

```
drug_interaction_analysis · adr_detector · sepsis_early_warning · critical_incidental_finder
```

The reasoning, from the source: a cost cap that could throttle these would be *a patient-safety
mechanism wearing a billing costume*. Their spend is reported separately as `safetyInr` for
transparency, never deducted.

That list is **mirrored in three places** — `SAFETY_AI_FEATURE_KEYS`, the
`hospital_ai_budget_status` view (migration `20261009000175`), and the AI wallet draw-down guard.
Change all three together or a safety feature starts being billed.

A plan with no budget (`null`, or a nonsensical `<= 0`) is **not metered** — show usage, never a
cap. Treating 0 as "nothing allowed" would put every legacy hospital permanently over budget.

## AI output is a suggestion, never an order

Non-negotiable across every clinical AI feature:

- A clinician reviews and confirms before anything is persisted or acted on. Nothing auto-applies —
  not a prescription, not a diagnosis, not an ICD code, not a discharge summary.
- The AI-generated state is visually distinct from the confirmed state, and the clinician can edit
  before accepting.
- **Drug safety is never delegated to the model.** `checkDrugSafety` still runs on the resulting
  prescription — see [clinical-compliance](../clinical-compliance/SKILL.md).
- Server-side, `evaluateSafety(aiOutput, patientContext)` in `_shared/safety-guard.ts` screens
  clinical output against controlled drugs, cross-reactive allergy families, and dose limits,
  returning `SafetyFlag[]` at `critical | warning | info`. Persist flags with `logSafetyFlags`.

## Audit every acceptance and override

```typescript
import { useAIAudit } from "@/hooks/useAIAudit";

const { logAudit } = useAIAudit();
await logAudit({ hospitalId, patientId, featureKey, aiOutput, confidence, reasoning },
               "accepted");        // "accepted" | "overridden" | "rejected" | "flagged"
```

Writes to `ai_suggestions_audit` with the user's action and any override value. Log **every**
outcome, not just acceptances — the override and rejection rates are how model quality gets
measured, and "the AI suggested X and the doctor changed it to Y" is the record a clinical review
asks for.

## PHI and AI

Send full clinical context to the model — accuracy requires it, and this is the deliberate exception
to PHI minimisation. **Redact what you log**, never the request payload itself:

```typescript
import { sanitizeForLog } from "../_shared/phi-redactor.ts";
```

Patient consent for AI-assisted processing belongs in the DPDP consent set. Regional/data-residency
constraints are why `azure_openai` is labelled "Azure (India Central)" — provider choice is a
compliance decision, made at the platform level, not per feature.

## Before you call it done

```bash
npm run lint
npm run check:db-contract
```

Voice/ASR chain, streaming, attachments and vision, provider/model config, and the Edge Function
side: [references/patterns.md](references/patterns.md).
