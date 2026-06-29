# Skill: Clinical Compliance Implementation

## NABH Evidence Logging
After every clinical action, call:
```typescript
import { logNABHEvidence } from '@/lib/nabh';
await logNABHEvidence(hospitalId, 'section_code', 'description', entityId);
```

## DPDP Consent
Every patient registration path must:
1. Show DPDP consent checkbox (separate from marketing consent)
2. Block submission if consent not given
3. Insert to patient_consents table

## Drug Safety Check
Before saving any prescription:
```typescript
import { checkDrugSafety } from '@/lib/drugSafetyCheck';
const result = await checkDrugSafety(drugs, patientAllergies, hospitalId);
if (result.hasContraindication) { /* show alert, block save */ }
```

## NEWS2 Score
After every IPD vitals save:
```typescript
import { calculateNEWS2 } from '@/lib/news2';
const score = calculateNEWS2(vitals);
if (score >= 5) { /* create clinical_alert */ }
```

## Indian Date Format
```typescript
// Always:
new Date(date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
// Never: toISOString() displayed to users
```
