// Azure AI Foundry serves different model families through different API surfaces:
//   • openai         → OpenAI-compatible /openai/v1 (GPT, and open models: Llama, DeepSeek, Mistral, Grok, Cohere…)
//   • anthropic      → /anthropic/v1/messages (Claude — Anthropic Messages shape, NOT OpenAI-compatible)
//   • foundry_models → /models/chat/completions?api-version= (serverless/partner deployments, OpenAI-shaped)
//
// This module is intentionally dependency-free so it is unit-testable in isolation and
// shared by the browser AI path (src/lib/aiProvider.ts). The Deno edge functions
// (supabase/functions/_shared/ai-config.ts) carry a parallel copy of this logic.
export type AzureSurfaceKind = "openai" | "anthropic" | "foundry_models";

// The DB / platform UI store Azure as "azure_openai", but the server-side resolver maps and
// provider dispatch in supabase/functions/_shared/ai-config.ts are keyed on "azure". That
// divergence silently made resolveAiConfig() return null for Azure (service-key lookup missed →
// API key never loaded → "No AI provider configured" on EVERY feature, Azure only). This is the
// testable twin of the Deno-side `normalizeProviderKey` — keep the two in lockstep.
export function normalizeProviderKey(provider: string | undefined | null): string {
  const p = String(provider || "");
  return p === "azure_openai" ? "azure" : p;
}

// Azure output-token headroom. `max_output_tokens`/`max_tokens` is a CEILING, not a
// reservation — you're billed for tokens actually generated — so a generous cap costs nothing
// for well-behaved models and rescues the two ways Foundry models blow the caller's budget:
//   • reasoning models (gpt-5/o-series) bill HIDDEN reasoning against the same budget →
//     it's consumed before the answer starts → empty output → JSON.parse("") blows up;
//   • verbose/"thinking" models (e.g. Kimi-K2.5) simply run past the cap → TRUNCATED JSON.
// Both were observed live at exactly the caller's cap (1152 and 1200 of 1200). Applied to ALL
// Azure calls, not just name-matched reasoning models — the name pattern was too narrow.
export function azureMaxOutputTokens(requested: number): number {
  return Math.max((Number(requested) || 0) * 4, 4000);
}

// Azure inference endpoints are ALWAYS the resource root (scheme + host) — the inference
// path (/openai/v1/…, /models/…, /anthropic/v1/…) is appended to it. Users frequently paste
// the Foundry *project* endpoint instead:
//   https://<res>.services.ai.azure.com/api/projects/<name>   ← Agents/SDK endpoint, NOT inference
// which would build broken URLs and make every Azure call 404. Normalise to the origin so any
// pasted project/path-suffixed URL still works.
export function normalizeAzureEndpoint(endpoint: string): string {
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
export function resolveAzureSurface(surface: string | undefined, model: string): AzureSurfaceKind {
  if (surface === "openai" || surface === "anthropic" || surface === "foundry_models") return surface;
  return /^claude/i.test(model || "") ? "anthropic" : "openai";
}

export interface AzureUrlConfig {
  endpoint: string;
  deployment: string;
  apiVersion?: string;
  apiStyle?: string; // "chat_completions" | "responses" (openai surface only)
  surface?: string;  // "auto" | AzureSurfaceKind
}

export interface AzureUrlResult {
  url: string;
  surface: AzureSurfaceKind;
  useV1: boolean;       // openai surface, blank api version → /openai/v1
  useResponses: boolean; // openai surface, Responses API
}

// Build the request URL + resolved surface for an Azure Foundry deployment.
export function buildAzureEndpointUrl(cfg: AzureUrlConfig): AzureUrlResult {
  const endpoint = normalizeAzureEndpoint(cfg.endpoint);
  const surface = resolveAzureSurface(cfg.surface, cfg.deployment);
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
  const reasoning = /^(o[0-9]|gpt-5)/i.test(cfg.deployment || "");
  const useResponses = useV1 && (cfg.apiStyle === "responses" || reasoning);
  const url = useResponses
    ? `${endpoint}/openai/v1/responses`
    : useV1
    ? `${endpoint}/openai/v1/chat/completions`
    : `${endpoint}/openai/deployments/${cfg.deployment}/chat/completions?api-version=${cfg.apiVersion}`;
  return { url, surface, useV1, useResponses };
}

export function azureRequestHeaders(surface: AzureSurfaceKind, apiKey: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json", "api-key": apiKey };
  if (surface === "anthropic") {
    h["x-api-key"] = apiKey;
    h["anthropic-version"] = "2023-06-01";
  }
  return h;
}
