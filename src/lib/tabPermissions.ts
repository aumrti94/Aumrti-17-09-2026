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
    { key: "performance", label: "Performance Appraisals" },
    { key: "occupational_health", label: "Occupational Health" },
    { key: "burnout", label: "Burnout Risk Monitor" },
    { key: "payroll_integrations", label: "Payroll Integrations" },
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
  ],
};

/* ── Action definitions per module ── */
export const MODULE_ACTIONS: Record<string, ActionDef[]> = {
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
  ],
  billing: [
    { key: "new_bill", label: "Create New Bill", description: "Create a new billing record" },
    { key: "approve_discount", label: "Approve Discount", description: "Approve or override discount on a bill" },
    { key: "day_closure", label: "Day Closure", description: "Perform end-of-day billing closure" },
    { key: "waive_amount", label: "Waive Amount", description: "Waive outstanding dues on a bill" },
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
};

const BYPASS_ROLES = ["super_admin", "hospital_admin"];

/* ──────────────────────────── TAB ACCESS ──────────────────────────── */

/**
 * Check if a tab is accessible. Default = ALLOW (backward compatible).
 * Admins/super-admins always pass.
 */
export function hasTabAccess(
  moduleKey: string,
  tabKey: string,
  permissions: Record<string, any> | null,
  role: string | null
): boolean {
  if (!role) return false;
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
 * Admins/super-admins always pass.
 */
export function hasActionAccess(
  moduleKey: string,
  actionKey: string,
  permissions: Record<string, any> | null,
  role: string | null
): boolean {
  if (!role) return false;
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
