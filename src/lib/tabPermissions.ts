import { AI_FEATURE_DEFS } from "./aiFeatures";

export interface TabDef {
  key: string;
  label: string;
}

export interface ActionDef {
  key: string;
  label: string;
  description: string;
}

/* ── Tab definitions per module ── */
export const MODULE_TABS: Record<string, TabDef[]> = {
  // Home dashboard KPI keycards + main panels. Each "tab" is a card/panel that can be
  // hidden per role (SettingsRolesPage) and per user (StaffAccessPanel). Runtime gating
  // lives in Dashboard.tsx via hasTabAccess("dashboard", <key>, …). Default = show.
  dashboard: [
    { key: "card_patients", label: "Total Patients (card)" },
    { key: "card_beds", label: "Beds Occupied (card)" },
    { key: "card_opd", label: "OPD Tokens (card)" },
    { key: "card_revenue", label: "Revenue MTD (card)" },
    { key: "card_doctors", label: "Doctors On Duty (card)" },
    { key: "card_alerts", label: "Critical Alerts (card)" },
    { key: "card_followups", label: "Follow-ups Due (card)" },
    { key: "card_nabh", label: "NABH Readiness (card)" },
    { key: "card_abdm", label: "ABDM Compliance (card)" },
    { key: "panel_revenue", label: "Revenue Chart (panel)" },
    { key: "panel_beds", label: "Bed Occupancy (panel)" },
    { key: "panel_alerts", label: "Active Alerts (panel)" },
  ],
  opd: [
    { key: "complaint", label: "Complaint" },
    { key: "vitals", label: "Vitals" },
    { key: "examination", label: "Examination" },
    { key: "guidance", label: "AI Guidance" },
    { key: "rx_orders", label: "Rx & Orders" },
    { key: "history", label: "History" },
  ],
  ipd: [
    { key: "overview", label: "Overview" },
    { key: "vitals", label: "Vitals" },
    { key: "medications", label: "Medications" },
    { key: "rx_orders", label: "Rx & Orders" },
    { key: "investigations", label: "Investigations" },
    { key: "wardround", label: "Ward Round" },
    { key: "notes", label: "Notes" },
    { key: "documents", label: "Documents" },
    { key: "advance", label: "Advance" },
    { key: "ledger", label: "Ledger" },
    { key: "nursing_kardex", label: "Kardex" },
    { key: "ipc_devices", label: "IPC/Devices" },
    { key: "palliative", label: "Palliative Care" },
    { key: "nutrition", label: "Nutrition & Dietetics" },
    { key: "wound_care", label: "Wound Care" },
  ],
  lab: [
    { key: "worklist", label: "Worklist" },
    { key: "collection", label: "Collection" },
    { key: "qc", label: "QC Dashboard" },
    { key: "calibration", label: "Calibration (NABL)" },
    { key: "histopathology", label: "Histopathology" },
    { key: "tat", label: "TAT Dashboard" },
    { key: "external", label: "External Referrals" },
    { key: "analyzer", label: "Analyzer Interface" },
    { key: "results", label: "Results (per order)" },
    { key: "sample", label: "Sample (per order)" },
    { key: "history", label: "History (per order)" },
    { key: "notes", label: "Notes (per order)" },
  ],
  radiology: [
    { key: "report", label: "Report" },
    { key: "images", label: "Images" },
  ],
  emergency: [
    { key: "triage", label: "Triage" },
    { key: "vitals", label: "Vitals" },
    { key: "assessment", label: "Assessment" },
    { key: "investigations", label: "Investigations" },
    { key: "disposition", label: "Disposition" },
  ],
  billing: [
    { key: "bills", label: "Bills" },
    { key: "collections", label: "Collections" },
    { key: "pending", label: "Pending Payments" },
    { key: "leakage", label: "Revenue Leakage" },
    { key: "approvals", label: "Approvals" },
    { key: "refund_approvals", label: "Refund Approvals" },
  ],
  hr: [
    { key: "roster", label: "Roster" },
    { key: "attendance", label: "Attendance" },
    { key: "leave", label: "Leave Management" },
    { key: "payroll", label: "Payroll" },
    { key: "payroll_run", label: "Payroll Run (PF/ESI/TDS)" },
    { key: "directory", label: "Staff Directory" },
    { key: "credentials", label: "Credentials" },
    { key: "expiring", label: "Expiring Credentials" },
    { key: "privileges", label: "Privileges" },
    { key: "training", label: "Training & CME" },
    { key: "compliance", label: "Training Compliance" },
    { key: "injuries", label: "Injury Register" },
    { key: "second_victim", label: "Second Victim Support" },
    { key: "performance", label: "Performance Appraisals" },
    { key: "occupational_health", label: "Occupational Health" },
    { key: "burnout", label: "Burnout Risk Monitor" },
    { key: "payroll_integrations", label: "Payroll Integrations" },
    { key: "recruitment", label: "Recruitment" },
    { key: "offboarding", label: "Exit & Full-and-Final" },
    { key: "disciplinary", label: "Disciplinary & Grievance" },
    { key: "documents", label: "Document Vault" },
    { key: "reports", label: "Reports" },
  ],
  pharmacy: [
    { key: "dispense", label: "Dispense" },
    { key: "stock", label: "Stock" },
    { key: "expiry", label: "Expiry Control" },
    { key: "reorder", label: "Reorder" },
    { key: "returns", label: "Returns" },
    { key: "ndps", label: "NDPS Register" },
    { key: "reports", label: "Reports" },
  ],
  ot: [
    { key: "who_checklist", label: "WHO Checklist" },
    { key: "case_details", label: "Case Details" },
    { key: "ot_team", label: "OT Team" },
    { key: "implants", label: "Implants & Consumables" },
    { key: "anaesthesia", label: "Anaesthesia" },
    { key: "pacu", label: "PACU" },
    { key: "billing", label: "Billing" },
  ],
  nursing: [
    { key: "tasks", label: "Tasks" },
    { key: "kanban", label: "Kanban" },
    { key: "care_plans", label: "Care Plans" },
    { key: "io", label: "I&O Chart" },
    { key: "restraints", label: "Restraints" },
    { key: "icu_monitor", label: "ICU Monitor" },
    { key: "risk_assessments", label: "Risk Assess" },
    { key: "collection", label: "Lab Collection" },
    { key: "radiology", label: "Radiology" },
  ],
  // ── Specialized / operations / finance module tabs (lifted from each page's <TabsTrigger>) ──
  dialysis: [
    { key: "machines", label: "Machine Board" },
    { key: "schedule", label: "Schedule" },
    { key: "patients", label: "Patients" },
    { key: "sessions", label: "Sessions" },
    { key: "reports", label: "Reports" },
  ],
  oncology: [
    { key: "daycare", label: "Daycare Board" },
    { key: "orders", label: "Orders" },
    { key: "patients", label: "Patients" },
    { key: "protocols", label: "Protocols" },
    { key: "reports", label: "Reports" },
  ],
  dental: [
    { key: "chart", label: "Tooth Chart" },
    { key: "perio", label: "Perio" },
    { key: "treatment", label: "Treatment Plan" },
    { key: "lab", label: "Lab Orders" },
  ],
  ayush: [
    { key: "consultation", label: "Consultation" },
    { key: "prakriti", label: "Prakriti" },
    { key: "panchakarma", label: "Panchakarma" },
    { key: "prescriptions", label: "Prescriptions" },
  ],
  ivf: [
    { key: "couples", label: "Couples" },
    { key: "cycles", label: "Cycles" },
    { key: "stimulation", label: "Stimulation" },
    { key: "embryology", label: "Embryology" },
    { key: "embryo-bank", label: "Embryo Bank" },
    { key: "andrology", label: "Andrology" },
    { key: "icmr", label: "ICMR" },
  ],
  physio: [
    { key: "referrals", label: "Referrals" },
    { key: "sessions", label: "Sessions" },
    { key: "outcomes", label: "Outcomes" },
    { key: "equipment", label: "Equipment" },
    { key: "hep", label: "HEP" },
  ],
  mortuary: [
    { key: "register", label: "Register" },
    { key: "mccd", label: "MCCD" },
    { key: "mlc", label: "MLC" },
    { key: "release", label: "Release" },
    { key: "organ", label: "Organ Donation" },
  ],
  mental_health: [
    { key: "consultation", label: "Consultation" },
    { key: "psychometric", label: "Psychometric Scales" },
    { key: "therapy", label: "Therapy Plans" },
  ],
  chronic_disease: [
    { key: "dashboard", label: "Cohort Dashboard" },
    { key: "plans", label: "Care Plans" },
    { key: "new", label: "New Care Plan" },
  ],
  blood_bank: [
    { key: "inventory", label: "Inventory" },
    { key: "requests", label: "Requests" },
    { key: "crossmatch", label: "Cross-Match" },
    { key: "donors", label: "Donors" },
    { key: "issuelog", label: "Issue Log" },
    { key: "tti", label: "TTI Testing" },
    { key: "reports", label: "Reports" },
  ],
  cssd: [
    { key: "sterilize", label: "Sterilize" },
    { key: "sets", label: "Sets & Instruments" },
    { key: "issue", label: "Issue / Return" },
    { key: "logs", label: "Logs" },
  ],
  dietetics: [
    { key: "screening", label: "Screening" },
    { key: "orders", label: "Diet Orders" },
    { key: "tracking", label: "Meal Tracking" },
    { key: "plans", label: "Meal Plans" },
    { key: "reports", label: "Reports" },
  ],
  vaccination: [
    { key: "patient-card", label: "Patient Card" },
    { key: "due-list", label: "Due List" },
    { key: "record", label: "Record Vaccine" },
    { key: "cold-chain", label: "Cold Chain" },
    { key: "camps", label: "Camps" },
    { key: "stock", label: "Stock" },
    { key: "adult-schedule", label: "Adult Schedule" },
    { key: "catalogue", label: "Add Vaccine" },
  ],
  mrd: [
    { key: "records", label: "Records Index" },
    { key: "icd", label: "ICD Coding" },
    { key: "requests", label: "Requests" },
    { key: "death", label: "Death Certs" },
    { key: "retention", label: "Retention" },
    { key: "maternity", label: "Form 8" },
    { key: "mlc", label: "MLC Register" },
    { key: "coding_audit", label: "Coding Audit" },
  ],
  crm: [
    { key: "referrals", label: "Referrals" },
    { key: "campaigns", label: "Campaigns" },
    { key: "reviews", label: "Reviews" },
    { key: "segments", label: "Segments" },
    { key: "analytics", label: "Analytics" },
  ],
  patient_relations: [
    { key: "grievances", label: "Grievances" },
    { key: "feedback", label: "Feedback" },
    { key: "visitors", label: "Visitor Passes" },
    { key: "rights", label: "Patient Rights" },
    { key: "analytics", label: "Analytics" },
  ],
  pmjay: [
    { key: "preauth", label: "Pre-Authorization" },
    { key: "beneficiaries", label: "Beneficiaries" },
    { key: "claims", label: "Cashless Claims" },
    { key: "catalog", label: "HBP Catalog" },
    { key: "analytics", label: "Analytics" },
  ],
  accounts: [
    { key: "dashboard", label: "Dashboard" },
    { key: "ledger", label: "Ledger" },
    { key: "expenses", label: "Expenses" },
    { key: "journal", label: "Journal" },
    { key: "bank", label: "Bank" },
    { key: "reports", label: "Reports" },
  ],
  telemedicine: [
    { key: "waiting", label: "Waiting" },
    { key: "scheduled", label: "Scheduled" },
    { key: "completed", label: "Completed" },
  ],
  health_packages: [
    { key: "catalogue", label: "Packages" },
    { key: "checkups", label: "Today's Checkups" },
    { key: "progress", label: "Progress Tracker" },
    { key: "corporate", label: "Corporate" },
    { key: "analytics", label: "Analytics" },
  ],
  biomedical: [
    { key: "equipment", label: "Equipment" },
    { key: "maintenance", label: "Maintenance" },
    { key: "calibration", label: "Calibration" },
    { key: "breakdowns", label: "Breakdowns" },
    { key: "alerts", label: "Alerts" },
    { key: "predictive", label: "AI Predictive" },
    { key: "reports", label: "Reports" },
  ],
  housekeeping: [
    { key: "tasks", label: "Tasks" },
    { key: "bmw", label: "BMW Log" },
    { key: "linen", label: "Linen" },
    { key: "schedules", label: "Schedules" },
    { key: "reports", label: "Reports" },
  ],
  ai_clinical: [
    { key: "deterioration", label: "Deterioration Watch" },
    { key: "los", label: "LOS Prediction" },
    { key: "prior_auth", label: "AI Prior Auth" },
  ],
  research: [
    { key: "cohort", label: "Cohort Builder" },
    { key: "deidentify", label: "De-identification" },
    { key: "export", label: "FHIR Export" },
  ],
  // ── Custom-tab-bar modules (nav filtered by tabAllowed in each page) ──
  insurance: [
    { key: "admissions", label: "Active Admissions" },
    { key: "intimations", label: "Intimations" },
    { key: "preauth", label: "Pre-Auth Queue" },
    { key: "enhancement_queue", label: "Enhancement Queue" },
    { key: "submit", label: "Claims to Submit" },
    { key: "hcx", label: "HCX Claims" },
    { key: "status", label: "Claims Status" },
    { key: "denial", label: "Denial Management" },
    { key: "queries", label: "TPA Queries" },
    { key: "ageing", label: "TPA Ageing" },
    { key: "unified", label: "Unified View" },
    { key: "reconciliation", label: "Reconciliation" },
    { key: "disputes", label: "TPA Disputes" },
    { key: "cghs_echs", label: "CGHS / ECHS" },
    { key: "esi", label: "ESI Scheme" },
    { key: "arogyasri", label: "Arogyasri / State" },
    { key: "analytics", label: "Denial Analytics" },
    { key: "automation", label: "Automation" },
    { key: "auto_settings", label: "Auto Settings" },
    { key: "config", label: "TPA Configuration" },
    { key: "settings", label: "Plan & Settings" },
  ],
  inventory: [
    { key: "stock", label: "Stock Overview" },
    { key: "indents", label: "Indents" },
    { key: "ward_store", label: "Ward Store" },
    { key: "consolidated", label: "Consolidated" },
    { key: "stock_count", label: "Stock Count" },
    { key: "rfq", label: "RFQ / Requisition" },
    { key: "po", label: "Purchase Orders" },
    { key: "grn", label: "GRN / Receipts" },
    { key: "vendors", label: "Vendors" },
    { key: "mis", label: "MIS Dashboard" },
    { key: "anomalies", label: "Anomalies" },
    { key: "reports", label: "Reports" },
  ],
  quality: [
    { key: "nabh", label: "NABH Dashboard" },
    { key: "indicators", label: "Quality Indicators" },
    { key: "audits", label: "Audit Calendar" },
    { key: "incidents", label: "Incident Reports" },
    { key: "capa", label: "CAPA Tracker" },
    { key: "infection", label: "Infection Control" },
    { key: "antibiotic", label: "Antibiotic Stewardship" },
    { key: "pain", label: "Pain Management" },
  ],
  ambulance: [
    { key: "dispatch", label: "Dispatch Board" },
    { key: "equipment", label: "Equipment Check" },
    { key: "transit", label: "Transit Log" },
    { key: "fleet", label: "Fleet" },
  ],
  home_care: [
    { key: "plans", label: "Active Plans" },
    { key: "visits", label: "Visit Schedule" },
    { key: "tele", label: "Tele-Monitoring" },
  ],
  fms: [
    { key: "assets", label: "Assets" },
    { key: "maintenance", label: "Maintenance" },
    { key: "safety", label: "Safety Rounds" },
    { key: "bmw", label: "BMW Manifests" },
    { key: "fire_safety", label: "Fire Safety" },
    { key: "medical_gas", label: "Medical Gas" },
    { key: "electrical", label: "Electrical Safety" },
  ],
  ipc: [
    { key: "overview", label: "Overview" },
    { key: "devices", label: "Device Log" },
    { key: "infections", label: "HAI Events" },
    { key: "bundles", label: "Bundle Compliance" },
    { key: "hand_hygiene", label: "Hand Hygiene" },
    { key: "trends", label: "Trends" },
    { key: "ai", label: "AI Insights" },
  ],
  abdm: [
    { key: "consents", label: "Consents" },
    { key: "care_contexts", label: "Care Contexts" },
    { key: "gateway_logs", label: "Gateway Logs" },
    { key: "hiu_fetch", label: "Fetch Records (HIU)" },
    { key: "compliance", label: "Compliance" },
  ],
};

/* ── Action definitions per module ── */
export const MODULE_ACTIONS: Record<string, ActionDef[]> = {
  // Dashboard buttons — page controls, Quick Access sidebar shortcuts, and top-bar header
  // buttons. Gated via hasActionAccess("dashboard", <key>, …) in Dashboard.tsx,
  // AppSidebar.tsx and AppHeader.tsx respectively. Default = allow (backward compatible).
  dashboard: [
    // ── Dashboard page buttons ──
    { key: "refresh", label: "Refresh Dashboard", description: "Manually refresh the live KPI data" },
    { key: "drilldown", label: "Card Drill-Downs", description: "Open the detailed drawer when a KPI card is clicked" },
    { key: "load_sample_data", label: "Load Sample Data", description: "Seed demo data on an empty hospital (welcome banner)" },
    { key: "complete_setup", label: "Complete Setup Shortcut", description: "Jump to the onboarding wizard from the welcome banner" },
    // ── Quick Access sidebar shortcuts ──
    { key: "quick_scheduling", label: "Quick Access: Scheduling", description: "Scheduling shortcut in the sidebar Quick Access group" },
    { key: "quick_opd", label: "Quick Access: OPD Queue", description: "OPD Queue shortcut in the sidebar" },
    { key: "quick_ipd", label: "Quick Access: IPD / Wards", description: "IPD / Wards shortcut in the sidebar" },
    { key: "quick_billing", label: "Quick Access: Billing", description: "Billing shortcut in the sidebar" },
    { key: "quick_hr", label: "Quick Access: HR & Staff", description: "HR & Staff shortcut in the sidebar" },
    { key: "quick_ceo_board", label: "Quick Access: CEO Board", description: "CEO Board shortcut in the sidebar" },
    { key: "quick_govt_schemes", label: "Quick Access: Govt Schemes", description: "Govt Schemes (PMJAY) shortcut in the sidebar" },
    { key: "quick_lab", label: "Quick Access: Lab", description: "Lab shortcut in the sidebar" },
    { key: "quick_analytics", label: "Quick Access: Analytics", description: "Analytics shortcut in the sidebar" },
    // ── Header (top bar) action buttons ──
    { key: "header_report_incident", label: "Header: Report Incident", description: "Red alert-triangle icon in the top bar" },
    { key: "header_report_event", label: "Header: Report Event", description: "Report Event button in the top bar" },
    { key: "header_sync_status", label: "Header: Online / Sync", description: "Online status & offline-sync button" },
    { key: "header_notifications", label: "Header: Notifications", description: "Notification bell in the top bar" },
    { key: "header_theme", label: "Header: Theme Toggle", description: "Dark / light mode toggle" },
  ],
  opd: [
    { key: "register_walkin", label: "Register Walk-in", description: "Add a new walk-in patient to the OPD queue" },
    { key: "call_next_patient", label: "Call Next Patient", description: "Advance the queue to the next waiting patient" },
    { key: "start_consultation", label: "Start Consultation", description: "Begin a clinical consultation session" },
    { key: "complete_and_bill", label: "Complete & Bill", description: "Finalize the consultation and generate a bill" },
    { key: "order_lab", label: "Order Lab Tests", description: "Create lab test orders from OPD" },
    { key: "order_radiology", label: "Order Radiology", description: "Create radiology orders from OPD" },
    { key: "admit_patient", label: "Admit to IPD", description: "Admit a patient from OPD to inpatient" },
    { key: "refer_physio", label: "Refer to Physio", description: "Create a physiotherapy referral" },
    { key: "send_rx", label: "Send Prescription", description: "Send prescription via WhatsApp/SMS" },
  ],
  ipd: [
    { key: "new_admission", label: "New Admission", description: "Register a new IPD admission" },
    { key: "bed_transfer", label: "Transfer Bed/Ward", description: "Move patient to a different bed or ward" },
    { key: "initiate_discharge", label: "Initiate Discharge", description: "Start the patient discharge process" },
    { key: "order_lab", label: "Order Lab (IPD)", description: "Create lab orders from IPD workspace" },
    { key: "order_radiology", label: "Order Radiology (IPD)", description: "Create radiology orders from IPD workspace" },
    { key: "edit_ward_round", label: "Write Ward Round", description: "Enter ward round notes" },
  ],
  lab: [
    { key: "new_lab_order", label: "New Lab Order", description: "Create a new lab test order" },
    { key: "validate_result", label: "Validate Results", description: "Approve and sign off on test results" },
    { key: "collect_sample", label: "Collect Sample", description: "Mark sample as collected" },
  ],
  radiology: [
    { key: "new_order", label: "New Radiology Order", description: "Create a new radiology order" },
    { key: "validate_report", label: "Validate Report", description: "Approve and sign the radiology report" },
  ],
  pharmacy: [
    { key: "dispense", label: "Dispense Medicines", description: "Dispense medications to patients" },
    { key: "receive_stock", label: "Receive Stock", description: "Record new stock receipts from supplier" },
    { key: "write_indent", label: "Create Indent", description: "Raise a stock indent/purchase request" },
    { key: "process_return", label: "Process Return", description: "Confirm a drug return and issue credit/refund" },
    { key: "quarantine_destroy_stock", label: "Quarantine/Destroy Stock", description: "Mark batch stock as quarantined or destroyed" },
  ],
  billing: [
    { key: "new_bill", label: "Create New Bill", description: "Create a new billing record" },
    { key: "approve_discount", label: "Approve Discount", description: "Approve or override discount on a bill" },
    { key: "day_closure", label: "Day Closure", description: "Perform end-of-day billing closure" },
    { key: "waive_amount", label: "Waive Amount", description: "Waive outstanding dues on a bill" },
    { key: "approve_refund", label: "Approve Refund", description: "Approve or reject a pending patient refund" },
  ],
  emergency: [
    { key: "register_patient", label: "Register Emergency Patient", description: "Register a new emergency/casualty case" },
    { key: "triage_update", label: "Update Triage", description: "Change triage level/color code" },
    { key: "admit_from_ed", label: "Admit from ED", description: "Admit emergency patient to inpatient" },
  ],
  ot: [
    { key: "book_case", label: "Book OT Case", description: "Schedule a new surgical procedure" },
    { key: "end_case", label: "End OT Case", description: "Mark an OT case as completed" },
    { key: "edit_team", label: "Edit OT Team", description: "Add/remove surgeons, anaesthetists, nurses" },
  ],
  // ── Specialized / operations module primary actions (header CTAs) ──
  dialysis: [
    { key: "register_patient", label: "Register Patient", description: "Enrol a new dialysis patient" },
    { key: "schedule_session", label: "Schedule Session", description: "Book a haemodialysis session" },
  ],
  oncology: [
    { key: "new_chemo_order", label: "New Chemo Order", description: "Create a chemotherapy order" },
    { key: "register_patient", label: "Register Patient", description: "Enrol a new oncology patient" },
  ],
  blood_bank: [
    { key: "register_donor", label: "Register Donor", description: "Add a new blood donor" },
    { key: "blood_request", label: "Blood Request", description: "Raise a blood/component request" },
  ],
  physio: [
    { key: "accept_referral", label: "Accept Referral", description: "Accept a physiotherapy referral" },
    { key: "book_session", label: "Book Session", description: "Schedule a physiotherapy session" },
  ],
  ivf: [
    { key: "register_couple", label: "Register Couple", description: "Register a new IVF couple" },
    { key: "start_cycle", label: "Start Cycle", description: "Start a new IVF/ART cycle" },
  ],
  mortuary: [
    { key: "admit", label: "Admit to Mortuary", description: "Admit a body to the mortuary register" },
    { key: "mlc_registration", label: "MLC Registration", description: "Register a medico-legal case" },
  ],
  cssd: [
    { key: "new_cycle", label: "New Cycle", description: "Start a new sterilization cycle" },
    { key: "issue_set", label: "Issue Set to OT", description: "Issue a sterile set to OT" },
  ],
  vaccination: [
    { key: "record_vaccine", label: "Record Vaccine", description: "Record a vaccine administration" },
    { key: "plan_camp", label: "Plan Camp", description: "Plan a vaccination camp" },
  ],
  ayush: [
    { key: "new_consultation", label: "New Consultation", description: "Register a new AYUSH walk-in consultation" },
    { key: "new_panchakarma", label: "Panchakarma", description: "Start a new Panchakarma therapy" },
  ],
  dietetics: [
    { key: "new_diet_order", label: "New Diet Order", description: "Create a diet order" },
    { key: "new_screening", label: "New Screening", description: "Start a nutritional screening" },
  ],
  patient_relations: [
    { key: "new_grievance", label: "New Grievance", description: "Log a new patient grievance" },
    { key: "visitor_pass", label: "Visitor Pass", description: "Issue a visitor pass" },
  ],
  biomedical: [
    { key: "add_equipment", label: "Add Equipment", description: "Register new biomedical equipment" },
    { key: "report_breakdown", label: "Report Breakdown", description: "Report an equipment breakdown" },
  ],
  housekeeping: [
    { key: "new_task", label: "New Task", description: "Create a housekeeping task" },
    { key: "bmw_entry", label: "BMW Entry", description: "Log a biomedical-waste entry" },
  ],
  pmjay: [
    { key: "new_form", label: "New Pre-Auth / Claim", description: "Create a new PMJAY pre-auth or claim" },
  ],
  mrd: [
    { key: "new_request", label: "New Record Request", description: "Raise a medical-records request" },
    { key: "death_certificate", label: "Death Certificate", description: "Issue a death certificate" },
  ],
  health_packages: [
    { key: "book_package", label: "Book Package", description: "Book a health-checkup package" },
    { key: "booking_link", label: "Patient Booking Link", description: "Open the public package-booking link" },
  ],
  crm: [
    { key: "add_referral_doctor", label: "Add Referral Doctor", description: "Add a referring doctor" },
    { key: "new_campaign", label: "New Campaign", description: "Create a marketing campaign" },
  ],
  telemedicine: [
    { key: "schedule_consult", label: "Schedule Consult", description: "Schedule a teleconsultation" },
  ],
  // AI features — the "actions" of the pseudo-module `ai_suite`; keys are the exact
  // callAI featureKeys, so withholding one blocks precisely that AI call.
  ai_suite: AI_FEATURE_DEFS,
};

const BYPASS_ROLES = ["super_admin", "hospital_admin"];

/* ──────────────────────── HOSPITAL ENTITLEMENT FLOOR ──────────────────────── */
/**
 * Platform-controlled, hospital-wide tab/action entitlements — "what the hospital
 * PAID for". Injected by HospitalContext under the reserved `__entitlement` key of
 * the permissions blob (module keys never start with "__", so there is no collision).
 *
 * Shape: { [moduleKey]: { tabs: { [tabKey]: boolean }, actions: { [actionKey]: boolean } } }
 * Only an explicit `false` withholds; anything else (absent / true) is allowed.
 *
 * This is an ENTITLEMENT, not an authorization — it is enforced for EVERY role,
 * including super_admin / hospital_admin. A hospital's own admin must not be able
 * to surface a tab/button the hospital never subscribed to, so these checks run
 * BEFORE the BYPASS_ROLES short-circuit below.
 */
export const ENTITLEMENT_KEY = "__entitlement";

export function isTabEntitled(
  moduleKey: string,
  tabKey: string,
  permissions: Record<string, any> | null
): boolean {
  const ent = permissions?.[ENTITLEMENT_KEY];
  const mod = ent?.[moduleKey];
  if (!mod || !mod.tabs) return true;
  return mod.tabs[tabKey] !== false;
}

export function isActionEntitled(
  moduleKey: string,
  actionKey: string,
  permissions: Record<string, any> | null
): boolean {
  const ent = permissions?.[ENTITLEMENT_KEY];
  const mod = ent?.[moduleKey];
  if (!mod || !mod.actions) return true;
  return mod.actions[actionKey] !== false;
}

/* ──────────────────────────── TAB ACCESS ──────────────────────────── */

/**
 * Check if a tab is accessible. Default = ALLOW (backward compatible).
 * Effective access = hospital entitlement AND role authorization.
 * The entitlement floor is enforced even for admins/super-admins; the role
 * authorization below is bypassed for them.
 */
export function hasTabAccess(
  moduleKey: string,
  tabKey: string,
  permissions: Record<string, any> | null,
  role: string | null
): boolean {
  if (!role) return false;
  // Entitlement floor — applies to ALL roles, including admins.
  if (!isTabEntitled(moduleKey, tabKey, permissions)) return false;
  if (BYPASS_ROLES.includes(role)) return true;
  if (!permissions) return true;
  if (permissions.all === true) return true;

  const modPerms = permissions[moduleKey];
  if (!modPerms) return true;
  if (typeof modPerms === "string") return true;
  if (!modPerms.tabs) return true;
  if (modPerms.tabs[tabKey] === undefined) return true;

  return !!modPerms.tabs[tabKey];
}

export function parseModuleTabs(
  moduleKey: string,
  perms: Record<string, any>
): Record<string, boolean> {
  const defs = MODULE_TABS[moduleKey] ?? [];
  const modPerms = perms[moduleKey];
  const savedTabs: Record<string, boolean> =
    modPerms && typeof modPerms === "object" && modPerms.tabs
      ? (modPerms.tabs as Record<string, boolean>)
      : {};

  return Object.fromEntries(defs.map((t) => [t.key, savedTabs[t.key] !== false]));
}

/* ──────────────────────────── ACTION ACCESS ──────────────────────────── */

/**
 * Check if a button/action is allowed. Default = ALLOW (backward compatible).
 * Effective access = hospital entitlement AND role authorization.
 * The entitlement floor is enforced even for admins/super-admins.
 */
export function hasActionAccess(
  moduleKey: string,
  actionKey: string,
  permissions: Record<string, any> | null,
  role: string | null
): boolean {
  if (!role) return false;
  // Entitlement floor — applies to ALL roles, including admins.
  if (!isActionEntitled(moduleKey, actionKey, permissions)) return false;
  if (BYPASS_ROLES.includes(role)) return true;
  if (!permissions) return true;
  if (permissions.all === true) return true;

  const modPerms = permissions[moduleKey];
  if (!modPerms) return true;
  if (typeof modPerms === "string") return true;
  if (!modPerms.actions) return true;
  if (modPerms.actions[actionKey] === undefined) return true;

  return !!modPerms.actions[actionKey];
}

export function parseModuleActions(
  moduleKey: string,
  perms: Record<string, any>
): Record<string, boolean> {
  const defs = MODULE_ACTIONS[moduleKey] ?? [];
  const modPerms = perms[moduleKey];
  const savedActions: Record<string, boolean> =
    modPerms && typeof modPerms === "object" && modPerms.actions
      ? (modPerms.actions as Record<string, boolean>)
      : {};

  return Object.fromEntries(defs.map((a) => [a.key, savedActions[a.key] !== false]));
}
