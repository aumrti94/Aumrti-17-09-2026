// Azure AI Foundry serves different model families through different API surfaces:
//   • openai         → OpenAI-compatible /openai/v1 (GPT, and open models: Llama, DeepSeek, Mistral, Grok, Cohere…)
//   • anthropic      → /anthropic/v1/messages (Claude — Anthropic Messages shape, NOT OpenAI-compatible)
//   • foundry_models → /models/chat/completions?api-version= (serverless/partner deployments, OpenAI-shaped)
//
// This module is intentionally dependency-free so it is unit-testable in isolation and
// shared by the browser AI path (src/lib/aiProvider.ts). The Deno edge functions
// (supabase/functions/_shared/ai-config.ts) carry a parallel copy of this logic.
export type AzureSurfaceKind = "openai" | "anthropic" | "foundry_models";

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
  const endpoint = (cfg.endpoint || "").replace(/\/$/, "");
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
  const auto = !cfg.surface || cfg.surface === "auto";
  const reasoning = /^(o[0-9]|gpt-5)/i.test(cfg.deployment || "");
  const useResponses = useV1 && (cfg.apiStyle === "responses" || (auto && reasoning));
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
