import React, { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  FEATURE_LABELS,
  PROVIDER_MODELS,
  KNOWN_SERVICES,
  PROVIDER_TO_SERVICE_KEY,
  getProviderLabel,
  getMergedModels,
  getCustomModels,
  saveCustomModels,
  extractResponsesOutputText,
} from "@/lib/aiProvider";
import {
  Loader2, Check, X, Play, Eye, EyeOff, ExternalLink, FlaskConical, Save, Plus, Trash2, RefreshCw,
} from "lucide-react";

const PROVIDERS = [
  { value: "claude",        label: "🤖 Claude (Anthropic)" },
  { value: "openai",        label: "💡 GPT-4 (OpenAI)" },
  { value: "azure_openai",  label: "🇮🇳 Azure OpenAI (India Central — DPDP)" },
  { value: "gemini",        label: "✨ Gemini (Google)" },
  { value: "perplexity",    label: "🔍 Perplexity AI" },
  { value: "openrouter",    label: "🌐 OpenRouter (Gemini/Claude/GPT/…)" },
  { value: "ollama",        label: "🦙 Ollama (Local)" },
];

// This platform page only manages GLOBAL AI + voice provider keys. Per-hospital
// integration keys (razorpay, wati, abdm, nic_irp, pmjay) stay in hospital Settings.
const AI_VOICE_SERVICE_KEYS = ["anthropic", "openai", "azure_openai", "gemini", "perplexity", "openrouter", "sarvam", "bhashini"];

interface AIConfig {
  id: string;
  feature_key: string;
  provider: string;
  model_name: string;
  api_key_ref: string | null;
  temperature: number;
  max_tokens: number;
  is_active: boolean;
}

interface APIKeyConfig {
  id: string;
  service_name: string;
  service_key: string;
  config: Record<string, string>;
  is_active: boolean;
  last_tested_at: string | null;
  test_status: string | null;
  test_message: string | null;
}

const PlatformAIConfigPage: React.FC = () => {
  const { toast } = useToast();
  const [aiConfigs, setAiConfigs] = useState<AIConfig[]>([]);
  const [apiKeys, setApiKeys] = useState<APIKeyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [voiceEngine, setVoiceEngine] = useState<string>("sarvam");
  const [usageLogs, setUsageLogs] = useState<{ feature_key: string; calls: number; tokens: number; errors: number; last_used: string }[]>([]);

  // API Key drawer
  const [editingKey, setEditingKey] = useState<typeof KNOWN_SERVICES[0] | null>(null);
  const [keyForm, setKeyForm] = useState({ api_key: "", endpoint: "", mode: "production", deployment: "", api_version: "", api_style: "chat_completions" });
  const [showSecret, setShowSecret] = useState(false);
  const [customModelInput, setCustomModelInput] = useState("");
  const [modelRefreshKey, setModelRefreshKey] = useState(0);
  const [azureModels, setAzureModels] = useState<string[]>([]);
  const [fetchingAzureModels, setFetchingAzureModels] = useState(false);
  const [azureModelsError, setAzureModelsError] = useState<string | null>(null);

  // Playground
  const [playFeature, setPlayFeature] = useState("voice_scribe");
  const [playPrompt, setPlayPrompt] = useState("Hello, summarize the following: Patient complains of headache for 2 days.");
  const [playResult, setPlayResult] = useState<{ text: string; provider: string; model: string; tokens?: number; ms?: number } | null>(null);
  const [playRunning, setPlayRunning] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (pendingAutoRun.current && !playRunning) {
      pendingAutoRun.current = false;
      setTimeout(() => runPlayground(), 200);
    }
  }, [playFeature]);

  // Load the global voice engine preference
  useEffect(() => {
    supabase
      .from("platform_ai_keys")
      .select("config")
      .eq("service_key", "voice_asr_engine")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.config) {
          setVoiceEngine((data.config as Record<string, string>).engine || "sarvam");
        }
      });
  }, []);

  const saveVoiceEngine = async (engine: string) => {
    setVoiceEngine(engine);
    const existing = apiKeys.find(k => k.service_key === "voice_asr_engine");
    const payload = {
      service_name: "Voice ASR Engine",
      service_key: "voice_asr_engine",
      config: { engine },
      is_active: true,
    };
    if (existing) {
      await supabase.from("platform_ai_keys").update(payload).eq("id", existing.id);
    } else {
      await supabase.from("platform_ai_keys").insert(payload);
    }
    const engineLabel = engine === "sarvam" ? "Sarvam Saaras" : engine === "bhashini" ? "Bhashini (MeitY)" : "Web Speech API";
    toast({ title: `✓ Voice engine set to ${engineLabel}` });
    await loadData();
  };

  const loadData = async () => {
    setLoading(true);
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    // Global AI config + keys; usage aggregated across ALL hospitals (admin RLS).
    const [aiRes, apiRes, logsRes] = await Promise.all([
      supabase.from("platform_ai_provider_config").select("*"),
      supabase.from("platform_ai_keys").select("*"),
      supabase.from("ai_usage_logs").select("feature_key, tokens_input, tokens_output, success, created_at").gte("created_at", sevenDaysAgo.toISOString()),
    ]);
    if (aiRes.data) setAiConfigs(aiRes.data as unknown as AIConfig[]);
    if (apiRes.data) setApiKeys(apiRes.data as unknown as APIKeyConfig[]);

    const agg = new Map<string, { calls: number; tokens: number; errors: number; last_used: string }>();
    for (const log of (logsRes.data || []) as Record<string, unknown>[]) {
      const fk = (log.feature_key as string) || "global_default";
      if (!agg.has(fk)) agg.set(fk, { calls: 0, tokens: 0, errors: 0, last_used: (log.created_at as string) || "" });
      const entry = agg.get(fk)!;
      entry.calls++;
      entry.tokens += ((log.tokens_input as number) || 0) + ((log.tokens_output as number) || 0);
      if (!log.success) entry.errors++;
      if (log.created_at && (log.created_at as string) > entry.last_used) entry.last_used = log.created_at as string;
    }
    setUsageLogs(Array.from(agg.entries()).map(([feature_key, v]) => ({ feature_key, ...v })).sort((a, b) => b.calls - a.calls));
    setLoading(false);
  };

  const globalConfig = useMemo(() => aiConfigs.find(c => c.feature_key === "global_default"), [aiConfigs]);
  const featureConfigs = useMemo(() => aiConfigs.filter(c => c.feature_key !== "global_default"), [aiConfigs]);

  const updateAIConfig = async (featureKey: string, updates: Partial<AIConfig>) => {
    setSaving(featureKey);
    const existing = aiConfigs.find(c => c.feature_key === featureKey);
    if (existing) {
      const { error } = await supabase
        .from("platform_ai_provider_config")
        .update(updates)
        .eq("id", existing.id);
      if (error) {
        toast({ title: "Failed to save AI config", description: error.message, variant: "destructive" });
      } else {
        toast({ title: `✓ ${FEATURE_LABELS[featureKey] || featureKey} config saved` });
        setAiConfigs(prev => prev.map(c => c.id === existing.id ? { ...c, ...updates } as AIConfig : c));
      }
    } else {
      const insertPayload = {
          feature_key: featureKey,
          provider: (updates as AIConfig).provider || "claude",
          model_name: (updates as AIConfig).model_name || "claude-sonnet-4-6",
          ...updates,
        };
      const { data, error } = await supabase
        .from("platform_ai_provider_config")
        .insert(insertPayload)
        .select()
        .maybeSingle();
      if (error) {
        toast({ title: "Failed to create AI config", description: error.message, variant: "destructive" });
      } else if (data) {
        setAiConfigs(prev => [...prev, data as unknown as AIConfig]);
        toast({ title: `✓ ${FEATURE_LABELS[featureKey] || featureKey} config created` });
      }
    }
    setSaving(null);
  };

  const getApiKeyForService = (serviceKey: string) => apiKeys.find(k => k.service_key === serviceKey);

  const saveApiKey = async () => {
    if (!editingKey) return;
    setSaving(editingKey.service_key);
    const existing = getApiKeyForService(editingKey.service_key);
    const config: Record<string, string> = {
      api_key: keyForm.api_key,
      endpoint: keyForm.endpoint || editingKey.endpoint,
      mode: keyForm.mode,
    };
    if (editingKey.service_key === "azure_openai") {
      config.deployment = keyForm.deployment;
      config.api_version = keyForm.api_version; // optional — blank uses the newer /openai/v1 surface
      config.api_style = keyForm.api_style; // "chat_completions" (default, works for any model) or "responses"
    }
    const payload = {
      service_name: editingKey.service_name,
      service_key: editingKey.service_key,
      config,
      is_active: true,
    };

    if (existing) {
      const { error } = await supabase.from("platform_ai_keys").update(payload).eq("id", existing.id);
      if (error) {
        toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      } else {
        toast({ title: `✓ ${editingKey.service_name} key saved` });
      }
    } else {
      const { error } = await supabase.from("platform_ai_keys").insert(payload);
      if (error) {
        toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      } else {
        toast({ title: `✓ ${editingKey.service_name} key added` });
      }
    }
    await loadData();
    setEditingKey(null);
    setSaving(null);
  };

  const playgroundRef = React.useRef<HTMLDivElement>(null);
  const pendingAutoRun = React.useRef(false);

  const testApiKey = async (serviceKey: string, overrideConfig?: Record<string, string>) => {
    setTesting(serviceKey);
    const existing = getApiKeyForService(serviceKey);
    // Prefer the live (possibly unsaved) drawer form values over the stale DB-saved config.
    const cfg = overrideConfig || (existing?.config as Record<string, string> | undefined);
    if (!cfg) { setTesting(null); return; }
    const apiKey = cfg.api_key;
    if (!apiKey) { setTesting(null); return; }

    let success = false;
    let message = "";
    const start = Date.now();

    try {
      if (serviceKey === "gemini") {
        // Use v1 (stable) endpoint with gemini-2.0-flash for connection testing.
        // gemini-1.5-flash was moved out of v1beta; preview models still use v1beta.
        const res = await fetch(`https://generativelanguage.googleapis.com/v1/models/gemini-2.0-flash:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: "Hi" }] }], generationConfig: { maxOutputTokens: 1 } }),
        });
        success = res.ok;
        if (!success) { const d = await res.json(); message = d.error?.message || `HTTP ${res.status}`; }
      } else if (serviceKey === "openai") {
        const res = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        success = res.ok;
        if (!success) { const d = await res.json(); message = d.error?.message || `HTTP ${res.status}`; }
      } else if (serviceKey === "anthropic") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model: "claude-3-5-haiku-20241022", max_tokens: 1, messages: [{ role: "user", content: "Hi" }] }),
        });
        success = res.ok;
        if (!success) { const d = await res.json(); message = d.error?.message || `HTTP ${res.status}`; }
      } else if (serviceKey === "azure_openai") {
        const endpoint = cfg.endpoint?.replace(/\/$/, "");
        const deployment = cfg.deployment;
        const apiVersion = cfg.api_version || undefined;
        if (!endpoint || !deployment) {
          success = false;
          message = !endpoint ? "Endpoint URL is required" : "Deployment Name is required";
        } else {
          const useV1 = !apiVersion;
          const useResponses = useV1 && cfg.api_style === "responses";
          const url = useResponses
            ? `${endpoint}/openai/v1/responses`
            : useV1
            ? `${endpoint}/openai/v1/chat/completions`
            : `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`;
          const body = useResponses
            ? { model: deployment, input: "Hi", max_output_tokens: 1 }
            : { ...(useV1 ? { model: deployment } : {}), messages: [{ role: "user", content: "Hi" }], max_tokens: 1 };
          const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": apiKey },
            body: JSON.stringify(body),
          });
          success = res.ok;
          if (!success) { const d = await res.json(); message = d.error?.message || `HTTP ${res.status}`; }
        }
      } else if (serviceKey === "perplexity") {
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "llama-3.1-sonar-small-128k-online", max_tokens: 1, messages: [{ role: "user", content: "Hi" }] }),
        });
        success = res.ok;
        if (!success) { const d = await res.json(); message = d.error?.message || `HTTP ${res.status}`; }
      } else if (serviceKey === "openrouter") {
        // OpenRouter is OpenAI-compatible; listing models is a cheap auth check.
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        success = res.ok;
        if (!success) { const d = await res.json().catch(() => ({})); message = d.error?.message || `HTTP ${res.status}`; }
      } else {
        // Non-AI services: just mark configured
        success = !!apiKey;
        message = success ? "Key is set" : "No key";
      }
    } catch (err) {
      success = false;
      message = err instanceof Error ? err.message : "Connection failed";
    }

    const ms = Date.now() - start;
    const now = new Date().toISOString();
    if (existing) {
      await supabase.from("platform_ai_keys").update({
        last_tested_at: now,
        test_status: success ? "success" : "failed",
        test_message: success ? `Connected — response in ${ms}ms` : message,
      }).eq("id", existing.id);
      await loadData();
    }

    setTesting(null);
    toast({
      title: success ? "✓ Connection successful" : "✗ Connection failed",
      description: success ? `Verified in ${ms}ms` : message,
      variant: success ? "default" : "destructive",
    });
  };

  const fetchAzureModels = async () => {
    const endpoint = keyForm.endpoint?.replace(/\/$/, "");
    const apiKey = keyForm.api_key;
    if (!endpoint || !apiKey) {
      toast({ title: "Enter API Key and Endpoint first", variant: "destructive" });
      return;
    }
    setFetchingAzureModels(true);
    setAzureModelsError(null);
    try {
      const res = await fetch(`${endpoint}/openai/v1/models`, {
        headers: { "api-key": apiKey },
      });
      if (!res.ok) {
        setAzureModels([]);
        setAzureModelsError("Couldn't list models automatically (this endpoint may not support model listing). Enter the deployment name manually.");
        return;
      }
      const data = await res.json();
      const ids: string[] = Array.isArray(data?.data) ? data.data.map((m: { id: string }) => m.id).filter(Boolean) : [];
      setAzureModels(ids);
      if (ids.length === 0) {
        setAzureModelsError("No deployments found at this endpoint — type the deployment name manually.");
      }
    } catch {
      setAzureModels([]);
      setAzureModelsError("Couldn't list models automatically (this endpoint may not support model listing). Enter the deployment name manually.");
    } finally {
      setFetchingAzureModels(false);
    }
  };

  const runPlayground = async () => {
    setPlayRunning(true);
    setPlayResult(null);
    const start = Date.now();

    try {
      // Resolve global AI config: feature-specific first, then global_default
      let config: any = null;
      const { data: fc } = await supabase
        .from("platform_ai_provider_config").select("*")
        .eq("feature_key", playFeature).eq("is_active", true).maybeSingle();
      config = fc;
      if (!config) {
        const { data: dc } = await supabase
          .from("platform_ai_provider_config").select("*")
          .eq("feature_key", "global_default").eq("is_active", true).maybeSingle();
        config = dc;
      }

      if (!config) {
        setPlayResult({ text: "No AI provider configured. Set a Global Default above.", provider: "none", model: "none", ms: Date.now() - start });
        return;
      }

      const { provider, model_name, temperature, max_tokens } = config;
      const serviceKey = PROVIDER_TO_SERVICE_KEY[provider] || provider;

      // Fetch API key from the global platform_ai_keys (admin-only — OK here for the admin playground)
      const { data: apiCfg } = await supabase
        .from("platform_ai_keys").select("config")
        .eq("service_key", serviceKey).eq("is_active", true).maybeSingle();
      const apiKey = (apiCfg?.config as Record<string, string>)?.api_key;

      if (!apiKey) {
        setPlayResult({ text: `No API key for ${provider}. Add it in External API Keys below.`, provider, model: model_name, ms: Date.now() - start });
        return;
      }

      const maxTok = Number(max_tokens) || 600;
      const temp = Number(temperature) || 0.3;
      let text = "";
      let tokens_used: number | undefined;

      if (provider === "gemini") {
        // v1beta + thinkingBudget:0 keeps Gemini 2.5/3 fast (no hidden "thinking" / MAX_TOKENS truncation).
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model_name}:generateContent?key=${apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: playPrompt }] }], generationConfig: { maxOutputTokens: maxTok, temperature: temp, thinkingConfig: { thinkingBudget: 0 } } }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
        tokens_used = data.usageMetadata?.totalTokenCount;

      } else if (provider === "openai") {
        const res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: model_name, max_tokens: maxTok, temperature: temp, messages: [{ role: "user", content: playPrompt }] }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        text = data.choices?.[0]?.message?.content || "";
        tokens_used = data.usage?.total_tokens;

      } else if (provider === "claude") {
        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
          body: JSON.stringify({ model: model_name, max_tokens: maxTok, temperature: temp, messages: [{ role: "user", content: playPrompt }] }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        text = data.content?.[0]?.text || "";
        tokens_used = (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0);

      } else if (provider === "perplexity") {
        const res = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: model_name, max_tokens: maxTok, messages: [{ role: "user", content: playPrompt }] }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        text = data.choices?.[0]?.message?.content || "";

      } else if (provider === "openrouter") {
        const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}`, "X-Title": "Aumrti HMS" },
          body: JSON.stringify({ model: model_name, max_tokens: maxTok, temperature: temp, messages: [{ role: "user", content: playPrompt }] }),
        });
        const data = await res.json();
        if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
        text = data.choices?.[0]?.message?.content || "";
        tokens_used = data.usage?.total_tokens;

      } else if (provider === "azure_openai") {
        const azureCfg = (await supabase
          .from("platform_ai_keys").select("config")
          .eq("service_key", "azure_openai").eq("is_active", true).maybeSingle()).data;
        const ac = azureCfg?.config as Record<string, string> | undefined;
        if (!ac?.endpoint || !ac?.deployment) {
          text = "Azure OpenAI: set Endpoint URL and Deployment Name in API Hub first.";
        } else {
          const azureEndpoint = ac.endpoint.replace(/\/$/, "");
          const useV1 = !ac.api_version;
          const useResponses = useV1 && ac.api_style === "responses";
          const azureUrl = useResponses
            ? `${azureEndpoint}/openai/v1/responses`
            : useV1
            ? `${azureEndpoint}/openai/v1/chat/completions`
            : `${azureEndpoint}/openai/deployments/${ac.deployment}/chat/completions?api-version=${ac.api_version}`;
          const azureBody = useResponses
            ? { model: ac.deployment, input: playPrompt, max_output_tokens: maxTok, temperature: temp }
            : { ...(useV1 ? { model: ac.deployment } : {}), messages: [{ role: "user", content: playPrompt }], max_tokens: maxTok, temperature: temp };
          const res = await fetch(azureUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json", "api-key": apiKey },
            body: JSON.stringify(azureBody),
          });
          const data = await res.json();
          if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
          text = useResponses ? extractResponsesOutputText(data) : (data.choices?.[0]?.message?.content || "");
          tokens_used = useResponses
            ? (data.usage?.total_tokens ?? (data.usage?.input_tokens || 0) + (data.usage?.output_tokens || 0))
            : data.usage?.total_tokens;
        }
      } else {
        text = `Direct browser calls not supported for provider: ${provider}. Deploy the ai-proxy edge function.`;
      }

      setPlayResult({ text, provider, model: model_name, tokens: tokens_used, ms: Date.now() - start });
    } catch (err: any) {
      setPlayResult({ text: err?.message || "Unknown error", provider: "unknown", model: "unknown", ms: Date.now() - start });
    } finally {
      setPlayRunning(false);
    }

  };

  const getStatusBadge = (svc: typeof KNOWN_SERVICES[0]) => {
    const existing = getApiKeyForService(svc.service_key);
    if (!existing) return <Badge variant="outline" className="text-muted-foreground gap-1"><span className="w-2 h-2 rounded-full bg-muted-foreground/40 inline-block" /> Not set</Badge>;
    const mode = (existing.config as Record<string, string>)?.mode;
    if (existing.test_status === "success") {
      return <Badge className="bg-emerald-100 text-emerald-700 gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Live</Badge>;
    }
    if (mode === "sandbox" || mode === "test") {
      return <Badge className="bg-amber-100 text-amber-700 gap-1"><span className="w-2 h-2 rounded-full bg-amber-500 inline-block" /> Test</Badge>;
    }
    return <Badge className="bg-blue-100 text-blue-700 gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Configured</Badge>;
  };

  const maskKey = (key?: string) => {
    if (!key) return "—";
    if (key.length <= 8) return "••••••••";
    return key.substring(0, Math.min(12, key.length - 8)) + "••••••••";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="animate-spin text-muted-foreground" size={24} />
      </div>
    );
  }

  return (
    <div className="p-6 overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-foreground">AI Configuration</h1>
        <p className="text-sm text-muted-foreground">Global AI provider, model and key settings applied to every hospital</p>
      </div>
      <div className="max-w-[960px] space-y-8">

        {/* ── SECTION 0: AI USAGE STATS ── */}
        <section>
          <h2 className="text-lg font-bold text-foreground mb-1">AI Usage — Last 7 Days</h2>
          <p className="text-sm text-muted-foreground mb-4">Live usage across all AI features, all hospitals</p>
          {usageLogs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No AI calls recorded in the last 7 days</p>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Feature</th>
                    <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Calls</th>
                    <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Tokens</th>
                    <th className="px-4 py-2.5 text-center font-medium text-xs text-muted-foreground">Errors</th>
                    <th className="px-4 py-2.5 text-left font-medium text-xs text-muted-foreground">Last Used</th>
                  </tr>
                </thead>
                <tbody>
                  {usageLogs.map(row => (
                    <tr key={row.feature_key} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium">{FEATURE_LABELS[row.feature_key] || row.feature_key}</td>
                      <td className="px-4 py-2.5 text-center">{row.calls}</td>
                      <td className="px-4 py-2.5 text-center">{row.tokens.toLocaleString("en-IN")}</td>
                      <td className="px-4 py-2.5 text-center">
                        {row.errors > 0
                          ? <Badge variant="destructive" className="text-xs">{row.errors}</Badge>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-xs">
                        {row.last_used ? new Date(row.last_used).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Separator />

        {/* ── SECTION 1: AI PROVIDERS ── */}
        <section>
          <h2 className="text-lg font-bold text-foreground mb-1">AI Provider Configuration</h2>
          <p className="text-sm text-muted-foreground mb-5">Choose which AI model powers each HMS feature</p>

          {/* Global Default */}
          <div className="bg-primary/5 border-2 border-primary rounded-xl p-5 mb-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-lg">🌐</span>
              <span className="font-bold text-sm text-foreground">Global Default</span>
              <span className="text-xs text-muted-foreground">— Used for all features unless overridden below</span>
            </div>
            <div className="grid grid-cols-5 gap-3 items-end">
              <div>
                <Label className="text-xs">Provider</Label>
                <Select
                  value={globalConfig?.provider || "claude"}
                  onValueChange={v => {
                    const models = getMergedModels(v);
                    const serviceKey = PROVIDER_TO_SERVICE_KEY[v] || null;
                    updateAIConfig("global_default", { provider: v, model_name: models?.[0]?.value || "", api_key_ref: serviceKey });
                  }}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Model{globalConfig?.provider === "azure_openai" ? " / Deployment" : ""}</Label>
                {globalConfig?.provider === "azure_openai" ? (
                  <div>
                    <Input
                      className="mt-1 text-xs"
                      value={globalConfig?.model_name || ""}
                      onChange={e => updateAIConfig("global_default", { model_name: e.target.value })}
                      placeholder="Deployment name (e.g. gpt-4o)"
                    />
                    <p className="text-[10px] text-muted-foreground mt-0.5">Must match deployment name in Azure AI Foundry</p>
                  </div>
                ) : (
                  <Select
                    value={globalConfig?.model_name || ""}
                    onValueChange={v => updateAIConfig("global_default", { model_name: v })}
                  >
                    <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getMergedModels(globalConfig?.provider || "claude").map(m => (
                        <SelectItem key={m.value} value={m.value}>{m.label}{m.isCustom ? " ★" : ""}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <div>
                <Label className="text-xs">API Key Source</Label>
                <Select
                  value={globalConfig?.api_key_ref || "env"}
                  onValueChange={v => updateAIConfig("global_default", { api_key_ref: v === "env" ? null : v })}
                >
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="env">Environment Variable</SelectItem>
                    {KNOWN_SERVICES.filter(s => ["anthropic", "openai", "azure_openai", "gemini", "perplexity", "openrouter"].includes(s.service_key)).map(s => (
                      <SelectItem key={s.service_key} value={s.service_key}>{s.emoji} {s.service_name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Temperature</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="2"
                  className="mt-1"
                  value={globalConfig?.temperature ?? 0.3}
                  onChange={e => updateAIConfig("global_default", { temperature: parseFloat(e.target.value) || 0.3 })}
                />
              </div>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={saving === "global_default"}
                onClick={() => updateAIConfig("global_default", {})}
              >
                {saving === "global_default" ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </Button>
            </div>
          </div>

          {/* Feature overrides table */}
          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Feature</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Provider</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Model</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Override</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(FEATURE_LABELS).filter(([k]) => k !== "global_default").map(([key, label]) => {
                  const config = featureConfigs.find(c => c.feature_key === key);
                  const isOverride = config?.is_active && config?.provider !== globalConfig?.provider;
                  return (
                    <tr key={key} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium text-foreground">{label}</td>
                      <td className="px-4 py-2.5">
                        <Select
                          value={config?.provider || globalConfig?.provider || "claude"}
                          onValueChange={v => {
                            const models = getMergedModels(v);
                            const serviceKey = PROVIDER_TO_SERVICE_KEY[v] || null;
                            updateAIConfig(key, { provider: v, model_name: models?.[0]?.value || "", is_active: true, api_key_ref: serviceKey });
                          }}
                        >
                          <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PROVIDERS.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-4 py-2.5">
                        {(config?.provider || globalConfig?.provider) === "azure_openai" ? (
                          <Input
                            className="h-8 text-xs w-[200px]"
                            value={config?.model_name || globalConfig?.model_name || ""}
                            onChange={e => updateAIConfig(key, { model_name: e.target.value })}
                            placeholder="Deployment name"
                          />
                        ) : (
                          <Select
                            value={config?.model_name || globalConfig?.model_name || ""}
                            onValueChange={v => updateAIConfig(key, { model_name: v })}
                          >
                            <SelectTrigger className="h-8 text-xs w-[200px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {getMergedModels(config?.provider || globalConfig?.provider || "claude").map(m => (
                                <SelectItem key={m.value} value={m.value}>{m.label}{m.isCustom ? " ★" : ""}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={!!isOverride}
                            onCheckedChange={checked => {
                              if (!checked && globalConfig) {
                                updateAIConfig(key, { provider: globalConfig.provider, model_name: globalConfig.model_name });
                              }
                            }}
                          />
                          <span className="text-xs text-muted-foreground">{isOverride ? "Custom" : "Default"}</span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          disabled={testing === key}
                          onClick={() => {
                            setPlayFeature(key);
                            setPlayPrompt("Hello, this is a test message. Respond with: Test successful.");
                            pendingAutoRun.current = true;
                            setTimeout(() => {
                              playgroundRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                            }, 100);
                          }}
                        >
                          <FlaskConical size={12} /> Test
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <Separator />

        {/* ── SECTION 1.5: VOICE ASR ENGINE ── */}
        <section>
          <h2 className="text-lg font-bold text-foreground mb-1">Voice ASR Engine</h2>
          <p className="text-sm text-muted-foreground mb-5">
            Choose which speech-to-text engine powers Voice Scribe for Indian languages
          </p>

          <div className="grid grid-cols-3 gap-4">
            {[
              {
                key: "sarvam",
                name: "Sarvam Saaras",
                emoji: "🎙️",
                desc: "Best medical vocabulary accuracy. 8 Indian languages. Paid API.",
                languages: "Hindi, Telugu, Tamil, Kannada, Malayalam, Marathi, Bengali, Gujarati",
                requiresKey: true,
                badge: "Recommended",
                badgeColor: "bg-blue-100 text-blue-700",
              },
              {
                key: "bhashini",
                name: "Bhashini (MeitY)",
                emoji: "🇮🇳",
                desc: "Government of India free ASR. 22 scheduled languages. ULCA pipeline.",
                languages: "All 22 scheduled languages including Odia, Punjabi, Assamese, Urdu, Sanskrit",
                requiresKey: true,
                badge: "Free",
                badgeColor: "bg-emerald-100 text-emerald-700",
              },
              {
                key: "web_speech",
                name: "Web Speech API",
                emoji: "🌐",
                desc: "Browser built-in. English only. No API key needed. Works offline.",
                languages: "English (en-IN)",
                requiresKey: false,
                badge: "Built-in",
                badgeColor: "bg-muted text-muted-foreground",
              },
            ].map((engine) => {
              const isSelected = (voiceEngine || "sarvam") === engine.key;
              const hasKey = engine.key === "web_speech" || !!getApiKeyForService(engine.key);
              return (
                <div
                  key={engine.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    if (engine.requiresKey && !hasKey) {
                      toast({ title: `Configure ${engine.name} API key first`, description: "Add the key in External API Keys below", variant: "destructive" });
                      return;
                    }
                    saveVoiceEngine(engine.key);
                  }}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") e.currentTarget.click(); }}
                  className={cn(
                    "relative border-2 rounded-xl p-5 cursor-pointer transition-all hover:shadow-md",
                    isSelected ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
                  )}
                >
                  {isSelected && (
                    <div className="absolute top-3 right-3">
                      <div className="bg-primary text-primary-foreground rounded-full p-0.5">
                        <Check size={12} />
                      </div>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{engine.emoji}</span>
                    <span className="font-bold text-sm text-foreground">{engine.name}</span>
                    <Badge className={cn("text-[10px]", engine.badgeColor)}>{engine.badge}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{engine.desc}</p>
                  <p className="text-[10px] text-muted-foreground">
                    <span className="font-medium">Languages:</span> {engine.languages}
                  </p>
                  {engine.requiresKey && !hasKey && (
                    <p className="text-[10px] text-amber-600 mt-2">⚠ API key required — configure below</p>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        <Separator />
        <section>
          <h2 className="text-lg font-bold text-foreground mb-1">External API Keys</h2>
          <p className="text-sm text-muted-foreground mb-5">All third-party integrations managed in one place</p>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/50 text-left">
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Service</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Status</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Key</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Endpoint</th>
                  <th className="px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
                </tr>
              </thead>
              <tbody>
                {KNOWN_SERVICES.filter(svc => AI_VOICE_SERVICE_KEYS.includes(svc.service_key)).map(svc => {
                  const existing = getApiKeyForService(svc.service_key);
                  return (
                    <tr key={svc.service_key} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium text-foreground">
                        <span className="mr-1.5">{svc.emoji}</span>{svc.service_name}
                      </td>
                      <td className="px-4 py-2.5">{getStatusBadge(svc)}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
                        {maskKey((existing?.config as Record<string, string>)?.api_key)}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-muted-foreground">{svc.endpoint}</td>
                      <td className="px-4 py-2.5 flex gap-1">
                        {existing && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1 text-xs"
                            disabled={testing === svc.service_key}
                            onClick={() => testApiKey(svc.service_key)}
                          >
                            {testing === svc.service_key ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
                            Test
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="gap-1 text-xs"
                          onClick={() => {
                            setEditingKey(svc);
                            const ex = getApiKeyForService(svc.service_key);
                            const cfg = (ex?.config as Record<string, string>) || {};
                            setKeyForm({
                              api_key: cfg.api_key || "",
                              endpoint: cfg.endpoint || svc.endpoint,
                              mode: cfg.mode || "production",
                              deployment: cfg.deployment || "",
                              api_version: cfg.api_version || "",
                              api_style: cfg.api_style || "chat_completions",
                            });
                            setShowSecret(false);
                            setAzureModels([]);
                            setAzureModelsError(null);
                          }}
                        >
                          {existing ? "Edit" : <><Plus size={12} /> Add</>}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <Separator />

        {/* ── SECTION 4: DEVELOPER TOOLS ── */}
        <section ref={playgroundRef}>
          <h2 className="text-sm font-bold text-foreground mb-3">Developer Tools — AI Playground</h2>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <Label className="text-xs">Feature Key</Label>
              <Select value={playFeature} onValueChange={setPlayFeature}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(FEATURE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Resolved Provider</Label>
              <Input
                className="mt-1"
                readOnly
                value={(() => {
                  const fc = aiConfigs.find(c => c.feature_key === playFeature);
                  return fc ? `${getProviderLabel(fc.provider)} / ${fc.model_name}` : "Using global default";
                })()}
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">Prompt</Label>
            <Textarea
              className="mt-1 font-mono text-xs min-h-[100px]"
              value={playPrompt}
              onChange={e => setPlayPrompt(e.target.value)}
            />
          </div>
          <Button
            size="sm"
            className="mt-3 gap-1.5"
            disabled={playRunning}
            onClick={runPlayground}
          >
            {playRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Run
          </Button>

          {playResult && (
            <div className="mt-3 bg-slate-900 text-white rounded-lg p-4 font-mono text-xs">
              <pre className="whitespace-pre-wrap mb-3">{playResult.text}</pre>
              <Separator className="bg-slate-700 my-2" />
              <p className="text-slate-400 text-[11px]">
                Provider: {playResult.provider} · Model: {playResult.model}
                {playResult.tokens ? ` · Tokens: ${playResult.tokens}` : ""}
                {playResult.ms ? ` · ${playResult.ms}ms` : ""}
              </p>
            </div>
          )}
        </section>
      </div>

      {/* ── API KEY DRAWER ── */}
      <Sheet open={!!editingKey} onOpenChange={() => setEditingKey(null)}>
        <SheetContent className="w-[400px]">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              {editingKey && <span>{editingKey.emoji}</span>}
              {editingKey?.service_name}
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-4 mt-6">
            <div>
              <Label>API Key</Label>
              <div className="relative mt-1">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={keyForm.api_key}
                  onChange={e => setKeyForm(p => ({ ...p, api_key: e.target.value }))}
                  placeholder="Enter API key..."
                  className="pr-10"
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                  onClick={() => setShowSecret(!showSecret)}
                >
                  {showSecret ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>
            <div>
              <Label>Endpoint URL</Label>
              <Input
                className="mt-1"
                value={keyForm.endpoint}
                onChange={e => setKeyForm(p => ({ ...p, endpoint: e.target.value }))}
                placeholder={editingKey?.service_key === "azure_openai" ? "https://YOUR-RESOURCE.openai.azure.com/" : ""}
              />
            </div>

            {editingKey?.service_key === "azure_openai" && (
              <>
                <div>
                  <Label>Deployment Name</Label>
                  <div className="flex gap-2 mt-1">
                    <Input
                      className="flex-1"
                      list="azure-deployment-models"
                      value={keyForm.deployment}
                      onChange={e => setKeyForm(p => ({ ...p, deployment: e.target.value }))}
                      placeholder="e.g. gpt-4o, Llama-3.3-70B-Instruct, Mistral-Large-2411"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1 shrink-0"
                      disabled={!keyForm.api_key || !keyForm.endpoint || fetchingAzureModels}
                      onClick={fetchAzureModels}
                    >
                      {fetchingAzureModels ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                      Fetch
                    </Button>
                  </div>
                  <datalist id="azure-deployment-models">
                    {azureModels.map(id => <option key={id} value={id} />)}
                  </datalist>
                  {azureModelsError && (
                    <p className="text-[11px] text-amber-600 mt-1">{azureModelsError}</p>
                  )}
                  <p className="text-[11px] text-muted-foreground mt-1">
                    The deployment name you created in Azure AI Foundry / Azure OpenAI Studio. Works with any model in the catalog (GPT, Llama, Mistral, DeepSeek, Cohere, etc.) — click Fetch to list deployments at this endpoint, or type the name directly.
                  </p>
                </div>
                <div>
                  <Label>API Version <span className="text-muted-foreground font-normal">(optional)</span></Label>
                  <Input
                    className="mt-1"
                    list="azure-api-versions"
                    value={keyForm.api_version}
                    onChange={e => setKeyForm(p => ({ ...p, api_version: e.target.value, ...(e.target.value ? { api_style: "chat_completions" } : {}) }))}
                    placeholder="Leave blank to use the latest /openai/v1 API"
                  />
                  <datalist id="azure-api-versions">
                    <option value="2024-02-01" />
                    <option value="2024-05-01-preview" />
                    <option value="2024-08-01-preview" />
                    <option value="2024-10-01-preview" />
                    <option value="2025-01-01-preview" />
                    <option value="2025-03-01-preview" />
                    <option value="2025-04-01-preview" />
                  </datalist>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Leave blank to call the new /openai/v1 surface (no version pinning needed). Set a version only if you need the classic dated GA/preview API.
                  </p>
                </div>
                <div>
                  <Label>API Style <span className="text-muted-foreground font-normal">(advanced)</span></Label>
                  <div className="flex gap-3 mt-1">
                    {[{ v: "chat_completions", l: "Chat Completions (default)" }, { v: "responses", l: "Responses API" }].map(o => (
                      <label key={o.v} className={cn("flex items-center gap-1.5 text-sm", o.v === "responses" && !!keyForm.api_version ? "opacity-40 cursor-not-allowed" : "cursor-pointer")}>
                        <input
                          type="radio"
                          name="api_style"
                          checked={keyForm.api_style === o.v}
                          disabled={o.v === "responses" && !!keyForm.api_version}
                          onChange={() => setKeyForm(p => ({ ...p, api_style: o.v }))}
                          className="accent-primary"
                        />
                        {o.l}
                      </label>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Chat Completions works with every model in the catalog (GPT, Llama, Mistral, DeepSeek, Cohere). Responses API is OpenAI-only (GPT/o-series) and requires API Version to be blank.
                  </p>
                </div>
              </>
            )}
            <div>
              <Label>Mode</Label>
              <div className="flex gap-3 mt-1">
                {["sandbox", "production"].map(m => (
                  <label key={m} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input
                      type="radio"
                      name="mode"
                      checked={keyForm.mode === m}
                      onChange={() => setKeyForm(p => ({ ...p, mode: m }))}
                      className="accent-primary"
                    />
                    {m === "sandbox" ? "Sandbox / Test" : "Production / Live"}
                  </label>
                ))}
              </div>
            </div>

            {editingKey?.service_key === "razorpay" && (
              <div>
                <Label>Key Secret</Label>
                <Input className="mt-1" type="password" placeholder="Razorpay key secret..." />
              </div>
            )}
            {editingKey?.service_key === "wati" && (
              <div>
                <Label>Phone Number</Label>
                <Input className="mt-1" placeholder="+91..." />
              </div>
            )}
            {editingKey?.service_key === "bhashini" && (
              <div className="space-y-3">
                <div>
                  <Label>User ID (from bhashini.gov.in)</Label>
                  <Input
                    className="mt-1"
                    placeholder="Bhashini User ID"
                    value={(keyForm as Record<string, string>).user_id || ""}
                    onChange={e => setKeyForm(p => ({ ...p, user_id: e.target.value }))}
                  />
                </div>
                <p className="text-[10px] text-muted-foreground">
                  Get free credentials at{" "}
                  <a href="https://bhashini.gov.in" target="_blank" rel="noopener noreferrer" className="underline text-primary">
                    bhashini.gov.in
                  </a>
                </p>
              </div>
            )}
            {editingKey?.service_key === "nic_irp" && (
              <>
                <div><Label>Username</Label><Input className="mt-1" placeholder="NIC IRP username" /></div>
                <div><Label>Password</Label><Input className="mt-1" type="password" placeholder="NIC IRP password" /></div>
              </>
            )}

            {/* Custom Model Management — only for LLM providers */}
            {editingKey && ["anthropic", "openai", "gemini", "perplexity", "openrouter"].includes(editingKey.service_key) && (() => {
              const providerKey = Object.entries(PROVIDER_TO_SERVICE_KEY).find(([, sk]) => sk === editingKey.service_key)?.[0] || editingKey.service_key;
              const allModels = getMergedModels(providerKey);
              const customModels = getCustomModels(providerKey);
              return (
                <div className="space-y-2">
                  <Separator />
                  <Label className="text-xs font-bold uppercase text-muted-foreground">Models</Label>
                  <div className="space-y-1 max-h-[180px] overflow-y-auto">
                    {allModels.map(m => (
                      <div key={m.value} className="flex items-center justify-between bg-muted/50 rounded px-2.5 py-1.5 text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <code className="font-mono text-foreground truncate">{m.value}</code>
                          {m.isCustom && <Badge variant="outline" className="text-[9px] px-1 py-0">Custom</Badge>}
                        </div>
                        {m.isCustom && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                            onClick={() => {
                              const updated = customModels.filter(cm => cm.value !== m.value);
                              saveCustomModels(providerKey, updated);
                              setModelRefreshKey(k => k + 1);
                              toast({ title: `Removed model: ${m.value}` });
                            }}
                          >
                            <Trash2 size={12} />
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      className="text-xs font-mono h-8 flex-1"
                      placeholder="e.g. gemini-3-flash-preview"
                      value={customModelInput}
                      onChange={e => setCustomModelInput(e.target.value)}
                      onKeyDown={e => {
                        if (e.key === "Enter" && customModelInput.trim()) {
                          const val = customModelInput.trim();
                          if (allModels.some(m => m.value === val)) {
                            toast({ title: "Model already exists", variant: "destructive" });
                            return;
                          }
                          saveCustomModels(providerKey, [...customModels, { label: val, value: val }]);
                          setCustomModelInput("");
                          setModelRefreshKey(k => k + 1);
                          toast({ title: `Added model: ${val}` });
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 gap-1 text-xs"
                      disabled={!customModelInput.trim()}
                      onClick={() => {
                        const val = customModelInput.trim();
                        if (!val) return;
                        if (allModels.some(m => m.value === val)) {
                          toast({ title: "Model already exists", variant: "destructive" });
                          return;
                        }
                        saveCustomModels(providerKey, [...customModels, { label: val, value: val }]);
                        setCustomModelInput("");
                        setModelRefreshKey(k => k + 1);
                        toast({ title: `Added model: ${val}` });
                      }}
                    >
                      <Plus size={12} /> Add
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">Add custom model codes. They'll appear in model dropdowns marked with ★</p>
                </div>
              );
            })()}

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="gap-1"
                disabled={!keyForm.api_key || testing === editingKey?.service_key}
                onClick={() => editingKey && testApiKey(editingKey.service_key, keyForm)}
              >
                {testing === editingKey?.service_key ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
                Test Connection
              </Button>
              <Button
                className="gap-1 flex-1"
                disabled={!keyForm.api_key || saving === editingKey?.service_key}
                onClick={saveApiKey}
              >
                {saving === editingKey?.service_key ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default PlatformAIConfigPage;
