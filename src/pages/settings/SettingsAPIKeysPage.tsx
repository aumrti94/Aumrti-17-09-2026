import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus, Copy, AlertTriangle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

interface ApiKeyRow {
  id: string;
  key_name: string;
  key_prefix: string;
  created_at: string | null;
  last_used_at: string | null;
  is_active: boolean | null;
}

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SettingsAPIKeysPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [keys, setKeys] = useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState("");
  const [generatedKey, setGeneratedKey] = useState("");
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    setLoading(true);
    supabase
      .from("api_keys")
      .select("id, key_name, key_prefix, created_at, last_used_at, is_active")
      .eq("hospital_id", hospitalId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setKeys(data);
        setLoading(false);
      });
  }, [hospitalId]);

  const generate = async () => {
    if (!hospitalId || !newKeyName.trim()) return;
    setGenerating(true);
    const raw = `hms_live_${crypto.randomUUID().replace(/-/g, "")}`;
    const prefix = raw.substring(0, 13);
    const hash = await sha256hex(raw);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
      .from("api_keys")
      .insert({ hospital_id: hospitalId, key_name: newKeyName.trim(), key_prefix: prefix, key_hash: hash, created_by: user?.id ?? null, is_active: true })
      .select("id, key_name, key_prefix, created_at, last_used_at, is_active")
      .single();
    setGenerating(false);
    if (error) { toast({ title: "Failed to generate key", description: error.message, variant: "destructive" }); return; }
    if (data) setKeys((prev) => [data, ...prev]);
    setGeneratedKey(raw);
    setShowGenerate(false);
    setShowKey(true);
    setNewKeyName("");
  };

  const copyKey = () => {
    navigator.clipboard.writeText(generatedKey);
    toast({ title: "API key copied to clipboard" });
  };

  const revoke = async (id: string) => {
    const { error } = await supabase.from("api_keys").update({ is_active: false }).eq("id", id);
    if (error) { toast({ title: "Failed to revoke key", variant: "destructive" }); return; }
    setKeys((prev) => prev.map((k) => k.id === id ? { ...k, is_active: false } : k));
    toast({ title: "API key revoked" });
  };

  const fmt = (ts: string | null) =>
    ts ? new Date(ts).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "Never";

  return (
    <SettingsPageWrapper title="API Keys" hideSave>
      <p className="text-sm text-muted-foreground mb-4">API keys allow external systems to connect to your HMS. Each key is shown only once — store it securely.</p>

      <div className="flex justify-end mb-4">
        <Button size="sm" onClick={() => setShowGenerate(true)} className="gap-1"><Plus size={14} /> Generate New Key</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <div className="border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="bg-muted/50 text-left">
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Key</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Created</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Last Used</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-2.5 font-medium text-muted-foreground">Actions</th>
            </tr></thead>
            <tbody>
              {keys.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">No API keys yet. Generate one to connect external systems.</td></tr>
              )}
              {keys.map((k) => (
                <tr key={k.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium text-foreground">{k.key_name}</td>
                  <td className="px-4 py-2.5 font-mono text-muted-foreground">{k.key_prefix}••••••••</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{fmt(k.created_at)}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{fmt(k.last_used_at)}</td>
                  <td className="px-4 py-2.5"><Badge variant={k.is_active ? "default" : "destructive"}>{k.is_active ? "Active" : "Revoked"}</Badge></td>
                  <td className="px-4 py-2.5">
                    {k.is_active && <Button variant="ghost" size="sm" className="text-destructive" onClick={() => revoke(k.id)}>Revoke</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Generate New API Key</DialogTitle></DialogHeader>
          <div><Label>Key Name</Label><Input value={newKeyName} onChange={(e) => setNewKeyName(e.target.value)} placeholder="e.g., Mobile App Integration" className="mt-1" /></div>
          <DialogFooter><Button onClick={generate} disabled={!newKeyName.trim() || generating}>{generating && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Generate</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showKey} onOpenChange={setShowKey}>
        <DialogContent className="bg-slate-900 text-white border-slate-700">
          <DialogHeader><DialogTitle className="text-white">API Key Generated</DialogTitle></DialogHeader>
          <div className="flex items-start gap-2 bg-amber-500/20 border border-amber-500/30 rounded-lg p-3 mb-4">
            <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-sm text-amber-200">Copy this key now — it won't be shown again</p>
          </div>
          <div className="bg-slate-800 rounded-lg p-4 font-mono text-sm text-green-400 break-all">{generatedKey}</div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={copyKey} className="gap-1 border-slate-600 text-white hover:bg-slate-800"><Copy size={14} /> Copy Key</Button>
            <Button onClick={() => setShowKey(false)} className="bg-white text-slate-900 hover:bg-slate-200">I've saved it — Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageWrapper>
  );
};

export default SettingsAPIKeysPage;
