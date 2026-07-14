import React, { useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  X, Upload, Check, ArrowRight, ArrowLeft, Download,
  AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2
} from "lucide-react";
import * as XLSX from "xlsx";

type EntityType = "patients" | "staff" | "services" | "drugs" | "vendors" | "lab_tests";

interface ImportWizardProps {
  entityType: EntityType;
  onClose: () => void;
  onComplete: (jobId: string) => void;
}

interface FieldDef {
  key: string;
  label: string;
  required: boolean;
}

interface ValidationError {
  row: number;
  field: string;
  message: string;
  data: Record<string, any>;
}

const ENTITY_FIELDS: Record<EntityType, FieldDef[]> = {
  patients: [
    { key: "full_name", label: "Full Name", required: true },
    { key: "phone", label: "Phone", required: false },
    { key: "dob", label: "Date of Birth", required: false },
    { key: "age", label: "Age", required: false },
    { key: "gender", label: "Gender", required: false },
    { key: "blood_group", label: "Blood Group", required: false },
    { key: "patient_category", label: "Patient Category", required: false },
    { key: "address", label: "Address", required: false },
    { key: "uhid", label: "UHID", required: false },
    { key: "allergies", label: "Allergies", required: false },
    { key: "chronic_conditions", label: "Chronic Conditions", required: false },
    { key: "insurance_id", label: "Insurance / TPA ID", required: false },
    { key: "abha_id", label: "ABHA ID", required: false },
    { key: "aadhaar_id", label: "Aadhaar ID", required: false },
    { key: "patient_gstin", label: "Company GSTIN", required: false },
    { key: "referral_source", label: "Referral Source", required: false },
    { key: "emergency_contact_name", label: "Emergency Contact Name", required: false },
    { key: "emergency_contact_phone", label: "Emergency Contact Phone", required: false },
  ],
  staff: [
    { key: "full_name", label: "Full Name", required: true },
    { key: "phone", label: "Phone", required: true },
    { key: "email", label: "Email", required: false },
    { key: "role", label: "Role", required: true },
    { key: "department", label: "Department", required: false },
    { key: "employee_id", label: "Employee ID", required: false },
    { key: "registration_number", label: "Registration / License No", required: false },
    { key: "employment_type", label: "Employment Type", required: false },
    { key: "payroll_type", label: "Payroll Type (staff/consultant)", required: false },
    { key: "basic_salary", label: "Basic Salary (₹/month)", required: false },
    { key: "hra_percent", label: "HRA %", required: false },
    { key: "da_percent", label: "DA %", required: false },
    { key: "conveyance", label: "Conveyance (₹)", required: false },
    { key: "medical_allowance", label: "Medical Allowance (₹)", required: false },
    { key: "pf_applicable", label: "PF Applicable (yes/no)", required: false },
    { key: "esic_applicable", label: "ESIC Applicable (yes/no)", required: false },
    { key: "uan_number", label: "UAN (EPF)", required: false },
    { key: "pan_number", label: "PAN", required: false },
    { key: "esi_ip_number", label: "ESI IP No", required: false },
    { key: "license_expiry_date", label: "License Expiry Date", required: false },
  ],
  services: [
    { key: "service_name", label: "Service Name", required: true },
    { key: "category", label: "Category", required: true },
    { key: "rate", label: "Rate (₹)", required: true },
    { key: "gst_percent", label: "GST %", required: false },
    { key: "hsn_code", label: "HSN Code", required: false },
    { key: "description", label: "Description", required: false },
  ],
  drugs: [
    { key: "drug_name", label: "Drug Name", required: true },
    { key: "generic_name", label: "Generic Name", required: false },
    { key: "category", label: "Category", required: true },
    { key: "schedule", label: "Schedule", required: false },
    { key: "strength", label: "Strength", required: false },
    { key: "form", label: "Form", required: false },
    { key: "mrp", label: "MRP (₹)", required: false },
    { key: "hsn_code", label: "HSN Code", required: false },
  ],
  vendors: [
    { key: "vendor_name", label: "Vendor Name", required: true },
    { key: "contact_person", label: "Contact Person", required: false },
    { key: "phone", label: "Phone", required: true },
    { key: "email", label: "Email", required: false },
    { key: "gst_number", label: "GST Number", required: false },
    { key: "address", label: "Address", required: false },
  ],
  lab_tests: [
    { key: "test_name", label: "Test Name", required: true },
    { key: "test_code", label: "Test Code", required: false },
    { key: "category", label: "Category", required: true },
    { key: "sample_type", label: "Sample Type", required: false },
    { key: "unit", label: "Unit", required: false },
    { key: "normal_range_low", label: "Normal Range Low", required: false },
    { key: "normal_range_high", label: "Normal Range High", required: false },
    { key: "tat_hours", label: "TAT (hours)", required: false },
  ],
};

const ENTITY_LABELS: Record<EntityType, string> = {
  patients: "Patients",
  staff: "Staff Members",
  services: "Service Rates",
  drugs: "Drug Master",
  vendors: "Vendors",
  lab_tests: "Lab Tests",
};

const AUTO_MATCH: Record<string, string[]> = {
  full_name: ["name", "patient_name", "full_name", "fullname", "patient name", "staff_name"],
  phone: ["phone", "mobile", "contact", "phone_number", "mobile_number", "contact_number"],
  email: ["email", "email_id", "mail"],
  dob: ["dob", "date_of_birth", "birth_date", "birthdate"],
  gender: ["gender", "sex"],
  address: ["address", "addr", "full_address"],
  uhid: ["uhid", "mr_number", "mrn", "patient_id", "old_id"],
  blood_group: ["blood_group", "blood", "bloodgroup"],
  age: ["age"],
  patient_category: ["patient_category", "category", "payer_category", "payer_type"],
  allergies: ["allergies", "allergy", "known_allergies"],
  chronic_conditions: ["chronic_conditions", "chronic_condition", "comorbidities", "conditions"],
  insurance_id: ["insurance_id", "insurance_tpa_id", "tpa_id", "insurance_no", "policy_number"],
  abha_id: ["abha_id", "abha_number", "abha"],
  aadhaar_id: ["aadhaar_id", "aadhaar", "aadhar", "aadhar_id"],
  patient_gstin: ["patient_gstin", "gstin", "company_gstin"],
  referral_source: ["referral_source", "referral", "referred_by", "source"],
  emergency_contact_name: ["emergency_contact_name", "emergency_contact", "emergency_name", "next_of_kin"],
  emergency_contact_phone: ["emergency_contact_phone", "emergency_phone", "emergency_number"],
  role: ["role", "designation", "position"],
  department: ["department", "dept"],
  employee_id: ["employee_id", "emp_id", "staff_id"],
  service_name: ["service_name", "service", "name", "item_name"],
  category: ["category", "type", "group"],
  rate: ["rate", "fee", "price", "amount", "charges"],
  gst_percent: ["gst_percent", "gst", "gst%", "tax"],
  hsn_code: ["hsn_code", "hsn", "sac_code"],
  description: ["description", "desc", "details"],
  drug_name: ["drug_name", "drug", "name", "brand_name", "medicine"],
  generic_name: ["generic_name", "generic", "salt", "composition"],
  schedule: ["schedule", "drug_schedule"],
  strength: ["strength", "dose"],
  form: ["form", "dosage_form", "type"],
  mrp: ["mrp", "price", "rate"],
  vendor_name: ["vendor_name", "vendor", "supplier", "name", "company"],
  contact_person: ["contact_person", "contact_name", "person"],
  gst_number: ["gst_number", "gstin", "gst", "gst_no"],
  test_name: ["test_name", "test", "name", "investigation"],
  test_code: ["test_code", "code"],
  sample_type: ["sample_type", "sample", "specimen"],
  unit: ["unit", "units"],
  normal_range_low: ["normal_range_low", "normal_low", "ref_low", "min"],
  normal_range_high: ["normal_range_high", "normal_high", "ref_high", "max"],
  tat_hours: ["tat_hours", "tat", "turnaround"],
  registration_number: ["registration_number", "reg_no", "reg_number", "registration", "license_no", "license_number", "medical_reg_no"],
  employment_type: ["employment_type", "employment", "emp_type"],
  payroll_type: ["payroll_type", "payroll", "tds_type"],
  basic_salary: ["basic_salary", "basic", "salary", "basic_pay"],
  hra_percent: ["hra_percent", "hra", "hra%", "hra_pct"],
  da_percent: ["da_percent", "da", "da%", "da_pct"],
  conveyance: ["conveyance", "conveyance_allowance", "transport_allowance"],
  medical_allowance: ["medical_allowance", "medical", "medical_allow"],
  pf_applicable: ["pf_applicable", "pf", "epf", "provident_fund"],
  esic_applicable: ["esic_applicable", "esic", "esi_applicable"],
  uan_number: ["uan_number", "uan", "uan_epf"],
  pan_number: ["pan_number", "pan"],
  esi_ip_number: ["esi_ip_number", "esi_ip", "esi_ip_no", "ip_number"],
  license_expiry_date: ["license_expiry_date", "license_expiry", "license_expiry_dt", "registration_expiry", "reg_expiry"],
};

const STEPS = ["Upload", "Map", "Validate", "Preview", "Import"];

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

// Accepts Excel serial numbers, ISO, DD/MM/YYYY, MM/DD/YYYY, DD.MM.YYYY, "28 Nov 1966",
// "November 28, 1966", 2-digit years, etc. Returns YYYY-MM-DD or null if unparseable.
function parseFlexibleDate(raw: any): string | null {
  if (raw === null || raw === undefined || raw === "") return null;

  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return null;
    return `${raw.getFullYear()}-${String(raw.getMonth() + 1).padStart(2, "0")}-${String(raw.getDate()).padStart(2, "0")}`;
  }

  const str = String(raw).trim();
  if (!str) return null;

  // Excel serial date (e.g. 24256)
  if (/^\d{4,6}(\.\d+)?$/.test(str)) {
    const num = Number(str);
    if (num > 15000 && num < 60000) {
      const excelEpoch = Date.UTC(1899, 11, 30);
      const d = new Date(excelEpoch + num * 86400000);
      if (!isNaN(d.getTime())) return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
    }
  }

  const toIso = (y: number, m: number, d: number): string | null => {
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const dt = new Date(y, m - 1, d);
    if (isNaN(dt.getTime()) || dt.getMonth() !== m - 1) return null;
    return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  };

  // Numeric with separators: /, -, . e.g. 28/11/1966, 1966-11-28, 28.11.66
  const sep = str.match(/^(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})$/);
  if (sep) {
    let [, a, b, c] = sep;
    if (a.length === 4) {
      const iso = toIso(Number(a), Number(b), Number(c));
      if (iso) return iso;
    } else {
      let year = c.length === 4 ? Number(c) : (Number(c) > 30 ? 1900 + Number(c) : 2000 + Number(c));
      let day = Number(a), month = Number(b);
      // Disambiguate DD/MM vs MM/DD when one part can't be a month
      if (day > 12 && month <= 12) { /* day/month order confirmed */ }
      else if (month > 12 && day <= 12) { [day, month] = [month, day]; }
      const iso = toIso(year, month, day);
      if (iso) return iso;
    }
  }

  // Textual month: "28 Nov 1966", "Nov 28, 1966", "28-Nov-1966"
  const textMatch = str.toLowerCase().match(/([a-z]{3,})/);
  if (textMatch) {
    const monthIdx = MONTH_NAMES.findIndex((m) => textMatch[1].startsWith(m));
    if (monthIdx >= 0) {
      const nums = str.match(/\d+/g);
      if (nums && nums.length >= 2) {
        const yearPart = nums.find((n) => n.length === 4);
        const dayPart = nums.find((n) => n !== yearPart && Number(n) <= 31);
        if (yearPart && dayPart) {
          const iso = toIso(Number(yearPart), monthIdx + 1, Number(dayPart));
          if (iso) return iso;
        }
      }
    }
  }

  // Fallback to native parsing (handles ISO timestamps, RFC formats, Date.toString() output)
  const parsed = Date.parse(str);
  if (!isNaN(parsed)) {
    const d = new Date(parsed);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  return null;
}

const ImportWizard: React.FC<ImportWizardProps> = ({ entityType, onClose, onComplete }) => {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [rawData, setRawData] = useState<Record<string, any>[]>([]);
  const [csvColumns, setCsvColumns] = useState<string[]>([]);
  const [columnMap, setColumnMap] = useState<Record<string, string>>({});

  // Validation
  const [validRows, setValidRows] = useState<Record<string, any>[]>([]);
  const [errorRows, setErrorRows] = useState<ValidationError[]>([]);
  const [dupeRows, setDupeRows] = useState<number[]>([]);
  const [validating, setValidating] = useState(false);
  const [skipDupes, setSkipDupes] = useState(true);

  // Import
  const [jobName, setJobName] = useState("");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [importTotal, setImportTotal] = useState(0);
  const [importResult, setImportResult] = useState<{ imported: number; skipped: number; errors: number } | null>(null);
  const [importJobId, setImportJobId] = useState<string | null>(null);

  const fields = ENTITY_FIELDS[entityType];

  // ── STEP 1: File parsing ──
  const handleFile = useCallback(async (f: File) => {
    if (f.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 10MB", variant: "destructive" });
      return;
    }
    setFile(f);
    try {
      const buffer = await f.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array", cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws, { defval: "" });
      if (json.length === 0) {
        toast({ title: "Empty file", variant: "destructive" });
        return;
      }
      setRawData(json);
      const cols = Object.keys(json[0]);
      setCsvColumns(cols);
      // Auto-map
      const map: Record<string, string> = {};
      fields.forEach((fd) => {
        const candidates = AUTO_MATCH[fd.key] || [fd.key];
        const match = cols.find((c) =>
          candidates.some((cand) => c.toLowerCase().trim() === cand.toLowerCase())
        );
        if (match) map[fd.key] = match;
      });
      setColumnMap(map);
      setJobName(`${ENTITY_LABELS[entityType]} Import ${new Date().toLocaleDateString("en-IN")}`);
    } catch {
      toast({ title: "Could not parse file", variant: "destructive" });
    }
  }, [entityType, fields, toast]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  }, [handleFile]);

  // ── STEP 2: Mapping check ──
  const mandatoryMapped = fields.filter((f) => f.required).every((f) => columnMap[f.key]);

  // ── STEP 3: Validation ──
  const runValidation = useCallback(async () => {
    setValidating(true);
    const valid: Record<string, any>[] = [];
    const errors: ValidationError[] = [];
    const dupes: number[] = [];

    // For dupe detection, fetch existing phones
    let existingPhones = new Set<string>();
    if (entityType === "patients" || entityType === "vendors") {
      const table = entityType === "patients" ? "patients" : "vendors";
      const phoneCol = entityType === "vendors" ? "contact_phone" : "phone";
      const { data } = await supabase.from(table as any).select(phoneCol);
      if (data) existingPhones = new Set(data.map((r: any) => String(r[phoneCol] || "").trim()));
    }

    rawData.forEach((row, i) => {
      const mapped: Record<string, any> = {};
      fields.forEach((fd) => {
        const csvCol = columnMap[fd.key];
        mapped[fd.key] = csvCol ? String(row[csvCol] ?? "").trim() : "";
      });

      // Required check
      const missingRequired = fields.filter((f) => f.required && !mapped[f.key]);
      if (missingRequired.length > 0) {
        errors.push({ row: i + 2, field: missingRequired[0].key, message: `${missingRequired[0].label} is required`, data: mapped });
        return;
      }

      // Entity-specific validation
      let err: string | null = null;
      if (entityType === "patients") {
        // Normalize phone: strip country code (+91), spaces, dashes
        if (mapped.phone) {
          mapped.phone = String(mapped.phone).replace(/[\s\-+]/g, "").replace(/^91(\d{10})$/, "$1");
          if (!/^\d{10}$/.test(mapped.phone)) err = `Phone must be 10 digits (got "${mapped.phone}")`;
        }
        if (mapped.dob) {
          const dobStr = String(mapped.dob).trim();
          const iso = parseFlexibleDate(dobStr);
          if (!iso) { err = `Invalid DOB format (got "${dobStr}"). Try YYYY-MM-DD, DD/MM/YYYY, or "28 Nov 1966"`; }
          else if (new Date(iso) > new Date()) err = "DOB cannot be in the future";
          else mapped.dob = iso;
        }
        if (mapped.full_name.length < 2) err = "Name too short (minimum 2 characters)";
        if (mapped.gender) {
          const g = mapped.gender.toLowerCase();
          if (["m", "male"].includes(g)) mapped.gender = "male";
          else if (["f", "female"].includes(g)) mapped.gender = "female";
          else if (["o", "other"].includes(g)) mapped.gender = "other";
          else err = "Gender must be Male/Female/Other";
        }
        if (mapped.age && (isNaN(Number(mapped.age)) || Number(mapped.age) < 0 || Number(mapped.age) > 120)) {
          err = "Age must be a number between 0 and 120";
        }
        if (mapped.patient_category) {
          const validCategories = ["general", "bpl", "cghs", "echs", "pmjay", "esi", "insurance", "medicalaid"];
          const c = mapped.patient_category.toLowerCase().replace(/[\s\-]/g, "");
          if (!validCategories.includes(c)) err = `Patient Category must be: ${validCategories.join(", ")}`;
          else mapped.patient_category = c;
        }
        if (mapped.aadhaar_id) mapped.aadhaar_id = String(mapped.aadhaar_id).replace(/\D/g, "").slice(0, 12);
        if (mapped.patient_gstin) mapped.patient_gstin = String(mapped.patient_gstin).trim().toUpperCase();
        if (mapped.chronic_conditions) {
          mapped.chronic_conditions = String(mapped.chronic_conditions).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
        }
        if (mapped.emergency_contact_phone) {
          const ecp = String(mapped.emergency_contact_phone).replace(/[\s\-+]/g, "").replace(/^91(\d{10})$/, "$1");
          if (!/^\d{10}$/.test(ecp)) err = `Emergency Contact Phone must be 10 digits (got "${ecp}")`;
          else mapped.emergency_contact_phone = ecp;
        }
      } else if (entityType === "staff") {
        if (mapped.phone) {
          mapped.phone = String(mapped.phone).replace(/[\s\-+]/g, "").replace(/^91(\d{10})$/, "$1");
          if (!/^\d{10}$/.test(mapped.phone)) err = "Phone must be 10 digits";
        }
        if (mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.email)) err = "Invalid email";
        // Role → real app_role enum (mirrors SettingsStaffPage VALID_APP_ROLES)
        const validRoles = [
          "super_admin", "hospital_admin", "doctor", "nurse", "receptionist",
          "pharmacist", "lab_tech", "accountant", "billing_executive", "hr_manager",
          "lab_technician", "radiologist", "cfo", "billing_staff",
        ];
        const roleSynonyms: Record<string, string> = {
          admin: "hospital_admin", administrator: "hospital_admin",
          billing: "accountant", accounts: "accountant", accountant_staff: "accountant",
          reception: "receptionist", "front desk": "receptionist",
          "lab technician": "lab_tech", labtech: "lab_tech", "lab tech": "lab_tech",
          pharmacy: "pharmacist", hr: "hr_manager",
        };
        const roleRaw = String(mapped.role).toLowerCase().trim();
        const roleNorm = roleSynonyms[roleRaw] || roleRaw.replace(/[\s\-]+/g, "_");
        if (!validRoles.includes(roleNorm)) err = `Role must be one of: ${validRoles.join(", ")}`;
        else mapped.role = roleNorm;
        // License expiry — any date format
        if (!err && mapped.license_expiry_date) {
          const licStr = String(mapped.license_expiry_date).trim();
          const iso = parseFlexibleDate(licStr);
          if (!iso) err = `Invalid License Expiry date (got "${licStr}"). Try YYYY-MM-DD, DD/MM/YYYY, or "31 Dec 2027"`;
          else mapped.license_expiry_date = iso;
        }
        // Numeric fields
        if (!err) {
          for (const nf of ["basic_salary", "hra_percent", "da_percent", "conveyance", "medical_allowance"]) {
            if (mapped[nf] !== "" && isNaN(Number(String(mapped[nf]).replace(/[,₹\s]/g, "")))) {
              err = `${nf.replace(/_/g, " ")} must be a number (got "${mapped[nf]}")`;
              break;
            }
            if (mapped[nf] !== "") mapped[nf] = String(mapped[nf]).replace(/[,₹\s]/g, "");
          }
        }
        // Booleans
        if (!err) {
          const toBool = (v: any): boolean | "" => {
            const s = String(v).toLowerCase().trim();
            if (s === "") return "";
            if (["yes", "y", "true", "1", "applicable"].includes(s)) return true;
            return false;
          };
          if (mapped.pf_applicable !== "") mapped.pf_applicable = toBool(mapped.pf_applicable);
          if (mapped.esic_applicable !== "") mapped.esic_applicable = toBool(mapped.esic_applicable);
        }
        // PAN — normalize, lenient validation
        if (!err && mapped.pan_number) {
          mapped.pan_number = String(mapped.pan_number).trim().toUpperCase();
          if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(mapped.pan_number)) err = `Invalid PAN (got "${mapped.pan_number}") — expected e.g. ABCDE1234F`;
        }
        // Payroll type → employee_type enum
        if (!err && mapped.payroll_type) {
          const p = String(mapped.payroll_type).toLowerCase().trim();
          mapped.payroll_type = ["consultant", "194j", "form16a"].some((k) => p.includes(k)) ? "consultant" : "staff";
        }
        // Employment type — normalize
        if (!err && mapped.employment_type) {
          mapped.employment_type = String(mapped.employment_type).toLowerCase().trim().replace(/[\s\-]+/g, "_");
        }
      } else if (entityType === "services") {
        const rate = parseFloat(mapped.rate);
        if (isNaN(rate) || rate <= 0) err = "Rate must be a positive number";
        if (mapped.gst_percent && ![0, 5, 12, 18].includes(Number(mapped.gst_percent))) err = "GST must be 0, 5, 12, or 18";
      } else if (entityType === "drugs") {
        if (mapped.schedule) {
          const validSchedules = ["otc", "h", "h1", "x", "g", ""];
          if (!validSchedules.includes(mapped.schedule.toLowerCase())) err = "Schedule must be OTC/H/H1/X/G";
          else mapped.schedule = mapped.schedule.toUpperCase();
        }
        if (mapped.mrp && (isNaN(Number(mapped.mrp)) || Number(mapped.mrp) < 0)) err = "MRP must be a positive number";
      } else if (entityType === "vendors") {
        if (mapped.phone && !/^\d{10}$/.test(mapped.phone)) err = "Phone must be 10 digits";
      }

      if (err) {
        errors.push({ row: i + 2, field: "", message: err, data: mapped });
        return;
      }

      // Dupe check
      const phoneKey = mapped.phone || "";
      if (phoneKey && existingPhones.has(phoneKey)) {
        dupes.push(i + 2);
      }

      valid.push({ ...mapped, _rowNum: i + 2 });
    });

    setValidRows(valid);
    setErrorRows(errors);
    setDupeRows(dupes);
    setValidating(false);
  }, [rawData, fields, columnMap, entityType]);

  // ── STEP 5: Import ──
  const runImport = useCallback(async () => {
    setImporting(true);
    const rowsToImport = skipDupes
      ? validRows.filter((r) => !dupeRows.includes(r._rowNum))
      : validRows;

    setImportTotal(rowsToImport.length);
    setImportProgress(0);

    // Get hospital_id
    const { data: userData } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
    const hospitalId = userData?.hospital_id;
    if (!hospitalId) {
      toast({ title: "Hospital not found", variant: "destructive" });
      setImporting(false);
      return;
    }

    // Staff: resolve department name → id (never auto-creates departments)
    const deptByName = new Map<string, string>();
    if (entityType === "staff") {
      const { data: deptRows } = await supabase.from("departments")
        .select("id, name").eq("hospital_id", hospitalId).eq("is_active", true);
      (deptRows || []).forEach((d: any) => deptByName.set(String(d.name).trim().toLowerCase(), d.id));
    }

    // Create migration job
    const { data: job, error: jobErr } = await supabase.from("migration_jobs" as any).insert({
      hospital_id: hospitalId,
      job_name: jobName,
      entity_type: entityType,
      file_name: file?.name || "unknown",
      total_rows: rawData.length,
      status: "importing",
      started_at: new Date().toISOString(),
      rollback_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    }).select("id").maybeSingle();

    if (jobErr || !job) {
      toast({ title: "Failed to create migration job", variant: "destructive" });
      setImporting(false);
      return;
    }
    const jobId = (job as any).id;
    setImportJobId(jobId);

    let imported = 0;
    let skipped = 0;
    let errors = 0;
    const batchSize = 50;

    for (let i = 0; i < rowsToImport.length; i += batchSize) {
      const batch = rowsToImport.slice(i, i + batchSize);
      const records: any[] = [];
      const logs: any[] = [];

      for (const row of batch) {
        try {
          let record: any = { hospital_id: hospitalId };
          let entityId: string | null = null;

          if (entityType === "patients") {
            record = {
              ...record,
              full_name: row.full_name,
              phone: row.phone || null,
              address: row.address || null,
              blood_group: row.blood_group || null,
              patient_category: row.patient_category || "general",
              allergies: row.allergies || null,
              chronic_conditions: Array.isArray(row.chronic_conditions) && row.chronic_conditions.length ? row.chronic_conditions : null,
              insurance_id: row.insurance_id || null,
              abha_id: row.abha_id || null,
              aadhaar_id: row.aadhaar_id || null,
              patient_gstin: row.patient_gstin || null,
              referral_source: row.referral_source || null,
              emergency_contact_name: row.emergency_contact_name || null,
              emergency_contact_phone: row.emergency_contact_phone || null,
            };
            if (row.dob) record.dob = new Date(row.dob).toISOString().split("T")[0];
            else if (row.age) {
              const d = new Date();
              d.setFullYear(d.getFullYear() - parseInt(row.age));
              record.dob = d.toISOString().split("T")[0];
            }
            if (row.gender) record.gender = row.gender;
            if (row.uhid) record.uhid = row.uhid;
            // Duplicate check: match by UHID if provided, else by phone + name
            if (row.uhid) {
              const { data: existing } = await supabase.from("patients").select("id").eq("hospital_id", hospitalId).eq("uhid", row.uhid).maybeSingle();
              if (existing) { skipped++; logs.push({ hospital_id: hospitalId, job_id: jobId, row_number: batch.indexOf(row) + i + 2, entity_id: existing.id, status: "skipped", error_message: `Duplicate UHID: ${row.uhid}`, source_data: row }); continue; }
            } else if (row.phone) {
              const { data: existing } = await supabase.from("patients").select("id").eq("hospital_id", hospitalId).eq("phone", row.phone).maybeSingle();
              if (existing) { skipped++; logs.push({ hospital_id: hospitalId, job_id: jobId, row_number: batch.indexOf(row) + i + 2, entity_id: existing.id, status: "skipped", error_message: `Duplicate phone: ${row.phone}`, source_data: row }); continue; }
            }
            const { data: ins, error } = await supabase.from("patients").insert(record).select("id").maybeSingle();
            if (error) throw error;
            entityId = ins?.id || null;
          } else if (entityType === "staff") {
            // Parity with the manual Add Staff form: write users + staff_profiles
            const deptId = row.department ? (deptByName.get(String(row.department).trim().toLowerCase()) || null) : null;
            const newId = crypto.randomUUID();
            const userRow: any = {
              id: newId,
              hospital_id: hospitalId,
              full_name: row.full_name,
              phone: row.phone || null,
              email: row.email || `${row.phone || Date.now()}@placeholder.local`,
              role: row.role,
              department_id: deptId,
              registration_number: row.registration_number || null,
              is_active: true,
              can_login: false, // mirror manual add — login enabled later once auth is set up
              auth_user_id: null,
            };
            const { error: uErr } = await supabase.from("users").insert(userRow);
            if (uErr) throw uErr;
            // Salary/statutory numbers arrive as strings; "" → default
            const num = (v: any, d: number | null) =>
              (v !== undefined && v !== "" && !isNaN(Number(v))) ? Number(v) : d;
            const profile: any = {
              user_id: newId,
              hospital_id: hospitalId,
              designation: row.role,
              employment_type: row.employment_type || "permanent",
              employee_type: row.payroll_type || "staff",
              department_id: deptId,
              registration_number: row.registration_number || null,
              employee_id: row.employee_id || null,
              basic_salary: num(row.basic_salary, null),
              hra_percent: num(row.hra_percent, 20),
              da_percent: num(row.da_percent, 10),
              conveyance: num(row.conveyance, 1600),
              medical_allowance: num(row.medical_allowance, 1250),
              pf_applicable: (row.pf_applicable === "" || row.pf_applicable === undefined) ? true : row.pf_applicable === true,
              esic_applicable: row.esic_applicable === true,
              uan_number: row.uan_number || null,
              pan_number: row.pan_number || null,
              esi_ip_number: row.esi_ip_number || null,
              license_expiry_date: row.license_expiry_date || null,
              is_active: true,
            };
            const { error: pErr } = await (supabase as any).from("staff_profiles").insert(profile);
            if (pErr) {
              // Roll back the just-inserted user so we don't leave an orphan account
              await supabase.from("users").delete().eq("id", newId);
              throw pErr;
            }
            entityId = newId;
          } else if (entityType === "services") {
            record = { ...record, name: row.service_name, category: row.category, fee: parseFloat(row.rate), item_type: row.category };
            if (row.gst_percent) record.gst_percent = Number(row.gst_percent);
            if (row.hsn_code) record.hsn_code = row.hsn_code;
            const { data: ins, error } = await supabase.from("service_master").insert(record).select("id").maybeSingle();
            if (error) throw error;
            entityId = ins?.id || null;
          } else if (entityType === "drugs") {
            record = { ...record, drug_name: row.drug_name, generic_name: row.generic_name || null, category: row.category };
            if (row.schedule) record.drug_schedule = row.schedule;
            if (row.hsn_code) record.hsn_code = row.hsn_code;
            const { data: ins, error } = await supabase.from("drug_master").insert(record).select("id").maybeSingle();
            if (error) throw error;
            entityId = ins?.id || null;
          } else if (entityType === "vendors") {
            record = { ...record, vendor_name: row.vendor_name, contact_name: row.contact_person || null, contact_phone: row.phone || null, contact_email: row.email || null, gstin: row.gst_number || null, address: row.address || null };
            const { data: ins, error } = await supabase.from("vendors").insert(record).select("id").maybeSingle();
            if (error) throw error;
            entityId = ins?.id || null;
          } else if (entityType === "lab_tests") {
            record = { ...record, test_name: row.test_name, test_code: row.test_code || null, category: row.category, sample_type: row.sample_type || null, unit: row.unit || null };
            if (row.normal_range_low) record.normal_min = parseFloat(row.normal_range_low);
            if (row.normal_range_high) record.normal_max = parseFloat(row.normal_range_high);
            if (row.tat_hours) record.tat_minutes = parseInt(row.tat_hours) * 60;
            const { data: ins, error } = await supabase.from("lab_test_master").insert(record).select("id").maybeSingle();
            if (error) throw error;
            entityId = ins?.id || null;
          }

          logs.push({ hospital_id: hospitalId, job_id: jobId, row_number: row._rowNum, entity_id: entityId, status: "imported", source_data: row });
          imported++;
        } catch (err: any) {
          logs.push({ hospital_id: hospitalId, job_id: jobId, row_number: row._rowNum, status: "error", error_message: err?.message || "Unknown error", source_data: row });
          errors++;
        }
      }

      // Insert logs
      if (logs.length > 0) {
        await supabase.from("migration_logs" as any).insert(logs);
      }

      setImportProgress(Math.min(i + batchSize, rowsToImport.length));
    }

    // Log skipped rows (errors from validation)
    const skipLogs = errorRows.map((e) => ({
      hospital_id: hospitalId,
      job_id: jobId,
      row_number: e.row,
      status: "error" as const,
      error_message: e.message,
      source_data: e.data,
    }));
    if (skipLogs.length > 0) {
      await supabase.from("migration_logs" as any).insert(skipLogs);
    }

    // Update job
    await supabase.from("migration_jobs" as any).update({
      status: errors > 0 && imported === 0 ? "failed" : "completed",
      imported_rows: imported,
      error_rows: errors + errorRows.length,
      skipped_rows: dupeRows.length,
      completed_at: new Date().toISOString(),
    }).eq("id", jobId);

    setImportResult({ imported, skipped: dupeRows.length, errors: errors + errorRows.length });
    setImporting(false);
  }, [validRows, dupeRows, skipDupes, entityType, jobName, file, rawData, errorRows, toast]);

  const downloadErrorReport = () => {
    const rows = [["Row", "Field", "Error Message"].join(",")];
    errorRows.forEach((e) => rows.push([e.row, e.field, `"${e.message}"`].join(",")));
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entityType}_errors.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadTemplate = () => {
    const headers = fields.map((f) => f.key);
    const blob = new Blob([headers.join(",") + "\n"], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${entityType}_template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {/* Overlay */}
      <div className="fixed inset-0 z-50 bg-black/40" onClick={onClose} />
      {/* Drawer */}
      <div className="fixed right-0 top-0 z-50 h-full w-[600px] max-w-full bg-background border-l border-border flex flex-col shadow-2xl">
        {/* Header */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-bold">Import {ENTITY_LABELS[entityType]}</h2>
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>

        {/* Step indicator */}
        <div className="flex items-center gap-1 px-5 py-3 border-b border-border flex-shrink-0">
          {STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div className={cn(
                "flex items-center gap-1.5 text-[11px] font-bold px-2 py-1 rounded-full",
                i < step ? "bg-teal-100 text-teal-700" :
                i === step ? "bg-primary text-primary-foreground" :
                "bg-muted text-muted-foreground"
              )}>
                {i < step ? <Check size={12} /> : <span>{i + 1}</span>}
                {s}
              </div>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-border" />}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* ── STEP 1: Upload ── */}
          {step === 0 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold">Upload your {ENTITY_LABELS[entityType].toLowerCase()} data file</h3>
                <p className="text-[11px] text-muted-foreground mt-1">Accepted: CSV (.csv) or Excel (.xlsx) • Max 10MB</p>
              </div>

              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  file ? "border-teal-400 bg-teal-50/50" : "border-border hover:border-primary/40"
                )}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
                />
                {file ? (
                  <div className="space-y-2">
                    <FileSpreadsheet size={32} className="mx-auto text-teal-600" />
                    <p className="text-sm font-bold">{file.name}</p>
                    <p className="text-[11px] text-muted-foreground">{rawData.length} rows detected • {csvColumns.length} columns</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload size={32} className="mx-auto text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Drag & drop or click to browse</p>
                  </div>
                )}
              </div>

              <Button variant="link" size="sm" className="text-xs gap-1 p-0" onClick={downloadTemplate}>
                <Download size={12} /> Download Template First
              </Button>
            </div>
          )}

          {/* ── STEP 2: Map Columns ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-sm font-bold">Match your columns to HMS fields</h3>
                <p className="text-[11px] text-muted-foreground mt-1">Auto-matched where possible. Adjust if needed.</p>
              </div>
              <div className="border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr className="text-[10px] font-bold uppercase text-muted-foreground">
                      <th className="px-3 py-2 text-left">HMS Field</th>
                      <th className="px-3 py-2 text-center w-10">Req</th>
                      <th className="px-3 py-2 text-left">Your Column</th>
                      <th className="px-3 py-2 text-left">Preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((fd) => {
                      const mappedCol = columnMap[fd.key];
                      const preview = mappedCol && rawData[0] ? String(rawData[0][mappedCol] ?? "") : "—";
                      return (
                        <tr key={fd.key} className="border-t border-border">
                          <td className="px-3 py-2 text-xs font-medium">{fd.label}</td>
                          <td className="px-3 py-2 text-center">
                            {fd.required && <Badge variant="outline" className="text-[8px] bg-red-50 text-red-600">*</Badge>}
                          </td>
                          <td className="px-3 py-2">
                            <Select value={mappedCol || "__none"} onValueChange={(v) => setColumnMap((m) => ({ ...m, [fd.key]: v === "__none" ? "" : v }))}>
                              <SelectTrigger className="h-8 text-xs">
                                <SelectValue placeholder="— Select —" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none">— Skip —</SelectItem>
                                {csvColumns.map((c) => (
                                  <SelectItem key={c} value={c}>{c}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2 text-[11px] text-muted-foreground truncate max-w-[120px]">{preview}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── STEP 3: Validate ── */}
          {step === 2 && (
            <div className="space-y-4">
              {validating ? (
                <div className="flex flex-col items-center gap-3 py-12">
                  <Loader2 className="animate-spin text-primary" size={32} />
                  <p className="text-sm text-muted-foreground">Checking your data for errors...</p>
                </div>
              ) : validRows.length === 0 && errorRows.length === 0 ? (
                <div className="text-center py-8">
                  <p className="text-sm text-muted-foreground">Click "Run Validation" to check your data.</p>
                  <Button className="mt-4" onClick={runValidation}>Run Validation</Button>
                </div>
              ) : (
                <>
                  <h3 className="text-sm font-bold">Validation Results</h3>
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                      <CheckCircle2 size={16} className="text-emerald-600" />
                      <span className="text-sm font-bold text-emerald-700">{validRows.length} rows ready to import</span>
                    </div>
                    {errorRows.length > 0 && (
                      <div className="flex items-center justify-between p-3 bg-red-50 rounded-lg border border-red-200">
                        <div className="flex items-center gap-2">
                          <AlertTriangle size={16} className="text-red-600" />
                          <span className="text-sm font-bold text-red-700">{errorRows.length} rows have errors (will be skipped)</span>
                        </div>
                        <Button size="sm" variant="outline" className="h-7 text-[10px] gap-1" onClick={downloadErrorReport}>
                          <Download size={11} /> Error Report
                        </Button>
                      </div>
                    )}
                    {dupeRows.length > 0 && (
                      <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 space-y-2">
                        <span className="text-sm font-bold text-blue-700">ℹ️ {dupeRows.length} possible duplicates detected</span>
                        <div className="flex items-center gap-3">
                          <Switch checked={skipDupes} onCheckedChange={setSkipDupes} />
                          <Label className="text-xs">Skip duplicates</Label>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ── STEP 4: Preview ── */}
          {step === 3 && (
            <div className="space-y-4">
              <h3 className="text-sm font-bold">Preview your data before importing</h3>
              <div className="border border-border rounded-lg overflow-x-auto">
                <table className="w-full text-[11px]">
                  <thead className="bg-muted/50">
                    <tr>
                      {fields.slice(0, 5).map((f) => (
                        <th key={f.key} className="px-2 py-1.5 text-left font-bold uppercase text-muted-foreground">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {validRows.slice(0, 10).map((row, i) => (
                      <tr key={i} className={cn("border-t border-border", dupeRows.includes(row._rowNum) ? "bg-blue-50" : "")}>
                        {fields.slice(0, 5).map((f) => (
                          <td key={f.key} className="px-2 py-1.5 truncate max-w-[120px]">{row[f.key] || "—"}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bg-card border border-border rounded-lg p-4 space-y-1.5">
                <p className="text-sm font-bold">Summary</p>
                <p className="text-xs">✅ <strong>{validRows.length - (skipDupes ? dupeRows.length : 0)}</strong> new records to import</p>
                {dupeRows.length > 0 && skipDupes && (
                  <p className="text-xs">⚠️ <strong>{dupeRows.length}</strong> duplicates to skip</p>
                )}
                {errorRows.length > 0 && (
                  <p className="text-xs">❌ <strong>{errorRows.length}</strong> error rows skipped</p>
                )}
              </div>
              <div>
                <Label className="text-xs">Job Name</Label>
                <Input value={jobName} onChange={(e) => setJobName(e.target.value)} className="mt-1 h-9 text-sm" />
              </div>
            </div>
          )}

          {/* ── STEP 5: Import ── */}
          {step === 4 && (
            <div className="space-y-4">
              {importing ? (
                <div className="space-y-4 py-8">
                  <h3 className="text-sm font-bold text-center">Importing your data...</h3>
                  <Progress value={(importProgress / Math.max(importTotal, 1)) * 100} className="h-3" />
                  <p className="text-xs text-center text-muted-foreground">
                    Row {importProgress} of {importTotal}
                  </p>
                </div>
              ) : importResult ? (
                <div className="space-y-4 py-4">
                  <div className="flex flex-col items-center gap-2">
                    <CheckCircle2 size={40} className="text-emerald-500" />
                    <h3 className="text-base font-bold">Import Complete!</h3>
                  </div>
                  <div className="bg-card border border-border rounded-lg p-4 space-y-1.5">
                    <p className="text-sm">✅ <strong>{importResult.imported}</strong> records imported successfully</p>
                    {importResult.skipped > 0 && <p className="text-sm">⚠️ <strong>{importResult.skipped}</strong> records skipped</p>}
                    {importResult.errors > 0 && (
                      <>
                        <p className="text-sm">❌ <strong>{importResult.errors}</strong> errors</p>
                        <Button size="sm" variant="outline" className="text-xs gap-1 mt-2" onClick={downloadErrorReport}>
                          <Download size={12} /> Download Error Report
                        </Button>
                      </>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 text-xs" onClick={() => { setStep(0); setFile(null); setRawData([]); setImportResult(null); }}>
                      Import Another File
                    </Button>
                    <Button size="sm" className="flex-1 text-xs" onClick={() => { if (importJobId) onComplete(importJobId); onClose(); }}>
                      Close
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>

        {/* Footer nav */}
        {step < 4 && (
          <div className="h-14 flex items-center justify-between px-5 border-t border-border flex-shrink-0">
            <Button variant="outline" size="sm" className="h-9 text-xs gap-1" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
              <ArrowLeft size={13} /> Back
            </Button>
            {step === 0 && (
              <Button size="sm" className="h-9 text-xs gap-1" disabled={!file || rawData.length === 0} onClick={() => setStep(1)}>
                Next <ArrowRight size={13} />
              </Button>
            )}
            {step === 1 && (
              <Button size="sm" className="h-9 text-xs gap-1" disabled={!mandatoryMapped} onClick={() => { setStep(2); runValidation(); }}>
                Next <ArrowRight size={13} />
              </Button>
            )}
            {step === 2 && (
              <Button size="sm" className="h-9 text-xs gap-1" disabled={validating || validRows.length === 0} onClick={() => setStep(3)}>
                Next <ArrowRight size={13} />
              </Button>
            )}
            {step === 3 && (
              <Button size="sm" className="h-9 text-xs gap-1 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={() => { setStep(4); runImport(); }}>
                Start Import <ArrowRight size={13} />
              </Button>
            )}
          </div>
        )}
      </div>
    </>
  );
};

export default ImportWizard;
