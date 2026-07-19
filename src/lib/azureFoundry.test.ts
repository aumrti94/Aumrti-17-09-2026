import { describe, it, expect } from "vitest";
import { resolveAzureSurface, buildAzureEndpointUrl, azureRequestHeaders } from "./azureFoundry";

const EP = "https://aumrtifoundry.services.ai.azure.com";

describe("resolveAzureSurface", () => {
  it("honours an explicit surface", () => {
    expect(resolveAzureSurface("anthropic", "gpt-4o")).toBe("anthropic");
    expect(resolveAzureSurface("foundry_models", "claude-sonnet-5")).toBe("foundry_models");
    expect(resolveAzureSurface("openai", "claude-opus-4-8")).toBe("openai");
  });
  it("auto-detects Claude deployments as the Anthropic surface", () => {
    expect(resolveAzureSurface("auto", "claude-sonnet-5")).toBe("anthropic");
    expect(resolveAzureSurface(undefined, "Claude-Opus-4-8")).toBe("anthropic");
  });
  it("auto-defaults everything else to the OpenAI-compatible surface", () => {
    expect(resolveAzureSurface("auto", "gpt-4o")).toBe("openai");
    expect(resolveAzureSurface(undefined, "DeepSeek-V3.2")).toBe("openai");
    expect(resolveAzureSurface("", "Llama-3.3-70B-Instruct")).toBe("openai");
  });
});

describe("buildAzureEndpointUrl", () => {
  it("openai surface, blank api version → /openai/v1/chat/completions (covers GPT + open models)", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "DeepSeek-V3.2" });
    expect(r.surface).toBe("openai");
    expect(r.url).toBe(`${EP}/openai/v1/chat/completions`);
    expect(r.useV1).toBe(true);
    expect(r.useResponses).toBe(false);
  });

  it("openai surface, Responses API when apiStyle=responses and no version", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "gpt-5.6-sol", apiStyle: "responses" });
    expect(r.url).toBe(`${EP}/openai/v1/responses`);
    expect(r.useResponses).toBe(true);
  });

  it("openai surface, pinned api version → classic deployment URL (no Responses)", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "gpt-4o", apiVersion: "2024-10-01-preview", apiStyle: "responses" });
    expect(r.url).toBe(`${EP}/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-01-preview`);
    expect(r.useV1).toBe(false);
    expect(r.useResponses).toBe(false);
  });

  it("anthropic surface (auto from claude*) → /anthropic/v1/messages", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "claude-sonnet-5" });
    expect(r.surface).toBe("anthropic");
    expect(r.url).toBe(`${EP}/anthropic/v1/messages`);
  });

  it("foundry_models surface → /models/chat/completions with default api-version", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "Mistral-Large-3", surface: "foundry_models" });
    expect(r.url).toBe(`${EP}/models/chat/completions?api-version=2025-03-01-preview`);
  });

  it("foundry_models surface honours an explicit api-version", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "Cohere-command", surface: "foundry_models", apiVersion: "2024-05-01-preview" });
    expect(r.url).toBe(`${EP}/models/chat/completions?api-version=2024-05-01-preview`);
  });

  it("strips a trailing slash from the endpoint", () => {
    const r = buildAzureEndpointUrl({ endpoint: `${EP}/`, deployment: "gpt-4o" });
    expect(r.url).toBe(`${EP}/openai/v1/chat/completions`);
  });
});

describe("buildAzureEndpointUrl — smart Auto for reasoning models", () => {
  it("auto-routes GPT-5 deployments to the Responses API (chat-completions 404s for them)", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "gpt-5.1" }); // surface undefined = auto
    expect(r.surface).toBe("openai");
    expect(r.url).toBe(`${EP}/openai/v1/responses`);
    expect(r.useResponses).toBe(true);
  });

  it("auto-routes o-series deployments to the Responses API", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "o3-mini", surface: "auto" });
    expect(r.url).toBe(`${EP}/openai/v1/responses`);
    expect(r.useResponses).toBe(true);
  });

  it("keeps non-reasoning deployments (gpt-4o) on chat completions under auto", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "gpt-4o", surface: "auto" });
    expect(r.url).toBe(`${EP}/openai/v1/chat/completions`);
    expect(r.useResponses).toBe(false);
  });

  it("respects an EXPLICIT openai surface for a reasoning model (no auto override)", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "gpt-5.1", surface: "openai" });
    expect(r.url).toBe(`${EP}/openai/v1/chat/completions`);
    expect(r.useResponses).toBe(false);
  });

  it("does not force Responses when a reasoning model has a pinned api-version (classic path)", () => {
    const r = buildAzureEndpointUrl({ endpoint: EP, deployment: "gpt-5.1", apiVersion: "2024-10-01-preview" });
    expect(r.url).toBe(`${EP}/openai/deployments/gpt-5.1/chat/completions?api-version=2024-10-01-preview`);
    expect(r.useResponses).toBe(false);
  });
});

describe("azureRequestHeaders", () => {
  it("adds anthropic-version + x-api-key for the anthropic surface", () => {
    const h = azureRequestHeaders("anthropic", "secret");
    expect(h["api-key"]).toBe("secret");
    expect(h["x-api-key"]).toBe("secret");
    expect(h["anthropic-version"]).toBe("2023-06-01");
  });
  it("uses only api-key for the openai / foundry_models surfaces", () => {
    for (const s of ["openai", "foundry_models"] as const) {
      const h = azureRequestHeaders(s, "secret");
      expect(h["api-key"]).toBe("secret");
      expect(h["x-api-key"]).toBeUndefined();
      expect(h["anthropic-version"]).toBeUndefined();
    }
  });
});
