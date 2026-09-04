---
name: clinical-compliance
description: Use when implementing or touching a clinical action (consultation, admission, prescription, vitals, discharge) that must satisfy NABH evidence logging, DPDP consent, drug safety checks, NEWS2 scoring, or Indian date formatting. Load before writing the clinical logic, not after.
---

# Clinical compliance implementation

## NABH evidence logging

After every clinical action, call:

```typescript
import { logNABHEvidence } from '@/lib/nabh';
await logNABHEvidence(hospitalId, 'section_code', 'description', entityId);
```

## DPDP consent

Every patient registration path must:
1. Show a DPDP consent checkbox (separate from marketing consent).
2. Block submission if consent is not given.
3. Insert a row into `patient_consents`.

## Drug safety check

Before saving any prescription:

```typescript
import { checkDrugSafety } from '@/lib/drugSafetyCheck';
const result = await checkDrugSafety(drugs, patientAllergies, hospitalId);
if (result.hasContraindication) { /* show alert, block save */ }
```

## NEWS2 score

After every IPD vitals save:

```typescript
import { calculateNEWS2 } from '@/lib/news2';
const score = calculateNEWS2(vitals);
if (score >= 5) { /* create clinical_alert */ }
```

## Indian date format

```typescript
// Always:
new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
// Never: toISOString() displayed to users
```
