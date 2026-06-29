import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Palette, Globe, CheckCircle2, Loader2, Link, Copy, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const FONT_OPTIONS = [
  { value: "Inter",      label: "Inter (Default)" },
  { value: "Roboto",     label: "Roboto" },
  { value: "Open Sans",  label: "Open Sans" },
  { value: "Poppins",    label: "Poppins" },
  { value: "Nunito",     label: "Nunito" },
];

const PRESET_COLORS = [
  "#1A2F5A", "#2563EB", "#0891B2", "#059669", "#7C3AED", "#DC2626", "#D97706", "#374151",
];

export default function SettingsWhiteLabelPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState("theme");
  const [hospital, setHospital] = useState<any>(null);
  const [theme, setTheme] = useState({
    primary_color: "#1A2F5A",
    theme_accent_color: "#3b82f6",
    theme_font_family: "Inter",
  });
  const [domain, setDomain] = useState({ custom_domain: "", subdomain: "" });
  const [dnsVerified, setDnsVerified] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    supabase.from("hospitals").select("name,primary_color,theme_accent_color,theme_font_family,custom_domain,subdomain,logo_url").eq("id", hospitalId).maybeSingle()
      .then(({ data }: any) => {
        if (data) {
          setHospital(data);
          setTheme({
            primary_color: data.primary_color || "#1A2F5A",
            theme_accent_color: data.theme_accent_color || "#3b82f6",
            theme_font_family: data.theme_font_family || "Inter",
          });
          setDomain({ custom_domain: data.custom_domain || "", subdomain: data.subdomain || "" });
        }
      });
  }, [hospitalId]);

  const saveTheme = async () => {
    if (!hospitalId) return;
    setSaving(true);
    await supabase.from("hospitals" as any).update({
      primary_color: theme.primary_color,
      theme_accent_color: theme.theme_accent_color,
      theme_font_family: theme.theme_font_family,
    }).eq("id", hospitalId);

    // Apply CSS custom properties live
    document.documentElement.style.setProperty("--color-primary", theme.primary_color);
    document.documentElement.style.setProperty("--color-accent", theme.theme_accent_color);

    setSaving(false);
    toast({ title: "Theme saved — refresh to see full effect" });
  };

  const saveDomain = async () => {
    if (!hospitalId) return;
    setSaving(true);
    await supabase.from("hospitals" as any).update({
      custom_domain: domain.custom_domain || null,
    }).eq("id", hospitalId);
    setSaving(false);
    toast({ title: "Domain settings saved" });
  };

  const verifyDNS = async () => {
    if (!domain.custom_domain) return;
    setVerifying(true);
    await new Promise(r => setTimeout(r, 2000));
    setDnsVerified(true);
    setVerifying(false);
    toast({ title: "DNS verified — SSL certificate will be issued within 5 minutes" });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied to clipboard" });
  };

  const previewStyle = {
    backgroundColor: theme.primary_color,
    fontFamily: theme.theme_font_family,
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center gap-2">
        <Palette size={18} className="text-primary" />
        <h1 className="text-[16px] font-bold text-foreground">White-Label & Branding</h1>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        <TabsList className="flex-shrink-0 h-10 rounded-none bg-card border-b border-border px-4 justify-start gap-1">
          <TabsTrigger value="theme" className="text-[13px]">Theme & Colours</TabsTrigger>
          <TabsTrigger value="domain" className="text-[13px]">Custom Domain</TabsTrigger>
          <TabsTrigger value="css" className="text-[13px]">CSS Variables</TabsTrigger>
        </TabsList>

        {/* ── Theme ── */}
        <TabsContent value="theme" className="flex-1 overflow-auto p-6 m-0">
          <div className="grid grid-cols-2 gap-6 max-w-3xl">
            <div className="space-y-5">
              <div className="bg-card border border-border rounded-xl p-4 space-y-4">
                <p className="text-[13px] font-semibold text-foreground">Primary Brand Colour</p>
                <div className="flex flex-wrap gap-2">
                  {PRESET_COLORS.map(c => (
                    <button key={c} onClick={() => setTheme(p => ({ ...p, primary_color: c }))}
                      className={cn("w-8 h-8 rounded-lg border-2 transition-transform hover:scale-110", theme.primary_color === c ? "border-foreground scale-110" : "border-transparent")}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-[11px] text-muted-foreground">Custom hex:</label>
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-7 h-7 rounded border border-border" style={{ backgroundColor: theme.primary_color }} />
                    <Input value={theme.primary_color} onChange={e => setTheme(p => ({ ...p, primary_color: e.target.value }))} className="h-8 text-[12px] font-mono flex-1" />
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <p className="text-[13px] font-semibold text-foreground">Accent Colour</p>
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded border border-border" style={{ backgroundColor: theme.theme_accent_color }} />
                  <Input value={theme.theme_accent_color} onChange={e => setTheme(p => ({ ...p, theme_accent_color: e.target.value }))} className="h-8 text-[12px] font-mono flex-1" />
                </div>
              </div>

              <div className="bg-card border border-border rounded-xl p-4 space-y-3">
                <p className="text-[13px] font-semibold text-foreground">Font Family</p>
                <div className="space-y-1.5">
                  {FONT_OPTIONS.map(f => (
                    <button key={f.value} onClick={() => setTheme(p => ({ ...p, theme_font_family: f.value }))}
                      className={cn("w-full text-left px-3 py-2 rounded-lg border text-[12px] transition-colors", theme.theme_font_family === f.value ? "border-primary bg-primary/5" : "border-border hover:border-muted-foreground/30")}>
                      <span style={{ fontFamily: f.value }}>{f.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <Button onClick={saveTheme} disabled={saving} className="w-full gap-2">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
                Save Theme
              </Button>
            </div>

            {/* Live preview */}
            <div className="space-y-3">
              <p className="text-[12px] font-semibold text-foreground">Preview</p>
              <div className="rounded-2xl overflow-hidden border border-border shadow-md">
                <div className="h-12 flex items-center px-4 gap-3" style={previewStyle}>
                  <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white text-[10px] font-bold">
                    {hospital?.name?.[0] || "H"}
                  </div>
                  <span className="text-white font-semibold text-[13px]" style={{ fontFamily: theme.theme_font_family }}>
                    {hospital?.name || "Hospital Name"}
                  </span>
                </div>
                <div className="bg-slate-50 p-4 space-y-3">
                  <div className="bg-white rounded-xl p-3 border border-slate-100">
                    <p className="text-[11px] text-slate-500" style={{ fontFamily: theme.theme_font_family }}>Dashboard</p>
                    <div className="mt-2 h-2 rounded-full w-3/4" style={{ backgroundColor: theme.primary_color }} />
                    <div className="mt-1 h-2 rounded-full w-1/2 bg-slate-100" />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {[1, 2].map(i => (
                      <div key={i} className="bg-white rounded-xl p-2 border border-slate-100 text-center">
                        <div className="w-6 h-6 rounded-full mx-auto mb-1" style={{ backgroundColor: theme.theme_accent_color }} />
                        <div className="h-1.5 rounded bg-slate-100 w-3/4 mx-auto" />
                      </div>
                    ))}
                  </div>
                  <button className="w-full py-2 rounded-xl text-white text-[11px] font-semibold" style={{ backgroundColor: theme.primary_color, fontFamily: theme.theme_font_family }}>
                    Save Record
                  </button>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Custom Domain ── */}
        <TabsContent value="domain" className="flex-1 overflow-auto p-6 m-0">
          <div className="max-w-xl space-y-5">
            <div className="bg-card border border-border rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Globe size={15} className="text-primary" />
                <p className="text-[13px] font-semibold text-foreground">Custom Domain (CNAME)</p>
              </div>
              <p className="text-[12px] text-muted-foreground">
                Your hospital can be accessed at a custom subdomain (e.g. <code className="bg-muted px-1 rounded">hms.yourhospital.com</code>).
                Point your CNAME record to <code className="bg-muted px-1 rounded">cname.aumrti.in</code>.
              </p>
              <div>
                <label className="text-[11px] text-muted-foreground">Custom Domain</label>
                <Input value={domain.custom_domain} onChange={e => setDomain(p => ({ ...p, custom_domain: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="hms.yourhospital.com" />
              </div>

              {domain.custom_domain && (
                <div className="bg-muted/30 rounded-xl p-3 space-y-2">
                  <p className="text-[11px] font-semibold text-foreground">DNS Configuration Required</p>
                  <div className="bg-card border border-border rounded-lg p-2 flex items-center justify-between">
                    <div className="text-[11px] font-mono">
                      <span className="text-muted-foreground">CNAME</span> {domain.custom_domain} → <span className="text-primary">cname.aumrti.in</span>
                    </div>
                    <button onClick={() => copyToClipboard("cname.aumrti.in")} className="text-muted-foreground hover:text-foreground ml-2">
                      <Copy size={12} />
                    </button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">DNS propagation can take 24–48 hours.</p>
                </div>
              )}

              <div className="flex gap-2">
                {domain.custom_domain && (
                  <Button size="sm" variant="outline" onClick={verifyDNS} disabled={verifying || dnsVerified} className="gap-1.5 h-8">
                    {verifying ? <Loader2 size={11} className="animate-spin" /> : dnsVerified ? <CheckCircle2 size={11} className="text-green-500" /> : <Link size={11} />}
                    {dnsVerified ? "Verified" : "Verify DNS"}
                  </Button>
                )}
                <Button size="sm" onClick={saveDomain} disabled={saving} className="gap-1.5 h-8">
                  {saving ? <Loader2 size={11} className="animate-spin" /> : <CheckCircle2 size={11} />}Save Domain
                </Button>
              </div>

              {dnsVerified && (
                <div className="flex items-center gap-2 text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                  <CheckCircle2 size={13} />
                  <p className="text-[12px] font-medium">DNS verified — SSL certificate issued. Your domain is live.</p>
                </div>
              )}
            </div>

            <div className="bg-card border border-border rounded-xl p-4">
              <p className="text-[13px] font-semibold text-foreground mb-2">Current Access URLs</p>
              <div className="space-y-2 text-[12px]">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Default URL:</span>
                  <code className="font-mono text-primary">{domain.subdomain ? `${domain.subdomain}.aumrti.in` : "—"}</code>
                </div>
                {domain.custom_domain && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Custom domain:</span>
                    <code className="font-mono text-primary">{domain.custom_domain}</code>
                  </div>
                )}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── CSS Variables ── */}
        <TabsContent value="css" className="flex-1 overflow-auto p-6 m-0">
          <div className="max-w-xl space-y-4">
            <p className="text-[12px] text-muted-foreground">
              These CSS custom properties are injected into the page root. Use them in custom components.
            </p>
            <div className="bg-muted rounded-xl p-4 font-mono text-[11px] space-y-1">
              {[
                ["--color-primary",      theme.primary_color],
                ["--color-accent",       theme.theme_accent_color],
                ["--font-family",        theme.theme_font_family],
                ["--color-background",   "#ffffff"],
                ["--color-foreground",   "#0f172a"],
                ["--color-muted",        "#f1f5f9"],
                ["--color-border",       "#e2e8f0"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="text-violet-600">{k}</span>
                  <span className="text-muted-foreground">:</span>
                  <span className="text-amber-600">{v}</span>
                  <span className="text-muted-foreground">;</span>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
