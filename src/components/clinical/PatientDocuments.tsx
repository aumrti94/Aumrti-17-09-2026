import React, { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Upload, FileText, Eye, Copy, Loader2, Image, FileCheck } from "lucide-react";
import { callAI } from "@/lib/aiProvider";

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
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum 10MB allowed", variant: "destructive" });
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
      // Upload to storage
      const path = `${hospitalId}/${patientId}/${Date.now()}_${selectedFile.name}`;
      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from("patient-documents")
        .upload(path, selectedFile);

      if (uploadErr) throw uploadErr;

      const fileUrl = supabase.storage
        .from("patient-documents")
        .getPublicUrl(uploadData.path).data.publicUrl;

      // Try AI analysis
      let docName = selectedFile.name;
      let docType = "other";
      let ocrText: string | null = null;
      let ocrSummary: string | null = null;

      if (selectedFile.type.startsWith("image/")) {
        setAnalysing(true);
        try {
          const base64 = await fileToBase64(selectedFile);
          const response = await callAI({
            featureKey: "document_ocr",
            hospitalId,
            prompt: `This is a patient's medical document from India.
            
Extract and return ONLY a JSON object:
{
  "document_type": "old_prescription|old_report|discharge_summary|xray_image|insurance_card|id_proof|referral_letter|other",
  "document_name": "suggested filename",
  "key_findings": "2-3 sentence summary of what this document contains",
  "extracted_text": "full text extracted from the document",
  "important_values": "any critical numbers like drug doses, test results, dates"
}

Be concise. Return only JSON.

[Image data provided as base64 in the prompt context - analyse the medical document]
Base64 image data: ${base64.substring(0, 500)}...`,
            maxTokens: 600,
          });

          const parsed = JSON.parse(
            response.text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim()
          );

          docName = parsed.document_name || selectedFile.name;
          docType = parsed.document_type || "other";
          ocrText = parsed.extracted_text || null;
          ocrSummary = parsed.key_findings || null;
        } catch (aiErr) {
          console.warn("AI analysis unavailable:", aiErr);
          toast({ title: "Document saved", description: "AI analysis unavailable — document saved without OCR" });
        }
        setAnalysing(false);
      }

      // Insert record
      await (supabase as any).from("patient_documents").insert({
        hospital_id: hospitalId,
        patient_id: patientId,
        document_name: docName,
        document_type: docType,
        file_url: fileUrl,
        ocr_text: ocrText,
        ocr_summary: ocrSummary,
        uploaded_by: userId,
      });

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
          accept="image/jpeg,image/png,application/pdf"
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
                    onClick={() => window.open(doc.file_url, "_blank", "noopener,noreferrer")}
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
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default PatientDocuments;
