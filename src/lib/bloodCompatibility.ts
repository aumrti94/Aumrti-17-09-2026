// ABO + Rh compatibility matrix for RBC transfusion
// PATIENT SAFETY CRITICAL: This logic must NEVER allow incompatible transfusion

type BloodGroup = 'A' | 'B' | 'AB' | 'O';
type RhFactor = 'positive' | 'negative';

const RBC_COMPATIBILITY: Record<BloodGroup, BloodGroup[]> = {
  'O':  ['O'],
  'A':  ['A', 'O'],
  'B':  ['B', 'O'],
  'AB': ['A', 'B', 'AB', 'O'],
};

export function isABOCompatible(patientGroup: BloodGroup, unitGroup: BloodGroup): boolean {
  return RBC_COMPATIBILITY[patientGroup]?.includes(unitGroup) ?? false;
}

export function isRhCompatible(patientRh: RhFactor, unitRh: RhFactor): boolean {
  if (patientRh === 'positive') return true; // Rh+ can receive both
  return unitRh === 'negative'; // Rh- can only receive Rh-
}

export function isFullyCompatible(
  patientGroup: BloodGroup, patientRh: RhFactor,
  unitGroup: BloodGroup, unitRh: RhFactor
): { compatible: boolean; aboOk: boolean; rhOk: boolean } {
  const aboOk = isABOCompatible(patientGroup, unitGroup);
  const rhOk = isRhCompatible(patientRh, unitRh);
  return { compatible: aboOk && rhOk, aboOk, rhOk };
}

export function formatBloodGroup(group: string, rh: string): string {
  return `${group}${rh === 'positive' ? '+' : '-'}`;
}

export function componentLabel(c: string): string {
  const map: Record<string, string> = {
    whole_blood: 'Whole Blood',
    rbc: 'RBC',
    ffp: 'FFP',
    platelets: 'Platelets',
    cryoprecipitate: 'Cryoprecipitate',
  };
  return map[c] || c;
}
