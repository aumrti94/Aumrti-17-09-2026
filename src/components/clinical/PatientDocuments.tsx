import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Eye, Copy, Loader2, Image, FileCheck, Trash2 } from "lucide-react";
import { analyzeDocument } from "@/lib/documentAI";
import { resolveStorageUrl, storagePathFromPublicUrl, BUCKETS } from "@/lib/storageUrls";

const BUCKET = BUCKETS.patientDocuments;

interface Doc {
  id: string;
  document_name: string;
  document_type: string;
  file_url: string;
  ocr_text: string | null;
  ocr_summary: string | null;
  upload_date: string;
}

interface Props {
  patientId: string;
  hospitalId: string;
  userId: string;
}

const TYPE_ICONS: Record<string, string> = {
  old_prescription: "💊",
  old_report: "📊",
  discharge_summary: "📋",
  xray_image: "🩻",
  insurance_card: "🏥",
  id_proof: "🪪",
  referral_letter: "✉️",
  other: "📄",
};

const TYPE_LABELS: Record<string, string> = {
  old_prescription: "Prescription",
  old_report: "Report",
  discharge_summary: "Discharge Summary",
  xray_image: "X-Ray / Imaging",
  insurance_card: "Insurance Card",
  id_proof: "ID Proof",
  referral_letter: "Referral Letter",
  other: "Other",
};

const PatientDocuments: React.FC<Props> = ({ patientId, hospitalId, userId }) => {
  const { toast } = useToast();
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [analysing, setAnalysing] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchDocs = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("patient_documents")
      .select("id, document_name, document_type, file_url, ocr_text, ocr_summary, upload_date")
      .eq("patient_id", patientId)
      .order("created_at", { ascending: false })
      .limit(20);
    setDocs(data || []);
  }, [patientId]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum 15MB allowed", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    if (file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = () => setPreview(reader.result as string);
      reader.readAsDataURL(file);
    } else {
      setPreview(null);
    }
  };

  const uploadAndAnalyse = async () => {
    if (!selectedFile) return;
    setUploading(true);

    try {
      // Upload to storage. The bucket is private (20261010000010), so we store
      // the object path and mint a signed URL at view time — never a public URL.
      const path = `${hospitalId}/${patientId}/${Date.now()}_${selectedFile.name}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from(BUCKET)
        .upload(path, selectedFile);

      if (uploadErr) throw uploadErr;

      const storedPath = uploadData.path;

      // Real content analysis — reads the ACTUAL document (image / PDF / DOCX / text),
      // not a truncated base64 string. Maps common id-proof types onto our labels.
      let docName = selectedFile.name;
      let docType = "other";
      let ocrText: string | null = null;
      let ocrSummary: string | null = null;

      setAnalysing(true);
      try {
        const analysis = await analyzeDocument({
          file: selectedFile,
          hospitalId,
          patientId,
        });
        if (analysis.analyzable) {
          docName = analysis.documentName || selectedFile.name;
          docType = mapDocType(analysis.documentType);
          ocrText = analysis.extractedText || null;
          ocrSummary =
            [analysis.summary, analysis.importantValues && `Key values: ${analysis.importantValues}`]
              .filter(Boolean)
              .join("\n") || null;
        } else if (analysis.error) {
          toast({ title: "Document saved", description: analysis.error });
        }
      } catch (aiErr: any) {
        console.warn("AI analysis unavailable:", aiErr);
        toast({ title: "Document saved", description: "AI analysis unavailable — document saved without OCR" });
      }
      setAnalysing(false);

      // Insert record. If this fails (e.g. the validate_patient_document_type
      // trigger rejects an unmapped type) the uploaded object would otherwise
      // be stranded in the bucket with nothing pointing at it — clean it up.
      const { error: insertErr } = await (supabase as any).from("patient_documents").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        document_name: docName,
        document_type: docType,
        file_url: storedPath,
        ocr_text: ocrText,
        ocr_summary: ocrSummary,
        uploaded_by: userId,
      });

      if (insertErr) {
        // Best-effort — a failed cleanup shouldn't mask the real error.
        try { await supabase.storage.from(BUCKET).remove([storedPath]); } catch { /* ignore */ }
        throw insertErr;
      }

      toast({ title: "Document uploaded successfully ✓" });
      setSelectedFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = "";
      fetchDocs();
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(false);
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Text copied to clipboard" });
  };

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const deleteDoc = async (doc: Doc) => {
    if (!window.confirm(`Delete "${doc.document_name}"? This permanently removes the document and its extracted text.`)) return;
    setDeletingId(doc.id);
    try {
      // Remove the stored file (best-effort — a failure here shouldn't block
      // deleting the DB record). Rows written before the bucket was made
      // private hold a full public URL; newer ones hold a bare path.
      const path = storagePathFromPublicUrl(BUCKET, doc.file_url) ?? doc.file_url;
      if (path) await supabase.storage.from(BUCKET).remove([path]);

      // Delete the database row — this is the authoritative removal.
      const { error } = await (supabase as any)
        .from("patient_documents")
        .delete()
        .eq("id", doc.id);
      if (error) throw error;

      setDocs((prev) => prev.filter((d) => d.id !== doc.id));
      toast({ title: "Document deleted" });
    } catch (err: any) {
      toast({ title: "Delete failed", description: err.message, variant: "destructive" });
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        Documents
      </h3>

      {/* Upload Zone */}
      <div
        className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors mb-3"
        onClick={() => fileRef.current?.click()}
      >
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.docx,.doc,text/plain,.csv"
          className="hidden"
          onChange={handleFileSelect}
        />
        <Upload size={20} className="mx-auto text-muted-foreground mb-1" />
        <p className="text-xs font-medium text-foreground">Upload Patient Document</p>
        <p className="text-[10px] text-muted-foreground">Prescription, report, discharge summary, ID proof</p>
      </div>

      {/* Selected file preview */}
      {selectedFile && (
        <div className="bg-muted rounded-lg p-3 mb-3">
          <div className="flex items-center gap-3">
            {preview ? (
              <img src={preview} alt="Preview" className="w-16 h-16 rounded object-cover" />
            ) : (
              <div className="w-16 h-16 rounded bg-muted-foreground/10 flex items-center justify-center">
                <FileText size={24} className="text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{selectedFile.name}</p>
              <p className="text-[10px] text-muted-foreground">{(selectedFile.size / 1024).toFixed(0)} KB</p>
            </div>
            <Button
              size="sm"
              onClick={uploadAndAnalyse}
              disabled={uploading || analysing}
              className="text-xs"
            >
              {analysing ? (
                <><Loader2 size={12} className="animate-spin mr-1" /> Analysing...</>
              ) : uploading ? (
                <><Loader2 size={12} className="animate-spin mr-1" /> Uploading...</>
              ) : (
                <><FileCheck size={12} className="mr-1" /> Upload & Analyse</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Document List */}
      {docs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No documents uploaded yet</p>
      ) : (
        <div className="space-y-2">
          {docs.map((doc) => (
            <div key={doc.id} className="bg-muted rounded-lg p-3">
              <div className="flex items-start gap-2">
                <span className="text-lg flex-shrink-0">{TYPE_ICONS[doc.document_type] || "📄"}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-bold text-foreground truncate">{doc.document_name}</p>
                  {doc.ocr_summary && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{doc.ocr_summary}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-[9px]">
                      {TYPE_LABELS[doc.document_type] || "Other"}
                    </Badge>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(doc.upload_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={async () => {
                      try {
                        const url = await resolveStorageUrl(BUCKET, doc.file_url);
                        window.open(url, "_blank", "noopener,noreferrer");
                      } catch (err: any) {
                        toast({ title: "Could not open document", description: err?.message, variant: "destructive" });
                      }
                    }}
                    title="View document"
                  >
                    <Eye size={12} />
                  </Button>
                  {doc.ocr_text && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => copyText(doc.ocr_text!)}
                      title="Copy extracted text"
                    >
                      <Copy size={12} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    disabled={deletingId === doc.id}
                    onClick={() => deleteDoc(doc)}
                    title="Delete document"
                  >
                    {deletingId === doc.id
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Trash2 size={12} />}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// The engine returns a broad set of clinical/insurance types; fold the ones this
// component doesn't have icons/labels for onto its nearest known bucket.
function mapDocType(engineType: string): string {
  const known = new Set([
    "old_prescription", "old_report", "discharge_summary", "xray_image",
    "insurance_card", "id_proof", "referral_letter", "other",
  ]);
  if (known.has(engineType)) return engineType;
  switch (engineType) {
    case "photo_id": return "id_proof";
    case "investigation_reports": return "old_report";
    case "admission_note":
    case "ot_notes":
    case "nurses_notes":
    case "drug_chart":
    case "pre_auth_approval": return "discharge_summary";
    default: return "other";
  }
}

export default PatientDocuments;
