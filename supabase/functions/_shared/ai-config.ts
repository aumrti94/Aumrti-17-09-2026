// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkAIAllowed } from "./ai-entitlement.ts";
import { getUsdToInr } from "./platform-rate.ts";

// Thrown by resolveAiConfig when a hospital's "AI Features" master switch (or the
// per-feature toggle) withholds this call. Distinct from the "no config → null →
// env fallback" path: a disabled hospital must be BLOCKED, never fall through to a
// platform env key. Callers that don't catch it fail safe (500, no provider spend).
export class AIDisabledError extends Error {
  constructor(message = "AI features are disabled for this hospital.") {
    super(message);
    this.name = "AIDisabledError";
  }
}

// The DB (platform_ai_provider_config.provider, and the platform UI dropdown) stores Azure as
// "azure_openai", but the maps + dispatch below are keyed on "azure". Without normalising, the
// service-key lookup returns undefined → the API key row is never fetched → resolveAiConfig()
// returns null → every feature reports "No AI provider configured" for Azure ONLY. Normalise
// once, here, so the two vocabularies can never diverge again.
export function normalizeProviderKey(provider: string | undefined | null): string {
  const p = String(provider || "");
  return p === "azure_openai" ? "azure" : p;
}

const PROVIDER_SERVICE_KEYS: Record<string, string> = {
  claude: "anthropic",
  openai: "openai",
  gemini: "gemini",
  perplexity: "perplexity",
  azure: "azure_openai",
  azure_openai: "azure_openai", // tolerate the raw DB value too
  openrouter: "openrouter",
};

const PROVIDER_ENV_KEYS: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  azure: "AZURE_OPENAI_API_KEY",
  azure_openai: "AZURE_OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const DEFAULT_MODELS: Record<string, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  perplexity: "llama-3.1-sonar-large-128k-online",
  azure: "gpt-4o",
  azure_openai: "gpt-4o",
  openrouter: "google/gemini-2.5-flash",
};

export interface AiConfig {
  provider: string;
  model: string;
  apiKey: string;
  temperature: number;
  maxTokens: number;
  endpoint?: string;   // Azure: base URL (e.g. https://xxx.openai.azure.com)
  apiVersion?: string; // Azure: API version (e.g. 2024-02-01); blank uses the newer /openai/v1 surface
  apiStyle?: "chat_completions" | "responses"; // Azure: "responses" only valid when apiVersion is blank
  azureSurface?: string; // Azure: which Foundry surface — "auto"|"openai"|"anthropic"|"foundry_models"
  /**
   * Who to bill this call's cost to. Set by resolveAiConfig (which already
   * receives both identifiers) so that callAiChat/callAiChatWithUsage/
   * callAiVision meter automatically.
   *
   * Why it lives on the config rather than at each call site: before this,
   * only ai-proxy and ai-clinical-voice logged cost — the other ten AI edge
   * functions called providers straight through this module and their spend
   * was invisible, which made any AI budget meaningless. Attaching the
   * identity to the config makes metering the default rather than something
   * each new function has to remember.
   */
  meter?: { hospitalId: string; featureKey: string };
}

// Azure AI Foundry serves different model families through different API surfaces:
//   • openai         → OpenAI-compatible /openai/v1 (GPT, and open models: Llama, DeepSeek, Mistral, Grok, Cohere…)
//   • anthropic      → /anthropic/v1/messages (Claude — Anthropic Messages shape, NOT OpenAI)
//   • foundry_models → /models/chat/completions?api-version= (serverless/partner deployments, OpenAI-shaped)
export type AzureSurface = "openai" | "anthropic" | "foundry_models";

// Azure output-token headroom. `max_output_tokens`/`max_tokens` is a CEILING, not a
// reservation — you're billed for tokens actually generated — so a generous cap costs nothing
// for well-behaved models and rescues the two ways Foundry models blow the caller's budget:
//   • reasoning models (gpt-5/o-series) bill HIDDEN reasoning against the same budget →
//     it's consumed before the answer starts → empty output → JSON.parse("") blows up;
//   • verbose/"thinking" models (e.g. Kimi-K2.5) simply run past the cap → TRUNCATED JSON.
// Both were observed live at exactly the caller's cap (1152 and 1200 of 1200). Applied to ALL
// Azure calls, not just name-matched reasoning models — the name pattern was too narrow.
// Twin of the helper in src/lib/azureFoundry.ts — keep in lockstep.
export function azureMaxOutputTokens(requested: number): number {
  return Math.max((Number(requested) || 0) * 4, 4000);
}

// Azure inference endpoints are ALWAYS the resource root (scheme + host) — the inference path
// (/openai/v1/…, /models/…, /anthropic/v1/…) is appended to it. Users frequently paste the
// Foundry *project* endpoint instead:
//   https://<res>.services.ai.azure.com/api/projects/<name>   ← Agents/SDK endpoint, NOT inference
// which builds broken URLs and makes EVERY Azure call 404. Normalise to the origin.
export function normalizeAzureEndpoint(endpoint: string | undefined): string {
  const raw = (endpoint || "").trim();
  if (!raw) return "";
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

// Resolve "auto"/blank to a concrete surface: Claude deployments speak the Anthropic
// surface; everything else defaults to the OpenAI-compatible surface.
export function resolveAzureSurface(surface: string | undefined, model: string): AzureSurface {
  if (surface === "openai" || surface === "anthropic" || surface === "foundry_models") return surface;
  return /^claude/i.test(model || "") ? "anthropic" : "openai";
}

export function buildAzureUrl(cfg: {
  endpoint?: string; model: string; apiVersion?: string; apiStyle?: string; surface?: string;
}): { url: string; surface: AzureSurface; useV1: boolean; useResponses: boolean } {
  const endpoint = normalizeAzureEndpoint(cfg.endpoint);
  if (!endpoint) throw new Error("Azure OpenAI endpoint not configured");
  const surface = resolveAzureSurface(cfg.surface, cfg.model);
  if (surface === "anthropic") {
    return { url: `${endpoint}/anthropic/v1/messages`, surface, useV1: false, useResponses: false };
  }
  if (surface === "foundry_models") {
    const apiVersion = cfg.apiVersion || "2025-03-01-preview";
    return { url: `${endpoint}/models/chat/completions?api-version=${apiVersion}`, surface, useV1: false, useResponses: false };
  }
  // openai surface. With an API version → classic GA (deployment in URL). Responses API
  // only exists on the newer /openai/v1 surface, so it requires apiVersion to be blank.
  // Smart Auto: GPT-5 / o-series reasoning models are served ONLY via the Responses API on
  // Foundry (chat-completions 404s), so when the user left surface on "auto" we route them
  // there automatically. Explicit surface/apiStyle choices are always respected.
  const useV1 = !cfg.apiVersion;
  // Reasoning models are served ONLY by the Responses API on Azure — chat-completions 404s for
  // them — so route them there whether the surface was left on "auto" OR set explicitly to
  // "openai". (Honouring an explicit chat_completions choice here would always fail.)
  const reasoning = /^(o[0-9]|gpt-5)/i.test(cfg.model || "");
  const useResponses = useV1 && (cfg.apiStyle === "responses" || reasoning);
  const url = useResponses
    ? `${endpoint}/openai/v1/responses`
    : useV1
    ? `${endpoint}/openai/v1/chat/completions`
    : `${endpoint}/openai/deployments/${cfg.model}/chat/completions?api-version=${cfg.apiVersion}`;
  return { url, surface, useV1, useResponses };
}

export function azureHeaders(surface: AzureSurface, apiKey: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", "api-key": apiKey };
  if (surface === "anthropic") {
    h["x-api-key"] = apiKey;
    h["anthropic-version"] = "2023-06-01";
  }
  return h;
}

// Azure Responses API returns output as a list of typed items rather than choices[0].message.content.
function extractResponsesOutputText(data: Record<string, unknown>): string {
  if (typeof data.output_text === "string") return data.output_text;
  const output = Array.isArray(data.output) ? data.output : [];
  const parts: string[] = [];
  for (const item of output as Record<string, unknown>[]) {
    if (item?.type !== "message" || !Array.isArray(item.content)) continue;
    for (const c of item.content as Record<string, unknown>[]) {
      if (c?.type === "output_text" && typeof c.text === "string") parts.push(c.text);
    }
  }
  return parts.join("");
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Resolve the GLOBAL (platform-controlled) AI config for a feature.
 *
 * AI configuration is no longer per-hospital: every hospital uses the single
 * global config managed at /platform (platform_ai_provider_config +
 * platform_ai_keys). `hospitalId` is retained in the signature for backwards
 * compatibility and call-site logging only — it is NOT used for resolution.
 *
 * Falls back to global_default if no feature-specific row found.
 * Returns null if no config or API key is available.
 */
export async function resolveAiConfig(
  hospitalId: string,
  featureKey: string,
  defaultMaxTokens = 1000,
): Promise<AiConfig | null> {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // AI entitlement floor — the single server-side choke every ai-config-based edge
  // function funnels through. THROW (don't return null) when the hospital's AI switch
  // withholds this: null would let callers fall through to `?? resolveAiConfigFromEnv()`
  // and spend on a platform key anyway. checkAIAllowed fails open, so this only throws
  // on a definite disabled decision — never on a transient DB error.
  const gate = await checkAIAllowed(sb, hospitalId, featureKey);
  if (!gate.allowed) throw new AIDisabledError(gate.reason);

  // Feature-specific config first, then global_default — global tables, no hospital_id
  let cfg: Record<string, unknown> | null = null;
  const { data: featureCfg } = await sb
    .from("platform_ai_provider_config")
    .select("provider, model_name, temperature, max_tokens")
    .eq("feature_key", featureKey)
    .eq("is_active", true)
    .maybeSingle();

  cfg = featureCfg;

  if (!cfg) {
    const { data: defaultCfg } = await sb
      .from("platform_ai_provider_config")
      .select("provider, model_name, temperature, max_tokens")
      .eq("feature_key", "global_default")
      .eq("is_active", true)
      .maybeSingle();
    cfg = defaultCfg;
  }

  if (!cfg) return null;

  // The DB stores Azure as "azure_openai" but everything below is keyed on "azure" —
  // normalise once so the service-key lookup and the Azure branch actually fire.
  const provider = normalizeProviderKey(cfg.provider as string);

  // Get API key (and extra fields) from the global platform_ai_keys
  const serviceKey = PROVIDER_SERVICE_KEYS[provider];
  let keyCfgData: Record<string, string> | undefined;

  if (serviceKey) {
    const { data: keyCfg } = await sb
      .from("platform_ai_keys")
      .select("config")
      .eq("service_key", serviceKey)
      .eq("is_active", true)
      .maybeSingle();
    keyCfgData = keyCfg?.config as Record<string, string> | undefined;
  }

  // Azure OpenAI requires endpoint + deployment in addition to API key
  if (provider === "azure") {
    const azApiKey = keyCfgData?.api_key || Deno.env.get("AZURE_OPENAI_API_KEY") || undefined;
    if (!azApiKey) return null;
    return {
      provider: "azure",
      // Per-feature model wins over the drawer's single deployment — otherwise EVERY Azure
      // feature is pinned to one deployment and the platform UI's per-feature Model box does
      // nothing (every other provider already honours cfg.model_name). Features without their
      // own row still inherit the drawer deployment via the global_default fallback above.
      model: (cfg.model_name as string) || keyCfgData?.deployment_name || keyCfgData?.deployment || DEFAULT_MODELS.azure,
      apiKey: azApiKey,
      endpoint: keyCfgData?.endpoint || Deno.env.get("AZURE_OPENAI_ENDPOINT") || undefined,
      apiVersion: keyCfgData?.api_version || Deno.env.get("AZURE_OPENAI_API_VERSION") || undefined,
      apiStyle: (keyCfgData?.api_style as AiConfig["apiStyle"]) || undefined,
      azureSurface: keyCfgData?.azure_surface || undefined,
      temperature: Number(cfg.temperature) || 0.3,
      maxTokens: Number(cfg.max_tokens) || defaultMaxTokens,
      meter: { hospitalId, featureKey },
    };
  }

  let apiKey: string | undefined = keyCfgData?.api_key;

  // Env var fallback
  if (!apiKey) {
    const envKey = PROVIDER_ENV_KEYS[provider];
    apiKey = envKey ? (Deno.env.get(envKey) || undefined) : undefined;
  }

  if (!apiKey) return null;

  return {
    provider,
    model: (cfg.model_name as string) || DEFAULT_MODELS[provider] || "gpt-4o",
    apiKey,
    temperature: Number(cfg.temperature) || 0.3,
    maxTokens: Number(cfg.max_tokens) || defaultMaxTokens,
    meter: { hospitalId, featureKey },
  };
}

/**
 * Resolve AI config from env vars only (no hospitalId required).
 * Tries providers in order: openai → claude → gemini.
 *
 * `hospitalId`/`featureKey` are optional but should be passed wherever the
 * caller knows them: this is the `?? resolveAiConfigFromEnv()` fallback that
 * fires when no DB config exists, and it still spends real money on a platform
 * key. Omitting them makes that spend unattributable.
 */
export function resolveAiConfigFromEnv(
  defaultMaxTokens = 1000,
  hospitalId?: string,
  featureKey?: string,
): AiConfig | null {
  const priorities = [
    { provider: "openai",     envKey: "OPENAI_API_KEY",     model: DEFAULT_MODELS.openai },
    { provider: "claude",     envKey: "ANTHROPIC_API_KEY",  model: DEFAULT_MODELS.claude },
    { provider: "gemini",     envKey: "GEMINI_API_KEY",     model: DEFAULT_MODELS.gemini },
    { provider: "perplexity", envKey: "PERPLEXITY_API_KEY", model: DEFAULT_MODELS.perplexity },
  ];
  const meter = hospitalId && featureKey ? { hospitalId, featureKey } : undefined;
  for (const { provider, envKey, model } of priorities) {
    const apiKey = Deno.env.get(envKey);
    if (apiKey) return { provider, model, apiKey, temperature: 0.3, maxTokens: defaultMaxTokens, meter };
  }
  return null;
}

export interface ChatUsage {
  tokensInput: number;
  tokensOutput: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

// USD cost per 1000 tokens (approximate) — mirrors ai-proxy/index.ts's
// COST_PER_1K table so a given model's estimated cost matches whichever
// path logged it. Falls back to a Claude-Sonnet-ish rate for unlisted models.
const COST_PER_1K: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-sonnet-4-6":          { input: 0.003,   output: 0.015,  cacheWrite: 0.00375, cacheRead: 0.0003 },
  "claude-sonnet-4-20250514":   { input: 0.003,   output: 0.015,  cacheWrite: 0.00375, cacheRead: 0.0003 },
  "claude-3-5-sonnet-20241022": { input: 0.003,   output: 0.015,  cacheWrite: 0.00375, cacheRead: 0.0003 },
  "claude-3-5-haiku-20241022":  { input: 0.0008,  output: 0.004,  cacheWrite: 0.001,   cacheRead: 0.00008 },
  "claude-3-opus-20240229":     { input: 0.015,   output: 0.075,  cacheWrite: 0.01875, cacheRead: 0.0015 },
  "gpt-4o":                     { input: 0.005,   output: 0.015,  cacheWrite: 0,       cacheRead: 0.0025 },
  "gpt-4o-mini":                { input: 0.00015, output: 0.0006, cacheWrite: 0,       cacheRead: 0.000075 },
  "gemini-2.0-flash":           { input: 0.0001,  output: 0.0004, cacheWrite: 0,       cacheRead: 0 },
};

// Azure Foundry deployment names are arbitrary (e.g. "claude-sonnet-5", "gpt-4o",
// "DeepSeek-V3.2"), so fall back to a family prefix when there's no exact match.
function pricingForModel(model: string) {
  if (COST_PER_1K[model]) return COST_PER_1K[model];
  const m = (model || "").toLowerCase();
  const SONNET = { input: 0.003, output: 0.015, cacheWrite: 0.00375, cacheRead: 0.0003 };
  if (m.includes("haiku")) return { input: 0.0008, output: 0.004, cacheWrite: 0.001, cacheRead: 0.00008 };
  if (m.includes("opus")) return { input: 0.015, output: 0.075, cacheWrite: 0.01875, cacheRead: 0.0015 };
  if (m.startsWith("claude") || m.includes("sonnet")) return SONNET;
  if (m.startsWith("gpt-4o-mini") || m.includes("mini")) return COST_PER_1K["gpt-4o-mini"];
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return COST_PER_1K["gpt-4o"];
  if (m.startsWith("gemini")) return COST_PER_1K["gemini-2.0-flash"];
  return SONNET;
}

export function estimateAiCostUsd(model: string, usage: ChatUsage): number {
  const pricing = pricingForModel(model);
  return (
    (usage.tokensInput / 1000) * pricing.input +
    (usage.tokensOutput / 1000) * pricing.output +
    (usage.cacheCreationTokens / 1000) * pricing.cacheWrite +
    (usage.cacheReadTokens / 1000) * pricing.cacheRead
  );
}

/**
 * Record one AI call against the hospital that caused it.
 *
 * Writes both the raw row (`ai_usage_logs`) and the pre-aggregate
 * (`ai_cost_daily`, via the same `upsert_ai_cost_daily` RPC ai-proxy uses), so
 * budget and dashboard queries can read the rollup without scanning raw logs.
 *
 * Fire-and-forget by design: metering must never be able to fail a clinical AI
 * call. A lost log row costs a rounding error in a budget; a thrown error here
 * would cost a discharge summary.
 */
async function recordAiUsage(
  meter: { hospitalId: string; featureKey: string },
  provider: string,
  model: string,
  usage: ChatUsage,
  latencyMs?: number,
): Promise<void> {
  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    // Provider rate cards are USD-per-1K-tokens, so the raw figure is computed
    // in USD and kept for invoice reconciliation. The rupee figure is frozen
    // alongside it at the rate in force now — everything a human sees, and
    // every budget comparison, uses the INR value.
    const costUsd = estimateAiCostUsd(model, usage);
    const costInr = costUsd * (await getUsdToInr(sb));
    const cacheHit = usage.cacheReadTokens > 0;

    await sb.from("ai_usage_logs").insert({
      hospital_id: meter.hospitalId,
      feature_key: meter.featureKey,
      provider,
      model_name: model,
      tokens_input: usage.tokensInput,
      tokens_output: usage.tokensOutput,
      cache_creation_tokens: usage.cacheCreationTokens,
      cache_read_tokens: usage.cacheReadTokens,
      cache_hit: cacheHit,
      estimated_cost_usd: costUsd,
      estimated_cost_inr: costInr,
      latency_ms: latencyMs ?? null,
      success: true,
    });

    await sb.rpc("upsert_ai_cost_daily", {
      p_hospital_id:       meter.hospitalId,
      p_date:              new Date().toISOString().split("T")[0],
      p_feature_key:       meter.featureKey,
      p_provider:          provider,
      p_tokens_input:      usage.tokensInput,
      p_tokens_output:     usage.tokensOutput,
      p_cache_read_tokens: usage.cacheReadTokens,
      p_cache_hit:         cacheHit,
      p_cost_usd:          costUsd,
      p_cost_inr:          costInr,
    });
  } catch (err) {
    console.error("AI usage metering failed (non-fatal):", err instanceof Error ? err.message : String(err));
  }
}

export interface ChatResult {
  content: string;
  usage: ChatUsage;
}

// Every provider reports usage under a slightly different shape/field name —
// this normalizes all of them to the one ChatUsage shape ai_usage_logs uses.
function extractUsage(data: Record<string, unknown>, provider: string): ChatUsage {
  const usage = (data.usage ?? data.usageMetadata ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number => (typeof v === "number" ? v : 0);

  if (provider === "gemini") {
    return {
      tokensInput: num(usage.promptTokenCount),
      tokensOutput: num(usage.candidatesTokenCount),
      cacheCreationTokens: 0,
      cacheReadTokens: num((usage as any).cachedContentTokenCount),
    };
  }
  if (provider === "claude") {
    return {
      tokensInput: num((usage as any).input_tokens),
      tokensOutput: num((usage as any).output_tokens),
      cacheCreationTokens: num((usage as any).cache_creation_input_tokens),
      cacheReadTokens: num((usage as any).cache_read_input_tokens),
    };
  }
  // OpenAI, Azure (chat_completions + responses), Perplexity, OpenRouter are
  // all OpenAI-compatible: prompt_tokens/completion_tokens, or the newer
  // Responses API's input_tokens/output_tokens.
  return {
    tokensInput: num((usage as any).prompt_tokens ?? (usage as any).input_tokens),
    tokensOutput: num((usage as any).completion_tokens ?? (usage as any).output_tokens),
    cacheCreationTokens: 0,
    cacheReadTokens: num((usage as any).prompt_tokens_details?.cached_tokens ?? (usage as any).input_tokens_details?.cached_tokens),
  };
}

// Build the full Azure request (url + headers + body) for a text chat across all
// three Foundry surfaces. Callers with image attachments (ai-proxy) resolve the
// surface via resolveAzureSurface()/buildAzureUrl() and shape content themselves.
export function buildAzureRequest(
  cfg: { endpoint?: string; model: string; apiKey: string; apiVersion?: string; apiStyle?: string; surface?: string },
  messages: ChatMessage[],
  opts: { maxTokens: number; temperature: number },
): { url: string; headers: Record<string, string>; body: Record<string, unknown>; surface: AzureSurface; useResponses: boolean } {
  const { url, surface, useV1, useResponses } = buildAzureUrl(cfg);
  const headers = azureHeaders(surface, cfg.apiKey);
  const systemMsg = messages.find((m) => m.role === "system");
  const chatMsgs = messages.filter((m) => m.role !== "system");
  // GPT-5 / o-series reasoning models reject the `temperature` sampling param on Azure.
  const reasoning = /^(o[0-9]|gpt-5)/i.test(cfg.model || "");
  let body: Record<string, unknown>;
  if (surface === "anthropic") {
    body = {
      model: cfg.model,
      max_tokens: azureMaxOutputTokens(opts.maxTokens),
      temperature: opts.temperature,
      ...(systemMsg ? { system: systemMsg.content } : {}),
      messages: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
    };
  } else if (surface === "foundry_models") {
    body = {
      model: cfg.model,
      max_tokens: azureMaxOutputTokens(opts.maxTokens),
      temperature: opts.temperature,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
  } else if (useResponses) {
    body = {
      model: cfg.model,
      input: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
      ...(systemMsg ? { instructions: systemMsg.content } : {}),
      max_output_tokens: azureMaxOutputTokens(opts.maxTokens),
      ...(reasoning ? { reasoning: { effort: "low" } } : { temperature: opts.temperature }),
    };
  } else {
    body = {
      ...(useV1 ? { model: cfg.model } : {}),
      max_tokens: azureMaxOutputTokens(opts.maxTokens),
      ...(reasoning ? {} : { temperature: opts.temperature }),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };
  }
  return { url, headers, body, surface, useResponses };
}

// Parse an Azure response into text + normalized usage, per surface.
export function parseAzureResponse(
  surface: AzureSurface,
  useResponses: boolean,
  data: Record<string, unknown>,
): { content: string; usage: ChatUsage } {
  if (surface === "anthropic") {
    const blocks = Array.isArray((data as any).content) ? (data as any).content : [];
    const content = blocks.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("");
    const u = ((data as any).usage ?? {}) as Record<string, unknown>;
    const n = (v: unknown) => (typeof v === "number" ? v : 0);
    return {
      content,
      usage: {
        tokensInput: n(u.input_tokens),
        tokensOutput: n(u.output_tokens),
        cacheCreationTokens: n(u.cache_creation_input_tokens),
        cacheReadTokens: n(u.cache_read_input_tokens),
      },
    };
  }
  const content = useResponses ? extractResponsesOutputText(data) : ((data as any).choices?.[0]?.message?.content || "");
  // A Responses payload with no message item means the model produced nothing usable — almost
  // always a reasoning model that burned max_output_tokens on hidden reasoning. Fail with the
  // real reason instead of returning "" and letting the caller's JSON.parse throw a misleading
  // "Failed to parse AI response as JSON".
  if (useResponses && !content) {
    const status = (data as any).status ?? "unknown";
    const reason = (data as any).incomplete_details?.reason;
    throw new Error(
      `Azure returned no output text (status=${status}${reason ? `, reason=${reason}` : ""}). ` +
      `Reasoning models (gpt-5/o-series) spend max_output_tokens on hidden reasoning — raise max tokens or lower reasoning effort.`,
    );
  }
  return { content, usage: extractUsage(data, "azure") };
}

/**
 * Call the configured AI provider with chat messages. Returns the response
 * text AND token/cache usage, normalized across providers — use this over
 * callAiChat() when the caller logs cost/usage (e.g. to ai_usage_logs).
 */
/**
 * Provider dispatch. Has one return per provider branch, which is exactly why
 * metering does NOT live here — see the exported wrapper below.
 */
async function callAiChatWithUsageRaw(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens?: number,
  temperature?: number,
): Promise<ChatResult> {
  const maxTok = maxTokens ?? config.maxTokens;
  const temp = temperature ?? config.temperature;

  if (normalizeProviderKey(config.provider) === "azure") {
    const { url, headers, body, surface, useResponses } = buildAzureRequest(
      {
        endpoint: config.endpoint,
        model: config.model,
        apiKey: config.apiKey,
        apiVersion: config.apiVersion,
        apiStyle: config.apiStyle,
        surface: config.azureSurface,
      },
      messages,
      { maxTokens: maxTok, temperature: temp },
    );
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Azure error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return parseAzureResponse(surface, useResponses, data);
  }

  if (config.provider === "claude") {
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMsgs = messages.filter((m) => m.role !== "system");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTok,
        temperature: temp,
        ...(systemMsg ? { system: systemMsg.content } : {}),
        messages: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Claude error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { content: data.content?.[0]?.text || "", usage: extractUsage(data, "claude") };
  }

  if (config.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTok,
        temperature: temp,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { content: data.choices?.[0]?.message?.content || "", usage: extractUsage(data, "openai") };
  }

  if (config.provider === "gemini") {
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMsgs = messages.filter((m) => m.role !== "system");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(systemMsg ? { system_instruction: { parts: [{ text: systemMsg.content }] } } : {}),
        contents: chatMsgs.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
        // thinkingBudget:0 disables Gemini 2.5/3 "thinking" — without it the model
        // burns the output budget on hidden reasoning (slow + MAX_TOKENS truncation).
        generationConfig: { maxOutputTokens: maxTok, temperature: temp, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
    if (res.status === 429) throw new Error("AI quota exceeded — the AI provider key has hit its rate limit / quota. Check provider billing.");
    if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || "", usage: extractUsage(data, "gemini") };
  }

  if (config.provider === "perplexity") {
    const res = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTok,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Perplexity error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { content: data.choices?.[0]?.message?.content || "", usage: extractUsage(data, "perplexity") };
  }

  if (config.provider === "openrouter") {
    // OpenRouter: one key, OpenAI-compatible API, vendor-namespaced models
    // (e.g. google/gemini-2.5-flash, anthropic/claude-3.7-sonnet, perplexity/sonar).
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", "X-Title": "Aumrti HMS" },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTok,
        temperature: temp,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (res.status === 429) throw new Error("AI quota exceeded — the AI provider key has hit its rate limit / quota. Check provider billing.");
    if (!res.ok) throw new Error(`OpenRouter error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return { content: data.choices?.[0]?.message?.content || "", usage: extractUsage(data, "openrouter") };
  }

  throw new Error(`Unsupported AI provider: ${config.provider}`);
}

/**
 * Call the configured AI provider with chat messages, returning the response
 * text AND normalised token/cache usage.
 *
 * Also METERS the call when the config carries a `meter` context — which
 * resolveAiConfig always sets. Metering sits in this single wrapper rather than
 * in each of the six provider branches, so adding a provider cannot silently
 * reintroduce unmetered spend.
 *
 * The recording is fire-and-forget and swallows its own errors: a failed log
 * must never fail the AI call it was measuring.
 */
export async function callAiChatWithUsage(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens?: number,
  temperature?: number,
): Promise<ChatResult> {
  const startedAt = Date.now();
  const result = await callAiChatWithUsageRaw(config, messages, maxTokens, temperature);
  if (config.meter) {
    void recordAiUsage(config.meter, config.provider, config.model, result.usage, Date.now() - startedAt);
  }
  return result;
}

/**
 * Call the configured AI provider with chat messages. Returns the response
 * text only (backward-compatible wrapper — existing callers are unaffected
 * by the usage-tracking addition above). Metering happens inside
 * callAiChatWithUsage, so plain callAiChat callers are metered too.
 */
export async function callAiChat(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens?: number,
  temperature?: number,
): Promise<string> {
  const { content } = await callAiChatWithUsage(config, messages, maxTokens, temperature);
  return content;
}

/**
 * Call the configured AI provider with a vision (image + text) input.
 * Supports openai, gemini, claude, and azure (all Foundry surfaces) providers.
 */
/**
 * Provider dispatch for vision. Returns content plus usage so the exported
 * wrapper can meter; metering does not live here for the same reason as chat —
 * one exit point instead of five.
 */
async function callAiVisionRaw(
  config: AiConfig,
  base64Image: string,
  mediaType: string,
  textPrompt: string,
  maxTokens?: number,
): Promise<ChatResult> {
  const maxTok = maxTokens ?? config.maxTokens;

  if (config.provider === "openai") {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTok,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Image}` } },
            { type: "text", text: textPrompt },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI vision error ${res.status}`);
    const data = await res.json();
    return { content: data.choices?.[0]?.message?.content || "", usage: extractUsage(data, "openai") };
  }

  if (config.provider === "gemini") {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { inline_data: { mime_type: mediaType, data: base64Image } },
            { text: textPrompt },
          ],
        }],
        generationConfig: { maxOutputTokens: maxTok },
      }),
    });
    if (!res.ok) throw new Error(`Gemini vision error ${res.status}`);
    const data = await res.json();
    return { content: data.candidates?.[0]?.content?.parts?.[0]?.text || "", usage: extractUsage(data, "gemini") };
  }

  if (config.provider === "claude") {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": config.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: maxTok,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
            { type: "text", text: textPrompt },
          ],
        }],
      }),
    });
    if (!res.ok) throw new Error(`Claude vision error ${res.status}`);
    const data = await res.json();
    return { content: data.content?.[0]?.text || "", usage: extractUsage(data, "claude") };
  }

  if (normalizeProviderKey(config.provider) === "azure") {
    const { url, surface, useResponses } = buildAzureUrl({
      endpoint: config.endpoint,
      model: config.model,
      apiVersion: config.apiVersion,
      apiStyle: config.apiStyle,
      surface: config.azureSurface,
    });
    const headers = azureHeaders(surface, config.apiKey);
    let body: Record<string, unknown>;
    if (surface === "anthropic") {
      body = {
        model: config.model,
        max_tokens: maxTok,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: base64Image } },
            { type: "text", text: textPrompt },
          ],
        }],
      };
    } else if (useResponses) {
      body = {
        model: config.model,
        max_output_tokens: maxTok,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: textPrompt },
            { type: "input_image", image_url: `data:${mediaType};base64,${base64Image}` },
          ],
        }],
      };
    } else {
      // openai chat (/openai/v1 or classic deployment) or foundry_models — both OpenAI-shaped.
      body = {
        ...(surface === "foundry_models" || !config.apiVersion ? { model: config.model } : {}),
        max_tokens: maxTok,
        messages: [{
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64Image}` } },
            { type: "text", text: textPrompt },
          ],
        }],
      };
    }
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) throw new Error(`Azure vision error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (surface === "anthropic") {
      return { content: data.content?.[0]?.text || "", usage: extractUsage(data, "claude") };
    }
    const content = useResponses ? extractResponsesOutputText(data) : (data.choices?.[0]?.message?.content || "");
    return { content, usage: extractUsage(data, "azure") };
  }

  throw new Error(`Provider ${config.provider} does not support vision input`);
}

/**
 * Call the configured AI provider with a vision (image + text) input.
 *
 * Metered like chat when the config carries a `meter` context. Vision is among
 * the most expensive calls the platform makes, so leaving it unmetered would
 * understate exactly the spend that matters most.
 */
export async function callAiVision(
  config: AiConfig,
  base64Image: string,
  mediaType: string,
  textPrompt: string,
  maxTokens?: number,
): Promise<string> {
  const startedAt = Date.now();
  const result = await callAiVisionRaw(config, base64Image, mediaType, textPrompt, maxTokens);
  if (config.meter) {
    void recordAiUsage(config.meter, config.provider, config.model, result.usage, Date.now() - startedAt);
  }
  return result.content;
}
