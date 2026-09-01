/**
 * Voice-scribe language catalogue. Lifted out of VoiceScribeContext.tsx so that
 * file exports only components — a file mixing component and non-component
 * exports silently disables Fast Refresh for it.
 *
 * This also fixes a layering inversion: src/hooks/useVoiceScribeLanguages.ts
 * previously reached into src/contexts to read this list.
 */
export interface LanguageOption {
  code: string;
  label: string;
  flag: string;
  /**
   * The language's own name in its own script, for pickers that show it (Settings → AI &
   * Language). Lives here so there is ONE catalogue: the settings page used to keep a
   * separate 10-entry list, which is why a hospital could not select the other 12 languages
   * at all.
   */
  native: string;
  /**
   * The engine tried FIRST for this language. It is no longer the only engine: the real
   * routing is the failover chain in src/lib/asrEngineChain.ts, which falls through to
   * Bhashini when the preferred engine cannot serve a segment. Treat this as a preference,
   * not an assignment — a language whose primary engine is down must still transcribe.
   */
  engine: "web_speech" | "sarvam" | "bhashini";
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "auto", label: "Auto (Multilingual)", native: "Auto", flag: "🌐", engine: "sarvam" },
  { code: "en-IN", label: "English", native: "English", flag: "🇺🇸", engine: "web_speech" },
  { code: "hi-IN", label: "Hindi", native: "हिन्दी", flag: "🇮🇳", engine: "sarvam" },
  { code: "te-IN", label: "Telugu", native: "తెలుగు", flag: "🌟", engine: "sarvam" },
  { code: "ta-IN", label: "Tamil", native: "தமிழ்", flag: "🌟", engine: "sarvam" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ", flag: "🌟", engine: "sarvam" },
  { code: "ml-IN", label: "Malayalam", native: "മലയാളം", flag: "🌟", engine: "sarvam" },
  { code: "mr-IN", label: "Marathi", native: "मराठी", flag: "🌟", engine: "sarvam" },
  { code: "bn-IN", label: "Bengali", native: "বাংলা", flag: "🌟", engine: "sarvam" },
  { code: "gu-IN", label: "Gujarati", native: "ગુજરાતી", flag: "🌟", engine: "sarvam" },
  // Odia is "od-IN" for Sarvam, NOT "or-IN" (which it rejects outright). Bhashini wants
  // bare "or" — see BHASHINI_LANG_MAP in asrLanguages.ts.
  { code: "od-IN", label: "Odia", native: "ଓଡ଼ିଆ", flag: "🌟", engine: "sarvam" },
  { code: "pa-IN", label: "Punjabi", native: "ਪੰਜਾਬੀ", flag: "🌟", engine: "sarvam" },
  { code: "as-IN", label: "Assamese", native: "অসমীয়া", flag: "🌟", engine: "sarvam" },
  { code: "ur-IN", label: "Urdu", native: "اردو", flag: "🌟", engine: "sarvam" },
  { code: "sa-IN", label: "Sanskrit", native: "संस्कृतम्", flag: "🌟", engine: "sarvam" },
  { code: "ne-IN", label: "Nepali", native: "नेपाली", flag: "🌟", engine: "sarvam" },
  { code: "sd-IN", label: "Sindhi", native: "سنڌي", flag: "🌟", engine: "sarvam" },
  { code: "ks-IN", label: "Kashmiri", native: "کٲشُر", flag: "🌟", engine: "sarvam" },
  { code: "kok-IN", label: "Konkani", native: "कोंकणी", flag: "🌟", engine: "sarvam" },
  { code: "doi-IN", label: "Dogri", native: "डोगरी", flag: "🌟", engine: "sarvam" },
  { code: "mai-IN", label: "Maithili", native: "मैथिली", flag: "🌟", engine: "sarvam" },
  { code: "mni-IN", label: "Manipuri", native: "ꯃꯤꯇꯩ ꯂꯣꯟ", flag: "🌟", engine: "sarvam" },
  { code: "sat-IN", label: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", flag: "🌟", engine: "sarvam" },
  // Bodo is "brx-IN". "bo-IN" is Tibetan — a different language, and rejected by Sarvam.
  { code: "brx-IN", label: "Bodo", native: "बड़ो", flag: "🌟", engine: "sarvam" },
];
