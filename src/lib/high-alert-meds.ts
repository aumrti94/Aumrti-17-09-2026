// High-alert medication detection utilities (F9: MOM.8.a NABH compliance)

export const HIGH_ALERT_KEYWORDS = [
  "insulin", "heparin", "warfarin", "enoxaparin", "clexane", "fondaparinux",
  "potassium chloride", "kcl", "concentrated electrolyte", "sodium chloride hypertonic",
  "morphine", "fentanyl", "tramadol", "buprenorphine", "oxycodone", "pethidine",
  "methadone", "hydromorphone", "naloxone",
  "vecuronium", "succinylcholine", "suxamethonium", "rocuronium", "atracurium",
  "methotrexate", "cyclophosphamide", "vincristine", "cisplatin", "carboplatin",
  "digoxin", "amiodarone", "adenosine", "adrenaline", "epinephrine", "noradrenaline",
  "dopamine", "dobutamine", "vasopressin",
  "lithium", "magnesium sulfate", "magnesium sulphate", "oxytocin", "ergometrine",
  "thrombolytics", "alteplase", "streptokinase",
  "hypertonic saline", "dextrose 50%", "concentrated dextrose",
  "neuromuscular block", "paralytics",
];

export const ANTIBIOTIC_KEYWORDS = [
  "amoxicillin", "amoxyclav", "augmentin", "ampicillin", "piperacillin", "tazobactam",
  "cefazolin", "cephalexin", "cefalexin", "cefixime", "cefuroxime", "ceftriaxone",
  "cefotaxime", "ceftazidime", "cefepime", "meropenem", "imipenem", "ertapenem",
  "doripenem", "azithromycin", "clarithromycin", "erythromycin", "metronidazole",
  "tinidazole", "ciprofloxacin", "levofloxacin", "ofloxacin", "norfloxacin",
  "vancomycin", "teicoplanin", "linezolid", "daptomycin", "gentamicin", "amikacin",
  "tobramycin", "doxycycline", "tetracycline", "clindamycin", "cotrimoxazole",
  "sulfamethoxazole", "trimethoprim", "nitrofurantoin", "fosfomycin", "colistin",
  "polymyxin", "rifampicin", "ethambutol", "isoniazid", "pyrazinamide",
  "streptomycin", "antibiotic", "antimicrobial",
];

export function isHighAlert(drugName: string, drugMasterFlag?: boolean): boolean {
  if (drugMasterFlag === true) return true;
  const lower = drugName.toLowerCase();
  return HIGH_ALERT_KEYWORDS.some(k => lower.includes(k));
}

export function isAntibioticByName(drugName: string): boolean {
  const lower = drugName.toLowerCase();
  return ANTIBIOTIC_KEYWORDS.some(k => lower.includes(k));
}
