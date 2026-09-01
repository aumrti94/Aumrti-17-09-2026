import React, { useState, useEffect, useMemo, useCallback } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { toast } from "@/hooks/use-toast";
import { Search, Upload, Download, Plus, Trash2, Eye, Package, FileText, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import * as XLSX from "xlsx";

interface CodeSet {
  id: string;
  set_name: string;
  set_type: string;
  code_system: string;
  version: string | null;
  description: string | null;
  total_codes: number;
  is_active: boolean;
  uploaded_at: string | null;
  created_at: string;
}

interface ICDCode {
  id: string;
  code: string;
  description: string;
  category: string | null;
  chapter: string | null;
  code_system: string;
  is_billable: boolean;
  common_india: boolean;
  use_count: number;
  hospital_id: string | null;
  code_set_id: string | null;
}

interface IcdSettings {
  id: string;
  active_set: string;
  show_common_first: boolean;
  /** icd10 | icd11 | both. Defaults to icd10 — ICD-11 is opt-in per hospital. */
  active_code_system: string;
}

/** ICD-11 sits beside ICD-10 in the same catalogue table, told apart by `code_system`. */
const CODE_SYSTEMS = [
  { value: "icd10", label: "ICD-10" },
  { value: "icd11", label: "ICD-11" },
] as const;

const SettingsICDCodesPage: React.FC = () => {
  const { hospitalId, loading: hospitalLoading } = useHospitalId();
  const [tab, setTab] = useState("sets");
  const [settings, setSettings] = useState<IcdSettings | null>(null);
  const [codeSets, setCodeSets] = useState<CodeSet[]>([]);
  const [codes, setCodes] = useState<ICDCode[]>([]);
  const [codesLoading, setCodesLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  // Settings form
  const [activeSet, setActiveSet] = useState("all");
  const [showCommonFirst, setShowCommonFirst] = useState(true);
  // Defaults to icd10 so a hospital that never opens this page keeps its pre-ICD-11 behaviour.
  const [activeCodeSystem, setActiveCodeSystem] = useState("icd10");

  // Browse filters
  const [searchQ, setSearchQ] = useState("");
  const [catFilter, setCatFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [systemFilter, setSystemFilter] = useState("all");
  const [billableOnly, setBillableOnly] = useState(true);

  // Upload state
  const [uploadStep, setUploadStep] = useState(0); // 0=none, 1=mapping, 2=validation, 3=naming
  const [fileData, setFileData] = useState<any[]>([]);
  const [fileColumns, setFileColumns] = useState<string[]>([]);
  const [colMap, setColMap] = useState({ code: "", description: "", category: "", is_billable: "" });
  const [validRows, setValidRows] = useState<any[]>([]);
  const [errorRows, setErrorRows] = useState<any[]>([]);
  const [setName, setSetName] = useState("My Hospital ICD-10 Codes");
  const [setVersion, setSetVersion] = useState("2022");
  /** Which classification the uploaded file contains. */
  const [uploadCodeSystem, setUploadCodeSystem] = useState("icd10");
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  // Add custom code modal
  const [showAddCode, setShowAddCode] = useState(false);
  const [newCode, setNewCode] = useState({ code: "", description: "", category: "", code_system: "icd10" });

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<CodeSet | null>(null);



  const loadSettings = useCallback(async () => {
    const { data } = await supabase
      .from("hospital_icd_settings")
      .select("*")
      .eq("hospital_id", hospitalId)
      .maybeSingle();
    if (data) {
      setSettings(data as IcdSettings);
      setActiveSet(data.active_set);
      setShowCommonFirst(data.show_common_first);
      setActiveCodeSystem((data as any).active_code_system || "icd10");
    }
  }, [hospitalId]);

  const loadCodeSets = useCallback(async () => {
    const { data } = await supabase
      .from("icd10_code_sets")
      .select("*")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: true });
    if (data) setCodeSets(data as CodeSet[]);
  }, [hospitalId]);

  useEffect(() => {
    loadSettings();
    loadCodeSets();
  }, [loadCodeSets, loadSettings]);

  const loadCodes = useCallback(async () => {
    setCodesLoading(true);
    const { data } = await supabase
      .from("icd10_codes")
      .select("*")
      .or(`hospital_id.is.null,hospital_id.eq.${hospitalId}`)
      .order("use_count", { ascending: false })
      .limit(1000);
    if (data) setCodes(data as ICDCode[]);
    setCodesLoading(false);
  }, [hospitalId]);

  useEffect(() => {
    if (tab === "browse") loadCodes();
  }, [loadCodes, tab]);

  const saveSettings = async () => {
    setSaving(true);
    if (settings) {
      await supabase
        .from("hospital_icd_settings")
        .update({ active_set: activeSet, show_common_first: showCommonFirst, active_code_system: activeCodeSystem } as any)
        .eq("id", settings.id);
    } else {
      await supabase
        .from("hospital_icd_settings")
        .insert({ hospital_id: hospitalId, active_set: activeSet, show_common_first: showCommonFirst, active_code_system: activeCodeSystem } as any);
    }
    toast({ title: "Preference saved" });
    setSaving(false);
    loadSettings();
  };

  const categories = useMemo(() => {
    const cats = new Set(codes.map((c) => c.category).filter(Boolean));
    return Array.from(cats).sort();
  }, [codes]);

  const filteredCodes = useMemo(() => {
    let list = codes;
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase();
      list = list.filter((c) => c.code.toLowerCase().includes(q) || c.description.toLowerCase().includes(q));
    }
    if (catFilter !== "all") list = list.filter((c) => c.category === catFilter);
    if (sourceFilter === "system") list = list.filter((c) => !c.hospital_id);
    if (sourceFilter === "uploaded") list = list.filter((c) => !!c.hospital_id);
    // Rows written before ICD-11 existed have no code_system client-side until reloaded; treat
    // a missing value as ICD-10, matching the column default.
    if (systemFilter !== "all") list = list.filter((c) => (c.code_system || "icd10") === systemFilter);
    if (billableOnly) list = list.filter((c) => c.is_billable);
    return list;
  }, [codes, searchQ, catFilter, sourceFilter, systemFilter, billableOnly]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 5MB", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target?.result, { type: "binary" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const json = XLSX.utils.sheet_to_json<Record<string, any>>(ws);
        if (!json.length) {
          toast({ title: "Empty file", variant: "destructive" });
          return;
        }
        setFileData(json);
        setFileColumns(Object.keys(json[0]));
        // auto-map
        const keys = Object.keys(json[0]).map((k) => k.toLowerCase());
        const origKeys = Object.keys(json[0]);
        setColMap({
          code: origKeys[keys.findIndex((k) => k.includes("code"))] || "",
          description: origKeys[keys.findIndex((k) => k.includes("desc") || k.includes("name"))] || "",
          category: origKeys[keys.findIndex((k) => k.includes("cat"))] || "",
          is_billable: origKeys[keys.findIndex((k) => k.includes("bill"))] || "",
        });
        setUploadStep(1);
      } catch {
        toast({ title: "Could not parse file", variant: "destructive" });
      }
    };
    reader.readAsBinaryString(file);
  }, []);

  const validateRows = () => {
    const valid: any[] = [];
    const errors: any[] = [];
    fileData.forEach((row, i) => {
      const code = String(row[colMap.code] || "").trim();
      const desc = String(row[colMap.description] || "").trim();
      const cat = colMap.category ? String(row[colMap.category] || "").trim() : "";
      const billable = colMap.is_billable ? String(row[colMap.is_billable] || "true").toLowerCase() : "true";
      const errs: string[] = [];
      if (!code) errs.push("Missing code");
      if (code.length > 10) errs.push("Code too long");
      if (!desc || desc.length < 3) errs.push("Description too short");
      if (errs.length) {
        errors.push({ row: i + 2, code, description: desc, errors: errs.join(", ") });
      } else {
        valid.push({ code, description: desc, category: cat || null, is_billable: !["false", "no", "0"].includes(billable) });
      }
    });
    setValidRows(valid);
    setErrorRows(errors);
    setUploadStep(2);
  };

  const importCodes = async () => {
    if (!validRows.length) return;
    setImporting(true);
    setUploadStep(3);
    setImportProgress(10);

    // Create code set
    const { data: cs, error: csErr } = await supabase
      .from("icd10_code_sets")
      .insert({
        hospital_id: hospitalId,
        set_name: setName,
        set_type: "hospital_uploaded",
        code_system: uploadCodeSystem,
        version: setVersion,
        total_codes: validRows.length,
        is_active: true,
        uploaded_at: new Date().toISOString(),
      })
      .select()
      .maybeSingle();

    if (csErr || !cs) {
      toast({ title: "Failed to create code set", variant: "destructive" });
      setImporting(false);
      return;
    }

    setImportProgress(30);

    // Batch insert codes (50 at a time)
    const batchSize = 50;
    for (let i = 0; i < validRows.length; i += batchSize) {
      const batch = validRows.slice(i, i + batchSize).map((r) => ({
        hospital_id: hospitalId,
        code_set_id: cs.id,
        code: r.code,
        description: r.description,
        category: r.category,
        code_system: uploadCodeSystem,
        is_billable: r.is_billable,
        common_india: false,
      }));
      await supabase.from("icd10_codes").insert(batch);
      setImportProgress(30 + Math.round((i / validRows.length) * 60));
    }

    setImportProgress(100);
    toast({ title: `✅ ${validRows.length} codes imported successfully` });
    setImporting(false);
    resetUpload();
    loadCodeSets();
    loadCodes();
  };

  const resetUpload = () => {
    setUploadStep(0);
    setFileData([]);
    setFileColumns([]);
    setValidRows([]);
    setErrorRows([]);
    setSetName("My Hospital ICD-10 Codes");
    setSetVersion("2022");
    setImportProgress(0);
  };

  const deleteCodeSet = async () => {
    if (!deleteTarget) return;
    await supabase.from("icd10_codes").delete().eq("code_set_id", deleteTarget.id);
    await supabase.from("icd10_code_sets").delete().eq("id", deleteTarget.id);
    toast({ title: "Code set deleted" });
    setDeleteTarget(null);
    loadCodeSets();
    loadCodes();
  };

  const addCustomCode = async () => {
    if (!newCode.code || !newCode.description) return;
    await supabase.from("icd10_codes").insert({
      hospital_id: hospitalId,
      code: newCode.code.trim(),
      description: newCode.description.trim(),
      category: newCode.category.trim() || null,
      code_system: newCode.code_system,
      is_billable: true,
      common_india: false,
    });
    toast({ title: "Code added" });
    setShowAddCode(false);
    setNewCode({ code: "", description: "", category: "", code_system: "icd10" });
    loadCodes();
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ["code", "description", "category", "is_billable"],
      ["A01.0", "Typhoid fever", "Infectious Diseases", "true"],
      ["I10", "Essential hypertension", "Cardiovascular", "true"],
      ["J45.9", "Asthma, unspecified", "Respiratory", "true"],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ICD10 Template");
    XLSX.writeFile(wb, "icd10_template.csv");
  };

  const systemSet = codeSets.find((s) => s.set_type === "system_default");
  const uploadedSets = codeSets.filter((s) => s.set_type !== "system_default");

  if (hospitalLoading || !hospitalId) return <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  return (
    <SettingsPageWrapper title="ICD-10 / ICD-11 Code Master" hideSave>
      <Tabs value={tab} onValueChange={setTab} className="w-full">
        <TabsList className="mb-6">
          <TabsTrigger value="sets" className="gap-1.5"><Package size={14} /> Code Sets</TabsTrigger>
          <TabsTrigger value="browse" className="gap-1.5"><Search size={14} /> Browse Codes</TabsTrigger>
        </TabsList>

        {/* ═══ TAB 1: CODE SETS ═══ */}
        <TabsContent value="sets" className="space-y-6">
          {/* Active Setting Card */}
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
            <p className="text-sm font-semibold text-foreground">Which codes should the AI use for suggestions?</p>
            <RadioGroup value={activeSet} onValueChange={setActiveSet} className="space-y-3">
              {[
                { value: "all", label: "All Codes (Recommended)", desc: "Use both pre-loaded Indian codes AND your uploaded codes. Gives the most comprehensive coverage." },
                { value: "system_only", label: "System Default Only", desc: "Use only the 500 pre-loaded Indian hospital codes. Best if you have not uploaded a custom set yet." },
                { value: "hospital_only", label: "My Hospital Codes Only", desc: "Use only codes you have uploaded. Best if your hospital uses a specific approved code list." },
              ].map((opt) => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <RadioGroupItem value={opt.value} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-foreground">{opt.label}</p>
                    <p className="text-xs text-muted-foreground">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </RadioGroup>

            {/* Classification switch — a DIFFERENT axis from the set selector above, which
                chooses system vs hospital-uploaded codes. */}
            <div className="pt-3 border-t border-border space-y-3">
              <p className="text-sm font-semibold text-foreground">Which classification do your clinicians code in?</p>
              <RadioGroup value={activeCodeSystem} onValueChange={setActiveCodeSystem} className="space-y-3">
                {[
                  { value: "icd10", label: "ICD-10 only (Default)", desc: "What the system has always used. PMJAY, insurance pre-auth and HCX claims all require ICD-10." },
                  { value: "both", label: "ICD-10 and ICD-11", desc: "Clinicians record both against a diagnosis. Recommended during the transition — ICD-10 keeps the statutory claims working while ICD-11 satisfies WHO reporting." },
                  { value: "icd11", label: "ICD-11 only", desc: "Only ICD-11 is offered in the pickers. Choose this only once your statutory reporting no longer needs ICD-10." },
                ].map((opt) => (
                  <label key={opt.value} className="flex items-start gap-3 cursor-pointer p-3 rounded-lg hover:bg-muted/50 transition-colors">
                    <RadioGroupItem value={opt.value} className="mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-foreground">{opt.label}</p>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </div>
                  </label>
                ))}
              </RadioGroup>
              {activeCodeSystem !== "icd10" && (
                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                  ICD-11 codes have to be uploaded before they appear in the pickers — no ICD-11 set
                  ships pre-loaded. Use the Upload tab with the classification set to ICD-11.
                </p>
              )}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <div className="flex items-center gap-2">
                <Switch checked={showCommonFirst} onCheckedChange={setShowCommonFirst} />
                <Label className="text-sm">Show common Indian codes first in search results</Label>
              </div>
              <Button onClick={saveSettings} disabled={saving} size="sm">
                {saving ? "Saving..." : "Save Preference"}
              </Button>
            </div>
          </div>

          {/* System Default */}
          {systemSet && (
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    <p className="text-sm font-bold text-foreground">{systemSet.set_name}</p>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{systemSet.total_codes} codes · {systemSet.version}</p>
                  <p className="text-xs text-muted-foreground">Covers all common diagnoses in Tier 2/3 hospitals</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setTab("browse"); setSourceFilter("system"); }}>
                  <Eye size={14} className="mr-1" /> Browse Codes
                </Button>
              </div>
            </div>
          )}

          {/* Uploaded Sets */}
          {uploadedSets.map((s) => (
            <div key={s.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-bold text-foreground">{s.set_name}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {s.total_codes} codes · {s.version || "—"} · Uploaded {s.uploaded_at ? new Date(s.uploaded_at).toLocaleDateString("en-IN") : "—"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => { setTab("browse"); setSourceFilter("uploaded"); }}>
                    <Eye size={14} className="mr-1" /> Browse
                  </Button>
                  <Button variant="outline" size="sm" className="text-destructive hover:bg-destructive/10" onClick={() => setDeleteTarget(s)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
            </div>
          ))}

          {/* Upload Section */}
          <div className="rounded-xl border border-dashed border-border p-6 space-y-4">
            <p className="text-sm font-semibold text-foreground">Upload your hospital's ICD-10 or ICD-11 code list</p>

            <div className="flex gap-3">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download size={14} className="mr-1" /> Download CSV Template
              </Button>
            </div>

            {/* No ICD-11 set ships pre-loaded: the WHO MMS linearization is ~35k entities and
                is not something to hand-transcribe into a migration. Hospitals export it from
                the WHO ICD-11 browser and load it here — the columns are identical. */}
            <p className="text-xs text-muted-foreground leading-relaxed">
              The same column layout works for both classifications — set <strong>Classification</strong>
              {" "}in Step&nbsp;3 to match the file. ICD-11 is not pre-loaded: export the MMS linearization
              from the WHO ICD-11 browser (icd.who.int) and upload it here.
            </p>

            {uploadStep === 0 && (
              <label className="flex flex-col items-center justify-center border-2 border-dashed border-muted-foreground/30 rounded-lg p-8 cursor-pointer hover:border-primary/50 transition-colors">
                <Upload size={24} className="text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">Drag & drop or click to upload (.csv, .xlsx)</p>
                <p className="text-xs text-muted-foreground">Max 5MB</p>
                <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileSelect} />
              </label>
            )}

            {/* Step 1: Column Mapping */}
            {uploadStep === 1 && (
              <div className="space-y-4 bg-muted/30 rounded-lg p-4">
                <p className="text-sm font-medium">Step 1 — Map Columns</p>
                <p className="text-xs text-muted-foreground">Preview: {fileData.length} rows found</p>
                <div className="overflow-auto max-h-32 rounded border border-border text-xs">
                  <table className="w-full">
                    <thead><tr>{fileColumns.map((c) => <th key={c} className="px-2 py-1 text-left bg-muted">{c}</th>)}</tr></thead>
                    <tbody>
                      {fileData.slice(0, 3).map((r, i) => (
                        <tr key={i}>{fileColumns.map((c) => <td key={c} className="px-2 py-1 border-t border-border">{String(r[c] ?? "")}</td>)}</tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {(["code", "description", "category", "is_billable"] as const).map((field) => (
                    <div key={field}>
                      <Label className="text-xs capitalize">{field === "is_billable" ? "Is Billable (optional)" : field === "category" ? "Category (optional)" : `${field} column *`}</Label>
                      <Select value={colMap[field]} onValueChange={(v) => setColMap((p) => ({ ...p, [field]: v }))}>
                        <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="Select column" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__skip__">— Skip —</SelectItem>
                          {fileColumns.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={validateRows} disabled={!colMap.code || !colMap.description}>Validate</Button>
                  <Button size="sm" variant="outline" onClick={resetUpload}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Step 2: Validation Results */}
            {uploadStep === 2 && (
              <div className="space-y-4 bg-muted/30 rounded-lg p-4">
                <p className="text-sm font-medium">Step 2 — Validation Results</p>
                <div className="flex gap-4">
                  <div className="flex items-center gap-1.5 text-emerald-600">
                    <CheckCircle2 size={14} /> <span className="text-sm font-medium">{validRows.length} valid codes</span>
                  </div>
                  {errorRows.length > 0 && (
                    <div className="flex items-center gap-1.5 text-amber-600">
                      <AlertTriangle size={14} /> <span className="text-sm font-medium">{errorRows.length} rows with errors (will be skipped)</span>
                    </div>
                  )}
                </div>
                {errorRows.length > 0 && (
                  <div className="overflow-auto max-h-24 rounded border border-border text-xs">
                    <table className="w-full">
                      <thead><tr><th className="px-2 py-1 bg-muted">Row</th><th className="px-2 py-1 bg-muted">Code</th><th className="px-2 py-1 bg-muted">Error</th></tr></thead>
                      <tbody>
                        {errorRows.slice(0, 10).map((r, i) => (
                          <tr key={i}><td className="px-2 py-1 border-t border-border">{r.row}</td><td className="px-2 py-1 border-t border-border">{r.code}</td><td className="px-2 py-1 border-t border-border text-destructive">{r.errors}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="space-y-2">
                  <p className="text-sm font-medium">Step 3 — Name Your Set</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label className="text-xs">Set Name</Label>
                      <Input value={setName} onChange={(e) => setSetName(e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Version</Label>
                      <Input value={setVersion} onChange={(e) => setSetVersion(e.target.value)} className="h-9 text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Classification</Label>
                      <Select value={uploadCodeSystem} onValueChange={setUploadCodeSystem}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CODE_SYSTEMS.map((s) => (
                            <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={importCodes} disabled={!validRows.length || importing}>
                    {importing ? "Importing..." : `Import ${validRows.length} Codes`}
                  </Button>
                  <Button size="sm" variant="outline" onClick={resetUpload}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Step 3: Importing */}
            {uploadStep === 3 && importing && (
              <div className="space-y-3 bg-muted/30 rounded-lg p-4">
                <p className="text-sm font-medium">Importing codes...</p>
                <Progress value={importProgress} className="h-2" />
                <p className="text-xs text-muted-foreground">{importProgress}%</p>
              </div>
            )}
          </div>
        </TabsContent>

        {/* ═══ TAB 2: BROWSE CODES ═══ */}
        <TabsContent value="browse" className="space-y-4">
          <div className="flex flex-wrap gap-3 items-center">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input value={searchQ} onChange={(e) => setSearchQ(e.target.value)} placeholder="Search code or description..." className="pl-9 h-9 text-sm" />
            </div>
            <Select value={catFilter} onValueChange={setCatFilter}>
              <SelectTrigger className="w-[180px] h-9 text-xs"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((c) => <SelectItem key={c} value={c!}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className="w-[150px] h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                <SelectItem value="system">System Default</SelectItem>
                <SelectItem value="uploaded">My Uploaded</SelectItem>
              </SelectContent>
            </Select>
            <Select value={systemFilter} onValueChange={setSystemFilter}>
              <SelectTrigger className="w-[130px] h-9 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">ICD-10 &amp; 11</SelectItem>
                {CODE_SYSTEMS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex items-center gap-1.5">
              <Switch checked={billableOnly} onCheckedChange={setBillableOnly} />
              <Label className="text-xs">Billable only</Label>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowAddCode(true)}>
              <Plus size={14} className="mr-1" /> Add Code
            </Button>
          </div>

          <p className="text-xs text-muted-foreground">{filteredCodes.length} codes</p>

          <div className="border border-border rounded-lg overflow-auto max-h-[calc(100vh-380px)]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[100px]">Code</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="w-[140px]">Category</TableHead>
                  <TableHead className="w-[60px]">Ch.</TableHead>
                  <TableHead className="w-[70px]">Billable</TableHead>
                  <TableHead className="w-[90px]">Source</TableHead>
                  <TableHead className="w-[60px]">Uses</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {codesLoading ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Loading...</TableCell></TableRow>
                ) : filteredCodes.length === 0 ? (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No codes found</TableCell></TableRow>
                ) : (
                  filteredCodes.slice(0, 200).map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono text-xs font-medium">{c.code}</TableCell>
                      <TableCell className="text-sm">{c.description}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.category || "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{c.chapter || "—"}</TableCell>
                      <TableCell>{c.is_billable ? <Badge variant="outline" className="text-[10px] bg-emerald-50 text-emerald-700 border-emerald-200">Yes</Badge> : <span className="text-xs text-muted-foreground">No</span>}</TableCell>
                      <TableCell>
                        {c.hospital_id ? (
                          <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">Uploaded</Badge>
                        ) : (
                          <Badge className="text-[10px] bg-accent/10 text-accent border-accent/20">System</Badge>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{c.use_count}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>

      {/* Delete Confirm */}
      <Dialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Code Set</DialogTitle>
            <DialogDescription>This will remove {deleteTarget?.total_codes} codes from "{deleteTarget?.set_name}". This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteCodeSet}>Delete</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Custom Code */}
      <Dialog open={showAddCode} onOpenChange={setShowAddCode}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom ICD Code</DialogTitle>
            <DialogDescription>This code will be added as a hospital-specific code.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Classification *</Label>
              <Select value={newCode.code_system} onValueChange={(v) => setNewCode((p) => ({ ...p, code_system: v }))}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CODE_SYSTEMS.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Code *</Label>
              <Input
                value={newCode.code}
                onChange={(e) => setNewCode((p) => ({ ...p, code: e.target.value }))}
                placeholder={newCode.code_system === "icd11" ? "e.g. 1A00" : "e.g. A01.0"}
                className="h-9"
              />
            </div>
            <div>
              <Label className="text-xs">Description *</Label>
              <Input value={newCode.description} onChange={(e) => setNewCode((p) => ({ ...p, description: e.target.value }))} placeholder="e.g. Typhoid fever" className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Input value={newCode.category} onChange={(e) => setNewCode((p) => ({ ...p, category: e.target.value }))} placeholder="e.g. Infectious Diseases" className="h-9" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddCode(false)}>Cancel</Button>
            <Button onClick={addCustomCode} disabled={!newCode.code || !newCode.description}>Add Code</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageWrapper>
  );
};

export default SettingsICDCodesPage;
