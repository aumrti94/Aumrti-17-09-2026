import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  Code2, Plus, Copy, Trash2, Loader2, CheckCircle2, Webhook, AlertTriangle, ShieldAlert,
  RefreshCw, RotateCcw, Activity, ChevronDown, ChevronRight, Lock, ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  API_SCOPES, SCOPE_DESCRIPTIONS, PHI_SCOPES, WEBHOOK_EVENT_GROUPS,
  generateApiKey, sha256hex, keyPrefix, environmentOf, apiBaseUrl, isGatewayLive,
  type ApiEnvironment, type ApiScope,
} from "@/lib/apiPlatform";

const DEFAULT_SCOPES: ApiScope[] = ["read:patients", "read:appointments"];

export default function SettingsAPIPortalPage() {
  // userId here is public.users.id — set by HospitalContext from users.select("id, …"). That is
  // the value api_keys.created_by references. It is NOT the auth.users id; see createKey below.
  const { hospitalId, userId } = useHospitalId();
  const { toast } = useToast();
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeyForms, setShowKeyForms] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<ApiScope[]>(DEFAULT_SCOPES);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newWebhook, setNewWebhook] = useState({ url: "", event: "scheduling.appointment.booked" });
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  // Which environment a new credential points at. A hospital stuck in sandbox takes payments
  // that never settle; one accidentally in production issues real tax documents while testing.
  // Neither is discoverable after the fact unless the key itself records which it is.
  const [credentialMode, setCredentialMode] = useState<ApiEnvironment>("sandbox");

  // The raw secret, held in state only long enough to show it once. It is never written to the
  // database, never re-fetchable, and is dropped when this dialog closes.
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  // Same show-once treatment as an API key: rotating replaces the value the partner verifies
  // signatures with, and there is no second chance to read it.
  const [rotatedSecret, setRotatedSecret] = useState<string | null>(null);

  // Delivery log, loaded per endpoint on expand rather than for every endpoint up front — a busy
  // hospital accumulates thousands of attempts and almost none of them are being looked at.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Record<string, any[]>>({});
  const [loadingLog, setLoadingLog] = useState(false);
  const [replaying, setReplaying] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ total: number; failed: number } | null>(null);
  const [entitled, setEntitled] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [keysRes, whRes, planRes, usageRes] = await Promise.all([
      (supabase as any).from("api_keys")
        .select("id, key_name, key_prefix, scopes, environment, created_at, last_used_at, is_active, revoked_reason")
        .eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      (supabase as any).from("webhook_endpoints").select("*")
        .eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      (supabase as any).from("hospital_subscriptions")
        .select("plan_id, status, subscription_plans(api_access, webhooks_enabled)")
        .eq("hospital_id", hospitalId).in("status", ["active", "trialing"]).maybeSingle(),
      // Last 24h, matching what an integrator is usually debugging.
      (supabase as any).from("api_request_log")
        .select("status_code")
        .eq("hospital_id", hospitalId)
        .gte("created_at", new Date(Date.now() - 86_400_000).toISOString())
        .limit(5000),
    ]);

    setApiKeys(keysRes.data || []);
    setWebhooks(whRes.data || []);

    // A missing subscription row is treated as not entitled rather than as an error, matching
    // the gateway. Null stays null so the UI can distinguish "still loading" from "no".
    setEntitled(Boolean(planRes.data?.subscription_plans?.api_access));

    const rows = usageRes.data || [];
    setUsage({
      total: rows.length,
      failed: rows.filter((r: any) => r.status_code >= 400).length,
    });
    setLoading(false);
  }, [hospitalId]);

  const loadDeliveries = useCallback(async (endpointId: string, force = false) => {
    // An empty array is a legitimate cached result ("no deliveries yet"), so the cache check has
    // to be for presence of the key, not truthiness of the value — and a refetch after a replay
    // must be able to override it outright.
    if (!force && endpointId in deliveries) return;
    setLoadingLog(true);
    const { data } = await (supabase as any).from("webhook_deliveries")
      .select("id, attempt, status, response_status, duration_ms, error_message, created_at, delivered_at")
      .eq("endpoint_id", endpointId)
      .order("created_at", { ascending: false })
      .limit(25);
    setDeliveries(prev => ({ ...prev, [endpointId]: data || [] }));
    setLoadingLog(false);
  }, [deliveries]);

  const toggleLog = (endpointId: string) => {
    const next = expanded === endpointId ? null : endpointId;
    setExpanded(next);
    if (next) loadDeliveries(next);
  };

  const replay = async (deliveryId: string, endpointId: string) => {
    setReplaying(deliveryId);
    // Via RPC, not a direct write: webhook_deliveries is read-only to the tenant so the log
    // cannot be edited to hide a failed delivery.
    const { error } = await (supabase as any).rpc("replay_webhook_delivery", { p_delivery_id: deliveryId });
    setReplaying(null);
    if (error) {
      toast({ title: "Could not replay", description: error.message, variant: "destructive" });
      return;
    }
    await loadDeliveries(endpointId, true);
    toast({ title: "Redelivery queued", description: "It will be sent within a minute." });
  };

  const rotateSecret = async (endpointId: string) => {
    const secret = "whsec_" + generateApiKey("sandbox").split("_").pop();
    const { error } = await (supabase as any).from("webhook_endpoints")
      .update({ secret }).eq("id", endpointId);
    if (error) {
      toast({ title: "Could not rotate secret", description: error.message, variant: "destructive" });
      return;
    }
    setRotatedSecret(secret);
    load();
  };

  const toggleEndpoint = async (endpointId: string, active: boolean) => {
    const { error } = await (supabase as any).from("webhook_endpoints")
      .update(active
        ? { is_active: true, failure_count: 0, disabled_reason: null, disabled_at: null }
        : { is_active: false, disabled_reason: "Disabled by an administrator.", disabled_at: new Date().toISOString() })
      .eq("id", endpointId);
    if (error) {
      toast({ title: "Could not update endpoint", description: error.message, variant: "destructive" });
      return;
    }
    load();
    toast({ title: active ? "Endpoint re-enabled" : "Endpoint disabled" });
  };

  useEffect(() => { load(); }, [load]);

  const createKey = async () => {
    if (!hospitalId || !newKeyName.trim()) return;
    setGenerating(true);

    // The raw key exists in this function and in the show-once dialog. What goes to the database
    // is the SHA-256 digest — this page used to insert the secret itself into `key_hash`, where
    // tenant RLS made every hospital's live integration keys readable to any logged-in user.
    const raw = generateApiKey(credentialMode);
    const hash = await sha256hex(raw);

    const { error } = await (supabase as any).from("api_keys").insert({
      hospital_id: hospitalId,
      key_name: newKeyName.trim(),
      key_hash: hash,
      key_prefix: keyPrefix(credentialMode),
      scopes: selectedScopes,
      environment: credentialMode,
      // api_keys.created_by references public.users(id). This used to pass
      // supabase.auth.getUser().id — the auth.users id, which this schema stores separately as
      // users.auth_user_id — so every create failed on api_keys_created_by_fkey.
      //
      // The column is nullable, so a missing userId sends null rather than a wrong id: an
      // unattributed key is recoverable, a key attributed to the wrong person is not.
      created_by: userId ?? null,
      is_active: true,
    });
    setGenerating(false);

    if (error) {
      toast({ title: "Could not create API key", description: error.message, variant: "destructive" });
      return;
    }
    setShowKeyForms(false);
    setNewKeyName("");
    setSelectedScopes(DEFAULT_SCOPES);
    setCredentialMode("sandbox");
    setIssuedKey(raw);
    load();
  };

  const revokeKey = async (id: string) => {
    const { error } = await (supabase as any).from("api_keys")
      .update({ is_active: false, revoked_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      toast({ title: "Could not revoke key", description: error.message, variant: "destructive" });
      return;
    }
    load();
    toast({ title: "API key revoked" });
  };

  const addWebhook = async () => {
    if (!hospitalId || !newWebhook.url) return;

    // Webhook payloads carry patient and billing events. Over plain http they are readable
    // by anyone on the path between the HMS and the partner system.
    const url = newWebhook.url.trim();
    if (!/^https:\/\//i.test(url)) {
      toast({
        title: "Endpoint URL must use https://",
        description: "Webhook payloads carry patient and billing events — http would send them in the clear.",
        variant: "destructive",
      });
      return;
    }

    // The signing secret never leaves the server side in a real design, but the endpoint needs one
    // at registration. Generated with the same CSPRNG path as an API key rather than Math.random.
    const secret = "whsec_" + generateApiKey("sandbox").split("_").pop();

    const { error } = await (supabase as any).from("webhook_endpoints").insert({
      hospital_id: hospitalId,
      url,
      events: [newWebhook.event],
      is_active: true,
      secret,
    });
    if (error) {
      toast({ title: "Could not register webhook", description: error.message, variant: "destructive" });
      return;
    }
    setShowWebhookForm(false);
    setNewWebhook({ url: "", event: "scheduling.appointment.booked" });
    load();
    toast({ title: "Webhook endpoint registered" });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied to clipboard" });
  };

  const gatewayLive = isGatewayLive();
  const baseUrl = apiBaseUrl();

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">API Portal</h1>
          <Badge variant="outline" className="text-[10px] ml-1">v1</Badge>
        </div>
        {/* Only rendered once the gateway is live. The previous link pointed at docs.aumrti.com,
            which does not exist; this one resolves to the spec generated from the route registry,
            so it cannot describe an endpoint that is not actually served. */}
        {gatewayLive && (
          <a href={`${baseUrl}/openapi.json`} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-[12px] text-primary hover:underline">
            API Reference (OpenAPI) <ExternalLink size={11} />
          </a>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* API Base URL */}
        <div className="bg-muted/30 border border-border rounded-xl p-4">
          <p className="text-[14px] font-semibold text-foreground mb-2">Base URL</p>
          <code className="text-[12px] text-primary font-mono bg-muted px-3 py-1.5 rounded-lg block break-all">
            {baseUrl}
          </code>
          <p className="text-[12px] text-muted-foreground mt-2">
            All requests must include <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;api-key&gt;</code> header.
          </p>
          {/* Entitlement is enforced by the gateway too — a gate only in the UI is not a gate.
              Shown here so an admin learns it before wiring an integration, not from a 403. */}
          {entitled === false && (
            <div className="flex items-start gap-2 mt-3 bg-muted border border-border rounded-lg p-2.5">
              <Lock size={14} className="text-muted-foreground mt-0.5 flex-shrink-0" />
              <p className="text-[12px] text-muted-foreground">
                API access is not included in this hospital's plan. Keys created here will be
                refused by the gateway until it is enabled — speak to your Aumrti account manager.
              </p>
            </div>
          )}
          {usage && usage.total > 0 && (
            <div className="flex items-center gap-4 mt-3 text-[12px] text-muted-foreground">
              <span className="flex items-center gap-1"><Activity size={12} />{usage.total} requests in the last 24h</span>
              {usage.failed > 0 && (
                <span className="text-amber-700">{usage.failed} returned an error</span>
              )}
            </div>
          )}
          {!gatewayLive && (
            /* Saying nothing here would leave an integrator building against a URL that answers
               nothing. Keys can be issued and managed now; the endpoints arrive with API v1. */
            <div className="flex items-start gap-2 mt-3 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
              <AlertTriangle size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
              <p className="text-[12px] text-amber-800">
                The API gateway is not serving requests yet. Keys issued here are valid and can be
                stored by your integrator, but endpoints will start responding when API v1 is released.
              </p>
            </div>
          )}
        </div>

        {/* API Keys */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px] font-semibold text-foreground">API Keys ({apiKeys.length})</p>
            <Button size="sm" onClick={() => setShowKeyForms(true)} className="gap-1.5 h-8"><Plus size={12} /> New Key</Button>
          </div>

          {showKeyForms && (
            <div className="border border-border rounded-xl p-4 bg-muted/20 mb-3 space-y-3">
              <div>
                <label className="text-[14px] text-foreground font-medium">Key Name *</label>
                <Input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} className="h-9 mt-1 text-[14px]" placeholder="e.g. Production Integration" />
              </div>
              <div>
                <label className="text-[14px] text-foreground font-medium">Credential Mode</label>
                <div className="flex gap-2 mt-1.5">
                  {([
                    { v: "sandbox" as const, l: "Sandbox", d: "Test integrations — nothing settles or is filed." },
                    { v: "production" as const, l: "Production", d: "Live data. Payments settle and documents are real." },
                  ]).map(m => (
                    <button
                      key={m.v}
                      onClick={() => setCredentialMode(m.v)}
                      title={m.d}
                      className={cn(
                        "flex-1 text-left px-3 py-2 rounded-lg border text-[14px] transition-colors",
                        credentialMode === m.v
                          ? "bg-primary/5 border-primary text-foreground"
                          : "bg-muted text-muted-foreground border-border hover:border-primary/50",
                      )}
                    >
                      <span className="font-medium block">{m.l}</span>
                      <span className="text-[12px] text-muted-foreground">{keyPrefix(m.v)}…</span>
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[14px] text-foreground font-medium">Scopes</label>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  Grant only what the integration needs. Scopes marked with a shield expose patient data.
                </p>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {API_SCOPES.map(s => (
                    <button key={s} onClick={() => setSelectedScopes(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s])}
                      title={SCOPE_DESCRIPTIONS[s]}
                      className={cn("text-[12px] px-2.5 py-1 rounded-full border font-medium transition-colors inline-flex items-center gap-1", selectedScopes.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}>
                      {PHI_SCOPES.has(s) && <ShieldAlert size={10} />}
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowKeyForms(false)} className="h-8">Cancel</Button>
                <Button size="sm" onClick={createKey} disabled={!newKeyName.trim() || generating} className="h-8 gap-1.5">
                  {generating && <Loader2 size={12} className="animate-spin" />}Generate Key
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-16"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
          ) : apiKeys.length === 0 ? (
            <p className="text-[14px] text-muted-foreground py-4 text-center">No API keys. Create one to start integrating.</p>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-[14px]">
                <thead className="bg-muted/50">
                  <tr>
                    {["Name","Key","Mode","Scopes","Created","Status",""].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[12px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map(k => (
                    <tr key={k.id} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium text-foreground">{k.key_name}</td>
                      <td className="px-4 py-2.5">
                        {/* Only the prefix is ever displayed. The secret is not stored, so there is
                            nothing here to reveal — which is the point of show-once. */}
                        <span className="font-mono text-[12px] text-muted-foreground">
                          {k.key_prefix}{"•".repeat(12)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={cn(
                          "text-[12px] px-1.5 py-0.5 rounded border font-medium",
                          environmentOf(k.key_prefix) === "production"
                            ? "bg-amber-50 text-amber-700 border-amber-200"
                            : "bg-muted text-muted-foreground border-border",
                        )}>
                          {environmentOf(k.key_prefix) === "production" ? "Production" : "Sandbox"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground text-[12px]">
                        {(k.scopes || []).length ? `${(k.scopes || []).length} granted` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{k.created_at ? format(new Date(k.created_at), "dd/MM/yyyy") : "—"}</td>
                      <td className="px-4 py-2.5">
                        <span
                          title={k.revoked_reason || undefined}
                          className={cn("text-[12px] px-2 py-0.5 rounded-full border font-medium", k.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border")}>
                          {k.is_active ? "Active" : "Revoked"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {k.is_active && (
                          <Button size="sm" variant="ghost" onClick={() => revokeKey(k.id)} className="h-7 text-[12px] text-red-600 hover:text-red-700 gap-1 px-2">
                            <Trash2 size={10} />Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Webhooks */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-[14px] font-semibold text-foreground">Webhook Endpoints ({webhooks.length})</p>
            <Button size="sm" variant="outline" onClick={() => setShowWebhookForm(true)} className="gap-1.5 h-8"><Plus size={12} /> Add Webhook</Button>
          </div>

          {showWebhookForm && (
            <div className="border border-border rounded-xl p-4 bg-muted/20 mb-3 space-y-3">
              <div>
                <label className="text-[14px] text-foreground font-medium">Endpoint URL *</label>
                <Input value={newWebhook.url} onChange={e => setNewWebhook(p => ({ ...p, url: e.target.value }))} className="h-9 mt-1 text-[14px]" placeholder="https://your-app.com/webhook/aumrti" />
              </div>
              <div>
                <label className="text-[14px] text-foreground font-medium">Event</label>
                <select value={newWebhook.event} onChange={e => setNewWebhook(p => ({ ...p, event: e.target.value }))}
                  className="mt-1 w-full h-9 text-[14px] border border-border rounded-md px-2 bg-background">
                  {WEBHOOK_EVENT_GROUPS.map(g => (
                    <optgroup key={g.domain} label={g.domain}>
                      {g.events.map(e => <option key={e} value={e}>{e}</option>)}
                    </optgroup>
                  ))}
                </select>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowWebhookForm(false)} className="h-8">Cancel</Button>
                <Button size="sm" onClick={addWebhook} disabled={!newWebhook.url} className="h-8 gap-1.5"><Webhook size={12} />Register</Button>
              </div>
            </div>
          )}

          {webhooks.length > 0 ? (
            <div className="space-y-2">
              {webhooks.map(w => (
                <div key={w.id} className="border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-mono text-foreground break-all">{w.url}</p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {(w.events || []).map((e: string) => (
                          <span key={e} className="text-[12px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">{e}</span>
                        ))}
                      </div>
                      {/* An endpoint switched off automatically must say why, or the hospital
                          only discovers the integration is dead when something downstream is
                          a week stale. */}
                      {!w.is_active && w.disabled_reason && (
                        <p className="text-[12px] text-amber-700 mt-1.5 flex items-start gap-1">
                          <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
                          {w.disabled_reason}
                        </p>
                      )}
                      {w.is_active && (w.failure_count ?? 0) > 0 && (
                        <p className="text-[12px] text-amber-700 mt-1.5">
                          {w.failure_count} consecutive failure{w.failure_count === 1 ? "" : "s"} — disabled automatically at 15.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className={cn("text-[12px] px-2 py-0.5 rounded-full border font-medium", w.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border")}>
                        {w.is_active ? "Active" : "Inactive"}
                      </span>
                      <Button size="sm" variant="ghost" onClick={() => rotateSecret(w.id)}
                        title="Generate a new signing secret. The partner must be given the new value."
                        className="h-7 text-[12px] gap-1 px-2">
                        <RefreshCw size={11} />Rotate secret
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleEndpoint(w.id, !w.is_active)}
                        className="h-7 text-[12px] px-2">
                        {w.is_active ? "Disable" : "Re-enable"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggleLog(w.id)}
                        className="h-7 text-[12px] gap-1 px-2">
                        {expanded === w.id ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        Deliveries
                      </Button>
                    </div>
                  </div>

                  {expanded === w.id && (
                    <div className="border-t border-border bg-muted/20 px-4 py-3">
                      {loadingLog && !deliveries[w.id] ? (
                        <div className="flex justify-center py-3"><Loader2 size={14} className="animate-spin text-muted-foreground" /></div>
                      ) : !deliveries[w.id]?.length ? (
                        <p className="text-[12px] text-muted-foreground text-center py-2">
                          No deliveries yet. Events are sent as they happen, within a minute.
                        </p>
                      ) : (
                        <table className="w-full text-[12px]">
                          <thead>
                            <tr className="text-muted-foreground">
                              {["When", "Attempt", "Status", "Response", "Took", ""].map(h => (
                                <th key={h} className="text-left font-medium pb-1.5">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {deliveries[w.id].map((d: any) => (
                              <tr key={d.id} className="border-t border-border/50">
                                <td className="py-1.5 text-muted-foreground">
                                  {format(new Date(d.created_at), "dd/MM/yyyy HH:mm")}
                                </td>
                                <td className="py-1.5 text-muted-foreground">#{d.attempt}</td>
                                <td className="py-1.5">
                                  <span className={cn("px-1.5 py-0.5 rounded border font-medium",
                                    d.status === "succeeded" ? "bg-green-50 text-green-700 border-green-200"
                                    : d.status === "dead" ? "bg-red-50 text-red-700 border-red-200"
                                    : "bg-amber-50 text-amber-700 border-amber-200")}>
                                    {d.status}
                                  </span>
                                </td>
                                <td className="py-1.5 text-muted-foreground" title={d.error_message || undefined}>
                                  {d.response_status ?? (d.error_message ? "no response" : "—")}
                                </td>
                                <td className="py-1.5 text-muted-foreground">
                                  {d.duration_ms != null ? `${d.duration_ms} ms` : "—"}
                                </td>
                                <td className="py-1.5 text-right">
                                  <Button size="sm" variant="ghost" disabled={replaying === d.id || !w.is_active}
                                    onClick={() => replay(d.id, w.id)}
                                    title={w.is_active ? "Queue this event for redelivery" : "Re-enable the endpoint first"}
                                    className="h-6 text-[11px] gap-1 px-1.5">
                                    {replaying === d.id ? <Loader2 size={10} className="animate-spin" /> : <RotateCcw size={10} />}
                                    Replay
                                  </Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[14px] text-muted-foreground py-4 text-center">No webhook endpoints configured.</p>
          )}
        </div>
      </div>

      {/* Show-once dialog. The only moment the raw secret is ever visible. */}
      <Dialog open={!!issuedKey} onOpenChange={open => { if (!open) setIssuedKey(null); }}>
        <DialogContent className="bg-slate-900 text-white border-slate-700">
          <DialogHeader><DialogTitle className="text-white">API Key Generated</DialogTitle></DialogHeader>
          <div className="flex items-start gap-2 bg-amber-500/20 border border-amber-500/30 rounded-lg p-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-[14px] text-amber-200">
              Copy it now — this key won't be shown again. Only a hash is stored, so it cannot be
              recovered later; if it is lost, revoke this key and issue a new one.
            </p>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 font-mono text-[12px] text-green-400 break-all">{issuedKey}</div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => issuedKey && copyToClipboard(issuedKey, "issued")}
              className="gap-1 border-slate-600 text-white hover:bg-slate-800">
              {copiedId === "issued" ? <CheckCircle2 size={14} className="text-green-400" /> : <Copy size={14} />} Copy Key
            </Button>
            <Button onClick={() => setIssuedKey(null)} className="bg-white text-slate-900 hover:bg-slate-200">
              I've saved it — Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rotating the signing secret breaks signature verification at the partner's end the
          moment it takes effect, so the new value has to reach them deliberately. */}
      <Dialog open={!!rotatedSecret} onOpenChange={open => { if (!open) setRotatedSecret(null); }}>
        <DialogContent className="bg-slate-900 text-white border-slate-700">
          <DialogHeader><DialogTitle className="text-white">New Signing Secret</DialogTitle></DialogHeader>
          <div className="flex items-start gap-2 bg-amber-500/20 border border-amber-500/30 rounded-lg p-3">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-[14px] text-amber-200">
              Copy it now — this secret won't be shown again. Deliveries are already being signed
              with it, so every signature will fail verification until the receiving system is
              updated.
            </p>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 font-mono text-[12px] text-green-400 break-all">{rotatedSecret}</div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => rotatedSecret && copyToClipboard(rotatedSecret, "secret")}
              className="gap-1 border-slate-600 text-white hover:bg-slate-800">
              {copiedId === "secret" ? <CheckCircle2 size={14} className="text-green-400" /> : <Copy size={14} />} Copy Secret
            </Button>
            <Button onClick={() => setRotatedSecret(null)} className="bg-white text-slate-900 hover:bg-slate-200">
              I've saved it — Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
