import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Upload, FileSpreadsheet, ImageIcon, Trash2, Download, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ImportRow {
  test_name: string;
  test_code: string;
  category: string;
  sample_type: string;
  unit: string;
  normal_min: string;
  normal_max: string;
  tat_minutes: string;
  fee: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
}

const CATEGORIES = ["Haematology", "Biochemistry", "Pathology", "Microbiology", "Serology", "Immunology"];
const SAMPLES = ["Blood", "Urine", "Stool", "Swab", "CSF", "Other"];

const blankRow = (): ImportRow => ({
  test_name: "", test_code: "", category: "Biochemistry",
  sample_type: "Blood", unit: "", normal_min: "", normal_max: "",
  tat_minutes: "60", fee: "0",
});

// Fuzzy column header → field mapping
function mapHeader(h: string): keyof ImportRow | null {
  const s = h.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["testname", "name", "test"].includes(s)) return "test_name";
  if (["testcode", "code", "abbreviation", "abbr"].includes(s)) return "test_code";
  if (["category", "dept", "department"].includes(s)) return "category";
  if (["sample", "sampletype", "specimentype", "specimen"].includes(s)) return "sample_type";
  if (["unit", "units", "uom"].includes(s)) return "unit";
  if (["normalmin", "min", "lowernormal", "lower"].includes(s)) return "normal_min";
  if (["normalmax", "max", "uppernormal", "upper"].includes(s)) return "normal_max";
  if (["tat", "tatminutes", "turnaround", "tatmins", "tatmin"].includes(s)) return "tat_minutes";
  if (["fee", "rate", "price", "amount", "cost", "charges"].includes(s)) return "fee";
  return null;
}

function normalizeRow(raw: Record<string, any>): ImportRow {
  return {
    test_name: String(raw.test_name ?? "").trim(),
    test_code: String(raw.test_code ?? "").trim(),
    category: raw.category ? String(raw.category).trim() : "Biochemistry",
    sample_type: raw.sample_type ? String(raw.sample_type).trim() : "Blood",
    unit: String(raw.unit ?? "").trim(),
    normal_min: raw.normal_min != null ? String(raw.normal_min) : "",
    normal_max: raw.normal_max != null ? String(raw.normal_max) : "",
    tat_minutes: raw.tat_minutes != null ? String(raw.tat_minutes) : "60",
    fee: raw.fee != null ? String(raw.fee) : "0",
  };
}

function downloadTemplate() {
  const headers = ["Test Name", "Code", "Category", "Sample Type", "Unit", "Normal Min", "Normal Max", "TAT (minutes)", "Fee (INR)"];
  const sample = [
    ["Complete Blood Count", "CBC", "Haematology", "Blood", "cells/µL", "4.5", "11.0", "120", "250"],
    ["Blood Sugar Fasting", "BSF", "Biochemistry", "Blood", "mg/dL", "70", "100", "60", "150"],
    ["Urine Routine", "URE", "Pathology", "Urine", "", "", "", "60", "100"],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws["!cols"] = headers.map(() => ({ wch: 18 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Lab Tests");
  XLSX.writeFile(wb, "lab_test_import_template.xlsx");
}

const BulkLabTestImportModal: React.FC<Props> = ({ open, onClose, hospitalId }) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<"excel" | "image">("excel");
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [importing, setImporting] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const excelRef = useRef<HTMLInputElement>(null);
  const imageRef = useRef<HTMLInputElement>(null);

  const handleClose = () => {
    setRows([]);
    setImagePreview(null);
    setImageFile(null);
    setMode("excel");
    onClose();
  };

  // ── Excel parsing ──────────────────────────────────────────────────────────
  const handleExcelFile = async (file: File) => {
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (raw.length === 0) { toast({ title: "Empty file", description: "No rows found in the first sheet.", variant: "destructive" }); return; }

      // Map headers
      const firstRow = raw[0];
      const headerMap: Record<string, keyof ImportRow> = {};
      for (const col of Object.keys(firstRow)) {
        const field = mapHeader(col);
        if (field) headerMap[col] = field;
      }

      const parsed: ImportRow[] = raw.map(r => {
        const mapped: Record<string, any> = {};
        for (const [col, field] of Object.entries(headerMap)) {
          mapped[field] = r[col];
        }
        return normalizeRow(mapped);
      }).filter(r => r.test_name);

      if (parsed.length === 0) {
        toast({ title: "No tests found", description: "Could not map any columns. Use the template for correct headers.", variant: "destructive" });
        return;
      }
      setRows(parsed);
    } catch (err: any) {
      toast({ title: "Parse failed", description: err.message, variant: "destructive" });
    }
  };

  // ── Image scanning ─────────────────────────────────────────────────────────
  const handleImageFile = (file: File) => {
    setImageFile(file);
    const reader = new FileReader();
    reader.onload = e => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  };

  const scanImage = async () => {
    if (!imageFile) return;
    setScanning(true);
    try {
      const ab = await imageFile.arrayBuffer();
      const bytes = new Uint8Array(ab);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const base64Image = btoa(binary);

      const { data, error } = await supabase.functions.invoke("scan-lab-tests", {
        body: { base64Image, mediaType: imageFile.type },
      });

      if (error || !data || data.error) {
        toast({ title: "Scan failed", description: data?.error || error?.message, variant: "destructive" });
        return;
      }

      const parsed = (Array.isArray(data) ? data : []).map(normalizeRow).filter((r: ImportRow) => r.test_name);
      if (parsed.length === 0) {
        toast({ title: "No tests detected", description: "Try a clearer image or use Excel upload instead.", variant: "destructive" });
        return;
      }
      setRows(parsed);
      toast({ title: `${parsed.length} tests extracted`, description: "Review and edit before importing." });
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  // ── Row editing ────────────────────────────────────────────────────────────
  const updateRow = (i: number, field: keyof ImportRow, value: string) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const addRow = () => setRows(prev => [...prev, blankRow()]);

  // ── Import ─────────────────────────────────────────────────────────────────
  const handleImport = async () => {
    const valid = rows.filter(r => r.test_name.trim());
    if (valid.length === 0) { toast({ title: "Nothing to import", variant: "destructive" }); return; }
    setImporting(true);
    try {
      const payload = valid.map(r => ({
        hospital_id: hospitalId,
        test_name: r.test_name.trim(),
        test_code: r.test_code.trim() || null,
        category: r.category || "Biochemistry",
        sample_type: r.sample_type || "Blood",
        unit: r.unit.trim() || null,
        normal_min: r.normal_min !== "" ? Number(r.normal_min) : null,
        normal_max: r.normal_max !== "" ? Number(r.normal_max) : null,
        tat_minutes: Number(r.tat_minutes) || 60,
        fee: Number(r.fee) || 0,
        is_active: true,
      }));

      const { error } = await supabase.from("lab_test_master").insert(payload as any);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["settings-lab-tests"] });
      toast({ title: `${valid.length} test${valid.length !== 1 ? "s" : ""} imported successfully` });
      handleClose();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const validCount = rows.filter(r => r.test_name.trim()).length;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[94vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Upload size={18} className="text-primary" />
            Bulk Import Lab Tests
          </DialogTitle>
        </DialogHeader>

        {/* Mode tabs */}
        <div className="flex gap-1 border-b border-border shrink-0 px-6 mt-4">
          {([
            { key: "excel", label: "Excel / CSV", icon: <FileSpreadsheet size={14} /> },
            { key: "image", label: "Image / Photo", icon: <ImageIcon size={14} /> },
          ] as const).map(t => (
            <button
              key={t.key}
              onClick={() => { setMode(t.key); setRows([]); setImagePreview(null); setImageFile(null); }}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium border-b-2 transition-colors",
                mode === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              )}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4 px-6 py-4">
          {/* ── Excel mode ── */}
          {mode === "excel" && rows.length === 0 && (
            <div className="space-y-3">
              <div
                className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                onClick={() => excelRef.current?.click()}
                onDragOver={e => e.preventDefault()}
                onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleExcelFile(f); }}
              >
                <FileSpreadsheet size={36} className="mx-auto text-muted-foreground/50 mb-2" />
                <p className="text-sm font-medium">Drop your Excel or CSV file here</p>
                <p className="text-xs text-muted-foreground mt-1">Supports .xlsx, .xls, .csv</p>
                <Button variant="outline" size="sm" className="mt-3 gap-1.5">
                  <Upload size={13} /> Choose File
                </Button>
              </div>
              <input ref={excelRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleExcelFile(f); e.target.value = ""; }} />
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Not sure about the format?</span>
                <button onClick={downloadTemplate} className="flex items-center gap-1 text-primary hover:underline font-medium">
                  <Download size={12} /> Download Template
                </button>
              </div>
            </div>
          )}

          {/* ── Image mode ── */}
          {mode === "image" && rows.length === 0 && (
            <div className="space-y-3">
              {!imagePreview ? (
                <div
                  className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors"
                  onClick={() => imageRef.current?.click()}
                  onDragOver={e => e.preventDefault()}
                  onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}
                >
                  <ImageIcon size={36} className="mx-auto text-muted-foreground/50 mb-2" />
                  <p className="text-sm font-medium">Upload a photo or screenshot of your test list</p>
                  <p className="text-xs text-muted-foreground mt-1">AI will extract all test names, codes, rates, and ranges</p>
                  <Button variant="outline" size="sm" className="mt-3 gap-1.5">
                    <Upload size={13} /> Choose Image
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="relative rounded-lg overflow-hidden border border-border" style={{ maxHeight: "calc(94vh - 280px)" }}>
                    <img src={imagePreview} alt="Uploaded" className="w-full object-contain" style={{ maxHeight: "calc(94vh - 280px)" }} />
                    <button
                      onClick={() => { setImagePreview(null); setImageFile(null); }}
                      className="absolute top-2 right-2 bg-black/50 text-white rounded-full p-1 hover:bg-black/70"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                  <Button onClick={scanImage} disabled={scanning} className="gap-2 w-full">
                    {scanning ? <><Loader2 size={14} className="animate-spin" /> Scanning with AI…</> : <><Sparkles size={14} /> Scan with AI</>}
                  </Button>
                </div>
              )}
              <input ref={imageRef} type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ""; }} />
            </div>
          )}

          {/* ── Preview table ── */}
          {rows.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{validCount} test{validCount !== 1 ? "s" : ""} ready to import</span>
                  {rows.some(r => !r.test_name.trim()) && (
                    <span className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                      {rows.filter(r => !r.test_name.trim()).length} row(s) missing name — will be skipped
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={addRow} className="gap-1 text-xs h-7">+ Add Row</Button>
                  <Button variant="outline" size="sm" onClick={() => setRows([])} className="gap-1 text-xs h-7 text-muted-foreground">Clear All</Button>
                </div>
              </div>

              <div className="border border-border rounded-lg overflow-auto" style={{ maxHeight: "calc(94vh - 240px)" }}>
                <table className="w-full text-xs min-w-[900px]">
                  <thead className="bg-muted/40 sticky top-0">
                    <tr>
                      {["Test Name *", "Code", "Category", "Sample", "Unit", "Min", "Max", "TAT(m)", "Fee(₹)", ""].map(h => (
                        <th key={h} className="px-2 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row, i) => (
                      <tr key={i} className={cn("hover:bg-muted/20", !row.test_name.trim() && "bg-destructive/5")}>
                        <td className="px-1 py-1">
                          <input value={row.test_name} onChange={e => updateRow(i, "test_name", e.target.value)}
                            className={cn("w-36 px-1.5 py-1 border rounded text-xs", !row.test_name.trim() ? "border-destructive" : "border-border")} />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.test_code} onChange={e => updateRow(i, "test_code", e.target.value)}
                            className="w-16 px-1.5 py-1 border border-border rounded text-xs" />
                        </td>
                        <td className="px-1 py-1">
                          <select value={row.category} onChange={e => updateRow(i, "category", e.target.value)}
                            className="w-28 px-1 py-1 border border-border rounded text-xs bg-background">
                            {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <select value={row.sample_type} onChange={e => updateRow(i, "sample_type", e.target.value)}
                            className="w-20 px-1 py-1 border border-border rounded text-xs bg-background">
                            {SAMPLES.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.unit} onChange={e => updateRow(i, "unit", e.target.value)}
                            className="w-16 px-1.5 py-1 border border-border rounded text-xs" placeholder="mg/dL" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" value={row.normal_min} onChange={e => updateRow(i, "normal_min", e.target.value)}
                            className="w-14 px-1.5 py-1 border border-border rounded text-xs" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" value={row.normal_max} onChange={e => updateRow(i, "normal_max", e.target.value)}
                            className="w-14 px-1.5 py-1 border border-border rounded text-xs" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" value={row.tat_minutes} onChange={e => updateRow(i, "tat_minutes", e.target.value)}
                            className="w-14 px-1.5 py-1 border border-border rounded text-xs" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" value={row.fee} onChange={e => updateRow(i, "fee", e.target.value)}
                            className="w-16 px-1.5 py-1 border border-border rounded text-xs" />
                        </td>
                        <td className="px-1 py-1">
                          <button onClick={() => removeRow(i)} className="text-muted-foreground hover:text-destructive p-0.5">
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-border px-6 py-3">
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          {rows.length > 0 && (
            <Button onClick={handleImport} disabled={importing || validCount === 0} className="gap-2 min-w-32">
              {importing ? <><Loader2 size={14} className="animate-spin" /> Importing…</> : `Import ${validCount} Test${validCount !== 1 ? "s" : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkLabTestImportModal;
