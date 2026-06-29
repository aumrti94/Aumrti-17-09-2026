import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { SUPPORTED_LANGUAGES, type LanguageOption } from "@/contexts/VoiceScribeContext";

// Maps 2-char codes stored in ai_language_settings → IETF codes used by SUPPORTED_LANGUAGES
const SETTINGS_TO_IETF: Record<string, string> = {
  en: "en-IN", hi: "hi-IN", te: "te-IN", ta: "ta-IN",
  ml: "ml-IN", kn: "kn-IN", mr: "mr-IN", bn: "bn-IN",
  gu: "gu-IN", pa: "pa-IN",
};

const FEATURE_KEY = "voice_scribe";
const DEFAULT_LANG = "en-IN";
const storageKey = (doctorId: string) => `vscribe_lang_${doctorId}`;

export interface UseVoiceScribeLanguagesResult {
  voiceLang: string;
  setVoiceLang: (code: string) => void;
  /** Languages the hospital has enabled; always includes en-IN as fallback. */
  languages: LanguageOption[];
  hospitalDefaultLang: string;
  doctorId: string | null;
  loading: boolean;
}

/**
 * Fetches the hospital's voice_scribe language setting from ai_language_settings.
 * Resolves language priority: doctor's localStorage override → hospital default → "en-IN".
 * Persists changes per-doctor so two doctors on the same device don't share a preference.
 */
export function useVoiceScribeLanguages(): UseVoiceScribeLanguagesResult {
  const [doctorId, setDoctorId] = useState<string | null>(null);
  const [hospitalDefaultLang, setHospitalDefaultLang] = useState(DEFAULT_LANG);
  const [voiceLang, setVoiceLangState] = useState(DEFAULT_LANG);
  const [loading, setLoading] = useState(true);
  // Start with all non-bhashini languages; may be refined after fetch
  const [languages, setLanguages] = useState<LanguageOption[]>(
    SUPPORTED_LANGUAGES.filter(l => l.engine !== "bhashini")
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !alive) return;

        const { data: userData } = await supabase
          .from("users")
          .select("id, hospital_id")
          .eq("auth_user_id", user.id)
          .maybeSingle();

        if (!userData || !alive) return;
        const { id: dId, hospital_id: hId } = userData;
        setDoctorId(dId);

        // Hospital voice_scribe setting (feature_key = "voice_scribe")
        const { data: setting } = await (supabase as any)
          .from("ai_language_settings")
          .select("language_code, enabled")
          .eq("hospital_id", hId)
          .eq("feature_key", FEATURE_KEY)
          .maybeSingle();

        let hospitalLang = DEFAULT_LANG;
        if (setting?.enabled && setting.language_code) {
          const ietf = SETTINGS_TO_IETF[setting.language_code] ?? (setting.language_code.includes("-") ? setting.language_code : null);
          const found = ietf ? SUPPORTED_LANGUAGES.find(l => l.code === ietf) : null;
          if (found) {
            hospitalLang = found.code;
            // Ensure hospital's language is always visible in the dropdown
            setLanguages(prev => {
              if (prev.some(l => l.code === found.code)) return prev;
              return [...prev, found];
            });
          }
        }

        if (!alive) return;
        setHospitalDefaultLang(hospitalLang);

        // Doctor-specific override wins over hospital default
        const stored = localStorage.getItem(storageKey(dId));
        setVoiceLangState(stored || hospitalLang);
      } catch {
        // Non-fatal — defaults remain
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const setVoiceLang = (code: string) => {
    setVoiceLangState(code);
    if (doctorId) localStorage.setItem(storageKey(doctorId), code);
  };

  return { voiceLang, setVoiceLang, languages, hospitalDefaultLang, doctorId, loading };
}
