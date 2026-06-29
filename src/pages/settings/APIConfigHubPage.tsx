import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { KNOWN_SERVICES } from "@/lib/aiProvider";
import { Loader2, Eye, EyeOff, FlaskConical, Save, Plus } from "lucide-react";

// AI provider + voice keys are configured GLOBALLY from /platform → API Hub.
// This hospital page now manages only the genuinely per-hospital integration keys.
const NON_AI_SERVICE_KEYS = ["razorpay", "wati", "abdm", "nic_irp", "pmjay"];

interface APIKeyConfig {
  id: string;
  hospital_id: string;
  service_name: string;
  service_key: string;
  config: Record<string, string>;
  is_active: boolean;
  last_tested_at: string | null;
  test_status: string | null;
  test_message: string | null;
}

const APIConfigHubPage: React.FC = () => {
  const { toast } = useToast();
  const [hospitalId, setHospitalId] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<APIKeyConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);

  // API Key drawer
  const [editingKey, setEditingKey] = useState<typeof KNOWN_SERVICES[0] | null>(null);
  const [keyForm, setKeyForm] = useState({ api_key: "", endpoint: "", mode: "production" });
  const [showSecret, setShowSecret] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    const { data: userData } = await supabase.rpc("get_user_hospital_id");
    const hId = userData as unknown as string;
    setHospitalId(hId);

    if (hId) {
      const { data } = await supabase.from("api_configurations").select("*").eq("hospital_id", hId);
      if (data) setApiKeys(data as unknown as APIKeyConfig[]);
    }
    setLoading(false);
  };

  const services = KNOWN_SERVICES.filter(s => NON_AI_SERVICE_KEYS.includes(s.service_key));
  const getApiKeyForService = (serviceKey: string) => apiKeys.find(k => k.service_key === serviceKey);

  const saveApiKey = async () => {
    if (!hospitalId || !editingKey) return;
    setSaving(editingKey.service_key);
    const existing = getApiKeyForService(editingKey.service_key);
    const config: Record<string, string> = {
      api_key: keyForm.api_key,
      endpoint: keyForm.endpoint || editingKey.endpoint,
      mode: keyForm.mode,
    };
    const payload = {
      hospital_id: hospitalId,
      service_name: editingKey.service_name,
      service_key: editingKey.service_key,
      config,
      is_active: true,
    };

    if (existing) {
      const { error } = await supabase.from("api_configurations").update(payload).eq("id", existing.id);
      if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      else toast({ title: `✓ ${editingKey.service_name} key saved` });
    } else {
      const { error } = await supabase.from("api_configurations").insert(payload);
      if (error) toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      else toast({ title: `✓ ${editingKey.service_name} key added` });
    }
    await loadData();
    setEditingKey(null);
    setSaving(null);
  };

  // Non-AI integration keys: a "test" simply records that a key is present.
  const testApiKey = async (serviceKey: string) => {
    setTesting(serviceKey);
    const existing = getApiKeyForService(serviceKey);
    const apiKey = (existing?.config as Record<string, string> | undefined)?.api_key;
    const success = !!apiKey;
    if (existing) {
      await supabase.from("api_configurations").update({
        last_tested_at: new Date().toISOString(),
        test_status: success ? "success" : "failed",
        test_message: success ? "Key is set" : "No key",
      }).eq("id", existing.id);
      await loadData();
    }
    setTesting(null);
    toast({
      title: success ? "✓ Key is set" : "✗ No key configured",
      variant: success ? "default" : "destructive",
    });
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
      <SettingsPageWrapper title="Integration Keys" hideSave>
        <div className="flex items-center justify-center py-20">
          <Loader2 className="animate-spin text-muted-foreground" size={24} />
        </div>
      </SettingsPageWrapper>
    );
  }

  return (
    <SettingsPageWrapper title="Integration Keys" hideSave>
      <div className="max-w-[960px] mx-auto space-y-8">
        <section>
          <h2 className="text-lg font-bold text-foreground mb-1">External API Keys</h2>
          <p className="text-sm text-muted-foreground mb-1">Payment, WhatsApp and government integration keys for this hospital</p>
          <p className="text-xs text-muted-foreground mb-5">
            AI providers and voice are configured centrally by Aumrti at <span className="font-medium">Platform → API Hub</span>.
          </p>

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
                {services.map(svc => {
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
                            });
                            setShowSecret(false);
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
              />
            </div>
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
            {editingKey?.service_key === "nic_irp" && (
              <>
                <div><Label>Username</Label><Input className="mt-1" placeholder="NIC IRP username" /></div>
                <div><Label>Password</Label><Input className="mt-1" type="password" placeholder="NIC IRP password" /></div>
              </>
            )}

            <div className="flex gap-2 pt-2">
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
    </SettingsPageWrapper>
  );
};

export default APIConfigHubPage;
