import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Code2, Plus, Eye, EyeOff, Copy, Trash2, ExternalLink, Loader2, CheckCircle2, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";

const SCOPES = ["read:patients","write:patients","read:appointments","write:appointments","read:bills","read:lab","read:pharmacy","admin"];

const WEBHOOK_EVENTS = [
  "patient.created","patient.updated",
  "appointment.booked","appointment.cancelled",
  "bill.created","bill.paid",
  "admission.created","admission.discharged",
  "lab.result_ready",
];

export default function SettingsAPIPortalPage() {
  const { hospitalId } = useHospitalId();
  const { toast } = useToast();
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [webhooks, setWebhooks] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showKeyForms, setShowKeyForms] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [selectedScopes, setSelectedScopes] = useState<string[]>(["read:patients","read:appointments"]);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [newWebhook, setNewWebhook] = useState({ url: "", event: "appointment.booked" });
  const [showWebhookForm, setShowWebhookForm] = useState(false);

  const fetch = useCallback(async () => {
    if (!hospitalId) return;
    setLoading(true);
    const [keysRes, whRes] = await Promise.all([
      (supabase as any).from("api_keys").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
      (supabase as any).from("webhook_endpoints").select("*").eq("hospital_id", hospitalId).order("created_at", { ascending: false }),
    ]);
    setApiKeys(keysRes.data || []);
    setWebhooks(whRes.data || []);
    setLoading(false);
  }, [hospitalId]);

  useEffect(() => { fetch(); }, [fetch]);

  const generateKey = () => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return "sk_live_" + Array.from({ length: 48 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  };

  const createKey = async () => {
    if (!hospitalId || !newKeyName) return;
    const key = generateKey();
    await (supabase as any).from("api_keys").insert({
      hospital_id: hospitalId,
      name: newKeyName,
      key_hash: key,
      scopes: selectedScopes,
      is_active: true,
    });
    setShowKeyForms(false);
    setNewKeyName("");
    setSelectedScopes(["read:patients"]);
    fetch();
    toast({ title: "API key created — copy it now, it won't be shown again" });
  };

  const revokeKey = async (id: string) => {
    await (supabase as any).from("api_keys").update({ is_active: false }).eq("id", id);
    fetch();
    toast({ title: "API key revoked" });
  };

  const addWebhook = async () => {
    if (!hospitalId || !newWebhook.url) return;
    await (supabase as any).from("webhook_endpoints").insert({
      hospital_id: hospitalId,
      url: newWebhook.url,
      events: [newWebhook.event],
      is_active: true,
      secret: generateKey().replace("sk_live_", "whsec_"),
    });
    setShowWebhookForm(false);
    setNewWebhook({ url: "", event: "appointment.booked" });
    fetch();
    toast({ title: "Webhook endpoint registered" });
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast({ title: "Copied to clipboard" });
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background">
      <div className="flex-shrink-0 h-14 border-b border-border px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Code2 size={18} className="text-primary" />
          <h1 className="text-[16px] font-bold text-foreground">API Portal</h1>
          <Badge variant="outline" className="text-[10px] ml-1">v1</Badge>
        </div>
        <a href="https://docs.aumrti.in/api" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[12px] text-primary hover:underline">
          API Docs <ExternalLink size={11} />
        </a>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* API Base URL */}
        <div className="bg-muted/30 border border-border rounded-xl p-4">
          <p className="text-[12px] font-semibold text-foreground mb-2">Base URL</p>
          <code className="text-[12px] text-primary font-mono bg-muted px-3 py-1.5 rounded-lg block">
            https://api.aumrti.in/v1
          </code>
          <p className="text-[11px] text-muted-foreground mt-2">All requests must include <code className="bg-muted px-1 rounded">Authorization: Bearer &lt;api-key&gt;</code> header.</p>
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
                <label className="text-[11px] text-muted-foreground">Key Name *</label>
                <Input value={newKeyName} onChange={e => setNewKeyName(e.target.value)} className="h-9 mt-1 text-[12px]" placeholder="e.g. Production Integration" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Scopes</label>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {SCOPES.map(s => (
                    <button key={s} onClick={() => setSelectedScopes(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s])}
                      className={cn("text-[11px] px-2.5 py-1 rounded-full border font-medium transition-colors", selectedScopes.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:border-primary/50")}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowKeyForms(false)} className="h-8">Cancel</Button>
                <Button size="sm" onClick={createKey} disabled={!newKeyName} className="h-8">Generate Key</Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center h-16"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
          ) : apiKeys.length === 0 ? (
            <p className="text-[12px] text-muted-foreground py-4 text-center">No API keys. Create one to start integrating.</p>
          ) : (
            <div className="border border-border rounded-xl overflow-hidden">
              <table className="w-full text-[12px]">
                <thead className="bg-muted/50">
                  <tr>
                    {["Name","Key","Scopes","Created","Status",""].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 font-medium text-muted-foreground text-[11px]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {apiKeys.map(k => (
                    <tr key={k.id} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium text-foreground">{k.name}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2 font-mono text-[11px]">
                          <span className="text-muted-foreground">
                            {revealedKeys.has(k.id) ? k.key_hash : `${k.key_hash?.slice(0, 12)}${"•".repeat(20)}`}
                          </span>
                          <button onClick={() => setRevealedKeys(p => { const s = new Set(p); s.has(k.id) ? s.delete(k.id) : s.add(k.id); return s; })} className="text-muted-foreground hover:text-foreground">
                            {revealedKeys.has(k.id) ? <EyeOff size={12} /> : <Eye size={12} />}
                          </button>
                          <button onClick={() => copyToClipboard(k.key_hash, k.id)} className="text-muted-foreground hover:text-foreground">
                            {copiedId === k.id ? <CheckCircle2 size={12} className="text-green-500" /> : <Copy size={12} />}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {(k.scopes || []).slice(0, 3).map((s: string) => (
                            <span key={s} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{s}</span>
                          ))}
                          {(k.scopes || []).length > 3 && <span className="text-[10px] text-muted-foreground">+{(k.scopes || []).length - 3}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">{format(new Date(k.created_at), "dd/MM/yyyy")}</td>
                      <td className="px-4 py-2.5">
                        <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", k.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-muted text-muted-foreground border-border")}>
                          {k.is_active ? "Active" : "Revoked"}
                        </span>
                      </td>
                      <td className="px-4 py-2.5">
                        {k.is_active && (
                          <Button size="sm" variant="ghost" onClick={() => revokeKey(k.id)} className="h-7 text-[10px] text-red-600 hover:text-red-700 gap-1 px-2">
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
                <label className="text-[11px] text-muted-foreground">Endpoint URL *</label>
                <Input value={newWebhook.url} onChange={e => setNewWebhook(p => ({ ...p, url: e.target.value }))} className="h-9 mt-1 text-[12px]" placeholder="https://your-app.com/webhook/aumrti" />
              </div>
              <div>
                <label className="text-[11px] text-muted-foreground">Event</label>
                <select value={newWebhook.event} onChange={e => setNewWebhook(p => ({ ...p, event: e.target.value }))}
                  className="mt-1 w-full h-9 text-[12px] border border-border rounded-md px-2 bg-background">
                  {WEBHOOK_EVENTS.map(e => <option key={e} value={e}>{e}</option>)}
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
                <div key={w.id} className="border border-border rounded-xl px-4 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-[12px] font-mono text-foreground">{w.url}</p>
                    <div className="flex gap-2 mt-1">
                      {(w.events || []).map((e: string) => (
                        <span key={e} className="text-[10px] bg-blue-50 text-blue-700 border border-blue-200 rounded px-1.5 py-0.5">{e}</span>
                      ))}
                    </div>
                  </div>
                  <span className={cn("text-[11px] px-2 py-0.5 rounded-full border font-medium", w.is_active ? "bg-green-50 text-green-700 border-green-200" : "bg-muted text-muted-foreground")}>
                    {w.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-muted-foreground py-4 text-center">No webhook endpoints configured.</p>
          )}
        </div>
      </div>
    </div>
  );
}
