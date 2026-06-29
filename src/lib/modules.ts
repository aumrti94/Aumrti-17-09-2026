export interface ModuleDefinition {
  name: string;
  desc: string;
  icon: string;
  route: string;
  category: ModuleCategory;
  roles: string[];
  isNew?: boolean;
}

export type ModuleCategory =
  | "Clinical"
  | "Diagnostics"
  | "Surgical"
  | "Pharmacy"
  | "Finance"
  | "Operations"
  | "Specialized"
  | "Patient"
  | "Analytics"
  | "Settings";

export const CATEGORY_COLORS: Record<ModuleCategory, string> = {
  Clinical: "#1A2F5A",
  Diagnostics: "#0E7B7B",
  Surgical: "#0E7B7B",
  Pharmacy: "#7C3AED",
  Finance: "#D97706",
  Operations: "#DC2626",
  Specialized: "#0369A1",
  Patient: "#0369A1",
  Analytics: "#1A2F5A",
  Settings: "#64748B",
};

export const ALL_MODULES: ModuleDefinition[] = [
  // ── CLINICAL ──
  { name: "OPD Queue", desc: "Outpatient consultations & tokens", icon: "🏥", route: "/opd", category: "Clinical", roles: ["doctor", "nurse", "receptionist", "super_admin"] },
  { name: "IPD / Wards", desc: "Admitted patients & bed management", icon: "🛏️", route: "/ipd", category: "Clinical", roles: ["doctor", "nurse", "super_admin"] },
  { name: "Day Care Unit", desc: "Same-day procedures & day care admissions", icon: "🩺", route: "/ipd/day-care", category: "Clinical", roles: ["doctor", "nurse", "receptionist", "super_admin"], isNew: true },
  { name: "Emergency", desc: "Emergency triage & treatment", icon: "🚨", route: "/emergency", category: "Clinical", roles: ["doctor", "nurse", "super_admin"] },
  { name: "Operation Theatre", desc: "OT scheduling & WHO checklist", icon: "🔪", route: "/ot", category: "Clinical", roles: ["doctor", "nurse", "super_admin"] },
  { name: "Nursing", desc: "MAR, handover & care plans", icon: "💉", route: "/nursing", category: "Clinical", roles: ["nurse", "super_admin"] },
  { name: "Telemedicine", desc: "Video consultations", icon: "📹", route: "/telemedicine", category: "Clinical", roles: ["doctor", "super_admin"] },
  { name: "Health Packages", desc: "Preventive checkup packages & corporate", icon: "📋", route: "/packages", category: "Clinical", roles: ["receptionist", "doctor", "super_admin"], isNew: true },

  // ── DIAGNOSTICS ──
  { name: "Laboratory (LIS)", desc: "Sample collection & results", icon: "🔬", route: "/lab", category: "Diagnostics", roles: ["lab_technician", "doctor", "super_admin"] },
  { name: "Radiology (RIS)", desc: "Imaging orders & reports", icon: "🩻", route: "/radiology", category: "Diagnostics", roles: ["radiologist", "doctor", "super_admin"] },

  // ── SURGICAL SERVICES ──
  { name: "Blood Bank", desc: "Donors, inventory & cross-match", icon: "🩸", route: "/blood-bank", category: "Surgical", roles: ["blood_bank_technician", "doctor", "super_admin"], isNew: true },
  { name: "CSSD", desc: "Central sterile supply", icon: "🛡️", route: "/cssd", category: "Surgical", roles: ["cssd_technician", "super_admin"], isNew: true },

  // ── PHARMACY ──
  { name: "Pharmacy (IP)", desc: "Inpatient dispensing & NDPS", icon: "💊", route: "/pharmacy", category: "Pharmacy", roles: ["pharmacist", "super_admin"] },
  { name: "Pharmacy Retail", desc: "Walk-in retail POS", icon: "🏪", route: "/pharmacy?mode=retail", category: "Pharmacy", roles: ["pharmacist", "super_admin"] },

  // ── FINANCE ──
  { name: "Billing", desc: "IP/OP billing & payments", icon: "🧾", route: "/billing", category: "Finance", roles: ["billing_executive", "super_admin"] },
  { name: "Day Closure", desc: "End-of-day cash reconciliation & lock", icon: "🔒", route: "/billing/closure", category: "Finance", roles: ["accountant", "billing_executive", "cfo", "super_admin"], isNew: true },
  { name: "Insurance / TPA", desc: "Pre-auth & claims", icon: "🛡️", route: "/insurance", category: "Finance", roles: ["billing_executive", "insurance_executive", "super_admin"] },
  { name: "Payments", desc: "Collections & receipts", icon: "💳", route: "/payments", category: "Finance", roles: ["billing_executive", "super_admin"] },
  { name: "Accounts / ERP", desc: "P&L, balance sheet, journals", icon: "📚", route: "/accounts", category: "Finance", roles: ["accountant", "cfo", "super_admin"] },
  { name: "Govt Schemes / PMJAY", desc: "PMJAY, CGHS, state scheme claims", icon: "🏥", route: "/pmjay", category: "Finance", roles: ["billing_executive", "super_admin"], isNew: true },

  // ── OPERATIONS ──
  { name: "HR & Payroll", desc: "Staff, roster & payroll", icon: "👥", route: "/hr", category: "Operations", roles: ["hr_manager", "super_admin"] },
  { name: "Inventory & Stores", desc: "Stock, PO & GRN", icon: "📦", route: "/inventory", category: "Operations", roles: ["inventory_manager", "super_admin"] },
  { name: "Quality & NABH", desc: "NABH compliance & CAPAs", icon: "✅", route: "/quality", category: "Operations", roles: ["quality_manager", "super_admin"] },
  { name: "IPC Dashboard", desc: "Infection prevention, HAI surveillance & antibiogram", icon: "🦠", route: "/ipc/dashboard", category: "Operations", roles: ["quality_officer", "quality_manager", "infection_control_nurse", "doctor", "super_admin", "hospital_admin"], isNew: true },

  // ── SPECIALIZED CLINICAL ──
  { name: "Dialysis Unit", desc: "Haemodialysis unit", icon: "🫀", route: "/dialysis", category: "Specialized", roles: ["nephrologist", "dialysis_technician", "super_admin"], isNew: true },
  { name: "Oncology", desc: "Chemotherapy & daycare", icon: "🎗️", route: "/oncology", category: "Specialized", roles: ["oncologist", "chemo_nurse", "super_admin"], isNew: true },
  { name: "Physiotherapy", desc: "Rehab, outcomes & HEP plans", icon: "🦿", route: "/physio", category: "Specialized", roles: ["physiotherapist", "doctor", "super_admin"], isNew: true },
  { name: "Mortuary & Medico-Legal", desc: "Mortuary register, MCCD, MLC & organ donation", icon: "🏥", route: "/mortuary", category: "Specialized", roles: ["mortuary_officer", "medical_officer", "super_admin"], isNew: true },
  { name: "Vaccination", desc: "NIS immunization, cold chain & camps", icon: "💉", route: "/vaccination", category: "Clinical", roles: ["nurse", "doctor", "super_admin"], isNew: true },
  { name: "Ambulance Service", desc: "Dispatch board, transit vitals & equipment checks", icon: "🚑", route: "/ambulance", category: "Clinical", roles: ["nurse", "doctor", "receptionist", "super_admin"], isNew: true },
  { name: "Home Care", desc: "Post-discharge home visits, tele-monitoring & care plans", icon: "🏠", route: "/home-care", category: "Clinical", roles: ["nurse", "doctor", "super_admin"], isNew: true },
  { name: "Dental", desc: "FDI tooth chart, perio & treatment plans", icon: "🦷", route: "/dental", category: "Specialized", roles: ["dentist", "super_admin"], isNew: true },
  { name: "AYUSH", desc: "Ayurveda, Homeopathy, Unani, Siddha, Yoga", icon: "🌿", route: "/ayush", category: "Specialized", roles: ["ayush_doctor", "super_admin"], isNew: true },
  { name: "IVF & ART", desc: "IVF cycles, embryology & ICMR compliance", icon: "🧬", route: "/ivf", category: "Specialized", roles: ["ivf_doctor", "embryologist", "super_admin"], isNew: true },
  { name: "Obstetric ANC", desc: "Antenatal care, risk flags & AI SOAP notes", icon: "🤰", route: "/specialty/anc", category: "Specialized", roles: ["obstetrician", "doctor", "nurse", "super_admin"], isNew: true },
  { name: "Neonatal EMR", desc: "APGAR, Bhutani nomogram, CCHD & anthropometry", icon: "👶", route: "/specialty/neonatal", category: "Specialized", roles: ["neonatologist", "paediatrician", "doctor", "super_admin"], isNew: true },
  { name: "Anaesthesia EMR", desc: "PAC, intraoperative chart & PACU Aldrete score", icon: "😴", route: "/specialty/anaesthesia", category: "Specialized", roles: ["anaesthetist", "doctor", "super_admin"], isNew: true },
  { name: "Ophthalmology EMR", desc: "VA, refraction, IOP, fundoscopy & IOL calc", icon: "👁️", route: "/specialty/ophthalmology", category: "Specialized", roles: ["ophthalmologist", "doctor", "super_admin"], isNew: true },
  { name: "Partograph", desc: "WHO labour progress chart with alert & action lines", icon: "📈", route: "/specialty/partograph", category: "Specialized", roles: ["obstetrician", "midwife", "nurse", "doctor", "super_admin"], isNew: true },
  { name: "Mental Health / Psychiatry", desc: "Consultations, psychometric scales, therapy plans & risk assessment", icon: "🧠", route: "/mental-health", category: "Specialized", roles: ["psychiatrist", "psychologist", "doctor", "nurse", "super_admin"], isNew: true },
  { name: "Chronic Disease Management", desc: "Care plans, task tracking, adherence & cohort dashboard", icon: "📋", route: "/chronic-disease", category: "Clinical", roles: ["doctor", "nurse", "super_admin"], isNew: true },
  { name: "Medical Records", desc: "MRD, ICD coding & retention", icon: "🗂️", route: "/mrd", category: "Operations", roles: ["mrd_officer", "super_admin", "billing_executive"], isNew: true },
  { name: "FMS / Safety", desc: "Facility assets, maintenance, safety rounds & BMW waste", icon: "🔩", route: "/fms/dashboard", category: "Operations", roles: ["facility_manager", "biomedical_technician", "super_admin", "hospital_admin"], isNew: true },
  { name: "Biomedical Engineering", desc: "Equipment, PM, calibration & breakdowns", icon: "🔧", route: "/biomedical", category: "Operations", roles: ["biomedical_technician", "super_admin", "hospital_admin"], isNew: true },
  { name: "Housekeeping", desc: "Cleaning tasks, BMW & linen", icon: "🧹", route: "/housekeeping", category: "Operations", roles: ["housekeeping_supervisor", "super_admin", "hospital_admin"], isNew: true },
  { name: "Govt HMIS Reporting", desc: "MoHFW, IDSP & RMNCH+A reports", icon: "📊", route: "/hmis", category: "Operations", roles: ["hmis_officer", "super_admin", "hospital_admin"], isNew: true },
  { name: "Dietetics & Nutrition", desc: "Nutritional screening, diet orders & AI meal plans", icon: "🥗", route: "/dietetics", category: "Clinical", roles: ["dietitian", "doctor", "super_admin"], isNew: true },
  { name: "Staff Training / LMS", desc: "NABH mandatory training & compliance", icon: "🎓", route: "/lms", category: "Operations", roles: ["hr_manager", "super_admin", "hospital_admin"], isNew: true },
  { name: "CRM & Marketing", desc: "Referrals, campaigns, reviews & segments", icon: "📣", route: "/crm", category: "Operations", roles: ["marketing", "hospital_admin", "super_admin"], isNew: true },
  { name: "ABDM / ABHA", desc: "ABHA creation, consent management & care context linking", icon: "🛡️", route: "/abdm", category: "Operations", roles: ["receptionist", "doctor", "nurse", "hospital_admin", "super_admin"] },

  // ── QUALITY & COMPLIANCE ──
  { name: "JCI Accreditation", desc: "JCI standards matrix, IPSG 1–6 tracking, evidence bundle export", icon: "🏅", route: "/quality/jci", category: "Operations", roles: ["quality_officer", "quality_manager", "super_admin", "hospital_admin"], isNew: true },
  { name: "MCI / Disaster Response", desc: "Mass casualty activation, triage zones, P1–P4 tagging", icon: "🚨", route: "/emergency/mci", category: "Operations", roles: ["doctor", "nurse", "receptionist", "super_admin", "hospital_admin"], isNew: true },

  // ── ANALYTICS (new) ──
  { name: "Population Health", desc: "Disease burden, NCD control rates, risk stratification, NIKSHAY TB", icon: "🌍", route: "/analytics/population-health", category: "Analytics", roles: ["doctor", "quality_officer", "quality_manager", "super_admin", "hospital_admin"], isNew: true },
  { name: "Revenue Intelligence", desc: "Service line P&L, payor mix, ALOS vs benchmark, AR days", icon: "💹", route: "/analytics/revenue-intelligence", category: "Analytics", roles: ["cfo", "super_admin", "hospital_admin"], isNew: true },
  { name: "AI Clinical Intelligence", desc: "Deterioration watch, LOS prediction, AI prior authorisation", icon: "🧠", route: "/ai/clinical-intelligence", category: "Analytics", roles: ["doctor", "nursing_supervisor", "super_admin", "hospital_admin"], isNew: true },
  { name: "Financial Statements", desc: "P&L, balance sheet, monthly financial reports", icon: "📑", route: "/accounts/financial-statements", category: "Finance", roles: ["accountant", "cfo", "super_admin", "hospital_admin"], isNew: true },
  { name: "Budget Management", desc: "Annual budgets with approval workflow and variance tracking", icon: "🎯", route: "/accounts/budget", category: "Finance", roles: ["accountant", "cfo", "super_admin", "hospital_admin"], isNew: true },
  { name: "Fixed Assets Register", desc: "Asset register, depreciation, insurance & disposal tracking", icon: "🏗️", route: "/accounts/fixed-assets", category: "Finance", roles: ["accountant", "cfo", "super_admin", "hospital_admin"], isNew: true },
  { name: "Research Platform", desc: "Cohort builder, k-anonymity de-identification, FHIR export for research", icon: "🔬", route: "/research", category: "Analytics", roles: ["quality_officer", "quality_manager", "super_admin", "hospital_admin"], isNew: true },
  { name: "Notifications", desc: "Notification log, escalation chain, channel preferences", icon: "🔔", route: "/notifications", category: "Operations", roles: ["doctor", "nurse", "receptionist", "super_admin", "hospital_admin"], isNew: true },

  // ── PATIENT-FACING ──
  { name: "Patient Portal", desc: "Patient self-service", icon: "🌐", route: "/portal", category: "Patient", roles: ["receptionist", "super_admin"] },
  { name: "Patient Relations", desc: "Grievances, feedback, visitor passes & NABH PCC", icon: "🤝", route: "/pro", category: "Patient", roles: ["pro_officer", "receptionist", "super_admin"], isNew: true },
  { name: "Communication Inbox", desc: "WhatsApp & messages", icon: "📬", route: "/inbox", category: "Patient", roles: ["receptionist", "super_admin"] },

  // ── ANALYTICS ──
  { name: "Analytics & BI", desc: "Revenue & clinical dashboards", icon: "📊", route: "/analytics", category: "Analytics", roles: ["ceo", "cmo", "super_admin", "billing_executive"] },
  { name: "HOD Dashboard", desc: "Department KPI view", icon: "🏢", route: "/hod-dashboard", category: "Analytics", roles: ["doctor", "cmo", "super_admin"] },
  { name: "TV Display", desc: "Waiting area token screen", icon: "📺", route: "/tv-display", category: "Analytics", roles: ["receptionist", "super_admin"] },

  // ── SETTINGS ──
  { name: "Settings Hub", desc: "Configure your hospital", icon: "⚙️", route: "/settings", category: "Settings", roles: ["super_admin", "hospital_admin"] },
];

const RECENT_KEY = "hms_recent_modules";
const MAX_RECENT = 6;

export function getRecentModules(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function trackModuleVisit(route: string) {
  const recent = getRecentModules().filter((r) => r !== route);
  recent.unshift(route);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export const CATEGORIES: ModuleCategory[] = [
  "Clinical",
  "Diagnostics",
  "Surgical",
  "Pharmacy",
  "Finance",
  "Operations",
  "Specialized",
  "Patient",
  "Analytics",
  "Settings",
];
