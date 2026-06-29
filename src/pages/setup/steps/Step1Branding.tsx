import React, { useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";

const presetColors = [
  { hex: "#1A2F5A", name: "Navy" },
  { hex: "#0E7B7B", name: "Teal" },
  { hex: "#1E40AF", name: "Blue" },
  { hex: "#7C3AED", name: "Purple" },
  { hex: "#065F46", name: "Forest" },
  { hex: "#9D174D", name: "Crimson" },
  { hex: "#92400E", name: "Brown" },
  { hex: "#1F2937", name: "Charcoal" },
];

interface Props {
  hospitalId: string;
  hospitalName: string;
  onComplete: () => void;
}

const Step1Branding: React.FC<Props> = ({ hospitalId, hospitalName, onComplete }) => {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [color, setColor] = useState("#1A2F5A");
  const [customHex, setCustomHex] = useState("");
  const [saving, setSaving] = useState(false);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Max 2MB", variant: "destructive" });
      return;
    }
    setUploading(true);
    const ext = file.name.split(".").pop();
    const path = `${hospitalId}/logo.${ext}`;
    const { error } = await supabase.storage.from("hospital-logos").upload(path, file, { upsert: true });
    if (error) {
      toast({ title: "Upload failed", description: error.message, variant: "destructive" });
    } else {
      const { data } = supabase.storage.from("hospital-logos").getPublicUrl(path);
      setLogoUrl(data.publicUrl);
      toast({ title: "Logo uploaded!" });
    }
    setUploading(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await supabase.from("hospitals").update({
      logo_url: logoUrl,
      primary_color: color,
    } as any).eq("id", hospitalId);
    setSaving(false);
    onComplete();
  };

  return (
    <div>
      <span className="inline-block bg-[#EEF2FF] text-[#4F46E5] text-[11px] px-2.5 py-0.5 rounded-full font-medium mb-4">~2 min</span>
      <h2 className="text-[22px] font-bold text-foreground">Make it yours</h2>
      <p className="text-sm text-muted-foreground mt-1 mb-8">Add your hospital's logo and brand color</p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Left - Upload & Color */}
        <div className="space-y-6">
          {/* Logo Upload */}
          <div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/svg+xml" className="hidden" onChange={handleUpload} />
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-border rounded-xl p-8 text-center cursor-pointer hover:border-primary/40 transition-colors"
            >
              {logoUrl ? (
                <img src={logoUrl} alt="Logo" className="mx-auto max-h-20 object-contain" />
              ) : (
                <>
                  <Upload className="mx-auto text-muted-foreground mb-2" size={28} />
                  <p className="font-semibold text-sm">{uploading ? "Uploading..." : "Drop your logo here"}</p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                  <p className="text-[11px] text-muted-foreground mt-1">PNG, JPG, SVG · Max 2MB</p>
                </>
              )}
            </div>
          </div>

          {/* Color Picker */}
          <div>
            <label className="text-[13px] font-bold text-foreground">Brand Colour</label>
            <div className="flex flex-wrap gap-2 mt-2">
              {presetColors.map((c) => (
                <button
                  key={c.hex}
                  onClick={() => setColor(c.hex)}
                  className={`w-8 h-8 rounded-full transition-all ${color === c.hex ? "ring-2 ring-offset-2 ring-primary" : ""}`}
                  style={{ backgroundColor: c.hex }}
                  title={c.name}
                />
              ))}
            </div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-muted-foreground">Custom:</span>
              <input
                type="text"
                value={customHex}
                onChange={(e) => {
                  setCustomHex(e.target.value);
                  if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) setColor(e.target.value);
                }}
                placeholder="#1A2F5A"
                maxLength={7}
                className="w-24 text-sm border border-border rounded px-2 py-1"
              />
            </div>
          </div>
        </div>

        {/* Right - Preview */}
        <div>
          <label className="text-[13px] font-bold text-muted-foreground">Preview</label>
          <div className="mt-2 bg-card rounded-xl border border-border p-4 shadow-card">
            <div className="flex gap-3 items-center">
              <div className="w-10 h-full rounded" style={{ backgroundColor: color, minHeight: 60 }} />
              <div className="flex items-center gap-2">
                {logoUrl ? (
                  <img src={logoUrl} alt="" className="w-8 h-8 object-contain rounded" />
                ) : (
                  <div className="w-8 h-8 rounded bg-muted flex items-center justify-center text-xs text-muted-foreground">🏥</div>
                )}
                <span className="text-sm font-semibold text-foreground">{hospitalName}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-between mt-10">
        <button onClick={onComplete} className="text-sm text-muted-foreground hover:text-foreground">Skip this step</button>
        <button onClick={handleSave} disabled={saving} className="bg-primary text-primary-foreground px-7 py-2.5 rounded-lg text-sm font-semibold hover:bg-[hsl(220,54%,16%)] transition-colors disabled:opacity-40 active:scale-[0.97]">
          {saving ? "Saving..." : "Save & Continue →"}
        </button>
      </div>
    </div>
  );
};

export default Step1Branding;
