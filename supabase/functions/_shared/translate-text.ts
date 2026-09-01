/**
 * Shared Indian-language → English translation helper.
 *
 * Used by the standalone `sarvam-translate` / `bhashini-translate` edge
 * functions AND inline by `ai-clinical-voice` when the platform has
 * `voice_pre_translate` enabled.
 *
 * Design constraints:
 * - Sarvam Translate API caps at 2 000 characters per request, so long
 *   transcripts are split at sentence boundaries and translated in sequence.
 * - Bhashini NMT requires a two-step pipeline (getModelsPipeline → inference).
 * - Best-effort: a failed translation returns the ORIGINAL text so the
 *   downstream LLM can still attempt multilingual extraction — a broken
 *   translation must never block a clinical workflow.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getUsdToInr } from "./platform-rate.ts";
// Language codes come from _shared/asr-languages.ts. They used to be restated in this file
// and had drifted: it carried `or-IN`/`bo-IN`, which Sarvam rejects (Odia is `od-IN`, Bodo is
// `brx-IN`), and it forwarded any unmapped value — including the literal "auto" — to the API
// as a source language.
import { toSarvamTranslateLang, toBhashiniLang } from "./asr-languages.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TranslateResult {
  translatedText: string;
  provider: "sarvam" | "bhashini";
  sourceLanguage: string;
  charactersTranslated: number;
  /** True when the result is the original text because translation failed. */
  fallback: boolean;
}

/** Returned when the source language cannot be resolved — the caller keeps the original text. */
function unresolvedLanguage(
  text: string, provider: "sarvam" | "bhashini", sourceLanguage: string,
): TranslateResult {
  console.warn(`translate: no ${provider} route for source language "${sourceLanguage}" — skipping translation`);
  return { translatedText: text, provider, sourceLanguage, charactersTranslated: 0, fallback: true };
}

// ─── Sentence splitting ───────────────────────────────────────────────────────

const SARVAM_CHAR_LIMIT = 1900; // Leave 100 chars headroom below the 2 000 API limit.

/**
 * Split text into chunks of ≤ `maxChars` characters, breaking at sentence
 * boundaries (`. `, `। `, `? `, `! `, newline) when possible. Falls back to
 * splitting at the last space within the limit if no sentence boundary is found.
 */
export function splitAtSentenceBoundary(text: string, maxChars: number = SARVAM_CHAR_LIMIT): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Find the last sentence boundary within the limit.
    const window = remaining.slice(0, maxChars);
    // Indian scripts use "।" (purna viram), English uses "."; also split at "?" "!" and newline.
    const sentenceEnders = /[।.?!]\s|\n/g;
    let lastBoundary = -1;
    let match: RegExpExecArray | null;
    while ((match = sentenceEnders.exec(window)) !== null) {
      lastBoundary = match.index + match[0].length;
    }

    if (lastBoundary > 0) {
      chunks.push(remaining.slice(0, lastBoundary).trim());
      remaining = remaining.slice(lastBoundary).trim();
    } else {
      // No sentence boundary found — split at last space.
      const lastSpace = window.lastIndexOf(" ");
      if (lastSpace > 0) {
        chunks.push(remaining.slice(0, lastSpace).trim());
        remaining = remaining.slice(lastSpace).trim();
      } else {
        // No space either — hard cut (extremely rare for natural text).
        chunks.push(remaining.slice(0, maxChars));
        remaining = remaining.slice(maxChars);
      }
    }
  }

  return chunks.filter(c => c.length > 0);
}

// ─── Sarvam Translate ─────────────────────────────────────────────────────────

async function translateChunkSarvam(
  text: string,
  sourceLang: string,
  apiKey: string,
): Promise<string> {
  const response = await fetch("https://api.sarvam.ai/translate", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: text,
      source_language_code: sourceLang,
      target_language_code: "en-IN",
      // mayura:v1 handles colloquial / code-mixed clinical speech better than
      // sarvam-translate:v1 which is tuned for formal documents.
      model: "mayura:v1",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Sarvam Translate error ${response.status}: ${errText}`);
  }

  const result = await response.json();
  return result.translated_text || "";
}

export async function translateWithSarvam(
  text: string,
  sourceLanguage: string,
  apiKey: string,
): Promise<TranslateResult> {
  // Refuse rather than forward an unresolvable code. `|| sourceLanguage` used to let the
  // literal "auto" through to the API as a source language, which failed the whole call.
  const sourceLang = toSarvamTranslateLang(sourceLanguage);
  if (!sourceLang) return unresolvedLanguage(text, "sarvam", sourceLanguage);

  try {
    const chunks = splitAtSentenceBoundary(text, SARVAM_CHAR_LIMIT);
    const translatedChunks: string[] = [];

    for (const chunk of chunks) {
      const translated = await translateChunkSarvam(chunk, sourceLang, apiKey);
      translatedChunks.push(translated);
    }

    const translatedText = translatedChunks.join(" ").trim();
    return {
      translatedText: translatedText || text, // if empty, return original
      provider: "sarvam",
      sourceLanguage,
      charactersTranslated: text.length,
      fallback: !translatedText,
    };
  } catch (err) {
    console.error("Sarvam translation failed (falling back to original):", err instanceof Error ? err.message : String(err));
    return {
      translatedText: text,
      provider: "sarvam",
      sourceLanguage,
      charactersTranslated: 0,
      fallback: true,
    };
  }
}

// ─── Bhashini Translate ───────────────────────────────────────────────────────

export async function translateWithBhashini(
  text: string,
  sourceLanguage: string,
  apiKey: string,
  userId: string,
): Promise<TranslateResult> {
  // `split("-")[0]` used to stand in for a map, which is wrong for exactly the codes that
  // matter: Bhashini wants "or" for od-IN and "brx" for brx-IN, not "od" and "brx".
  const sourceLang = toBhashiniLang(sourceLanguage);
  if (!sourceLang) return unresolvedLanguage(text, "bhashini", sourceLanguage);

  try {
    // Step 1: Get NMT pipeline config from ULCA
    const pipelineRes = await fetch(
      "https://meity-auth.ulcacontrib.org/ulca/apis/v0/model/getModelsPipeline",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ulcaApiKey: apiKey,
          userID: userId,
        },
        body: JSON.stringify({
          pipelineTasks: [{
            taskType: "translation",
            config: {
              language: { sourceLanguage: sourceLang, targetLanguage: "en" },
            },
          }],
          pipelineRequestConfig: { pipelineId: "64392f96daac500b55c543cd" },
        }),
      },
    );

    if (!pipelineRes.ok) {
      throw new Error(`Bhashini pipeline error ${pipelineRes.status}: ${await pipelineRes.text()}`);
    }

    const pipelineData = await pipelineRes.json();
    const nmtConfig = pipelineData?.pipelineResponseConfig?.[0]?.config?.[0];
    const serviceUrl = pipelineData?.pipelineInferenceAPIEndPoint?.callbackUrl;
    const inferenceApiKey = pipelineData?.pipelineInferenceAPIEndPoint?.inferenceApiKey?.value;

    if (!serviceUrl || !inferenceApiKey || !nmtConfig?.serviceId) {
      throw new Error("Could not resolve Bhashini NMT endpoint");
    }

    // Step 2: Call NMT inference
    const nmtRes = await fetch(serviceUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: inferenceApiKey,
      },
      body: JSON.stringify({
        pipelineTasks: [{
          taskType: "translation",
          config: {
            language: { sourceLanguage: sourceLang, targetLanguage: "en" },
            serviceId: nmtConfig.serviceId,
          },
        }],
        inputData: {
          input: [{ source: text }],
        },
      }),
    });

    if (!nmtRes.ok) {
      throw new Error(`Bhashini NMT error ${nmtRes.status}: ${await nmtRes.text()}`);
    }

    const nmtData = await nmtRes.json();
    const translatedText = nmtData?.pipelineResponse?.[0]?.output?.[0]?.target || "";

    return {
      translatedText: translatedText || text,
      provider: "bhashini",
      sourceLanguage,
      charactersTranslated: text.length,
      fallback: !translatedText,
    };
  } catch (err) {
    console.error("Bhashini translation failed (falling back to original):", err instanceof Error ? err.message : String(err));
    return {
      translatedText: text,
      provider: "bhashini",
      sourceLanguage,
      charactersTranslated: 0,
      fallback: true,
    };
  }
}

// ─── Unified entry point ──────────────────────────────────────────────────────

/**
 * Translate Indian-language text to English using the specified provider.
 *
 * Best-effort: returns original text on failure (never throws).
 */
export async function translateToEnglish(
  text: string,
  sourceLanguage: string,
  provider: "sarvam" | "bhashini",
  apiKey: string,
  bhashiniUserId?: string,
): Promise<TranslateResult> {
  // English → English is a no-op.
  if (sourceLanguage === "en-IN" || sourceLanguage === "en") {
    return {
      translatedText: text,
      provider,
      sourceLanguage,
      charactersTranslated: 0,
      fallback: false,
    };
  }

  if (provider === "bhashini") {
    if (!bhashiniUserId) {
      console.error("Bhashini translation requires userId — falling back to original text");
      return { translatedText: text, provider, sourceLanguage, charactersTranslated: 0, fallback: true };
    }
    return translateWithBhashini(text, sourceLanguage, apiKey, bhashiniUserId);
  }

  return translateWithSarvam(text, sourceLanguage, apiKey);
}

// ─── Translation metering ─────────────────────────────────────────────────────

export const TRANSLATE_FEATURE_KEY = "voice_translate";

export interface TranslateUsage {
  hospitalId: string | null;
  provider: "sarvam" | "bhashini";
  charactersTranslated: number;
  latencyMs?: number;
  success?: boolean;
  errorMessage?: string;
}

/**
 * Record one translation call in `ai_usage_logs` + `ai_cost_daily`.
 *
 * Translation is priced per 1 000 characters (from `translate_pricing` table).
 * Fire-and-forget — metering must never fail a clinical workflow.
 */
export async function recordTranslateUsage(sb: SupabaseClient, usage: TranslateUsage): Promise<void> {
  if (!usage.hospitalId) return;

  try {
    const [{ data: pricing }, rate] = await Promise.all([
      sb.from("translate_pricing").select("cost_per_1000_chars_inr").eq("provider", usage.provider).maybeSingle(),
      getUsdToInr(sb),
    ]);

    const per1kInr = Number(pricing?.cost_per_1000_chars_inr ?? 0);
    const costInr = (usage.charactersTranslated / 1000) * per1kInr;
    const costUsd = rate > 0 ? costInr / rate : 0;

    await sb.from("ai_usage_logs").insert({
      hospital_id: usage.hospitalId,
      feature_key: TRANSLATE_FEATURE_KEY,
      provider: usage.provider,
      model_name: usage.provider === "sarvam" ? "mayura:v1" : "bhashini-nmt",
      tokens_input: usage.charactersTranslated, // chars, not tokens — see ASR precedent
      tokens_output: 0,
      estimated_cost_usd: costUsd,
      estimated_cost_inr: costInr,
      latency_ms: usage.latencyMs ?? null,
      success: usage.success ?? true,
      error_message: usage.errorMessage ?? null,
    });

    if (usage.success !== false) {
      await sb.rpc("upsert_ai_cost_daily", {
        p_hospital_id: usage.hospitalId,
        p_date: new Date().toISOString().split("T")[0],
        p_feature_key: TRANSLATE_FEATURE_KEY,
        p_provider: usage.provider,
        p_tokens_input: usage.charactersTranslated,
        p_tokens_output: 0,
        p_cache_read_tokens: 0,
        p_cache_hit: false,
        p_cost_usd: costUsd,
        p_cost_inr: costInr,
      });
    }
  } catch (err) {
    console.error("Translate metering failed (non-fatal):", err instanceof Error ? err.message : String(err));
  }
}
