/**
 * WHO Surgical Safety Checklist items. Lifted out of WHOChecklistTab.tsx so that
 * file exports only its component — a file mixing component and non-component
 * exports silently disables Fast Refresh for it.
 */
export const SIGNIN_ITEMS: { key: string; label: string }[] = [
  { key: "signin_patient_identity", label: "Patient identity confirmed" },
  { key: "signin_site_marked", label: "Surgical site marked" },
  { key: "signin_consent_signed", label: "Patient consent signed" },
  { key: "signin_anaesthesia_checked", label: "Anaesthesia machine checked" },
  { key: "signin_pulse_oximeter", label: "Pulse oximeter working" },
  { key: "signin_allergies_known", label: "Known allergies confirmed" },
  { key: "signin_difficult_airway", label: "Difficult airway risk assessed" },
  { key: "signin_blood_loss_risk", label: "Blood loss risk assessed" },
];

export const TIMEOUT_ITEMS: { key: string; label: string }[] = [
  { key: "timeout_team_introduced", label: "Team introductions done" },
  { key: "timeout_patient_confirmed", label: "Patient identity re-confirmed" },
  { key: "timeout_procedure_confirmed", label: "Procedure confirmed" },
  { key: "timeout_site_confirmed", label: "Surgical site re-confirmed" },
  { key: "timeout_imaging_displayed", label: "Imaging displayed" },
  { key: "timeout_antibiotics_given", label: "Prophylactic antibiotics given" },
  { key: "timeout_anticoagulation", label: "Anticoagulation considered" },
  { key: "timeout_equipment_issues", label: "Equipment concerns addressed" },
];

export const SIGNOUT_ITEMS: { key: string; label: string }[] = [
  { key: "signout_procedure_recorded", label: "Procedure recorded in notes" },
  { key: "signout_instrument_count", label: "Instrument count correct" },
  { key: "signout_swab_count", label: "Swab count correct" },
  { key: "signout_specimen_labelled", label: "Specimen labelled correctly" },
  { key: "signout_equipment_issues", label: "Equipment issues noted" },
  { key: "signout_recovery_handover", label: "Recovery team briefed" },
];
