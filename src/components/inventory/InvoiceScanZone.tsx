import React, { useState, useRef } from "react";
import { Camera, Upload, X, Loader2, CheckCircle, Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

export interface ExtractedInvoiceItem {
  name: string;
  batch_number: string | null;
  expiry_date: string | null;
  quantity: number | null;
  unit: string | null;
  unit_rate: number | null;
  total_amount: number | null;
  gst_percent: number | null;
  mrp: number | null;
}

export interface ExtractedInvoiceData {
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  items: ExtractedInvoiceItem[];
  total_invoice_amount: number | null;
  confidence: number;
}

interface Props {
  onExtracted: (data: ExtractedInvoiceData, imageFile: File) => void;
}

const STEPS = [
  { icon: Camera, label: "Reading invoice..." },
  { icon: Search, label: "Identifying items..." },
  { icon: Sparkles, label: "Matching products..." },
  { icon: CheckCircle, label: "Extraction complete!" },
];

const InvoiceScanZone: React.FC<Props> = ({ onExtracted }) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [step, setStep] = useState(0);

  const handleFile = (file: File) => {
    if (!file.type.startsWith("image/") && file.type !== "application/pdf") {
      toast({ title: "Please upload an image or PDF", variant: "destructive" });
      return;
    }
    setImageFile(file);
    if (file.type.startsWith("image/")) {
      const url = URL.createObjectURL(file);
      setImagePreview(url);
    } else {
      setImagePreview(null);
    }
  };

  const clearImage = () => {
    setImageFile(null);
    setImagePreview(null);
    setStep(0);
  };

  const extractData = async () => {
    if (!imageFile) return;
    setProcessing(true);
    setStep(0);
    const startTime = Date.now();

    // Animate steps
    const stepTimer1 = setTimeout(() => setStep(1), 1000);
    const stepTimer2 = setTimeout(() => setStep(2), 2500);

    try {
      // Convert to base64
      const arrayBuffer = await imageFile.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      const base64 = btoa(binary);

      const { data, error } = await supabase.functions.invoke("scan-invoice", {
        body: { base64Image: base64, mediaType: imageFile.type },
      });

      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);

      if (error) throw new Error(error.message || "Extraction failed");
      if (data?.error) throw new Error(data.error);

      setStep(3);
      const processingTime = Date.now() - startTime;

      toast({ title: `Extracted ${data.items?.length || 0} items in ${(processingTime / 1000).toFixed(1)}s` });

      setTimeout(() => {
        onExtracted(data as ExtractedInvoiceData, imageFile);
        setProcessing(false);
      }, 800);
    } catch (err: any) {
      clearTimeout(stepTimer1);
      clearTimeout(stepTimer2);
      setProcessing(false);
      setStep(0);
      toast({ title: "Extraction failed", description: err.message, variant: "destructive" });
    }
  };

  return (
    <div className="space-y-3">
      <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />

      {!imageFile ? (
        <div className="border-2 border-dashed border-border rounded-xl p-6 text-center bg-muted/30">
          <Camera className="h-10 w-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm font-semibold text-foreground">Scan or upload vendor invoice</p>
          <p className="text-xs text-muted-foreground mb-3">AI will auto-fill the GRN form</p>
          <div className="flex gap-2 justify-center">
            <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => cameraRef.current?.click()}>
              <Camera className="h-3.5 w-3.5" /> Take Photo
            </Button>
            <Button size="sm" variant="outline" className="text-xs gap-1.5" onClick={() => fileRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" /> Upload File
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Image preview */}
          <div className="relative border border-border rounded-lg overflow-hidden bg-muted/30">
            {imagePreview ? (
              <img src={imagePreview} alt="Invoice" className="w-full max-h-[200px] object-contain" />
            ) : (
              <div className="p-4 text-center text-xs text-muted-foreground">📄 {imageFile.name}</div>
            )}
            {!processing && (
              <button onClick={clearImage} className="absolute top-2 right-2 p-1 bg-background/80 rounded-full hover:bg-background">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Processing state */}
          {processing ? (
            <div className="bg-muted/50 rounded-lg p-4 space-y-2">
              {STEPS.map((s, i) => {
                const Icon = s.icon;
                const active = i === step;
                const done = i < step;
                return (
                  <div key={i} className={`flex items-center gap-2 text-xs transition-all ${done ? "text-emerald-600" : active ? "text-primary font-medium" : "text-muted-foreground"}`}>
                    {active ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : done ? <CheckCircle className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5 opacity-40" />}
                    {s.label}
                  </div>
                );
              })}
            </div>
          ) : (
            <Button className="w-full gap-2 h-10" onClick={extractData}>
              <Sparkles className="h-4 w-4" /> Extract Invoice Data
            </Button>
          )}
        </div>
      )}

      <div className="relative flex items-center justify-center">
        <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-border" /></div>
        <span className="relative bg-background px-3 text-[10px] text-muted-foreground uppercase">or fill manually below</span>
      </div>
    </div>
  );
};

export default InvoiceScanZone;
