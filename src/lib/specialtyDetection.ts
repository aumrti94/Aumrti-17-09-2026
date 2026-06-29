export type SpecialtySheet = 'obstetric' | 'neonatal' | 'anaesthesia' | 'ophthalmology';

export const getSpecialtySheet = (departmentName?: string | null): SpecialtySheet | null => {
  const name = (departmentName || '').toLowerCase();
  
  if (name.includes('obstet') || name.includes('gynae') || name.includes('gynecol') || name.includes('maternity')) {
    return 'obstetric';
  }
  if (name.includes('paediat') || name.includes('pediatr') || name.includes('nicu') || name.includes('neonatal')) {
    return 'neonatal';
  }
  if (name.includes('anaesth') || name.includes('anesthes') || name.includes('ot') || name.includes('operation')) {
    return 'anaesthesia';
  }
  if (name.includes('ophthal') || name.includes('eye')) {
    return 'ophthalmology';
  }
  return null;
};

export const specialtyTabMeta: Record<SpecialtySheet, { icon: string; label: string }> = {
  obstetric: { icon: '🤰', label: 'Obstetric' },
  neonatal: { icon: '👶', label: 'Neonatal' },
  anaesthesia: { icon: '😷', label: 'Anaesthesia' },
  ophthalmology: { icon: '👁', label: 'Ophthalmology' },
};
