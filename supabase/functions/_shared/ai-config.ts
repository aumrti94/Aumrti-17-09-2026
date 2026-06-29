// @ts-nocheck
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const PROVIDER_SERVICE_KEYS: Record<string, string> = {
  claude: "anthropic",
  openai: "openai",
  gemini: "gemini",
  perplexity: "perplexity",
  azure: "azure_openai",
  openrouter: "openrouter",
};

const PROVIDER_ENV_KEYS: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  azure: "AZURE_OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

const DEFAULT_MODELS: Record<string, string> = {
  claude: "claude-sonnet-4-6",
  openai: "gpt-4o",
  gemini: "gemini-2.0-flash",
  perplexity: "llama-3.1-sonar-large-128k-online",
  azure: "gpt-4o",
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
  _hospitalId: string,
  featureKey: string,
  defaultMaxTokens = 1000,
): Promise<AiConfig | null> {
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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

  // Get API key (and extra fields) from the global platform_ai_keys
  const serviceKey = PROVIDER_SERVICE_KEYS[cfg.provider as string];
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
  if (cfg.provider === "azure") {
    const azApiKey = keyCfgData?.api_key || Deno.env.get("AZURE_OPENAI_API_KEY") || undefined;
    if (!azApiKey) return null;
    return {
      provider: "azure",
      model: keyCfgData?.deployment_name || keyCfgData?.deployment || (cfg.model_name as string) || DEFAULT_MODELS.azure,
      apiKey: azApiKey,
      endpoint: keyCfgData?.endpoint || Deno.env.get("AZURE_OPENAI_ENDPOINT") || undefined,
      apiVersion: keyCfgData?.api_version || Deno.env.get("AZURE_OPENAI_API_VERSION") || undefined,
      apiStyle: (keyCfgData?.api_style as AiConfig["apiStyle"]) || undefined,
      temperature: Number(cfg.temperature) || 0.3,
      maxTokens: Number(cfg.max_tokens) || defaultMaxTokens,
    };
  }

  let apiKey: string | undefined = keyCfgData?.api_key;

  // Env var fallback
  if (!apiKey) {
    const envKey = PROVIDER_ENV_KEYS[cfg.provider as string];
    apiKey = envKey ? (Deno.env.get(envKey) || undefined) : undefined;
  }

  if (!apiKey) return null;

  return {
    provider: cfg.provider as string,
    model: (cfg.model_name as string) || DEFAULT_MODELS[cfg.provider as string] || "gpt-4o",
    apiKey,
    temperature: Number(cfg.temperature) || 0.3,
    maxTokens: Number(cfg.max_tokens) || defaultMaxTokens,
  };
}

/**
 * Resolve AI config from env vars only (no hospitalId required).
 * Tries providers in order: openai → claude → gemini.
 */
export function resolveAiConfigFromEnv(defaultMaxTokens = 1000): AiConfig | null {
  const priorities = [
    { provider: "openai",     envKey: "OPENAI_API_KEY",     model: DEFAULT_MODELS.openai },
    { provider: "claude",     envKey: "ANTHROPIC_API_KEY",  model: DEFAULT_MODELS.claude },
    { provider: "gemini",     envKey: "GEMINI_API_KEY",     model: DEFAULT_MODELS.gemini },
    { provider: "perplexity", envKey: "PERPLEXITY_API_KEY", model: DEFAULT_MODELS.perplexity },
  ];
  for (const { provider, envKey, model } of priorities) {
    const apiKey = Deno.env.get(envKey);
    if (apiKey) return { provider, model, apiKey, temperature: 0.3, maxTokens: defaultMaxTokens };
  }
  return null;
}

/**
 * Call the configured AI provider with chat messages. Returns the response text.
 */
export async function callAiChat(
  config: AiConfig,
  messages: ChatMessage[],
  maxTokens?: number,
  temperature?: number,
): Promise<string> {
  const maxTok = maxTokens ?? config.maxTokens;
  const temp = temperature ?? config.temperature;

  if (config.provider === "azure") {
    const endpoint = config.endpoint?.replace(/\/$/, "");
    if (!endpoint) throw new Error("Azure OpenAI endpoint not configured");
    // With an API version: classic GA surface (deployment in the URL). Responses API only
    // exists on the newer /openai/v1 surface, so it requires apiVersion to be blank.
    const useV1 = !config.apiVersion;
    const useResponses = useV1 && config.apiStyle === "responses";
    const url = useResponses
      ? `${endpoint}/openai/v1/responses`
      : useV1
      ? `${endpoint}/openai/v1/chat/completions`
      : `${endpoint}/openai/deployments/${config.model}/chat/completions?api-version=${config.apiVersion}`;
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMsgs = messages.filter((m) => m.role !== "system");
    const body = useResponses
      ? {
          model: config.model,
          input: chatMsgs.map((m) => ({ role: m.role, content: m.content })),
          ...(systemMsg ? { instructions: systemMsg.content } : {}),
          max_output_tokens: maxTok,
          temperature: temp,
        }
      : {
          ...(useV1 ? { model: config.model } : {}),
          max_tokens: maxTok,
          temperature: temp,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        };
    const res = await fetch(url, {
      method: "POST",
      headers: { "api-key": config.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Azure OpenAI error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return useResponses ? extractResponsesOutputText(data) : (data.choices?.[0]?.message?.content || "");
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
    return data.content?.[0]?.text || "";
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
    return data.choices?.[0]?.message?.content || "";
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
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
    return data.choices?.[0]?.message?.content || "";
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
    return data.choices?.[0]?.message?.content || "";
  }

  throw new Error(`Unsupported AI provider: ${config.provider}`);
}

/**
 * Call the configured AI provider with a vision (image + text) input.
 * Supports openai, gemini, and claude providers.
 */
export async function callAiVision(
  config: AiConfig,
  base64Image: string,
  mediaType: string,
  textPrompt: string,
  maxTokens?: number,
): Promise<string> {
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
    return data.choices?.[0]?.message?.content || "";
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
    return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
    return data.content?.[0]?.text || "";
  }

  throw new Error(`Provider ${config.provider} does not support vision input`);
}
