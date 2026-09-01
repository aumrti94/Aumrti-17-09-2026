import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { type LanguageOption } from "@/contexts/VoiceScribeContext";
import { SUPPORTED_LANGUAGES } from "@/lib/voiceScribeLanguages";
import { toBhashiniLang } from "@/lib/asrLanguages";

/**
 * Short codes stored in `ai_language_settings.language_code` → the IETF codes
 * SUPPORTED_LANGUAGES uses.
 *
 * DERIVED, not hand-written. The literal it replaced listed only 10 languages, so a hospital
 * whose default was any of the other 12 fell through to `en-IN` — the scribe quietly ran in
 * English and nobody was told. Deriving it means adding a language to the catalogue is enough.
 *
 * Note the derivation is on the code PREFIX, which is exactly right here: Bhashini/settings
 * store ISO-639 (`or`) while Sarvam wants BCP-47 (`od-IN`), so both spellings are accepted.
 */
const SETTINGS_TO_IETF: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES
    .filter(l => l.code !== "auto")
    .flatMap(l => {
      const short = l.code.split("-")[0];
      const bhashini = toBhashiniLang(l.code);
      // e.g. od-IN is reachable as both "od" (prefix) and "or" (Bhashini/ISO-639).
      return bhashini && bhashini !== short
        ? [[short, l.code], [bhashini, l.code]]
        : [[short, l.code]];
    }),
);

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
  // Every catalogued language. The old filter dropped anything tagged `bhashini`, which is
  // what made the deployed Bhashini function unreachable — and with it, the only fallback
  // for a language Sarvam declines. Engine choice is now the failover chain's job
  // (src/lib/asrEngineChain.ts), not a visibility filter's.
  const [languages] = useState<LanguageOption[]>(SUPPORTED_LANGUAGES);

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
          } else {
            // Silence here is how a hospital ended up dictating in English without knowing:
            // an unrecognised code resolved to en-IN with nothing logged anywhere.
            console.warn(
              `voice_scribe: hospital language "${setting.language_code}" is not in the scribe ` +
              `catalogue — falling back to ${DEFAULT_LANG}. Check Settings → AI & Language.`,
            );
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
