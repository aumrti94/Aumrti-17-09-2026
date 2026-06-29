/**
 * Patient-content translation utilities.
 * Uses the translate-patient-content edge function via Supabase Functions.
 */

import { supabase } from "@/integrations/supabase/client";

export const ALL_PATIENT_LANGUAGES = [
  { code: "English",   label: "English",   native: "English",    tts: "en-IN" },
  { code: "Hindi",     label: "Hindi",     native: "हिन्दी",      tts: "hi-IN" },
  { code: "Telugu",    label: "Telugu",    native: "తెలుగు",       tts: "te-IN" },
  { code: "Tamil",     label: "Tamil",     native: "தமிழ்",        tts: "ta-IN" },
  { code: "Kannada",   label: "Kannada",   native: "ಕನ್ನಡ",        tts: "kn-IN" },
  { code: "Marathi",   label: "Marathi",   native: "मराठी",         tts: "mr-IN" },
  { code: "Malayalam", label: "Malayalam", native: "മലയാളം",       tts: "ml-IN" },
  { code: "Bengali",   label: "Bengali",   native: "বাংলা",        tts: "bn-IN" },
  { code: "Gujarati",  label: "Gujarati",  native: "ગુજરાતી",       tts: "gu-IN" },
  { code: "Odia",      label: "Odia",      native: "ଓଡ଼ିଆ",         tts: "or-IN" },
  { code: "Punjabi",   label: "Punjabi",   native: "ਪੰਜਾਬੀ",       tts: "pa-IN" },
];

/**
 * Translate patient-facing content to an Indian language.
 * Returns the English content unchanged if target is "English".
 */
export async function translateText(
  content: string,
  targetLanguage: string,
  hospitalId: string,
  opts?: { context?: string; patientId?: string }
): Promise<string> {
  if (!content.trim() || targetLanguage === "English") return content;

  const { data, error } = await supabase.functions.invoke("translate-patient-content", {
    body: {
      content,
      target_language: targetLanguage,
      context:         opts?.context || "patient_document",
      hospital_id:     hospitalId,
      patient_id:      opts?.patientId || null,
    },
  });

  if (error || !data?.translated_text) {
    console.warn("Translation failed — falling back to English:", error);
    return content;
  }
  return data.translated_text as string;
}

/**
 * Fetch the hospital's configured preferred patient languages.
 * Always includes "English" as the first entry.
 */
export async function getHospitalLanguages(hospitalId: string): Promise<string[]> {
  const { data } = await (supabase as any)
    .from("hospitals")
    .select("patient_languages")
    .eq("id", hospitalId)
    .maybeSingle();

  const configured: string[] = data?.patient_languages || [];
  if (!configured.includes("English")) configured.unshift("English");
  return configured;
}

/**
 * Build a bilingual side-by-side HTML section for print documents.
 */
export function buildBilingualHtml(
  englishText: string,
  translatedText: string,
  langLabel: string,
  langNative: string
): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `
<div style="margin-top:20px;border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;page-break-inside:avoid;">
  <div style="background:#f0f7ff;padding:6px 12px;font-size:11px;font-weight:700;color:#1A2F5A;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;">
    <span>Patient Instructions</span>
    <span style="color:#475569;">Auto-translated · Please verify with patient before discharge.</span>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:0;">
    <div style="padding:12px;border-right:1px solid #e2e8f0;">
      <div style="font-size:10px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px;">English</div>
      <pre style="font-family:inherit;font-size:12px;line-height:1.6;white-space:pre-wrap;margin:0;">${esc(englishText)}</pre>
    </div>
    <div style="padding:12px;background:#fffbeb;">
      <div style="font-size:10px;font-weight:700;color:#92400e;text-transform:uppercase;margin-bottom:6px;">${esc(langLabel)} (${esc(langNative)})</div>
      <pre style="font-family:inherit;font-size:12px;line-height:1.6;white-space:pre-wrap;margin:0;">${esc(translatedText)}</pre>
    </div>
  </div>
</div>`;
}
