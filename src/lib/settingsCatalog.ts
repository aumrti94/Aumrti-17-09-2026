/**
 * Single source of truth for the Settings hub: every settings page, what module(s) it
 * configures, and the module-aware search that powers the Settings search box.
 *
 * WHY THIS EXISTS
 * ---------------
 * The card list used to live inline in SettingsPage.tsx and search was a plain substring
 * match over title + desc. Two failures fell out of that:
 *   1. Searching a MODULE name returned almost nothing — "pharmacy" does not appear in
 *      "Drug Formulary / Hospital drug list and formulary", and the pages that genuinely
 *      configure pharmacy (staff, dropdowns, store locations, IPD ancillary payment) were
 *      invisible. Synonyms users actually type ("pathology", "theatre", "x-ray", "TPA")
 *      returned zero.
 *   2. Six real settings routes had no card at all and were unreachable by browsing OR
 *      search, because nothing linked the card list to the router.
 *
 * So: every entry carries `modules` (canonical keys from moduleKeys.ts) plus `keywords`,
 * `MODULE_ALIASES` maps what users type onto those keys, and settingsCatalog.test.ts reads
 * App.tsx and fails if a settings route ever ships without an entry here.
 *
 * Pages that configure EVERY module (staff, roles, dropdowns, approvals…) are marked
 * `crossCutting` and are returned in their own result bucket, so a module search shows them
 * without them drowning the direct hits.
 */
import {
  Hospital, Palette, Globe, CreditCard, Building2, BedDouble, Clock, Users, Lock,
  CalendarDays, IndianRupee, TestTube, Pill, FileText, ClipboardCheck, BookOpen,
  Bell as BellIcon, Workflow, ShieldCheck, ListChecks, Settings2, MessageSquare,
  PlayCircle, CalendarClock, Smartphone, FileSpreadsheet, Landmark, HardDrive, KeyRound,
  Cpu, Tv2, Monitor, Languages, LayoutGrid, Stethoscope, Network, Boxes,
} from "lucide-react";
import type { ElementType } from "react";
import { PERMISSION_MODULES } from "./moduleRegistry";
import { CANONICAL_MODULE_KEYS } from "./moduleKeys";

export interface SettingsEntry {
  icon: ElementType;
  emoji?: string;
  title: string;
  desc: string;
  route: string;
  /** Display group in the browse grid. */
  group: string;
  /** Canonical module keys (moduleKeys.ts) this page configures. */
  modules: string[];
  /** Extra search terms not present in title/desc. */
  keywords?: string[];
  /** True when the page configures every module (staff, roles, dropdowns, …). */
  crossCutting?: boolean;
  /** moduleKey → route that opens the page on the sub-section relevant to that module. */
  moduleDeepLinks?: Record<string, string>;
}

export const SETTINGS_GROUP_ORDER = [
  "Identity",
  "Plan & Modules",
  "Structure",
  "People & Access",
  "Clinical",
  "Queue Display & Kiosk",
  "Workflows",
  "Integrations",
  "Inventory & Stores",
  "Audit & Compliance",
  "Go-Live & Migration",
] as const;

export const GROUP_EMOJI: Record<string, string> = {
  "Identity": "🏥",
  "Plan & Modules": "🧩",
  "Structure": "🏗️",
  "People & Access": "👥",
  "Clinical": "🩺",
  "Queue Display & Kiosk": "📺",
  "Workflows": "⚙️",
  "Integrations": "🔌",
  "Inventory & Stores": "🏭",
  "Audit & Compliance": "🔒",
  "Go-Live & Migration": "🚀",
};

// ── Reusable module-key bundles ───────────────────────────────────────────────
// Kept as named groups so a page's tags read as intent ("every billable service")
// rather than an unexplained 30-key literal.

/** Everything a hospital can raise a charge for — Service Rates / GST touch all of these. */
const BILLABLE_MODULES = [
  "billing", "opd", "ipd", "day_care", "emergency", "ot", "lab", "radiology", "pharmacy",
  "pharmacy_retail", "health_packages", "dialysis", "oncology", "physio", "dental", "ayush",
  "ivf", "vaccination", "ambulance", "home_care", "blood_bank", "telemedicine", "dietetics",
  "mental_health", "insurance", "pmjay", "payments", "mortuary",
];

/** Patient-facing clinical modules — departments, protocols, consent, templates. */
const CLINICAL_MODULES = [
  "opd", "ipd", "day_care", "emergency", "ot", "nursing", "telemedicine", "dialysis",
  "oncology", "physio", "dental", "ayush", "ivf", "obstetric_anc", "neonatal", "anaesthesia",
  "ophthalmology", "partograph", "mental_health", "chronic_disease", "vaccination",
  "home_care", "dietetics", "ambulance",
];

/** Modules with their own EMR/note templates. */
const EMR_TEMPLATE_MODULES = [
  "opd", "ipd", "emergency", "ot", "nursing", "obstetric_anc", "neonatal", "anaesthesia",
  "ophthalmology", "partograph", "mental_health", "chronic_disease", "dental", "ayush",
  "ivf", "oncology", "dialysis", "physio", "dietetics", "telemedicine", "mrd",
];

/** Modules whose work involves a signed consent / procedure form. */
const CONSENT_MODULES = [
  "ot", "ipd", "day_care", "emergency", "anaesthesia", "ivf", "oncology", "dialysis",
  "blood_bank", "vaccination", "dental", "ophthalmology", "obstetric_anc", "mental_health",
  "telemedicine", "home_care", "mortuary", "research",
];

/** Modules that raise clinical alerts / critical values. */
const ALERTING_MODULES = [
  "ipd", "nursing", "emergency", "lab", "radiology", "ot", "neonatal", "dialysis",
  "chronic_disease", "ai_clinical", "day_care",
];

/** Modules that consume stock from a store. */
const STOCK_MODULES = [
  "inventory", "pharmacy", "pharmacy_retail", "ot", "cssd", "nursing", "ipd", "lab",
  "radiology", "biomedical", "housekeeping", "blood_bank", "vaccination", "dialysis",
  "assets", "fms",
];

// ── The catalog ───────────────────────────────────────────────────────────────

export const SETTINGS_CATALOG: SettingsEntry[] = [
  // ── Identity ────────────────────────────────────────────────────────────────
  {
    icon: Hospital, title: "Hospital Profile", desc: "Name, address, GSTIN, contact details",
    route: "/settings/profile", group: "Identity", modules: ["settings"],
    keywords: ["hospital name", "address", "gstin", "registration", "contact", "logo"],
  },
  {
    icon: Palette, title: "Branding", desc: "Logo, colours, fonts, print templates",
    route: "/settings/branding", group: "Identity", modules: ["settings"],
    keywords: ["theme", "colour", "color", "letterhead", "print", "logo", "font"],
  },
  {
    icon: Palette, title: "White-Label Branding", desc: "Partner/reseller branding, custom domain and product name",
    route: "/settings/white-label", group: "Identity", modules: ["settings"],
    keywords: ["white label", "reseller", "partner", "custom domain", "oem", "rebrand"],
  },
  {
    icon: Globe, title: "Language & Region", desc: "Interface language, date format, currency",
    route: "/settings/language", group: "Identity", modules: ["settings"],
    keywords: ["locale", "timezone", "date format", "currency", "regional"],
  },
  {
    icon: MessageSquare, title: "Support", desc: "Raise a ticket, message Aumrti's team",
    route: "/settings/support", group: "Identity", modules: ["settings"],
    keywords: ["help", "ticket", "contact support", "issue"],
  },
  {
    icon: PlayCircle, title: "Training Videos", desc: "Short how-to videos for every role",
    route: "/settings/training", group: "Identity", modules: ["settings", "lms"],
    keywords: ["tutorial", "how to", "onboarding", "learn"],
  },

  // ── Plan & Modules (cross-cutting: which modules a hospital has at all) ──────
  {
    icon: CreditCard, title: "Plan & Billing", desc: "Your current plan, usage, invoices",
    route: "/settings/plan", group: "Plan & Modules", modules: [], crossCutting: true,
    keywords: ["subscription", "upgrade", "invoice", "licence", "license", "usage", "quota", "renewal"],
  },
  {
    icon: LayoutGrid, title: "Modules Config", desc: "Enable or disable modules and their tabs for this hospital",
    route: "/settings/modules", group: "Plan & Modules", modules: [], crossCutting: true,
    keywords: ["enable module", "disable module", "turn on", "turn off", "entitlement", "feature toggle", "tabs"],
  },
  {
    icon: Settings2, title: "Product Mode", desc: "Switch between clinic, hospital and chain operating modes",
    route: "/settings/product-mode", group: "Plan & Modules", modules: [], crossCutting: true,
    keywords: ["clinic mode", "hospital mode", "chain", "operating mode", "preset"],
  },
  {
    icon: Cpu, title: "AI Features & Attestation", desc: "Enable/disable AI per feature, DPA compliance, doctor attestation policy",
    route: "/settings/ai-features", group: "Plan & Modules", modules: ["ai_clinical"], crossCutting: true,
    keywords: ["artificial intelligence", "ai", "copilot", "scribe", "attestation", "dpa", "llm"],
  },

  // ── Structure ───────────────────────────────────────────────────────────────
  {
    icon: Building2, title: "Departments", desc: "Manage hospital departments and specialties",
    route: "/settings/departments", group: "Structure",
    modules: [...CLINICAL_MODULES, "lab", "radiology", "hr", "quality", "fms", "assets", "biomedical"],
    keywords: ["specialty", "speciality", "unit", "cost centre", "cost center"],
  },
  {
    icon: BedDouble, title: "Wards & Beds", desc: "Configure wards, bed count and categories",
    route: "/settings/wards", group: "Structure",
    modules: ["ipd", "day_care", "nursing", "emergency", "housekeeping", "billing", "oncology", "dialysis"],
    keywords: ["room", "bed", "icu", "ward category", "room rent", "occupancy"],
  },
  {
    icon: Clock, title: "Shifts", desc: "Define shift timings and patterns",
    route: "/settings/shifts", group: "Structure",
    modules: ["hr", "nursing", "ot", "emergency", "lab", "housekeeping", "ipd", "fms", "ambulance"],
    keywords: ["roster", "duty", "timing", "night shift", "rotation"],
  },
  {
    icon: Landmark, title: "Bank Accounts", desc: "Configure bank accounts for reconciliation",
    route: "/settings/bank-accounts", group: "Structure",
    modules: ["accounts", "payments", "billing", "day_closure", "hr"],
    keywords: ["bank", "reconciliation", "upi", "cheque", "ifsc", "cash"],
  },
  {
    icon: ListChecks, title: "Configurable Dropdowns",
    desc: "Customise every dropdown in the system — admission types, drug routes, leave types, TPA list, lab categories and more",
    route: "/settings/config-values", group: "Structure", modules: [], crossCutting: true,
    keywords: ["dropdown", "picklist", "master list", "options", "lookup", "select values"],
    moduleDeepLinks: {
      pharmacy:         "/settings/config-values?cat=drug_routes",
      pharmacy_retail:  "/settings/config-values?cat=drug_routes",
      lab:              "/settings/config-values?cat=lab_test_categories",
      hr:               "/settings/config-values?cat=leave_types",
      insurance:        "/settings/config-values?cat=tpa_companies",
      pmjay:            "/settings/config-values?cat=government_schemes",
      inventory:        "/settings/config-values?cat=inventory_categories",
      housekeeping:     "/settings/config-values?cat=housekeeping_task_types",
      biomedical:       "/settings/config-values?cat=equipment_categories",
      ipd:              "/settings/config-values?cat=admission_types",
      day_care:         "/settings/config-values?cat=admission_types",
      dialysis:         "/settings/config-values?cat=dialysis_complications",
      home_care:        "/settings/config-values?cat=home_care_services",
      physio:           "/settings/config-values?cat=physio_modalities",
      mortuary:         "/settings/config-values?cat=death_manner_types",
      mrd:              "/settings/config-values?cat=record_requester_types",
    },
  },

  // ── People & Access ─────────────────────────────────────────────────────────
  {
    icon: Users, title: "Staff Members", desc: "Add, edit, deactivate staff accounts",
    route: "/settings/staff", group: "People & Access", modules: ["hr"], crossCutting: true,
    keywords: ["user", "account", "login", "employee", "doctor", "nurse", "technician", "pharmacist", "add user"],
  },
  {
    icon: Lock, title: "Roles & Permissions", desc: "Define roles, assign module access",
    route: "/settings/roles", group: "People & Access", modules: [], crossCutting: true,
    keywords: ["access", "permission", "rbac", "privilege", "who can", "rights", "tabs", "buttons"],
  },
  {
    icon: CalendarDays, title: "Doctor Schedules", desc: "OPD timings, slots, leave blocks",
    route: "/settings/doctor-schedules", group: "People & Access",
    modules: ["opd", "telemedicine", "hr", "health_packages", "dental", "physio"],
    keywords: ["appointment", "slot", "availability", "consultation timing", "booking"],
  },
  {
    icon: IndianRupee, title: "Service Rates", desc: "OPD fees, room rates, package pricing",
    route: "/settings/services", group: "People & Access", modules: BILLABLE_MODULES,
    keywords: ["price", "tariff", "charge", "rate card", "fee", "service master", "cost"],
  },
  {
    icon: CreditCard, title: "Payer Masters", desc: "TPAs, corporates, PMJAY, CGHS, ESI, and scheme accounts",
    route: "/settings/payer-masters", group: "People & Access",
    modules: ["insurance", "pmjay", "billing", "payments", "accounts"],
    keywords: ["tpa", "corporate", "scheme", "cashless", "empanelment", "payer", "cghs", "esi", "insurer"],
  },

  // ── Clinical ────────────────────────────────────────────────────────────────
  {
    icon: TestTube, title: "Lab Test Master", desc: "Manage lab test catalog and panels",
    route: "/settings/lab-tests", group: "Clinical", modules: ["lab", "billing", "health_packages"],
    keywords: ["pathology", "lims", "lis", "test", "panel", "profile", "reference range", "sample"],
  },
  {
    icon: Pill, title: "Drug Formulary", desc: "Hospital drug list and formulary",
    route: "/settings/drugs", group: "Clinical",
    modules: ["pharmacy", "pharmacy_retail", "ipd", "opd", "emergency", "oncology"],
    keywords: ["medicine", "medication", "drug master", "brand", "generic", "dose", "ndps", "prescription"],
  },
  {
    icon: FileText, title: "Consent Forms", desc: "Manage consent form templates",
    route: "/settings/consent-forms", group: "Clinical", modules: CONSENT_MODULES,
    keywords: ["consent", "form", "signature", "declaration", "medico-legal"],
  },
  {
    icon: ClipboardCheck, title: "OT Checklist", desc: "WHO surgical safety checklist config",
    route: "/settings/ot-checklist", group: "Clinical", modules: ["ot", "anaesthesia", "quality"],
    keywords: ["surgery", "theatre", "theater", "who checklist", "sign in", "time out", "safety"],
  },
  {
    icon: BookOpen, title: "Clinical Protocols", desc: "Standard treatment protocols",
    route: "/settings/protocols", group: "Clinical", modules: [...CLINICAL_MODULES, "quality", "ipc"],
    keywords: ["pathway", "guideline", "order set", "standard treatment", "sop"],
  },
  {
    icon: BellIcon, title: "Alert Thresholds", desc: "Vitals and lab critical value alerts",
    route: "/settings/clinical-thresholds", group: "Clinical", modules: ALERTING_MODULES,
    keywords: ["critical value", "vitals", "early warning", "news", "escalation", "panic value"],
  },
  {
    icon: FileText, title: "ICD-10 Code Master", desc: "Manage diagnosis code sets for ICD coding",
    route: "/settings/icd-codes", group: "Clinical",
    modules: ["mrd", "insurance", "pmjay", "billing", "hmis", "analytics", ...CLINICAL_MODULES],
    keywords: ["diagnosis", "icd", "coding", "morbidity", "casemix"],
  },
  {
    icon: Settings2, title: "Radiology Modalities", desc: "Manage modality types and pricing",
    route: "/settings/radiology", group: "Clinical", modules: ["radiology", "billing"],
    keywords: ["x-ray", "xray", "ct", "mri", "ultrasound", "scan", "imaging", "pacs", "modality"],
  },
  {
    icon: ClipboardCheck, title: "Day Care Procedures", desc: "Configure approved day care procedure catalog",
    route: "/settings/day-care-procedures", group: "Clinical", modules: ["day_care", "ipd", "ot", "billing"],
    keywords: ["day care", "daycare", "same day", "procedure catalog", "short stay"],
  },
  {
    icon: Stethoscope, title: "EMR Templates", desc: "Specialty note templates for consultations and clinical records",
    route: "/settings/templates", group: "Clinical", modules: EMR_TEMPLATE_MODULES,
    keywords: ["template", "note", "emr", "specialty template", "form builder", "chart"],
  },

  // ── Queue Display & Kiosk ───────────────────────────────────────────────────
  {
    icon: Tv2, title: "TV Queue Display",
    desc: "Multi-doctor queue, SpeechSynthesis announcements, language support, marketing banners",
    route: "/settings/tv-display", group: "Queue Display & Kiosk",
    modules: ["tv_display", "opd", "crm"],
    keywords: ["token display", "waiting area", "announcement", "screen", "signage", "queue"],
  },
  {
    icon: Monitor, title: "Self-Service Kiosk",
    desc: "Touch-screen kiosk configuration, device URL, and registration flow settings",
    route: "/settings/tv-display", group: "Queue Display & Kiosk",
    modules: ["tv_display", "opd", "patient_portal"],
    keywords: ["kiosk", "self service", "touch screen", "self registration", "check in"],
  },

  // ── Workflows ───────────────────────────────────────────────────────────────
  {
    icon: Workflow, title: "Discharge Workflow", desc: "Discharge checklist and approval flow",
    route: "/settings/discharge-workflow", group: "Workflows",
    modules: ["ipd", "day_care", "nursing", "billing", "mrd", "emergency"],
    keywords: ["discharge", "summary", "checklist", "clearance", "bed release"],
  },
  {
    icon: ShieldCheck, title: "Approval Rules", desc: "Discount, refund and override approvals",
    route: "/settings/approvals", group: "Workflows", modules: [], crossCutting: true,
    keywords: ["approval", "discount", "refund", "override", "authorisation", "authorization", "limit", "maker checker"],
  },
  {
    icon: ListChecks, title: "OPD Queue Config", desc: "Token generation and queue rules",
    route: "/settings/opd-workflow", group: "Workflows", modules: ["opd", "tv_display", "telemedicine"],
    keywords: ["token", "queue", "walk in", "appointment", "waiting", "outpatient"],
  },
  {
    icon: IndianRupee, title: "IPD Ancillary Payment",
    desc: "Pay-before-service vs accrue-to-bill for pharmacy, lab, radiology",
    route: "/settings/ipd-ancillary-payment", group: "Workflows",
    modules: ["ipd", "day_care", "billing", "pharmacy", "lab", "radiology"],
    keywords: ["accrue", "pay before service", "credit", "ancillary", "indent", "charge posting"],
  },
  {
    icon: Settings2, title: "Notification Config", desc: "SMS, email and push notification rules",
    route: "/settings/notifications", group: "Workflows", modules: [], crossCutting: true,
    keywords: ["sms", "email", "push", "alert", "reminder", "template", "message"],
  },
  {
    icon: MessageSquare, title: "WhatsApp Bot", desc: "Automated WhatsApp message config",
    route: "/settings/whatsapp", group: "Workflows",
    modules: ["crm", "inbox", "patient_relations", "patient_portal", "opd", "billing"],
    keywords: ["whatsapp", "wati", "chat", "bot", "message", "reminder"],
  },
  {
    icon: CalendarClock, title: "Scheduled Reports", desc: "Auto-generate and email reports",
    route: "/settings/report-schedules", group: "Workflows",
    modules: ["analytics", "hod_dashboard", "accounts", "billing", "hmis", "quality"],
    keywords: ["report", "schedule", "cron", "email report", "mis", "digest"],
  },

  // ── Integrations ────────────────────────────────────────────────────────────
  {
    icon: Cpu, title: "Integrations Console",
    desc: "Lab analyzers, PACS, WhatsApp multi-provider, Tally ledger mapping",
    route: "/settings/integrations", group: "Integrations",
    modules: ["lab", "radiology", "accounts", "crm", "inbox", "biomedical"],
    keywords: ["analyzer", "analyser", "pacs", "tally", "interface", "middleware", "device"],
  },
  {
    icon: Network, title: "HL7 / FHIR Integration", desc: "HL7 v2 and FHIR message endpoints for external systems",
    route: "/settings/hl7", group: "Integrations",
    modules: ["lab", "radiology", "abdm", "mrd", "ipd", "opd"],
    keywords: ["hl7", "fhir", "adt", "oru", "orm", "interoperability", "message", "endpoint"],
  },
  {
    icon: CreditCard, title: "Razorpay Payments", desc: "Payment gateway configuration",
    route: "/settings/razorpay", group: "Integrations",
    modules: ["payments", "billing", "patient_portal", "pharmacy_retail"],
    keywords: ["gateway", "razorpay", "online payment", "upi", "card", "refund"],
  },
  {
    icon: FileSpreadsheet, title: "HMIS / IHIP Portal", desc: "MoHFW portal credentials for report submission",
    route: "/settings/hmis-portal", group: "Integrations", modules: ["hmis", "quality", "analytics"],
    keywords: ["hmis", "ihip", "mohfw", "government report", "nhm", "submission"],
  },
  {
    icon: Smartphone, title: "WhatsApp / WATI", desc: "WhatsApp Business API setup",
    route: "/settings/whatsapp", group: "Integrations",
    modules: ["crm", "inbox", "patient_portal", "patient_relations"],
    keywords: ["whatsapp", "wati", "business api", "provider", "sender"],
  },
  {
    icon: FileSpreadsheet, title: "GST / NIC IRP", desc: "e-Invoice config + GSTIN mapping",
    route: "/settings/gst", group: "Integrations",
    modules: ["billing", "accounts", "payments", "pharmacy", "pharmacy_retail", "inventory"],
    keywords: ["gst", "gstin", "e-invoice", "irp", "hsn", "sac", "tax", "cgst", "sgst", "igst"],
  },
  {
    icon: Landmark, title: "ABDM / ABHA", desc: "ABDM HIP/HIU configuration",
    route: "/settings/abdm", group: "Integrations", modules: ["abdm", "patient_portal", "mrd"],
    keywords: ["abha", "abdm", "ndhm", "health id", "hip", "hiu", "consent artefact"],
  },
  {
    icon: HardDrive, title: "Backup & Export", desc: "Data export, audit logs",
    route: "/settings/backup", group: "Integrations", modules: [], crossCutting: true,
    keywords: ["backup", "export", "download data", "dump", "restore", "archive"],
  },
  {
    icon: KeyRound, title: "API Keys", desc: "Developer API access tokens",
    route: "/settings/api-keys", group: "Integrations", modules: [],
    keywords: ["api", "token", "developer", "key", "secret", "webhook"],
  },
  {
    icon: KeyRound, title: "API Portal", desc: "Developer portal — endpoints, docs and sandbox access",
    route: "/settings/api-portal", group: "Integrations", modules: [],
    keywords: ["api", "developer portal", "documentation", "sandbox", "endpoint", "swagger"],
  },
  {
    icon: Cpu, title: "Integration Keys",
    desc: "Payment, WhatsApp & government API keys (AI is configured centrally)",
    route: "/settings/api-hub", group: "Integrations",
    modules: ["payments", "crm", "abdm", "hmis"],
    keywords: ["credential", "api key", "secret", "provider", "gateway"],
  },
  {
    icon: Languages, title: "AI Language Packs",
    desc: "Multi-language output for Voice Scribe, Token Display, Discharge Summary — 10+ Indian languages",
    route: "/settings/ai-languages", group: "Integrations",
    modules: ["ai_clinical", "opd", "ipd", "tv_display", "patient_portal"],
    keywords: ["language", "translation", "hindi", "telugu", "tamil", "voice", "scribe", "regional"],
  },

  // ── Inventory & Stores ──────────────────────────────────────────────────────
  {
    icon: Boxes, title: "Store Locations", desc: "Central store, ward sub-stores, OT store, ICU store",
    route: "/settings/inventory", group: "Inventory & Stores", modules: STOCK_MODULES,
    keywords: ["store", "warehouse", "sub store", "stock location", "indent", "consumables", "supply"],
  },

  // ── Audit & Compliance ──────────────────────────────────────────────────────
  {
    icon: ShieldCheck, title: "Record Retention",
    desc: "Retention policies per record type — NABH IMS compliance",
    route: "/settings/record-retention", group: "Audit & Compliance",
    modules: ["mrd", "quality", "lab", "radiology", "ipd"],
    keywords: ["retention", "archive", "purge", "nabh", "ims", "policy", "medical records"],
  },
  {
    icon: ClipboardCheck, title: "Record Access Log",
    desc: "Who accessed which records — IMS evidence for NABH assessments",
    route: "/ims/access-logs", group: "Audit & Compliance", modules: ["mrd", "quality"], crossCutting: true,
    keywords: ["audit", "access log", "who viewed", "trail", "nabh", "privacy"],
  },
  {
    icon: ListChecks, title: "Config Change Log",
    desc: "Audit trail of all configuration changes — controlled change management",
    route: "/settings/change-log", group: "Audit & Compliance", modules: [], crossCutting: true,
    keywords: ["audit", "change log", "history", "who changed", "trail", "change management"],
  },

  // ── Go-Live & Migration ─────────────────────────────────────────────────────
  {
    icon: ListChecks, title: "Go-Live Checklist", desc: "Pre-launch readiness verification for pilot hospitals",
    route: "/admin/go-live", group: "Go-Live & Migration", modules: [], crossCutting: true,
    keywords: ["go live", "launch", "readiness", "cutover", "pilot", "checklist"],
  },
  {
    icon: HardDrive, emoji: "📥", title: "Data Migration",
    desc: "Import patients, staff, drugs, and services from your old system",
    route: "/admin/data-migration", group: "Go-Live & Migration", modules: [], crossCutting: true,
    keywords: ["import", "migration", "excel", "upload", "old hms", "csv", "bulk", "template"],
  },
];

// ── Module aliases: what people type → canonical module key ───────────────────

export const MODULE_ALIASES: Record<string, string[]> = {
  opd:              ["outpatient", "out patient", "consultation", "token", "queue", "clinic"],
  ipd:              ["inpatient", "in patient", "admission", "ward", "bed", "admitted"],
  day_care:         ["daycare", "day care", "same day", "short stay"],
  emergency:        ["casualty", "er", "ed", "trauma", "triage"],
  ot:               ["theatre", "theater", "operation theatre", "surgery", "surgical", "operating room"],
  nursing:          ["nurse", "mar", "vitals", "ward nursing", "bedside"],
  telemedicine:     ["teleconsult", "tele consultation", "video consult", "online consultation"],
  health_packages:  ["package", "health checkup", "master health", "preventive"],
  lab:              ["pathology", "laboratory", "lims", "lis", "test", "sample", "specimen", "diagnostics"],
  radiology:        ["ris", "imaging", "xray", "x-ray", "ct", "mri", "ultrasound", "scan", "pacs", "sonography"],
  blood_bank:       ["blood", "transfusion", "donor", "bloodbank"],
  cssd:             ["sterilisation", "sterilization", "sterile", "autoclave", "tssu"],
  pharmacy:         ["drug", "drugs", "medicine", "medication", "chemist", "dispensary", "formulary", "prescription", "pharmacist", "dispensing"],
  pharmacy_retail:  ["retail pharmacy", "otc", "counter sale", "outpatient pharmacy"],
  billing:          ["bill", "invoice", "charge", "tariff", "cashier", "estimate"],
  day_closure:      ["day closure", "cash closure", "shift closure", "eod", "end of day", "reconciliation"],
  insurance:        ["tpa", "claim", "cashless", "payer", "pre auth", "preauth", "mediclaim", "policy"],
  payments:         ["payment", "gateway", "receipt", "collection", "refund"],
  accounts:         ["accounting", "erp", "ledger", "journal", "finance", "tally", "gl"],
  assets:           ["asset", "fixed asset", "depreciation", "equipment register"],
  pmjay:            ["ayushman", "government scheme", "arogyasri", "cghs", "echs", "esi", "scheme"],
  hr:               ["human resource", "payroll", "employee", "attendance", "leave", "salary", "staff", "recruitment"],
  inventory:        ["stock", "store", "purchase", "procurement", "grn", "vendor", "supplier", "indent", "consumable", "supply chain"],
  quality:          ["nabh", "jci", "accreditation", "audit", "incident", "compliance"],
  dialysis:         ["renal", "nephrology", "haemodialysis", "hemodialysis", "hd"],
  oncology:         ["cancer", "chemo", "chemotherapy", "tumour", "tumor"],
  physio:           ["physiotherapy", "rehab", "rehabilitation", "pt"],
  mortuary:         ["morgue", "death", "medico legal", "medico-legal", "postmortem", "body"],
  vaccination:      ["vaccine", "immunisation", "immunization", "jab", "shot"],
  ambulance:        ["emt", "transport", "fleet", "108"],
  home_care:        ["home visit", "domiciliary", "home health"],
  dental:           ["dentist", "dentistry", "odontology", "tooth"],
  ayush:            ["ayurveda", "homeopathy", "unani", "siddha", "yoga", "naturopathy"],
  ivf:              ["fertility", "art", "embryology", "infertility", "assisted reproduction"],
  obstetric_anc:    ["antenatal", "anc", "obstetric", "obstetrics", "pregnancy", "maternity"],
  neonatal:         ["nicu", "newborn", "neonate", "paediatric", "pediatric"],
  anaesthesia:      ["anesthesia", "anaesthetist", "anesthesiology", "pac"],
  ophthalmology:    ["eye", "optometry", "vision", "ophthalmic"],
  partograph:       ["labour", "labor", "delivery", "birth"],
  mental_health:    ["psychiatry", "psychology", "counselling", "counseling", "behavioural"],
  chronic_disease:  ["ncd", "diabetes", "hypertension", "chronic care"],
  mrd:              ["medical records", "health records", "file", "case sheet", "record department"],
  biomedical:       ["equipment", "device", "calibration", "biomed", "maintenance"],
  housekeeping:     ["cleaning", "sanitation", "linen", "janitorial"],
  hmis:             ["ihip", "mohfw", "government report", "nhm", "public health reporting"],
  dietetics:        ["diet", "nutrition", "dietician", "dietitian", "meal", "food"],
  lms:              ["training", "learning", "course", "cme", "education"],
  crm:              ["marketing", "campaign", "lead", "referral", "outreach"],
  abdm:             ["abha", "ndhm", "health id", "hip", "hiu", "digital mission"],
  patient_portal:   ["portal", "patient app", "self service", "kiosk"],
  patient_relations:["pro", "feedback", "grievance", "complaint", "satisfaction"],
  inbox:            ["message", "communication", "chat", "conversation"],
  ipc:              ["infection", "infection control", "hai", "antibiogram", "hand hygiene"],
  fms:              ["facility", "safety", "utility", "fire", "maintenance"],
  ai_clinical:      ["ai", "artificial intelligence", "copilot", "scribe", "llm", "machine learning"],
  research:         ["trial", "study", "ethics", "irb"],
  analytics:        ["bi", "dashboard", "report", "mis", "insight", "kpi"],
  hod_dashboard:    ["hod", "head of department", "department dashboard"],
  tv_display:       ["tv", "display", "signage", "waiting area", "announcement", "kiosk"],
  settings:         ["configuration", "config", "setup", "preferences", "system"],
};

// ── Search ────────────────────────────────────────────────────────────────────

const MODULE_LABEL: Record<string, string> = Object.fromEntries(
  PERMISSION_MODULES.map((m) => [m.key, m.label]),
);

/** Human label for a module key (falls back to a de-underscored key). */
export function moduleLabel(key: string): string {
  return MODULE_LABEL[key] ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Label without the system-acronym suffix — "Laboratory (LIS)" → "Laboratory". Used in
 * headings and hint lines, where the acronym is noise.
 */
export function moduleShortLabel(key: string): string {
  return moduleLabel(key).replace(/\s*\([^)]*\)\s*$/, "");
}

/** Every search token that should resolve to a given module key. */
function moduleTokens(key: string): string[] {
  return [
    key,
    key.replace(/_/g, " "),
    (MODULE_LABEL[key] ?? "").toLowerCase(),
    ...(MODULE_ALIASES[key] ?? []),
  ].filter(Boolean);
}

/**
 * Searchable module keys = the canonical list, minus the routeless `ai_suite` pseudo-module
 * (it has no settings page of its own — the AI Features page covers it). Derived from
 * CANONICAL_MODULE_KEYS rather than MODULE_ALIASES so a new module is searchable by its own
 * name the moment it is added, alias table or not.
 */
export const SEARCHABLE_MODULE_KEYS: string[] = CANONICAL_MODULE_KEYS.filter(
  (k) => k !== "ai_suite",
);

/**
 * Resolve a free-text query to canonical module keys.
 *
 * Matches on the key itself, the module's display label, and its aliases. Short queries
 * (< 3 chars) must match a token exactly so "ot" and "hr" work without "o" dragging in
 * half the catalog.
 */
export function resolveModuleQuery(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exactOnly = q.length < 3;

  const hits: string[] = [];
  for (const key of SEARCHABLE_MODULE_KEYS) {
    const match = moduleTokens(key).some((raw) => {
      const t = raw.toLowerCase();
      if (t === q) return true;
      if (exactOnly) return false;
      if (t.startsWith(q)) return true;
      return t.split(/[\s/&-]+/).some((w) => w.startsWith(q));
    });
    if (match) hits.push(key);
  }
  return hits;
}

function haystack(e: SettingsEntry): string {
  return [e.title, e.desc, ...(e.keywords ?? []), ...e.modules.map(moduleLabel)]
    .join(" ")
    .toLowerCase();
}

/**
 * Word-prefix match, not raw substring — a raw `includes` made the 2-char query "hr" hit
 * "T-hr-esholds" and "C-hr-onic Disease", which is exactly the unrelated noise this search
 * is meant to eliminate.
 */
function textMatches(e: SettingsEntry, q: string): boolean {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}`).test(haystack(e));
}

function score(e: SettingsEntry, q: string, moduleKeys: string[]): number {
  const title = e.title.toLowerCase();
  let s = 0;
  if (title === q) s += 100;
  else if (title.startsWith(q)) s += 60;
  else if (title.includes(q)) s += 40;
  // `modules` is written primary-first, so a page whose FIRST tag is the searched module
  // (Drug Formulary → pharmacy) must outrank one that merely touches it in passing
  // (Razorpay → payments, billing, portal, pharmacy_retail).
  if (moduleKeys.length) {
    const idx = e.modules.findIndex((m) => moduleKeys.includes(m));
    if (idx >= 0) s += Math.max(6, 30 - idx * 4);
  }
  if ((e.keywords ?? []).some((k) => k.toLowerCase() === q)) s += 20;
  if (e.desc.toLowerCase().includes(q)) s += 10;
  return s;
}

export interface SettingsSearchResult {
  /** Canonical module keys the query resolved to (empty for plain text queries). */
  moduleKeys: string[];
  /** Pages that configure the matched module(s), or plain text matches. */
  direct: SettingsEntry[];
  /** Pages that configure every module — only populated for module queries. */
  crossCutting: SettingsEntry[];
}

/**
 * Module-aware settings search.
 *
 * A MODULE query ("pharmacy", "pathology", "theatre") returns every page tagged with that
 * module in `direct`, and every cross-cutting page in `crossCutting` — that split is what
 * lets the UI show "also configures Pharmacy" without burying the direct hits.
 *
 * A PLAIN query ("gstin", "backup", "razorpay") behaves like the old substring search:
 * everything lands in `direct` and `crossCutting` stays empty.
 */
export function searchSettings(query: string): SettingsSearchResult {
  const q = query.trim().toLowerCase();
  if (!q) return { moduleKeys: [], direct: [], crossCutting: [] };

  const moduleKeys = resolveModuleQuery(q);
  const byScore = (a: SettingsEntry, b: SettingsEntry) =>
    score(b, q, moduleKeys) - score(a, q, moduleKeys) || a.title.localeCompare(b.title);

  if (moduleKeys.length === 0) {
    return {
      moduleKeys,
      direct: SETTINGS_CATALOG.filter((e) => textMatches(e, q)).sort(byScore),
      crossCutting: [],
    };
  }

  const direct = SETTINGS_CATALOG.filter(
    (e) => !e.crossCutting && (e.modules.some((m) => moduleKeys.includes(m)) || textMatches(e, q)),
  ).sort(byScore);

  const crossCutting = SETTINGS_CATALOG.filter((e) => e.crossCutting).sort(byScore);

  return { moduleKeys, direct, crossCutting };
}

/** Route a card should navigate to for a given module context. */
export function entryRoute(e: SettingsEntry, moduleKey?: string): string {
  if (moduleKey && e.moduleDeepLinks?.[moduleKey]) return e.moduleDeepLinks[moduleKey];
  return e.route;
}

/**
 * One-line explanation of WHY a cross-cutting page appears under a module search —
 * e.g. Staff Members under "pharmacy" reads "add pharmacists and their logins".
 */
const CROSS_CUTTING_HINTS: Record<string, string> = {
  "/settings/staff":            "add {m} staff and their logins",
  "/settings/roles":            "who can see and do what in {m}",
  "/settings/config-values":    "dropdown lists used across {m}",
  "/settings/notifications":    "SMS, email and push alerts for {m}",
  "/settings/approvals":        "discount, refund and override approvals for {m}",
  "/settings/plan":             "whether {m} is included in your plan",
  "/settings/modules":          "turn {m} and its tabs on or off",
  "/settings/product-mode":     "operating mode that shapes {m}",
  "/settings/ai-features":      "AI features available inside {m}",
  "/settings/change-log":       "audit trail of {m} configuration changes",
  "/settings/backup":           "export {m} data",
  "/ims/access-logs":           "who accessed {m} records",
  "/admin/go-live":             "{m} readiness before launch",
  "/admin/data-migration":      "import your existing {m} data",
};

export function crossCuttingHint(e: SettingsEntry, moduleKey?: string): string | undefined {
  const tpl = CROSS_CUTTING_HINTS[e.route];
  if (!tpl || !moduleKey) return undefined;
  return tpl.replace("{m}", moduleShortLabel(moduleKey));
}
