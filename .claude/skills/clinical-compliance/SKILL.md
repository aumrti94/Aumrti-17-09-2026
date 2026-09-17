---
name: clinical-compliance
description: Use when implementing or touching a clinical action — consultation, prescription, admission, vitals, procedure, discharge, consent — that must satisfy NABH evidence logging, DPDP consent, drug interaction and allergy checking, NEWS2 deterioration scoring, or clinical alerting. Load before writing the clinical logic, not after.
---

# Clinical compliance

These are patient-safety and accreditation surfaces. Every signature below was verified against the
source; call them exactly as written.

## Drug safety — check before the drug enters the prescription

```typescript
import { checkDrugSafety, type DrugSafetyResult } from "@/lib/drugSafetyCheck";

const result = await checkDrugSafety(
  drug.drug_name,        // the ONE drug being added
  currentDrugNames,      // string[] — drugs already on this prescription
  patientAllergies,      // string[]
  hospitalId ?? "",
);

if (result.hasIssues) {
  setSafetyResult(result);
  setShowSafetyModal(true);   // doctor reviews and confirms
} else {
  addDrugDirect(drug);
}
```

`DrugSafetyResult` is `{ hasIssues, interactions, allergyConflicts, duplicates, worstSeverity }`.

**There is no `hasContraindication` field.** Gating on one silently reads `undefined`, so the
check never fires and every prescription saves unblocked. Gate on `hasIssues`, and read
`worstSeverity` (`"contraindicated" | "major" | "moderate" | "minor" | "none"`) to decide how hard
to push back — `contraindicated` warrants a blocking confirmation, `minor` an inline note.

This is a **per-drug** check run as each drug is added, not one batch check before save. It covers
three things at once: pairwise interactions, allergy conflicts (direct and cross-reactivity), and
therapeutic duplicates. Brand names are resolved to generics first, so matching works on aliases
rather than the typed string.

Never mock or skip this, including in demos and seed flows. If the formulary lookup fails the
helper degrades to the typed name rather than throwing — that fallback is deliberate, because a
lookup failure must never block prescribing. Do not extend that leniency to skipping the call.

Controlled substances have extra NDPS requirements — see `@/lib/high-alert-meds`.

## NABH evidence

```typescript
import { logNABHEvidence } from "@/lib/nabh-evidence";

await logNABHEvidence(
  hospitalId,
  "COP.3",                                   // NABH criterion number
  `Daily ambulance equipment check completed. All OK: ${allOk}`,
  "compliant",                               // optional: ComplianceStatus, defaults "compliant"
);
```

The module is `@/lib/nabh-evidence`, not `@/lib/nabh`.

The fourth parameter is a `ComplianceStatus` — `"compliant" | "partially_compliant" |
"non_compliant"` (`"partial"` is accepted and normalised). It is **not** an entity id; passing a
uuid there writes a garbage status into the accreditation trail.

It returns `{ ok, error }` and never throws, precisely so a module side-effect cannot fail because
accreditation logging failed. Don't wrap it in a try/catch that swallows the result, and don't
`await` it in a hot path where it would delay a clinical action — the pattern at several call sites
is to fire it without awaiting.

Log evidence on the clinical action itself: result verification, OT close, CSSD cycle, consent
capture, equipment check, discharge. Not on navigation or on read.

## DPDP consent

Every patient registration path must:

1. Show a DPDP processing-consent checkbox, **separate** from any marketing-communication consent.
   Bundling the two invalidates both.
2. Block submission when it is not given.
3. Insert a row into `patient_consents` (`hospital_id`, `patient_id`, consent type, timestamp).

Consent is per purpose and it is withdrawable — a withdrawal path is part of the feature, not a
follow-up. `ConsentSignatureModal` is the existing capture surface; reuse it rather than building a
second one.

## NEWS2 deterioration scoring

```typescript
import { calculateNEWS2, getNEWS2Level, getNEWS2Label, getNEWS2BadgeClasses } from "@/lib/news2";

const score = calculateNEWS2(vitals);        // accepts Partial<VitalsInput>
const level = getNEWS2Level(score);          // "low" | "medium" | "high" | "critical"
```

Run it on every IPD and Emergency vitals save. When `level` is not `"low"`, raise a clinical alert
and surface it in the UI — `getNEWS2BadgeClasses` and `getNEWS2Label` give the shared colour and
wording so the same score never looks different in two places.

`calculateNEWS2` takes a partial: missing observations score 0 rather than throwing. A score built
from two of seven parameters is not reassuring, so show which observations are missing alongside a
partial score.

## Clinical alerts

Alerts go to `clinical_alerts` and surface **immediately**. They are never batched into a digest,
never delayed to a polling interval, and never silenced by a preference toggle.

Deduplicate deliberately — a repeat of the same alert for the same patient within its window should
suppress rather than re-fire. Write the dedup guard against a table that actually exists: the sepsis
guard once read a non-existent table, so it suppressed nothing and duplicate critical alerts fired
on every vitals entry. `npm run check:db-contract` is what catches that class now.

## PHI handling

No PHI in Supabase logs, in an Edge Function `console.log`, or in an error message shown to a user
or written to an audit row. Redaction at the logging boundary is `sanitizeForLog` from
`supabase/functions/_shared/phi-redactor.ts` — apply it to anything that may reach a log, never to
the AI request payload itself, where clinical accuracy needs full context.

Any table holding clinical data needs an audit trigger — see
[supabase-migration](../supabase-migration/SKILL.md).

## Locale

Indian English spelling everywhere, UI strings and identifiers alike: Anaesthesia, Gynaecology,
Paediatrics, Orthopaedics, immunisation, finalised.

Dates via `formatDateIST` / `formatDateTimeIST` from `@/lib/dateUtils` — `DD/MM/YYYY`, `en-IN`.
Never show an ISO timestamp. Money via `formatCurrency` from `@/lib/currency`.

## Before you call it done

```bash
npm run lint
npm run check:db-contract
```

Criterion-code reference, alert severity ladder, and the high-alert/NDPS medication rules:
[references/patterns.md](references/patterns.md).