/**
 * Language & region config — the shape stored in `hospital_settings` under `language_region`.
 *
 * Split out of SettingsLanguagePage so formatters elsewhere can read the hospital's chosen
 * conventions without importing a page component.
 *
 * DEFAULTS MUST STAY INDIAN. A hospital that never opens the screen still has to print dates
 * a patient in Hyderabad can read: DD/MM/YYYY, ₹ INR, Asia/Kolkata, and Indian digit grouping
 * (1,00,000 — not 100,000).
 */

export const LANGUAGE_REGION_KEY = "language_region";

export interface LanguageRegionConfig {
  /** ISO 639-1 code — en, hi, te, ta, kn, ml, mr. */
  language: string;
  dateFormat: string;
  /** "12" or "24". */
  timeFormat: string;
  currency: string;
  timezone: string;
  /** "indian" or "international". */
  numberFormat: string;
}

export const DEFAULT_LANGUAGE_REGION: LanguageRegionConfig = {
  language: "en",
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12",
  currency: "INR",
  timezone: "Asia/Kolkata",
  numberFormat: "indian",
};
