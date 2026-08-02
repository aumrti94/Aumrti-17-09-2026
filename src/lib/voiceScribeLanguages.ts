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
  engine: "web_speech" | "sarvam" | "bhashini";
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
  { code: "auto", label: "Auto (Multilingual)", flag: "🌐", engine: "sarvam" },
  { code: "en-IN", label: "English", flag: "🇺🇸", engine: "web_speech" },
  { code: "hi-IN", label: "Hindi", flag: "🇮🇳", engine: "sarvam" },
  { code: "te-IN", label: "Telugu", flag: "🌟", engine: "sarvam" },
  { code: "ta-IN", label: "Tamil", flag: "🌟", engine: "sarvam" },
  { code: "kn-IN", label: "Kannada", flag: "🌟", engine: "sarvam" },
  { code: "ml-IN", label: "Malayalam", flag: "🌟", engine: "sarvam" },
  { code: "mr-IN", label: "Marathi", flag: "🌟", engine: "sarvam" },
  { code: "bn-IN", label: "Bengali", flag: "🌟", engine: "sarvam" },
  { code: "gu-IN", label: "Gujarati", flag: "🌟", engine: "sarvam" },
  { code: "or-IN", label: "Odia", flag: "🌟", engine: "sarvam" },
  { code: "pa-IN", label: "Punjabi", flag: "🌟", engine: "sarvam" },
  { code: "as-IN", label: "Assamese", flag: "🌟", engine: "sarvam" },
  { code: "ur-IN", label: "Urdu", flag: "🌟", engine: "sarvam" },
  { code: "sa-IN", label: "Sanskrit", flag: "🌟", engine: "sarvam" },
  { code: "ne-IN", label: "Nepali", flag: "🌟", engine: "sarvam" },
  { code: "sd-IN", label: "Sindhi", flag: "🌟", engine: "sarvam" },
  { code: "kok-IN", label: "Konkani", flag: "🌟", engine: "sarvam" },
  { code: "doi-IN", label: "Dogri", flag: "🌟", engine: "sarvam" },
  { code: "mai-IN", label: "Maithili", flag: "🌟", engine: "sarvam" },
  { code: "mni-IN", label: "Manipuri", flag: "🌟", engine: "sarvam" },
  { code: "sat-IN", label: "Santali", flag: "🌟", engine: "sarvam" },
  { code: "bo-IN", label: "Bodo", flag: "🌟", engine: "sarvam" },
];
