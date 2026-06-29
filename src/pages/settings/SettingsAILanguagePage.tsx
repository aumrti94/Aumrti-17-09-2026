import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Languages, Mic, Tv2, FileText, ClipboardList, Globe } from "lucide-react";

// ─── Language catalog ─────────────────────────────────────────────────────────

const LANGUAGES = [
  { code: "en", label: "English",    script: "English" },
  { code: "hi", label: "Hindi",      script: "हिन्दी" },
  { code: "te", label: "Telugu",     script: "తెలుగు" },
  { code: "ta", label: "Tamil",      script: "தமிழ்" },
  { code: "ml", label: "Malayalam",  script: "മലയാളം" },
  { code: "kn", label: "Kannada",    script: "ಕನ್ನಡ" },
  { code: "mr", label: "Marathi",    script: "मराठी" },
  { code: "bn", label: "Bengali",    script: "বাংলা" },
  { code: "gu", label: "Gujarati",   script: "ગુજરાતી" },
  { code: "pa", label: "Punjabi",    script: "ਪੰਜਾਬੀ" },
];

// ─── Feature definitions ──────────────────────────────────────────────────────

interface FeatureDef {
  key: string;
  label: string;
  description: string;
  icon: React.ElementType;
  hint: string;
}

const FEATURES: FeatureDef[] = [
  {
    key: "voice_scribe",
    label: "Voice Scribe",
    description: "AI dictation for clinical notes, SOAP entries and ward rounds",
    icon: Mic,
    hint: "Affects ai-clinical-voice edge function. Choose the language the doctor dictates in.",
  },
  {
    key: "token_display",
    label: "OPD Token Display (TV Queue)",
    description: "Language shown on the TV queue screen for patient announcements",
    icon: Tv2,
    hint: "Sets the secondary (local) language shown alongside English on the TV display.",
  },
  {
    key: "discharge_summary",
    label: "Discharge Summary",
    description: "AI-generated discharge summaries for IPD patients",
    icon: FileText,
    hint: "Affects ai-discharge-summary edge function output language.",
  },
  {
    key: "opd_notes",
    label: "OPD Clinical Notes",
    description: "AI-assisted SOAP and consultation notes in the OPD workspace",
    icon: ClipboardList,
    hint: "Affects ai-generate-clinical-note edge function.",
  },
  {
    key: "patient_portal",
    label: "Patient Portal Content",
    description: "Language for patient-facing health tips, appointment messages and reports",
    icon: Globe,
    hint: "Controls portal page text and WhatsApp notification language.",
  },
];

// ─── Module default language config ──────────────────────────────────────────

const MODULE_KEYS = [
  { key: "opd_module_lang",  label: "OPD Module Default" },
  { key: "ipd_module_lang",  label: "IPD Module Default" },
  { key: "ed_module_lang",   label: "Emergency (ED) Default" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface LangSetting {
  feature_key: string;
  language_code: string;
  enabled: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

const SettingsAILanguagePage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast }      = useToast();

  const [settings,  setSettings]  = useState<Record<string, LangSetting>>({});
  const [loading,   setLoading]   = useState(true);
  const [saving,    setSaving]    = useState(false);

  const allKeys = [...FEATURES.map(f => f.key), ...MODULE_KEYS.map(m => m.key)];

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("ai_language_settings")
        .select("feature_key, language_code, enabled")
        .eq("hospital_id", hospitalId);

      const map: Record<string, LangSetting> = {};

      // Initialize defaults
      allKeys.forEach(key => {
        map[key] = { feature_key: key, language_code: "en", enabled: true };
      });

      // Overlay DB values
      (data || []).forEach((row: LangSetting) => {
        map[row.feature_key] = row;
      });

      setSettings(map);
      setLoading(false);
    })();
  }, [hospitalId]);

  const update = (key: string, field: "language_code" | "enabled", value: string | boolean) => {
    setSettings(prev => ({
      ...prev,
      [key]: { ...prev[key], feature_key: key, [field]: value },
    }));
  };

  const save = async () => {
    if (!hospitalId) return;
    setSaving(true);
    try {
      const rows = Object.values(settings).map(s => ({
        hospital_id: hospitalId,
        feature_key: s.feature_key,
        language_code: s.language_code,
        enabled: s.enabled,
        updated_at: new Date().toISOString(),
      }));

      const { error } = await (supabase as any)
        .from("ai_language_settings")
        .upsert(rows, { onConflict: "hospital_id,feature_key" });

      if (error) throw error;
      toast({ title: "Language settings saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

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
          <Languages className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-bold text-foreground">AI Language Packs</h1>
            <p className="text-xs text-muted-foreground">
              Configure language for each AI feature — supports 10+ Indian languages
            </p>
          </div>
        </div>
        <Button size="sm" onClick={save} disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
          Save Settings
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-8 max-w-3xl space-y-10">

        {/* ── Per-Feature Language Pack ── */}
        <Section title="Feature Language Packs" icon="🌐">
          <p className="text-xs text-muted-foreground mb-5">
            Each AI feature can output in a different language. Enable the pack and choose the
            language — English AI prompts are translated into the target language automatically.
          </p>

          <div className="space-y-3">
            {FEATURES.map(feat => {
              const s = settings[feat.key] ?? { feature_key: feat.key, language_code: "en", enabled: true };
              const Icon = feat.icon;
              return (
                <div
                  key={feat.key}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-[10px] bg-muted flex items-center justify-center shrink-0 mt-0.5">
                        <Icon className="h-4 w-4 text-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-foreground">{feat.label}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{feat.description}</p>
                        <p className="text-[11px] text-muted-foreground/70 mt-1 italic">{feat.hint}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      {/* Language selector — only shown when enabled */}
                      {s.enabled && (
                        <Select
                          value={s.language_code}
                          onValueChange={v => update(feat.key, "language_code", v)}
                        >
                          <SelectTrigger className="h-8 w-[160px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {LANGUAGES.map(l => (
                              <SelectItem key={l.code} value={l.code} className="text-xs">
                                <span className="font-medium">{l.label}</span>
                                <span className="ml-2 text-muted-foreground">{l.script}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}

                      {/* Enable toggle */}
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={s.enabled}
                          onCheckedChange={v => update(feat.key, "enabled", v)}
                        />
                        <Label className="text-xs text-muted-foreground w-10">
                          {s.enabled ? "On" : "Off"}
                        </Label>
                      </div>
                    </div>
                  </div>

                  {/* Language badge when enabled */}
                  {s.enabled && s.language_code !== "en" && (
                    <div className="mt-3 flex items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                        Output language:
                      </span>
                      {(() => {
                        const lang = LANGUAGES.find(l => l.code === s.language_code);
                        return lang ? (
                          <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                            {lang.script} ({lang.label})
                          </span>
                        ) : null;
                      })()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Module Default Languages ── */}
        <Section title="Module Default Languages" icon="🏥">
          <p className="text-xs text-muted-foreground mb-5">
            Sets the default regional language for entire modules. Individual feature settings
            above override these defaults when configured.
          </p>

          <div className="space-y-3">
            {MODULE_KEYS.map(mod => {
              const s = settings[mod.key] ?? { feature_key: mod.key, language_code: "en", enabled: true };
              return (
                <div key={mod.key} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
                  <Label className="text-sm font-medium text-foreground">{mod.label}</Label>
                  <Select
                    value={s.language_code}
                    onValueChange={v => update(mod.key, "language_code", v)}
                  >
                    <SelectTrigger className="h-8 w-[180px] text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {LANGUAGES.map(l => (
                        <SelectItem key={l.code} value={l.code} className="text-xs">
                          <span className="font-medium">{l.label}</span>
                          <span className="ml-2 text-muted-foreground">{l.script}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </Section>

        {/* ── Info ── */}
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-bold mb-1">ℹ️ How language packs work</p>
          <ul className="text-xs space-y-1 list-disc pl-4 text-blue-700">
            <li>Voice Scribe: transcription uses Bhashini/Sarvam ASR; AI structures the note in the target language.</li>
            <li>Token Display: TV queue shows the secondary language label alongside English text.</li>
            <li>Discharge Summary & OPD Notes: AI prompt instructs the LLM to generate output in the chosen language.</li>
            <li>Patient Portal: appointment messages and health tips are displayed in the configured language.</li>
          </ul>
        </div>

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
    {children}
  </div>
);

export default SettingsAILanguagePage;
