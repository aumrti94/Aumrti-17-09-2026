import React, { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Upload, X, Monitor, Smartphone, Printer, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  HANDWRITING_FONTS,
  HANDWRITING_SECTION_LABELS,
  DEFAULT_HANDWRITING,
  fontsHref,
  type HandwritingSection,
} from "@/lib/printUtils";

const PRESET_COLORS = [
  { label: "Navy", hex: "#1A2F5A" },
  { label: "Teal", hex: "#0E7B7B" },
  { label: "Royal Blue", hex: "#1E40AF" },
  { label: "Maroon", hex: "#7F1D1D" },
  { label: "Forest", hex: "#14532D" },
  { label: "Slate", hex: "#334155" },
  { label: "Purple", hex: "#4C1D95" },
  { label: "Charcoal", hex: "#1C1917" },
];

const FONTS = ["Inter", "Poppins", "Roboto", "Noto Sans", "Open Sans", "Lato", "Nunito", "Raleway"];

const INK_COLORS = [
  { label: "Blue Ink", hex: "#1E3A8A" },
  { label: "Royal Blue", hex: "#1D4ED8" },
  { label: "Blue-Black", hex: "#16305C" },
  { label: "Black", hex: "#111827" },
];

const HANDWRITING_SECTIONS = Object.keys(HANDWRITING_SECTION_LABELS) as HandwritingSection[];

const HEADER_LAYOUTS = [
  { id: 1, label: "Logo Left + Center Text", desc: "Logo left, name center, contact right" },
  { id: 2, label: "Center All", desc: "Logo + text all centered" },
  { id: 3, label: "Full Colour Band", desc: "Colour header, white text" },
  { id: 4, label: "Logo Right", desc: "Name left, logo right" },
  { id: 5, label: "Text Only", desc: "No logo, text centered" },
  { id: 6, label: "Minimal", desc: "Name only, large font" },
];

type PreviewMode = "desktop" | "mobile" | "print";

const SettingsBrandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [tagline, setTagline] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [primaryColor, setPrimaryColor] = useState("#1A2F5A");
  const [accentColor, setAccentColor] = useState("#0E7B7B");
  const [fontFamily, setFontFamily] = useState("Inter");
  const [fontSize, setFontSize] = useState(14);
  const [headerLayout, setHeaderLayout] = useState(1);
  const [footerLeft, setFooterLeft] = useState("");
  const [footerCenter, setFooterCenter] = useState("");
  const [footerRight, setFooterRight] = useState("");
  const [hw, setHw] = useState(DEFAULT_HANDWRITING);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("print");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  // False until the effect below has actually copied the loaded hospital into form state.
  // `hospital` alone isn't enough to gate on — it can go truthy a render before the effect
  // that populates `name` etc. has run, and a Save in that window overwrites hospitals.name
  // with the still-empty initial state.
  const [hydrated, setHydrated] = useState(false);

  const { data: hospital } = useQuery({
    queryKey: ["hospital-branding"],
    queryFn: async () => {
      const { data: user } = await supabase.from("users").select("hospital_id").limit(1).maybeSingle();
      if (!user) return null;
      const { data } = await supabase.from("hospitals").select("*").eq("id", user.hospital_id).maybeSingle();
      return data;
    },
  });

  useEffect(() => {
    if (!hospital) return;
    setName(hospital.name || "");
    setTagline((hospital as any).tagline || "");
    setLogoUrl(hospital.logo_url || null);
    setPrimaryColor(hospital.primary_color || "#1A2F5A");
    setAccentColor((hospital as any).accent_color || "#0E7B7B");
    setFontFamily((hospital as any).font_family || "Inter");
    const cfg = (hospital as any).branding_config || {};
    setFontSize(cfg.fontSize || 14);
    setHeaderLayout(cfg.headerLayout || 1);
    setFooterLeft(cfg.footerLeft || "");
    setFooterCenter(cfg.footerCenter || "");
    setFooterRight(cfg.footerRight || "");
    setHw({
      ...DEFAULT_HANDWRITING,
      ...(cfg.handwriting || {}),
      sections: { ...DEFAULT_HANDWRITING.sections, ...(cfg.handwriting?.sections || {}) },
    });
    setHydrated(true);
  }, [hospital]);

  // The script faces aren't in the app shell (index.html loads Inter only) — pull the
  // selected one in on demand so the live preview below shows the real typeface.
  useEffect(() => {
    const id = "hw-font-preview";
    let link = document.getElementById(id) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = fontsHref([...HANDWRITING_FONTS]);
  }, []);

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !hospital) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large (max 2MB)", variant: "destructive" });
      return;
    }
    setUploading(true);
    const path = `${hospital.id}/logo.${file.name.split(".").pop()}`;
    const { error } = await supabase.storage.from("hospital-assets").upload(path, file, { upsert: true });
    if (error) {
      toast({ title: "Upload failed", variant: "destructive" });
      setUploading(false);
      return;
    }
    const { data: urlData } = supabase.storage.from("hospital-assets").getPublicUrl(path);
    setLogoUrl(urlData.publicUrl);
    setUploading(false);
    toast({ title: "Logo uploaded" });
  };

  const removeLogo = () => setLogoUrl(null);

  const handleSave = async () => {
    if (!hospital || !hydrated) return;
    setSaving(true);
    const brandingConfig = {
      fontSize,
      headerLayout,
      footerLeft,
      footerCenter,
      footerRight,
      handwriting: hw,
    };
    const { error } = await supabase
      .from("hospitals")
      .update({
        name,
        logo_url: logoUrl,
        primary_color: primaryColor,
        accent_color: accentColor,
        font_family: fontFamily,
        tagline,
        branding_config: brandingConfig,
      } as any)
      .eq("id", hospital.id);
    setSaving(false);
    if (error) {
      toast({ title: "Failed to save", variant: "destructive" });
    } else {
      queryClient.invalidateQueries({ queryKey: ["hospital-branding"] });
      // Apply primary color immediately so users see the change
      document.documentElement.style.setProperty("--brand-primary", primaryColor);
      document.documentElement.style.setProperty("--primary-hex", primaryColor);
      toast({ title: "Branding saved ✓ — applies to all new printouts" });
    }
  };

  /* ── Section header helper ── */
  const SectionHeader = ({ children }: { children: React.ReactNode }) => (
    <div className="mb-4 mt-6 first:mt-0">
      <h3 className="text-sm font-bold text-foreground">{children}</h3>
      <div className="h-px bg-border mt-2" />
    </div>
  );

  /* ── Colour picker row ── */
  const ColorPicker = ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <div className="mb-4">
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{label}</label>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-8 h-8 rounded-lg border border-border" style={{ backgroundColor: value }} />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="w-28 h-8 text-xs font-mono" />
        <label className="cursor-pointer">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="sr-only" />
          <span className="text-xs text-primary hover:underline">Pick</span>
        </label>
      </div>
      <div className="flex gap-1.5 flex-wrap">
        {PRESET_COLORS.map((c) => (
          <button
            key={c.hex}
            onClick={() => onChange(c.hex)}
            className={cn(
              "w-6 h-6 rounded-md border transition-all",
              value === c.hex ? "ring-2 ring-primary ring-offset-1" : "border-border hover:scale-110"
            )}
            style={{ backgroundColor: c.hex }}
            title={c.label}
          />
        ))}
      </div>
    </div>
  );

  /* ── Print preview header renderer ── */
  const renderPrintHeader = () => {
    const logoEl = logoUrl ? (
      <img src={logoUrl} alt="Logo" className="max-h-[40px] object-contain" />
    ) : (
      <div className="w-10 h-10 rounded bg-muted flex items-center justify-center text-[10px] text-muted-foreground">Logo</div>
    );
    const nameEl = <div className="font-bold text-sm" style={{ color: primaryColor }}>{name || "Hospital Name"}</div>;
    const tagEl = tagline ? <div className="text-[8px] text-muted-foreground">{tagline}</div> : null;

    switch (headerLayout) {
      case 2:
        return (
          <div className="text-center mb-3">
            <div className="flex justify-center mb-1">{logoEl}</div>
            {nameEl}{tagEl}
          </div>
        );
      case 3:
        return (
          <div className="rounded-md px-4 py-3 mb-3 flex items-center gap-3" style={{ backgroundColor: primaryColor }}>
            {logoUrl && <img src={logoUrl} alt="" className="max-h-[32px] object-contain brightness-0 invert" />}
            <div>
              <div className="font-bold text-sm text-white">{name || "Hospital Name"}</div>
              {tagline && <div className="text-[8px] text-white/70">{tagline}</div>}
            </div>
          </div>
        );
      case 4:
        return (
          <div className="flex items-center justify-between mb-3">
            <div>{nameEl}{tagEl}</div>
            {logoEl}
          </div>
        );
      case 5:
        return (
          <div className="text-center mb-3">
            {nameEl}{tagEl}
          </div>
        );
      case 6:
        return (
          <div className="mb-3">
            <div className="text-lg font-bold" style={{ color: primaryColor }}>{name || "Hospital Name"}</div>
          </div>
        );
      default: // layout 1
        return (
          <div className="flex items-center gap-3 mb-3">
            {logoEl}
            <div className="flex-1 text-center">{nameEl}{tagEl}</div>
            <div className="text-[7px] text-muted-foreground text-right">Ph: 9876543210<br />City, State</div>
          </div>
        );
    }
  };

  return (
    <div className="h-[calc(100vh-56px)] flex overflow-hidden bg-background">
      {/* ── LEFT EDITOR ── */}
      <div className="w-[400px] flex-shrink-0 border-r border-border bg-card flex flex-col">
        <div className="h-[52px] flex items-center gap-2 px-4 border-b border-border flex-shrink-0">
          <button onClick={() => navigate("/settings")} className="text-muted-foreground hover:text-foreground">
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm font-bold text-foreground">Branding</span>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {/* Section 1: Identity */}
          <SectionHeader>Hospital Identity</SectionHeader>

          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Hospital Logo</label>
          <div
            onClick={() => fileInputRef.current?.click()}
            className={cn(
              "border-2 border-dashed border-border rounded-xl h-[120px] flex flex-col items-center justify-center cursor-pointer",
              "hover:border-primary/50 hover:bg-muted/30 transition-colors mb-2"
            )}
          >
            {logoUrl ? (
              <img src={logoUrl} alt="Logo" className="max-h-[80px] object-contain" />
            ) : (
              <>
                <Upload size={24} className="text-muted-foreground mb-1" />
                <span className="text-xs text-muted-foreground">{uploading ? "Uploading..." : "Click to upload"}</span>
                <span className="text-[10px] text-muted-foreground/60 mt-0.5">PNG, JPG or SVG · Max 2MB</span>
              </>
            )}
          </div>
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/svg+xml" className="hidden" onChange={handleLogoUpload} />
          {logoUrl && (
            <button onClick={removeLogo} className="text-[11px] text-destructive hover:underline mb-3 block">
              Remove Logo
            </button>
          )}

          <label className="text-xs font-medium text-muted-foreground mb-1 block mt-3">Hospital Name</label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm mb-3" />

          <label className="text-xs font-medium text-muted-foreground mb-1 block">Tagline</label>
          <Input
            value={tagline}
            onChange={(e) => setTagline(e.target.value.slice(0, 100))}
            placeholder="e.g. NABH Accredited | 24×7 Emergency"
            className="h-9 text-sm mb-1"
          />
          <p className="text-[10px] text-muted-foreground mb-4">{tagline.length}/100</p>

          {/* Section 2: Colours */}
          <SectionHeader>Brand Colours</SectionHeader>
          <ColorPicker label="Primary Colour (Sidebar, headers)" value={primaryColor} onChange={setPrimaryColor} />
          <ColorPicker label="Accent / Button Colour" value={accentColor} onChange={setAccentColor} />

          {/* Section 3: Typography */}
          <SectionHeader>Typography</SectionHeader>
          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Primary Font</label>
          <select
            value={fontFamily}
            onChange={(e) => setFontFamily(e.target.value)}
            className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm mb-3"
          >
            {FONTS.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>
                {f} — AbCdEf 1234
              </option>
            ))}
          </select>

          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Base Font Size</label>
          <div className="flex gap-2 mb-4">
            {[{ label: "Small", val: 13 }, { label: "Normal", val: 14 }, { label: "Large", val: 15 }].map((s) => (
              <button
                key={s.val}
                onClick={() => setFontSize(s.val)}
                className={cn(
                  "flex-1 h-8 rounded-md text-xs font-medium border transition-colors",
                  fontSize === s.val
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                )}
              >
                {s.label} — {s.val}px
              </button>
            ))}
          </div>

          {/* Section 4: Handwritten clinical text */}
          <SectionHeader>Handwritten Clinical Text</SectionHeader>
          <p className="text-[11px] text-muted-foreground mb-3">
            Arogyasri and several TPAs return claim files whose clinical narrative looks machine-set.
            Turn this on to print the doctor-authored free text in a script face. Only the typeface
            changes — the author name, timestamp and wording stay exactly as recorded.
          </p>

          <button
            onClick={() => setHw({ ...hw, enabled: !hw.enabled })}
            className={cn(
              "w-full flex items-center justify-between border rounded-lg px-3 py-2.5 mb-3 transition-colors",
              hw.enabled ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            )}
          >
            <span className="text-xs font-semibold text-foreground">Handwriting mode on printouts</span>
            <span
              className={cn(
                "w-9 h-5 rounded-full flex items-center px-0.5 transition-colors",
                hw.enabled ? "bg-primary justify-end" : "bg-muted justify-start"
              )}
            >
              <span className="w-4 h-4 rounded-full bg-white shadow" />
            </span>
          </button>

          {hw.enabled && (
            <div className="mb-4">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Handwriting Style</label>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {HANDWRITING_FONTS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setHw({ ...hw, font: f })}
                    className={cn(
                      "border rounded-lg px-2 py-2 text-left transition-all",
                      hw.font === f ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    )}
                  >
                    <div
                      className="text-[15px] leading-tight truncate"
                      style={{ fontFamily: `'${f}', cursive`, color: hw.color }}
                    >
                      Afebrile, cont. same
                    </div>
                    <div className="text-[9px] text-muted-foreground mt-0.5">{f}</div>
                  </button>
                ))}
              </div>

              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Ink Colour</label>
              <div className="flex gap-1.5 flex-wrap mb-3">
                {INK_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    onClick={() => setHw({ ...hw, color: c.hex })}
                    className={cn(
                      "h-7 px-2 rounded-md border text-[10px] font-medium transition-all",
                      hw.color.toUpperCase() === c.hex ? "ring-2 ring-primary ring-offset-1" : "border-border hover:border-primary/50"
                    )}
                    style={{ color: c.hex }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>

              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Size — {Math.round(hw.scale * 100)}% of base text
              </label>
              <input
                type="range"
                min={80}
                max={200}
                step={5}
                value={Math.round(hw.scale * 100)}
                onChange={(e) => setHw({ ...hw, scale: Number(e.target.value) / 100 })}
                className="w-full mb-3 accent-primary"
              />

              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
                Slant — {hw.slant}°
              </label>
              <input
                type="range"
                min={0}
                max={12}
                step={1}
                value={hw.slant}
                onChange={(e) => setHw({ ...hw, slant: Number(e.target.value) })}
                className="w-full mb-3 accent-primary"
              />

              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Apply To</label>
              <div className="space-y-1.5">
                {HANDWRITING_SECTIONS.map((s) => (
                  <label key={s} className="flex items-center gap-2 text-[11px] text-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={hw.sections[s]}
                      onChange={(e) => setHw({ ...hw, sections: { ...hw.sections, [s]: e.target.checked } })}
                      className="accent-primary"
                    />
                    {HANDWRITING_SECTION_LABELS[s]}
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Section 5: Header Layout */}
          <SectionHeader>Print Header Layout</SectionHeader>
          <p className="text-[11px] text-muted-foreground mb-3">Applied to all printed documents</p>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {HEADER_LAYOUTS.map((l) => (
              <button
                key={l.id}
                onClick={() => setHeaderLayout(l.id)}
                className={cn(
                  "border rounded-lg p-2.5 text-left transition-all",
                  headerLayout === l.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/50"
                )}
              >
                <div className="h-8 rounded bg-muted/50 mb-1.5 flex items-center justify-center">
                  <span className="text-[9px] text-muted-foreground font-mono">#{l.id}</span>
                </div>
                <p className="text-[11px] font-semibold text-foreground">{l.label}</p>
                <p className="text-[9px] text-muted-foreground">{l.desc}</p>
              </button>
            ))}
          </div>

          <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Footer Text</label>
          <div className="space-y-2 mb-4">
            <Input value={footerLeft} onChange={(e) => setFooterLeft(e.target.value)} placeholder="Left: e.g. For appointments: 9876543210" className="h-8 text-xs" />
            <Input value={footerCenter} onChange={(e) => setFooterCenter(e.target.value)} placeholder="Center: e.g. www.hospital.com" className="h-8 text-xs" />
            <Input value={footerRight} onChange={(e) => setFooterRight(e.target.value)} placeholder="Right: e.g. Reg No: KARN/HOSP/2019" className="h-8 text-xs" />
          </div>
        </div>

        {/* Sticky save button */}
        <div className="flex-shrink-0 px-5 py-3 border-t border-border">
          <Button className="w-full h-12 gap-2 text-sm font-semibold" onClick={handleSave} disabled={saving || !hydrated}>
            <Save size={16} />
            {saving ? "Saving..." : "Save Branding"}
          </Button>
        </div>
      </div>

      {/* ── RIGHT PREVIEW ── */}
      <div className="flex-1 flex flex-col overflow-hidden bg-muted/30">
        {/* Device toggle */}
        <div className="h-11 flex items-center gap-1 px-4 border-b border-border bg-card flex-shrink-0">
          {([
            { mode: "desktop" as PreviewMode, icon: Monitor, label: "Desktop" },
            { mode: "mobile" as PreviewMode, icon: Smartphone, label: "Mobile" },
            { mode: "print" as PreviewMode, icon: Printer, label: "Print Doc" },
          ]).map(({ mode, icon: Icon, label }) => (
            <button
              key={mode}
              onClick={() => setPreviewMode(mode)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors",
                previewMode === mode ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        {/* Preview area */}
        <div className="flex-1 overflow-auto flex items-start justify-center p-6">
          {previewMode === "print" && (
            <div
              className="bg-white rounded shadow-lg w-[480px] min-h-[600px] flex flex-col"
              style={{ fontFamily, fontSize: `${fontSize}px`, padding: "32px" }}
            >
              {/* Header */}
              {renderPrintHeader()}
              <div className="h-px mb-3" style={{ backgroundColor: accentColor }} />

              {/* Sample content */}
              <div className="font-bold text-base mb-3" style={{ color: primaryColor }}>PATIENT BILL</div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] text-muted-foreground mb-4">
                <div>Patient: <span className="text-foreground font-medium">Ramesh Kumar</span></div>
                <div>UHID: <span className="text-foreground font-medium">UH-2025-001</span></div>
                <div>Date: <span className="text-foreground font-medium">27 Mar 2026</span></div>
                <div>Bill No: <span className="text-foreground font-medium">BIL-0042</span></div>
              </div>

              <table className="w-full text-[10px] border-collapse mb-4">
                <thead>
                  <tr style={{ backgroundColor: `${primaryColor}15` }}>
                    <th className="text-left py-1.5 px-2 font-semibold border-b border-border">#</th>
                    <th className="text-left py-1.5 px-2 font-semibold border-b border-border">Service</th>
                    <th className="text-right py-1.5 px-2 font-semibold border-b border-border">Qty</th>
                    <th className="text-right py-1.5 px-2 font-semibold border-b border-border">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { s: "OPD Consultation", q: 1, a: 500 },
                    { s: "Blood Test - CBC", q: 1, a: 350 },
                    { s: "X-Ray Chest PA", q: 1, a: 800 },
                  ].map((r, i) => (
                    <tr key={i} className="border-b border-border/50">
                      <td className="py-1.5 px-2">{i + 1}</td>
                      <td className="py-1.5 px-2">{r.s}</td>
                      <td className="py-1.5 px-2 text-right">{r.q}</td>
                      <td className="py-1.5 px-2 text-right">₹{r.a}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="flex justify-end mb-6">
                <div className="text-[10px] space-y-1 w-40">
                  <div className="flex justify-between"><span>Subtotal</span><span>₹1,650</span></div>
                  <div className="flex justify-between"><span>GST (18%)</span><span>₹297</span></div>
                  <div className="flex justify-between font-bold border-t border-border pt-1" style={{ color: primaryColor }}>
                    <span>Total</span><span>₹1,947</span>
                  </div>
                </div>
              </div>

              {/* Ward-round sample — shows the handwriting settings on real S/O/A/P text */}
              <div className="font-bold text-xs mb-2" style={{ color: primaryColor }}>WARD ROUND NOTE</div>
              <div className="border border-border rounded p-2 mb-6">
                <div className="flex justify-between text-[8px] text-muted-foreground border-b border-border pb-1 mb-1.5">
                  <span className="font-semibold">26 Aug 2026, 9:15 am</span>
                  <span>Dr. A. Sharma</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                  {[
                    ["Subjective", "No fresh complaints, slept well"],
                    ["Objective", "Afebrile, chest clear, BP 124/78"],
                    ["Assessment", "Improving, sepsis resolving"],
                    ["Plan", "Continue IV antibiotics × 2 days"],
                  ].map(([k, v]) => (
                    <div key={k} className="text-[8px] text-muted-foreground">
                      {k}:{" "}
                      <span
                        style={
                          hw.enabled
                            ? {
                                fontFamily: `'${hw.font}', cursive`,
                                fontSize: `${Math.round(fontSize * hw.scale * 0.8)}px`,
                                color: hw.color,
                                display: hw.slant ? "inline-block" : undefined,
                                transform: hw.slant ? `skewX(-${hw.slant}deg)` : undefined,
                              }
                            : { fontSize: "9px", color: "#1e293b" }
                        }
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mt-auto pt-4 border-t border-border flex justify-between text-[8px] text-muted-foreground">
                <span>{footerLeft || "For appointments: 9876543210"}</span>
                <span>{footerCenter || "www.hospital.com"}</span>
                <span>{footerRight || "Reg No: KARN/HOSP/2019"}</span>
              </div>
            </div>
          )}

          {previewMode === "desktop" && (
            <div className="w-[520px] bg-white rounded-lg shadow-lg overflow-hidden">
              <p className="text-[10px] text-muted-foreground text-center py-1 bg-muted/50">
                This is how your staff sees the HMS
              </p>
              {/* Simulated header */}
              <div className="h-10 flex items-center px-3 text-white text-xs font-bold" style={{ backgroundColor: primaryColor }}>
                {logoUrl && <img src={logoUrl} alt="" className="h-5 mr-2 brightness-0 invert" />}
                {name || "Hospital Name"}
              </div>
              {/* Simulated layout */}
              <div className="flex h-[300px]">
                <div className="w-[160px] flex flex-col gap-0.5 p-2" style={{ backgroundColor: primaryColor }}>
                  {["Dashboard", "Patients", "OPD", "IPD", "Lab", "Pharmacy", "Billing", "Settings"].map((item) => (
                    <div key={item} className="text-white/80 text-[10px] py-1.5 px-2 rounded hover:bg-white/10">
                      {item}
                    </div>
                  ))}
                </div>
                <div className="flex-1 bg-muted/20 p-4">
                  <div className="h-4 w-32 rounded bg-muted mb-2" />
                  <div className="h-3 w-48 rounded bg-muted/70 mb-4" />
                  <div className="grid grid-cols-3 gap-2">
                    {[1, 2, 3, 4, 5, 6].map((i) => (
                      <div key={i} className="h-16 rounded-lg bg-white border border-border" />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {previewMode === "mobile" && (
            <div className="w-[280px] bg-white rounded-2xl shadow-lg overflow-hidden border-4 border-foreground/10">
              <p className="text-[10px] text-muted-foreground text-center py-1 bg-muted/50">
                Patient Portal Preview
              </p>
              <div className="h-12 flex items-center justify-center text-white text-xs font-bold" style={{ backgroundColor: primaryColor }}>
                {logoUrl && <img src={logoUrl} alt="" className="h-5 mr-2 brightness-0 invert" />}
                {name || "Hospital Name"}
              </div>
              <div className="p-3 space-y-2 h-[280px]">
                {["Book Appointment", "My Reports", "Bills & Payments"].map((item) => (
                  <div key={item} className="border border-border rounded-xl p-3 flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg" style={{ backgroundColor: `${accentColor}20` }} />
                    <span className="text-xs font-medium">{item}</span>
                  </div>
                ))}
              </div>
              <div className="h-12 flex items-center justify-around border-t border-border">
                {["Home", "Book", "Reports", "Profile"].map((t) => (
                  <span key={t} className="text-[9px] font-medium" style={{ color: t === "Home" ? accentColor : "#94A3B8" }}>
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsBrandingPage;
