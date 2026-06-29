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
    { key: "gender", label: "Gender", required: false },
    { key: "address", label: "Address", required: false },
    { key: "uhid", label: "UHID", required: false },
    { key: "blood_group", label: "Blood Group", required: false },
  ],
  staff: [
    { key: "full_name", label: "Full Name", required: true },
    { key: "phone", label: "Phone", required: true },
    { key: "email", label: "Email", required: false },
    { key: "role", label: "Role", required: true },
    { key: "department", label: "Department", required: false },
    { key: "joining_date", label: "Joining Date", required: false },
    { key: "employee_id", label: "Employee ID", required: false },
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
  joining_date: ["joining_date", "join_date", "doj"],
};

const STEPS = ["Upload", "Map", "Validate", "Preview", "Import"];

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
      const wb = XLSX.read(buffer, { type: "array" });
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
          // Accept DD/MM/YYYY, DD-MM-YYYY, MM/DD/YYYY, YYYY-MM-DD
          const dobStr = String(mapped.dob).trim();
          const slashParts = dobStr.split(/[\/\-]/);
          if (slashParts.length === 3) {
            const [a, b, c] = slashParts;
            // If first part is 4-digit year: YYYY-MM-DD
            if (a.length === 4) mapped.dob = `${a}-${b.padStart(2,"0")}-${c.padStart(2,"0")}`;
            // If last part is 4-digit year and first <= 31: DD/MM/YYYY
            else if (c.length === 4 && Number(a) <= 31) mapped.dob = `${c}-${b.padStart(2,"0")}-${a.padStart(2,"0")}`;
          }
          if (isNaN(Date.parse(mapped.dob))) { err = `Invalid DOB format (got "${dobStr}"). Use YYYY-MM-DD`; }
          else if (new Date(mapped.dob) > new Date()) err = "DOB cannot be in the future";
        }
        if (mapped.full_name.length < 2) err = "Name too short (minimum 2 characters)";
        if (mapped.gender) {
          const g = mapped.gender.toLowerCase();
          if (["m", "male"].includes(g)) mapped.gender = "male";
          else if (["f", "female"].includes(g)) mapped.gender = "female";
          else if (["o", "other"].includes(g)) mapped.gender = "other";
          else err = "Gender must be Male/Female/Other";
        }
      } else if (entityType === "staff") {
        if (mapped.phone) {
          mapped.phone = String(mapped.phone).replace(/[\s\-+]/g, "").replace(/^91(\d{10})$/, "$1");
          if (!/^\d{10}$/.test(mapped.phone)) err = "Phone must be 10 digits";
        }
        if (mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.email)) err = "Invalid email";
        const validRoles = ["doctor", "nurse", "admin", "pharmacist", "lab_tech", "receptionist", "super_admin"];
        if (!validRoles.includes(mapped.role.toLowerCase())) err = `Role must be: ${validRoles.join(", ")}`;
        else mapped.role = mapped.role.toLowerCase();
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
            record = { ...record, full_name: row.full_name, phone: row.phone || null, address: row.address || null, blood_group: row.blood_group || null };
            if (row.dob) record.dob = new Date(row.dob).toISOString().split("T")[0];
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
            record = { ...record, full_name: row.full_name, phone: row.phone, email: row.email || null, role: row.role };
            if (row.employee_id) record.employee_id = row.employee_id;
            const { data: ins, error } = await supabase.from("users").insert(record).select("id").maybeSingle();
            if (error) throw error;
            entityId = ins?.id || null;
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
