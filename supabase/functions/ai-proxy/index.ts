// @ts-nocheck
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  resolveAiConfig,
  resolveAiConfigFromEnv,
  resolveAzureSurface,
  buildAzureUrl,
  azureHeaders,
  normalizeAzureEndpoint,
  azureMaxOutputTokens,
} from "../_shared/ai-config.ts";
import { sanitizeForLog } from "../_shared/phi-redactor.ts";
import { checkAIAllowed } from "../_shared/ai-entitlement.ts";
import { getUsdToInr } from "../_shared/platform-rate.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PROVIDER_TO_SERVICE_KEY: Record<string, string> = {
  claude: "anthropic",
  openai: "openai",
  gemini: "gemini",
  perplexity: "perplexity",
  azure_openai: "azure_openai",
  openrouter: "openrouter",
};

// Azure Responses API returns output as typed items rather than choices[0].message.content.
const extractResponsesOutputText = (data: Record<string, unknown>): string => {
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
};

const ENV_KEY_NAMES: Record<string, string> = {
  claude: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GEMINI_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  azure_openai: "AZURE_OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
};

// USD cost per 1000 tokens (approximate, Claude Sonnet 4 pricing)
const COST_PER_1K: Record<string, { input: number; output: number; cache_write: number; cache_read: number }> = {
  "claude-sonnet-4-6":            { input: 0.003,   output: 0.015,  cache_write: 0.00375, cache_read: 0.0003 },
  "claude-sonnet-4-20250514":     { input: 0.003,   output: 0.015,  cache_write: 0.00375, cache_read: 0.0003 },
  "claude-3-5-sonnet-20241022":   { input: 0.003,   output: 0.015,  cache_write: 0.00375, cache_read: 0.0003 },
  "claude-3-5-haiku-20241022":    { input: 0.0008,  output: 0.004,  cache_write: 0.001,   cache_read: 0.00008 },
  "claude-3-opus-20240229":       { input: 0.015,   output: 0.075,  cache_write: 0.01875, cache_read: 0.0015 },
  "gpt-4o":                       { input: 0.005,   output: 0.015,  cache_write: 0,       cache_read: 0.0025 },
  "gpt-4o-mini":                  { input: 0.00015, output: 0.0006, cache_write: 0,       cache_read: 0.000075 },
  "gemini-2.0-flash":             { input: 0.0001,  output: 0.0004, cache_write: 0,       cache_read: 0 },
};

// Azure Foundry deployment names are arbitrary (e.g. "claude-sonnet-5", "gpt-4o",
// "DeepSeek-V3.2"), so fall back to a family prefix when there's no exact match.
const pricingForModel = (model: string) => {
  if (COST_PER_1K[model]) return COST_PER_1K[model];
  const m = (model || "").toLowerCase();
  const SONNET = { input: 0.003, output: 0.015, cache_write: 0.00375, cache_read: 0.0003 };
  if (m.includes("haiku")) return { input: 0.0008, output: 0.004, cache_write: 0.001, cache_read: 0.00008 };
  if (m.includes("opus")) return { input: 0.015, output: 0.075, cache_write: 0.01875, cache_read: 0.0015 };
  if (m.startsWith("claude") || m.includes("sonnet")) return SONNET;
  if (m.startsWith("gpt-4o-mini") || m.includes("mini")) return COST_PER_1K["gpt-4o-mini"];
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3")) return COST_PER_1K["gpt-4o"];
  if (m.startsWith("gemini")) return COST_PER_1K["gemini-2.0-flash"];
  return SONNET;
};

const estimateCost = (
  model: string,
  tokensInput: number,
  tokensOutput: number,
  cacheCreationTokens: number,
  cacheReadTokens: number,
): number => {
  const pricing = pricingForModel(model);
  return (
    (tokensInput / 1000) * pricing.input +
    (tokensOutput / 1000) * pricing.output +
    (cacheCreationTokens / 1000) * pricing.cache_write +
    (cacheReadTokens / 1000) * pricing.cache_read
  );
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const safeParseJson = async (res: Response, provider: string): Promise<any> => {
    const text = await res.text();
    if (!text) {
      if (!res.ok) return { error: `${provider} error (${res.status} ${res.statusText})` };
      return { error: `${provider} returned an empty response` };
    }
    try {
      return JSON.parse(text);
    } catch {
      if (!res.ok) return { error: `${provider} error (${res.status}): ${text.substring(0, 100)}...` };
      return { error: `${provider} returned malformed JSON: ${text.substring(0, 100)}...` };
    }
  };

  const startTime = Date.now();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const {
      provider, model, prompt, systemPrompt: incomingSystemPrompt, maxTokens, temperature,
      hospitalId, featureKey, patientId, encounterId, attachments: rawAttachments,
      azureConfig, probe, azureAction,
    } = await req.json() as {
      provider: string;
      model: string;
      prompt: string;
      systemPrompt?: string;
      maxTokens?: number;
      temperature?: number;
      hospitalId: string;
      featureKey?: string;
      patientId?: string;
      encounterId?: string;
      attachments?: { kind: "image" | "pdf"; mediaType: string; data: string }[];
      // Admin connection-test only: test UNSAVED Azure drawer values without a DB round-trip.
      // Browser cannot call Azure directly (no CORS), so the platform Test button routes here.
      azureConfig?: { endpoint?: string; apiKey?: string; deployment?: string; apiVersion?: string; apiStyle?: string; surface?: string };
      probe?: boolean; // skip usage logging for a throwaway test call
      azureAction?: string; // "list-deployments" — server-side deployment listing (browser is CORS-blocked)
    };

    // Server-side Azure deployment listing. The browser cannot call Azure directly (no CORS),
    // so the drawer's "Fetch" button routes here. Tries the OpenAI-compatible, Foundry Models,
    // and classic Azure OpenAI listing surfaces and returns the union of deployment names.
    if (azureAction === "list-deployments") {
      const ep = normalizeAzureEndpoint(azureConfig?.endpoint);
      const key = azureConfig?.apiKey || Deno.env.get("AZURE_OPENAI_API_KEY") || "";
      if (!ep || !key) return json({ error: "Endpoint URL and API Key are required to list deployments." }, 400);
      const listFrom = async (url: string): Promise<string[] | null> => {
        try {
          const r = await fetch(url, { headers: { "api-key": key } });
          if (!r.ok) return null;
          const d = await r.json();
          const arr = Array.isArray(d?.data) ? d.data : Array.isArray(d) ? d : [];
          return arr.map((m: Record<string, string>) => m.id || m.name || m.model).filter(Boolean);
        } catch {
          return null;
        }
      };
      const names = new Set<string>();
      for (const url of [
        `${ep}/openai/v1/models`,
        `${ep}/models?api-version=2024-05-01-preview`,
        `${ep}/openai/deployments?api-version=2023-03-15-preview`,
      ]) {
        const got = await listFrom(url);
        if (got) got.forEach((n) => names.add(n));
      }
      return json({ deployments: [...names].sort() });
    }

    // Sanitise attachments: only image/pdf base64 blobs, cap count + size so a
    // malformed payload can't blow past provider limits. Purely additive —
    // when absent, every provider call behaves exactly as before.
    const attachments = Array.isArray(rawAttachments)
      ? rawAttachments
          .filter((a) => a && (a.kind === "image" || a.kind === "pdf") && typeof a.data === "string" && a.data.length > 0)
          .slice(0, 5)
      : [];
    const hasAttachments = attachments.length > 0;

    const adminClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Enforce hospital isolation — a caller may only spend/attribute AI usage against their
    // own hospital's entitlement and wallet, never one named in the request body. Without
    // this, any authenticated user at Hospital A could pass Hospital B's hospitalId and
    // bypass A's restrictions or debit B's ai_wallet. super_admin is exempt (platform ops).
    const { data: callerUser } = await adminClient
      .from("users")
      .select("role, hospital_id")
      .eq("auth_user_id", user.id)
      .maybeSingle();
    if (!callerUser) return json({ error: "Forbidden" }, 403);
    if (callerUser.hospital_id !== hospitalId && callerUser.role !== "super_admin") {
      return json({ error: "Cross-hospital access denied" }, 403);
    }

    // AI entitlement floor — enforce the platform/hospital "AI Features" master switch
    // (and per-feature toggles) HERE, server-side, before any provider call. The browser
    // callAI() gate can be bypassed by invoking edge functions directly, so this is the
    // authoritative check. Fail-open inside checkAIAllowed keeps DB blips non-blocking.
    const gate = await checkAIAllowed(adminClient, hospitalId, featureKey);
    if (!gate.allowed) return json({ error: gate.reason }, 403);

    // Resolve system prompt: registry takes precedence over inline when featureKey matches
    let systemPrompt = incomingSystemPrompt;
    if (featureKey && !systemPrompt) {
      const { data: reg } = await adminClient
        .from("prompt_registry")
        .select("system_prompt")
        .eq("feature_key", featureKey)
        .eq("is_active", true)
        .maybeSingle();
      if (reg?.system_prompt) {
        systemPrompt = reg.system_prompt;
      }
    }

    let resolvedProvider = provider;
    let resolvedModel = model;
    let apiKey: string | undefined;
    let usedPlatformDefault = false;

    if (provider === "auto") {
      // Client has no hospital-specific ai_provider_config row. Re-check server-side
      // (covers stale client cache) then fall back to the platform-default key from
      // Supabase secrets — mirrors the pattern already used by ai-clinical-voice.
      const hospitalCfg = hospitalId && featureKey
        ? await resolveAiConfig(hospitalId, featureKey, maxTokens || 600)
        : null;
      const cfg = hospitalCfg ?? resolveAiConfigFromEnv(maxTokens || 600);

      if (!cfg) {
        return json({
          error: "AI service temporarily unavailable. Configure your own provider key in Settings → API Hub or contact Aumrti support.",
        }, 503);
      }
      resolvedProvider = cfg.provider;
      resolvedModel = cfg.model;
      apiKey = cfg.apiKey;
      usedPlatformDefault = !hospitalCfg;
    } else if (!PROVIDER_TO_SERVICE_KEY[provider] && !ENV_KEY_NAMES[provider]) {
      // An unrecognised provider name would otherwise fall through the API-key resolution
      // below and call `Deno.env.get("")` (ENV_KEY_NAMES[provider] || "") — Deno's env API
      // throws "Key is an empty string" for an empty key, rather than returning undefined,
      // crashing this handler with a 500 before ever reaching the "Unknown provider" check
      // that already existed further down for exactly this case. Found via Phase 6
      // edge-function testing.
      return json({ error: `Unknown provider: ${provider}` }, 400);
    } else {
      // Keys are global (platform-controlled) — not per hospital.
      const serviceKey = PROVIDER_TO_SERVICE_KEY[provider];
      if (serviceKey) {
        const { data } = await adminClient
          .from("platform_ai_keys")
          .select("config")
          .eq("service_key", serviceKey)
          .eq("is_active", true)
          .maybeSingle();
        apiKey = (data?.config as Record<string, string>)?.api_key;
      }

      if (!apiKey) {
        const envKeyName = ENV_KEY_NAMES[provider];
        apiKey = envKeyName ? Deno.env.get(envKeyName) || undefined : undefined;
      }
      // Admin Azure connection test with unsaved drawer values → use the inline key.
      if (!apiKey && provider === "azure_openai" && azureConfig?.apiKey) {
        apiKey = azureConfig.apiKey;
      }
    }

    if (!apiKey) {
      return json({
        error: `No API key configured for ${resolvedProvider}. Add it in Settings → API Hub → ${resolvedProvider.toUpperCase()}.`,
      }, 400);
    }

    const maxTok = maxTokens || 600;
    const temp = temperature ?? 0.3;
    let text = "";
    let tokensInput = 0;
    let tokensOutput = 0;
    let cacheCreationTokens = 0;
    let cacheReadTokens = 0;
    let cacheHit = false;

    if (resolvedProvider === "claude") {
      // Wrap system prompt with cache_control so Anthropic caches it for 5 minutes (ephemeral TTL).
      // This eliminates re-sending the same large system prompt on every call — saves ~40% cost.
      const systemBlock = systemPrompt
        ? [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }]
        : undefined;

      // Multimodal: build content blocks when attachments are present, else a plain string.
      // Claude reads images (jpeg/png/gif/webp) and PDFs (document blocks) natively.
      const claudeContent = hasAttachments
        ? [
            ...attachments.map((a) =>
              a.kind === "pdf"
                ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: a.data } }
                : { type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } }
            ),
            { type: "text", text: prompt },
          ]
        : prompt;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          // pdfs beta enables document blocks; harmless when no PDF is attached.
          "anthropic-beta": hasAttachments ? "prompt-caching-2024-07-31,pdfs-2024-09-25" : "prompt-caching-2024-07-31",
        },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: maxTok,
          temperature: temp,
          ...(systemBlock ? { system: systemBlock } : {}),
          messages: [{ role: "user", content: claudeContent }],
        }),
      });
      const data = await safeParseJson(res, "Claude");
      if (data.error) return json({ error: data.error }, 400);
      text = data.content?.[0]?.text || "";
      tokensInput = data.usage?.input_tokens || 0;
      tokensOutput = data.usage?.output_tokens || 0;
      cacheCreationTokens = data.usage?.cache_creation_input_tokens || 0;
      cacheReadTokens = data.usage?.cache_read_input_tokens || 0;
      cacheHit = cacheReadTokens > 0;

    } else if (resolvedProvider === "openai") {
      // OpenAI chat completions accept images via image_url data-URIs; PDFs are not
      // supported on this surface, so pdf attachments are dropped (engine handles the
      // fallback). No attachments → plain string content, unchanged behaviour.
      const openaiImages = attachments.filter((a) => a.kind === "image");
      const openaiContent = openaiImages.length
        ? [
            { type: "text", text: prompt },
            ...openaiImages.map((a) => ({
              type: "image_url",
              image_url: { url: `data:${a.mediaType};base64,${a.data}` },
            })),
          ]
        : prompt;
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: maxTok,
          temperature: temp,
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: openaiContent },
          ],
        }),
      });
      const data = await safeParseJson(res, "OpenAI");
      if (data.error) return json({ error: data.error }, 400);
      text = data.choices?.[0]?.message?.content || "";
      tokensInput = data.usage?.prompt_tokens || 0;
      tokensOutput = data.usage?.completion_tokens || 0;
      // OpenAI prompt caching is automatic for repeated prompts >1024 tokens
      cacheReadTokens = data.usage?.prompt_tokens_details?.cached_tokens || 0;
      cacheHit = cacheReadTokens > 0;

    } else if (resolvedProvider === "gemini") {
      // v1beta supports thinkingConfig; thinkingBudget:0 disables Gemini "thinking"
      // (otherwise the model is slow and truncates output at MAX_TOKENS).
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${resolvedModel}:generateContent?key=${apiKey}`;
      // Gemini reads both images and PDFs via inline_data parts.
      const geminiParts = hasAttachments
        ? [
            ...attachments.map((a) => ({
              inline_data: { mime_type: a.kind === "pdf" ? "application/pdf" : a.mediaType, data: a.data },
            })),
            { text: prompt },
          ]
        : [{ text: prompt }];
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
          contents: [{ parts: geminiParts }],
          generationConfig: { maxOutputTokens: maxTok, temperature: temp, thinkingConfig: { thinkingBudget: 0 } },
        }),
      });
      if (res.status === 429) return json({ error: "AI quota exceeded — the AI provider key has hit its rate limit / quota. Check provider billing." }, 429);
      const data = await safeParseJson(res, "Gemini");
      if (data.error) return json({ error: data.error }, 400);
      text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
      tokensInput = data.usageMetadata?.promptTokenCount || 0;
      tokensOutput = data.usageMetadata?.candidatesTokenCount || 0;

    } else if (resolvedProvider === "perplexity") {
      const res = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: maxTok,
          messages: [{ role: "user", content: prompt }],
        }),
      });
      const data = await safeParseJson(res, "Perplexity");
      if (data.error) return json({ error: data.error }, 400);
      text = data.choices?.[0]?.message?.content || "";

    } else if (resolvedProvider === "openrouter") {
      // OpenRouter: one key, OpenAI-compatible API, vendor-namespaced models
      // (e.g. google/gemini-2.5-flash, anthropic/claude-3.7-sonnet).
      // OpenRouter is OpenAI-compatible; images ride as image_url data-URIs and are
      // forwarded to whichever underlying model supports them.
      const orImages = attachments.filter((a) => a.kind === "image");
      const orContent = orImages.length
        ? [
            { type: "text", text: prompt },
            ...orImages.map((a) => ({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } })),
          ]
        : prompt;
      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Title": "Aumrti HMS" },
        body: JSON.stringify({
          model: resolvedModel,
          max_tokens: maxTok,
          temperature: temp,
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: orContent },
          ],
        }),
      });
      if (res.status === 429) return json({ error: "AI quota exceeded — the AI provider key has hit its rate limit / quota. Check provider billing." }, 429);
      const data = await safeParseJson(res, "OpenRouter");
      if (data.error) return json({ error: data.error.message || data.error }, 400);
      text = data.choices?.[0]?.message?.content || "";
      tokensInput = data.usage?.prompt_tokens || 0;
      tokensOutput = data.usage?.completion_tokens || 0;

    } else if (resolvedProvider === "azure_openai") {
      // Endpoint / deployment / version / style live in the global platform_ai_keys config —
      // UNLESS this is an admin connection test carrying unsaved inline values.
      let ac: Record<string, string>;
      if (azureConfig?.endpoint || azureConfig?.deployment) {
        ac = {
          endpoint: azureConfig.endpoint || "",
          deployment: azureConfig.deployment || "",
          api_version: azureConfig.apiVersion || "",
          api_style: azureConfig.apiStyle || "",
          azure_surface: azureConfig.surface || "",
        };
      } else {
        const { data: azData } = await adminClient
          .from("platform_ai_keys")
          .select("config")
          .eq("service_key", "azure_openai")
          .eq("is_active", true)
          .maybeSingle();
        ac = (azData?.config as Record<string, string>) || {};
      }
      const endpoint = normalizeAzureEndpoint(ac.endpoint);
      // Per-feature / requested model wins over the drawer's single deployment — otherwise every
      // Azure feature is pinned to one deployment and the platform UI's per-feature Model box
      // does nothing (this also made the Playground REPORT one model while calling another).
      // Falls back to the drawer/inline deployment when no model was requested (e.g. the probe).
      const deployment = resolvedModel || ac.deployment;
      if (!endpoint || !deployment) {
        return json({ error: "Azure OpenAI: set Endpoint URL and Deployment Name at /platform → API Hub." }, 400);
      }
      // Route to the correct Foundry surface: openai (GPT + open models), anthropic
      // (Claude — Messages API), or foundry_models (serverless /models). "auto" picks
      // anthropic for claude* deployments, else openai.
      const { url, surface, useResponses } = buildAzureUrl({
        endpoint, model: deployment, apiVersion: ac.api_version, apiStyle: ac.api_style, surface: ac.azure_surface,
      });
      const headers = azureHeaders(surface, apiKey);
      // GPT-5 / o-series reasoning models reject the `temperature` sampling param on Azure,
      // so omit it for them (Azure uses the model default).
      const azReasoning = /^(o[0-9]|gpt-5)/i.test(deployment);
      // Images: OpenAI/Foundry read image_url content blocks (chat) or input_image parts
      // (responses); Anthropic reads image source blocks. PDFs aren't supported on Azure.
      const azImages = attachments.filter((a) => a.kind === "image");
      let body: Record<string, unknown>;
      if (surface === "anthropic") {
        const anthContent = azImages.length
          ? [
              { type: "text", text: prompt },
              ...azImages.map((a) => ({ type: "image", source: { type: "base64", media_type: a.mediaType, data: a.data } })),
            ]
          : prompt;
        body = {
          model: deployment,
          max_tokens: azureMaxOutputTokens(maxTok),
          temperature: temp,
          ...(systemPrompt ? { system: systemPrompt } : {}),
          messages: [{ role: "user", content: anthContent }],
        };
      } else if (useResponses) {
        const azResponsesInput = azImages.length
          ? [
              {
                role: "user",
                content: [
                  { type: "input_text", text: prompt },
                  ...azImages.map((a) => ({ type: "input_image", image_url: `data:${a.mediaType};base64,${a.data}` })),
                ],
              },
            ]
          : prompt;
        body = {
          model: deployment,
          input: azResponsesInput,
          ...(systemPrompt ? { instructions: systemPrompt } : {}),
          max_output_tokens: azureMaxOutputTokens(maxTok),
          ...(azReasoning ? { reasoning: { effort: "low" } } : { temperature: temp }),
        };
      } else {
        // openai chat (/openai/v1 or classic deployment) or foundry_models (/models) — OpenAI-shaped.
        const azChatContent = azImages.length
          ? [
              { type: "text", text: prompt },
              ...azImages.map((a) => ({ type: "image_url", image_url: { url: `data:${a.mediaType};base64,${a.data}` } })),
            ]
          : prompt;
        const includeModel = surface === "foundry_models" || !ac.api_version; // classic deployment carries model in URL
        body = {
          ...(includeModel ? { model: deployment } : {}),
          messages: [
            ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
            { role: "user", content: azChatContent },
          ],
          max_tokens: azureMaxOutputTokens(maxTok),
          ...(azReasoning ? {} : { temperature: temp }),
        };
      }
      let sentUrl = url;
      let sentBody = body;
      let res = await fetch(sentUrl, {
        method: "POST",
        headers,
        body: JSON.stringify(sentBody),
      });
      let data = await safeParseJson(res, "Azure OpenAI");
      // Safety net: a GPT-5 / o-series reasoning deployment 404s on chat completions ("Resource
      // not found") because it's only served via the Responses API. When the openai chat path
      // 404s (blank api-version), retry once via /openai/v1/responses so unknown-named reasoning
      // models work without the user flipping API Style. The smart-Auto heuristic covers the
      // common gpt-5*/o-series cases up front; this catches the rest.
      let effUseResponses = useResponses;
      if (res.status === 404 && surface === "openai" && !useResponses && !ac.api_version) {
        effUseResponses = true;
        const azImages2 = attachments.filter((a) => a.kind === "image");
        const respInput = azImages2.length
          ? [{
              role: "user",
              content: [
                { type: "input_text", text: prompt },
                ...azImages2.map((a) => ({ type: "input_image", image_url: `data:${a.mediaType};base64,${a.data}` })),
              ],
            }]
          : prompt;
        const respBody = {
          model: deployment,
          input: respInput,
          ...(systemPrompt ? { instructions: systemPrompt } : {}),
          max_output_tokens: azureMaxOutputTokens(maxTok),
          ...(azReasoning ? { reasoning: { effort: "low" } } : { temperature: temp }),
        };
        sentUrl = `${endpoint}/openai/v1/responses`;
        sentBody = respBody;
        res = await fetch(sentUrl, { method: "POST", headers, body: JSON.stringify(sentBody) });
        data = await safeParseJson(res, "Azure OpenAI");
      }
      // Safety net for unsupported sampling params: some models reject `temperature` (reasoning
      // models do). If that's the error and we still sent it, strip temperature and retry once.
      if (data.error && (sentBody as any).temperature !== undefined &&
          /unsupported parameter|not supported with this model|'temperature'/i.test(JSON.stringify(data.error))) {
        delete (sentBody as any).temperature;
        res = await fetch(sentUrl, { method: "POST", headers, body: JSON.stringify(sentBody) });
        data = await safeParseJson(res, "Azure OpenAI");
      }
      if (data.error) return json({ error: data.error.message || data.error }, 400);
      if (surface === "anthropic") {
        const blocks = Array.isArray(data.content) ? data.content : [];
        text = blocks.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("");
        tokensInput = data.usage?.input_tokens ?? 0;
        tokensOutput = data.usage?.output_tokens ?? 0;
        cacheReadTokens = data.usage?.cache_read_input_tokens ?? 0;
        cacheCreationTokens = data.usage?.cache_creation_input_tokens ?? 0;
      } else {
        text = effUseResponses ? extractResponsesOutputText(data) : (data.choices?.[0]?.message?.content || "");
        tokensInput = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0;
        tokensOutput = data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0;
      }

    } else {
      return json({ error: `Unknown provider: ${resolvedProvider}` }, 400);
    }

    const latencyMs = Date.now() - startTime;
    const costUsd = estimateCost(resolvedModel, tokensInput, tokensOutput, cacheCreationTokens, cacheReadTokens);
    const fKey = featureKey || "global_default";

    // Fire-and-forget: log to ai_usage_logs and roll up ai_cost_daily.
    // Skip for a throwaway admin connection test (probe) — no real usage to bill.
    if (!probe) (async () => {
      try {
        // Freeze the rupee cost at the current FX rate — everything humans see
        // and the wallet draw-down use INR, not USD.
        const costInr = costUsd * (await getUsdToInr(adminClient));

        await adminClient.from("ai_usage_logs").insert({
          hospital_id: hospitalId,
          feature_key: fKey,
          provider: resolvedProvider,
          model_name: resolvedModel,
          tokens_input: tokensInput,
          tokens_output: tokensOutput,
          cache_creation_tokens: cacheCreationTokens,
          cache_read_tokens: cacheReadTokens,
          cache_hit: cacheHit,
          estimated_cost_usd: costUsd,
          estimated_cost_inr: costInr,
          latency_ms: latencyMs,
          success: true,
          patient_id: patientId || null,
          encounter_id: encounterId || null,
          used_platform_default: usedPlatformDefault,
        });

        await adminClient.rpc("upsert_ai_cost_daily", {
          p_hospital_id:       hospitalId,
          p_date:              new Date().toISOString().split("T")[0],
          p_feature_key:       fKey,
          p_provider:          resolvedProvider,
          p_tokens_input:      tokensInput,
          p_tokens_output:     tokensOutput,
          p_cache_read_tokens: cacheReadTokens,
          p_cache_hit:         cacheHit,
          p_cost_usd:          costUsd,
          p_cost_inr:          costInr,
        });

        // Draw the overage above the plan's included allowance from the wallet.
        await adminClient.rpc("debit_ai_wallet_for_usage", {
          p_hospital_id: hospitalId,
          p_feature_key: fKey,
          p_cost_inr:    costInr,
        });
      } catch (logErr) {
        console.warn("ai-proxy: failed to log usage:", logErr instanceof Error ? logErr.message : String(logErr));
      }
    })();

    return json({
      text,
      tokens_used: tokensInput + tokensOutput,
      cache_hit: cacheHit,
      cache_read_tokens: cacheReadTokens,
      estimated_cost_usd: costUsd,
    });

  } catch (err) {
    // Sanitize before logging in case error text contains prompt fragments with PHI
    console.error("ai-proxy error:", sanitizeForLog(err instanceof Error ? err.message : String(err)));
    return json({ error: err instanceof Error ? err.message : "Unknown error" }, 500);
  }
});
