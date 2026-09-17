# Clinical compliance — detail

## NABH criterion codes in use

Chapter prefixes, with the codes this codebase already logs against:

| Prefix | Chapter | Codes seen in the repo |
|---|---|---|
| `AAC` | Access, Assessment and Continuity of Care | AAC.3, AAC.4, AAC.11, AAC.12 |
| `COP` | Care of Patients | COP.1–COP.6, COP.8, COP.10 |
| `MOM` | Management of Medication | MOM.3, MOM.4 |
| `HIC` | Hospital Infection Control | HIC.2, HIC.8 |
| `QPS` | Quality and Patient Safety | QPS.2–QPS.5 |
| `TMS` | Transfusion Medicine Services | TMS.3 |
| `ROM` | Responsibilities of Management | ROM.3 |

Before inventing a code, grep for the chapter prefix — an existing call site in the same clinical
area is usually already logging against the right criterion, and consistency matters more to an
auditor than precision at the sub-code level.

`mapTextToNABHCriterion` in `@/lib/nabh-evidence` will suggest a code and status from free text via
AI when you genuinely don't know. It returns `null` when AI is unavailable, so it is a convenience
for the evidence-entry UI, not something to depend on in a code path.

Evidence text should read as evidence: what happened, to what, by whom, with the identifier an
auditor would use to pull the record. `"Daily ambulance equipment check completed for vehicle. All
OK: true"` is the house register. Never put a patient name in it — the row is scoped to a patient
already, and the evidence log is exportable.

## Alert severity ladder

`clinical_alerts` severities, and what each implies for presentation:

- **critical** — interrupts. Modal or persistent banner, colour-coded red, cannot be dismissed
  without an action. Sepsis, NEWS2 critical, contraindicated drug pair, incompatible crossmatch.
- **high** — persistent banner, must be acknowledged, does not block.
- **medium** — inline badge on the relevant record.
- **low** — surfaced in the record, not pushed.

Rules that hold at every level: alerts surface immediately, they are never batched into a digest,
and no user preference silences a critical one. Acknowledgement is recorded with the acknowledging
staff member (`public.users.id`) and a timestamp — "who saw this and when" is the question an
incident review asks first.

Deduplicate within a clinical window rather than re-firing per event. Check the guard's table name
resolves: the sepsis 4-hour dedup guard once read a table that did not exist, so it suppressed
nothing and duplicate critical alerts fired on every vitals entry.

## NEWS2

`calculateNEWS2(v: Partial<VitalsInput>)` scores respiratory rate, SpO₂, supplemental oxygen,
temperature, systolic BP, pulse, and consciousness level.

Because it takes a partial, absent observations contribute 0. Two of seven parameters can therefore
yield a comfortable-looking score that means nothing. Show the observation count alongside a partial
score, and don't drive a suppression decision from one.

Thresholds via `getNEWS2Level`: `low` → routine; `medium` → increase observation frequency;
`high` → urgent clinical review; `critical` → emergency response. Use `getNEWS2BadgeClasses` and
`getNEWS2Label` for display so the same score never renders differently in two modules.

Run on every IPD and Emergency vitals save. `SepsisWarningBanner` is the existing surfacing
component for deterioration in IPD.

## High-alert and controlled medications

```typescript
import { isHighAlert, isAntibioticByName } from "@/lib/high-alert-meds";

if (isHighAlert(drug.drug_name, drugMaster?.is_high_alert)) {
  // independent double-check before administration
}
```

`isHighAlert` matches on `HIGH_ALERT_KEYWORDS` and also honours an explicit drug-master flag — pass
both when you have them, since the master flag is the authoritative one and the keyword list is the
fallback for free-text entries.

High-alert drugs (insulin, heparin, concentrated electrolytes, chemotherapy, opioids) require an
independent second-person check recorded at administration, not just at prescription.

`isAntibioticByName` feeds antimicrobial stewardship — antibiotic prescriptions carry an indication
and a review date. See `@/lib/ipcBundles` for the infection-control bundle checks.

NDPS-schedule drugs additionally need a register entry, prescriber verification, and balance
reconciliation. Those are statutory, not internal policy — treat a gap there as a blocker.

## Consent

`patient_consents` rows carry `hospital_id`, `patient_id`, the consent type, and optionally
`admission_id` and `template_id`. Consent is:

- **Per purpose** — treatment, DPDP data processing, marketing communication, ABDM linkage, and
  research are separate rows. A single "I agree" covering several purposes is not valid consent.
- **Withdrawable** — a withdrawal path ships with the feature.
- **Evidenced** — capture via `ConsentSignatureModal`, which also writes NABH evidence.

Procedure and surgical consent additionally record the specific procedure, the named risks
discussed, and the consenting party when it is not the patient (guardian, next of kin) with the
relationship recorded.

## PHI in logs

```typescript
import { sanitizeForLog } from "../_shared/phi-redactor.ts";   // Edge Functions
console.log("upsert result", sanitizeForLog(JSON.stringify(payload)));
```

The redactor strips Indian mobile numbers, Aadhaar-shaped digits, emails, encrypted PHI blobs
(`v{n}:{base64}`), HMAC hash columns, and the common JSON PHI keys (`patient_name`, `mobile`,
`address`, `aadhaar`, and the `_enc` variants).

Apply it at persistence and logging boundaries **only**. Do not apply it to an AI request payload —
clinical accuracy requires full context there, and the AI path has its own governance in
`_shared/safety-guard.ts` and `_shared/ai-config.ts`.

23 of 109 Edge Functions import it — the patient-data ones. Add it whenever you introduce a
`console.*` that could carry patient data to a function that lacks it.

## Checklist

- [ ] `checkDrugSafety` called per drug added; gated on `hasIssues`, severity read from `worstSeverity`
- [ ] `logNABHEvidence(hospitalId, criterion, evidenceText, status?)` — correct module, correct 4th arg
- [ ] DPDP consent separate from marketing consent; blocks submission; row written; withdrawal path exists
- [ ] NEWS2 recalculated on every vitals save; non-low levels raise an alert
- [ ] Alerts immediate, deduplicated against a table that exists, acknowledgement attributed
- [ ] No PHI in logs, errors, or evidence text
- [ ] Indian English; dates via `formatDateIST`; money via `formatCurrency`
- [ ] `npm run lint && npm run check:db-contract`