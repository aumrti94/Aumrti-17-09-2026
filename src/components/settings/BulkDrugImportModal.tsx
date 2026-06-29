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
  drug_name: string;
  generic_name: string;
  category: string;
  schedule_type: string;
  strength: string;
  form: string;
  hsn_code: string;
  gst_percent: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  hospitalId: string;
}

const SCHEDULES = ["OTC", "G", "H", "H1", "X", "other"];
const FORMS = ["Tablet", "Capsule", "Injection", "Syrup", "Ointment", "Drops", "Inhaler", "Patch", "Other"];

const blankRow = (): ImportRow => ({
  drug_name: "", generic_name: "", category: "",
  schedule_type: "OTC", strength: "", form: "Tablet",
  hsn_code: "", gst_percent: "12",
});

function mapHeader(h: string): keyof ImportRow | null {
  const s = h.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (["drugname", "name", "drug", "medicine", "medication"].includes(s)) return "drug_name";
  if (["genericname", "generic", "generics", "inn"].includes(s)) return "generic_name";
  if (["category", "class", "therapeuticclass", "drugclass"].includes(s)) return "category";
  if (["schedule", "scheduletype", "drugschedule", "sch", "schedtype"].includes(s)) return "schedule_type";
  if (["strength", "concentration", "dose", "potency"].includes(s)) return "strength";
  if (["form", "dosageform", "formulation", "dosageformulation"].includes(s)) return "form";
  if (["hsncode", "hsn", "hsnno"].includes(s)) return "hsn_code";
  if (["gst", "gstpercent", "gsttax", "taxrate", "tax", "gstrate"].includes(s)) return "gst_percent";
  return null;
}

function normalizeRow(raw: Record<string, any>): ImportRow {
  return {
    drug_name:    String(raw.drug_name    ?? "").trim(),
    generic_name: String(raw.generic_name ?? "").trim(),
    category:     String(raw.category     ?? "").trim(),
    schedule_type: raw.schedule_type ? String(raw.schedule_type).trim() : "OTC",
    strength:     String(raw.strength     ?? "").trim(),
    form:         raw.form ? String(raw.form).trim() : "Tablet",
    hsn_code:     String(raw.hsn_code     ?? "").trim(),
    gst_percent:  raw.gst_percent != null ? String(raw.gst_percent) : "12",
  };
}

function downloadTemplate() {
  const headers = ["Drug Name", "Generic Name", "Category", "Schedule (G/H/H1/X/OTC)", "Strength", "Form", "HSN Code", "GST %"];
  const sample = [
    ["Paracetamol 500mg", "Acetaminophen", "Analgesic", "OTC", "500mg", "Tablet", "30049099", "12"],
    ["Amoxicillin 250mg", "Amoxicillin Trihydrate", "Antibiotic", "H", "250mg", "Capsule", "30042090", "12"],
    ["Morphine 10mg/ml", "Morphine Sulfate", "Opioid Analgesic", "X", "10mg/ml", "Injection", "30049011", "5"],
  ];
  const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
  ws["!cols"] = headers.map(() => ({ wch: 20 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Drug Master");
  XLSX.writeFile(wb, "drug_import_template.xlsx");
}

const BulkDrugImportModal: React.FC<Props> = ({ open, onClose, hospitalId }) => {
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

  const handleExcelFile = async (file: File) => {
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: Record<string, any>[] = XLSX.utils.sheet_to_json(sheet, { defval: "" });
      if (raw.length === 0) {
        toast({ title: "Empty file", description: "No rows found in the first sheet.", variant: "destructive" });
        return;
      }

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
      }).filter(r => r.drug_name);

      if (parsed.length === 0) {
        toast({ title: "No drugs found", description: "Could not map any columns. Use the template for correct headers.", variant: "destructive" });
        return;
      }
      setRows(parsed);
    } catch (err: any) {
      toast({ title: "Parse failed", description: err.message, variant: "destructive" });
    }
  };

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

      const { data, error } = await supabase.functions.invoke("scan-drug-list", {
        body: { base64Image, mediaType: imageFile.type },
      });

      if (error || !data || data.error) {
        toast({ title: "Scan failed", description: data?.error || error?.message, variant: "destructive" });
        return;
      }

      const parsed = (Array.isArray(data) ? data : []).map(normalizeRow).filter((r: ImportRow) => r.drug_name);
      if (parsed.length === 0) {
        toast({ title: "No drugs detected", description: "Try a clearer image or use Excel upload instead.", variant: "destructive" });
        return;
      }
      setRows(parsed);
      toast({ title: `${parsed.length} drugs extracted`, description: "Review and edit before importing." });
    } catch (err: any) {
      toast({ title: "Scan failed", description: err.message, variant: "destructive" });
    } finally {
      setScanning(false);
    }
  };

  const updateRow = (i: number, field: keyof ImportRow, value: string) => {
    setRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: value } : r));
  };
  const removeRow = (i: number) => setRows(prev => prev.filter((_, idx) => idx !== i));
  const addRow = () => setRows(prev => [...prev, blankRow()]);

  const handleImport = async () => {
    const valid = rows.filter(r => r.drug_name.trim());
    if (valid.length === 0) { toast({ title: "Nothing to import", variant: "destructive" }); return; }
    setImporting(true);
    try {
      const payload = valid.map(r => ({
        hospital_id:  hospitalId,
        drug_name:    r.drug_name.trim(),
        generic_name: r.generic_name.trim()  || null,
        category:     r.category.trim()      || null,
        schedule_type: r.schedule_type.trim() || null,
        strength:     r.strength.trim()      || null,
        form:         r.form.trim()          || null,
        hsn_code:     r.hsn_code.trim()      || null,
        gst_percent:  r.gst_percent !== "" ? Number(r.gst_percent) : null,
        is_ndps:      r.schedule_type.trim().toUpperCase() === "X",
        is_active:    true,
      }));

      const { error } = await (supabase as any).from("drug_master").insert(payload);
      if (error) throw error;

      queryClient.invalidateQueries({ queryKey: ["settings-drugs"] });
      toast({ title: `${valid.length} drug${valid.length !== 1 ? "s" : ""} imported successfully` });
      handleClose();
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  const validCount = rows.filter(r => r.drug_name.trim()).length;

  return (
    <Dialog open={open} onOpenChange={v => !v && handleClose()}>
      <DialogContent className="max-w-[96vw] w-[96vw] h-[94vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-6 pt-5 pb-0 shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Upload size={18} className="text-primary" />
            Bulk Import Drug Master
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
                  <p className="text-sm font-medium">Upload a photo or screenshot of your drug list</p>
                  <p className="text-xs text-muted-foreground mt-1">AI will extract drug names, strengths, schedules, and GST rates</p>
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
                  <span className="text-sm font-medium">{validCount} drug{validCount !== 1 ? "s" : ""} ready to import</span>
                  {rows.some(r => !r.drug_name.trim()) && (
                    <span className="text-xs text-destructive bg-destructive/10 px-2 py-0.5 rounded-full">
                      {rows.filter(r => !r.drug_name.trim()).length} row(s) missing name — will be skipped
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
                      {["Drug Name *", "Generic Name", "Category", "Schedule", "Strength", "Form", "HSN Code", "GST %", ""].map(h => (
                        <th key={h} className="px-2 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {rows.map((row, i) => (
                      <tr key={i} className={cn("hover:bg-muted/20", !row.drug_name.trim() && "bg-destructive/5")}>
                        <td className="px-1 py-1">
                          <input value={row.drug_name} onChange={e => updateRow(i, "drug_name", e.target.value)}
                            className={cn("w-36 px-1.5 py-1 border rounded text-xs", !row.drug_name.trim() ? "border-destructive" : "border-border")} />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.generic_name} onChange={e => updateRow(i, "generic_name", e.target.value)}
                            className="w-28 px-1.5 py-1 border border-border rounded text-xs" />
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.category} onChange={e => updateRow(i, "category", e.target.value)}
                            className="w-24 px-1.5 py-1 border border-border rounded text-xs" placeholder="Analgesic" />
                        </td>
                        <td className="px-1 py-1">
                          <select value={row.schedule_type} onChange={e => updateRow(i, "schedule_type", e.target.value)}
                            className="w-20 px-1 py-1 border border-border rounded text-xs bg-background">
                            {SCHEDULES.map(s => <option key={s}>{s}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.strength} onChange={e => updateRow(i, "strength", e.target.value)}
                            className="w-20 px-1.5 py-1 border border-border rounded text-xs" placeholder="500mg" />
                        </td>
                        <td className="px-1 py-1">
                          <select value={row.form} onChange={e => updateRow(i, "form", e.target.value)}
                            className="w-24 px-1 py-1 border border-border rounded text-xs bg-background">
                            {FORMS.map(f => <option key={f}>{f}</option>)}
                          </select>
                        </td>
                        <td className="px-1 py-1">
                          <input value={row.hsn_code} onChange={e => updateRow(i, "hsn_code", e.target.value)}
                            className="w-20 px-1.5 py-1 border border-border rounded text-xs" placeholder="30049099" />
                        </td>
                        <td className="px-1 py-1">
                          <input type="number" value={row.gst_percent} onChange={e => updateRow(i, "gst_percent", e.target.value)}
                            className="w-14 px-1.5 py-1 border border-border rounded text-xs" />
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
              {importing ? <><Loader2 size={14} className="animate-spin" /> Importing…</> : `Import ${validCount} Drug${validCount !== 1 ? "s" : ""}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default BulkDrugImportModal;
