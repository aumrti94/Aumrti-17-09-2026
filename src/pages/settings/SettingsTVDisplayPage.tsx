import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Monitor, Tv2, Plus, Trash2, ExternalLink } from "lucide-react";

// ─── Language options ─────────────────────────────────────────────────────────

const LANGUAGES = [
  { value: "en-IN", label: "English (India)" },
  { value: "hi-IN", label: "हिन्दी — Hindi" },
  { value: "ta-IN", label: "தமிழ் — Tamil" },
  { value: "te-IN", label: "తెలుగు — Telugu" },
  { value: "kn-IN", label: "ಕನ್ನಡ — Kannada" },
  { value: "ml-IN", label: "മലയാളം — Malayalam" },
  { value: "mr-IN", label: "मराठी — Marathi" },
  { value: "bn-IN", label: "বাংলা — Bengali" },
];

interface Slide { type: "tip" | "image"; emoji?: string; text?: string; url?: string }

interface Settings {
  announcement_language:  string;
  call_format:            string;
  marketing_slides:       Slide[];
  slide_interval_seconds: number;
  show_marketing_panel:   boolean;
}

const DEFAULT: Settings = {
  announcement_language:  "en-IN",
  call_format:            "Token {number}, please proceed to {doctor}",
  marketing_slides:       [],
  slide_interval_seconds: 8,
  show_marketing_panel:   true,
};

// ─── Component ────────────────────────────────────────────────────────────────

const SettingsTVDisplayPage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast }      = useToast();

  const [settings,  setSettings]  = useState<Settings>(DEFAULT);
  const [recordId,  setRecordId]  = useState<string | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);
  const [speaking,  setSpeaking]  = useState(false);

  // New slide form
  const [newSlideType, setNewSlideType] = useState<"tip" | "image">("tip");
  const [newSlideEmoji, setNewSlideEmoji] = useState("🏥");
  const [newSlideText,  setNewSlideText]  = useState("");
  const [newSlideUrl,   setNewSlideUrl]   = useState("");

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("tv_display_settings")
        .select("*")
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (data) {
        setRecordId(data.id);
        setSettings({
          announcement_language:  data.announcement_language  ?? DEFAULT.announcement_language,
          call_format:            data.call_format            ?? DEFAULT.call_format,
          marketing_slides:       Array.isArray(data.marketing_slides) ? data.marketing_slides : [],
          slide_interval_seconds: data.slide_interval_seconds ?? DEFAULT.slide_interval_seconds,
          show_marketing_panel:   data.show_marketing_panel   ?? DEFAULT.show_marketing_panel,
        });
      }
      setLoading(false);
    })();
  }, [hospitalId]);

  const save = async () => {
    if (!hospitalId) return;
    setSaving(true);
    try {
      const payload = { ...settings, hospital_id: hospitalId, updated_at: new Date().toISOString() };
      if (recordId) {
        const { error } = await (supabase as any)
          .from("tv_display_settings").update(payload).eq("id", recordId);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any)
          .from("tv_display_settings").insert(payload).select("id").maybeSingle();
        if (error) throw error;
        if (data) setRecordId(data.id);
      }
      toast({ title: "TV settings saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const testAnnouncement = () => {
    if (!window.speechSynthesis) {
      toast({ title: "Speech synthesis not supported", variant: "destructive" }); return;
    }
    const text = (settings.call_format || "Token {number}, please proceed to {doctor}")
      .replace("{number}", "A-7")
      .replace("{doctor}", "Smith");
    const u  = new SpeechSynthesisUtterance(text);
    u.lang   = settings.announcement_language;
    u.rate   = 0.9; u.pitch = 1.05;
    u.onstart = () => setSpeaking(true);
    u.onend   = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  };

  const addSlide = () => {
    if (newSlideType === "tip" && !newSlideText.trim()) return;
    if (newSlideType === "image" && !newSlideUrl.trim()) return;
    const slide: Slide = newSlideType === "tip"
      ? { type: "tip", emoji: newSlideEmoji || "🏥", text: newSlideText.trim() }
      : { type: "image", url: newSlideUrl.trim() };
    setSettings(s => ({ ...s, marketing_slides: [...s.marketing_slides, slide] }));
    setNewSlideText(""); setNewSlideUrl(""); setNewSlideEmoji("🏥");
  };

  const removeSlide = (i: number) =>
    setSettings(s => ({ ...s, marketing_slides: s.marketing_slides.filter((_, j) => j !== i) }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-56px)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col overflow-hidden bg-background">
      {/* Header */}
      <div className="flex-shrink-0 h-16 flex items-center justify-between px-8 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Tv2 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-bold text-foreground">TV Queue Display & Kiosk Settings</h1>
            <p className="text-xs text-muted-foreground">Configure announcement language, call format, and marketing banners</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href={`/tv?h=${hospitalId}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4 mr-1.5" /> Preview TV
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href={`/kiosk?h=${hospitalId}`} target="_blank" rel="noopener noreferrer">
              <Monitor className="h-4 w-4 mr-1.5" /> Preview Kiosk
            </a>
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : null}
            Save Settings
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 space-y-8 max-w-3xl">

        {/* ── Announcements ── */}
        <Section title="Announcements" icon="🔊">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Announcement Language</Label>
              <Select
                value={settings.announcement_language}
                onValueChange={v => setSettings(s => ({ ...s, announcement_language: v }))}
              >
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map(l => (
                    <SelectItem key={l.value} value={l.value} className="text-sm">{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                Voice used for "Call Next" audio announcements on the TV display
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Call Format Template</Label>
            <Textarea
              value={settings.call_format}
              onChange={e => setSettings(s => ({ ...s, call_format: e.target.value }))}
              rows={2}
              className="resize-none text-sm font-mono"
              placeholder="Token {number}, please proceed to {doctor}"
            />
            <p className="text-[11px] text-muted-foreground">
              Use <code className="bg-muted px-1 rounded">{"{number}"}</code> and{" "}
              <code className="bg-muted px-1 rounded">{"{doctor}"}</code> as placeholders.
            </p>
          </div>

          <Button variant="outline" size="sm" onClick={testAnnouncement} disabled={speaking}>
            {speaking ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : "🔈 "}
            {speaking ? "Speaking…" : "Test Announcement (Token A-7 → Dr. Smith)"}
          </Button>
        </Section>

        {/* ── Display Layout ── */}
        <Section title="Display Layout" icon="🖥️">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Show Marketing / Info Panel</p>
              <p className="text-xs text-muted-foreground">Right-side panel with health tips, department status, and banners</p>
            </div>
            <Switch
              checked={settings.show_marketing_panel}
              onCheckedChange={v => setSettings(s => ({ ...s, show_marketing_panel: v }))}
            />
          </div>

          <div className="space-y-1.5 w-40">
            <Label>Slide Interval (seconds)</Label>
            <Input
              type="number"
              min={3} max={60}
              value={settings.slide_interval_seconds}
              onChange={e => setSettings(s => ({ ...s, slide_interval_seconds: parseInt(e.target.value, 10) || 8 }))}
              className="h-9 text-sm"
            />
          </div>
        </Section>

        {/* ── Marketing Slides ── */}
        <Section title="Marketing & Info Slides" icon="🎞️">
          <p className="text-xs text-muted-foreground">
            Add health tips or image URLs that rotate in the TV right-panel.
            If empty, the built-in health tips are shown.
          </p>

          {/* Existing slides */}
          {settings.marketing_slides.length > 0 && (
            <div className="space-y-2 mt-2">
              {settings.marketing_slides.map((slide, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 bg-muted/40"
                >
                  <span className="text-xl w-8 text-center shrink-0">
                    {slide.type === "tip" ? (slide.emoji || "🏥") : "🖼️"}
                  </span>
                  <p className="flex-1 text-sm truncate text-foreground">
                    {slide.type === "tip" ? slide.text : slide.url}
                  </p>
                  <button
                    onClick={() => removeSlide(i)}
                    className="shrink-0 text-destructive hover:text-destructive/80 p-1 rounded"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Add new slide */}
          <div className="border border-border rounded-xl p-4 space-y-3 bg-card mt-3">
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Add Slide</p>
            <div className="flex gap-2">
              <button
                onClick={() => setNewSlideType("tip")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium border transition-colors ${
                  newSlideType === "tip" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                💬 Health Tip
              </button>
              <button
                onClick={() => setNewSlideType("image")}
                className={`flex-1 rounded-lg py-2 text-sm font-medium border transition-colors ${
                  newSlideType === "image" ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:bg-muted"
                }`}
              >
                🖼️ Image URL
              </button>
            </div>

            {newSlideType === "tip" ? (
              <div className="flex gap-2">
                <Input
                  value={newSlideEmoji}
                  onChange={e => setNewSlideEmoji(e.target.value)}
                  placeholder="Emoji"
                  className="w-20 h-9 text-xl text-center"
                />
                <Input
                  value={newSlideText}
                  onChange={e => setNewSlideText(e.target.value)}
                  placeholder="Health tip text…"
                  className="flex-1 h-9 text-sm"
                />
              </div>
            ) : (
              <Input
                value={newSlideUrl}
                onChange={e => setNewSlideUrl(e.target.value)}
                placeholder="https://example.com/banner.jpg"
                className="h-9 text-sm"
              />
            )}

            <Button
              size="sm"
              variant="outline"
              onClick={addSlide}
              disabled={newSlideType === "tip" ? !newSlideText.trim() : !newSlideUrl.trim()}
            >
              <Plus className="h-4 w-4 mr-1" /> Add Slide
            </Button>
          </div>
        </Section>

        {/* ── Kiosk Settings ── */}
        <Section title="Kiosk URL" icon="🖥️">
          <p className="text-sm text-muted-foreground">
            Open the kiosk on a dedicated touch-screen device using:
          </p>
          <code className="block text-xs bg-muted rounded-lg px-4 py-2.5 text-foreground break-all">
            {window.location.origin}/kiosk?h={hospitalId}
          </code>
          <p className="text-xs text-muted-foreground">
            The device should be signed in as a <strong>receptionist</strong> account so that
            patient registrations and token creation are authorised by RLS policies.
          </p>
        </Section>

      </div>
    </div>
  );
};

const Section: React.FC<{ title: string; icon: string; children: React.ReactNode }> = ({
  title, icon, children,
}) => (
  <div>
    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">
      {icon} {title}
    </p>
    <div className="space-y-4 pl-1">{children}</div>
  </div>
);

export default SettingsTVDisplayPage;
