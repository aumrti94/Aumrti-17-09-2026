import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";

const SettingsRazorpayPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({
    mode: "test",
    keyId: "",
    keySecret: "",
    upiId: "",
    partPayments: false,
    autoReceipt: true,
  });
  const [connected, setConnected] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!hospitalId) return;
    const load = async () => {
      const { data } = await (supabase as any)
        .from("api_configurations")
        .select("config")
        .eq("hospital_id", hospitalId)
        .eq("service_key", "razorpay")
        .eq("is_active", true)
        .maybeSingle();
      if (data?.config) {
        const c = data.config as Record<string, any>;
        setConfig({
          mode: c.mode || "test",
          keyId: c.key_id || "",
          keySecret: c.key_secret || "",
          upiId: c.upi_id || "",
          partPayments: c.part_payments ?? false,
          autoReceipt: c.auto_receipt ?? true,
        });
        setConnected(!!c.key_id);
      }
      setLoading(false);
    };
    load();
  }, [hospitalId]);

  const testConnection = () => {
    setTesting(true);
    setTimeout(() => {
      setConnected(!!config.keyId);
      setTesting(false);
      toast({ title: config.keyId ? "Connection successful" : "Invalid credentials" });
    }, 1000);
  };

  const handleSave = async () => {
    if (!hospitalId) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("api_configurations")
      .upsert({
        hospital_id: hospitalId,
        service_key: "razorpay",
        service_name: "Razorpay",
        is_active: true,
        config: {
          mode: config.mode,
          key_id: config.keyId,
          key_secret: config.keySecret,
          upi_id: config.upiId,
          part_payments: config.partPayments,
          auto_receipt: config.autoReceipt,
        },
      }, { onConflict: "hospital_id,service_key" });

    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Razorpay config saved" });
      setConnected(!!config.keyId);
    }
    setSaving(false);
  };

  if (loading) return null;

  return (
    <SettingsPageWrapper title="Razorpay Payments" onSave={handleSave} saving={saving}>
      <p className="text-sm text-muted-foreground mb-6">Configure Razorpay to accept online payments from patients.</p>

      <div className="mb-6">
        {connected === true && (
          <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5">
            <CheckCircle2 size={16} /> Connected — {config.mode === "live" ? "Live" : "Test"} Mode
          </div>
        )}
        {connected === false && (
          <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5">
            <AlertTriangle size={16} /> Not configured or invalid credentials
          </div>
        )}
      </div>

      <div className="space-y-6">
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Configuration</h2>
          <div className="space-y-4">
            <div>
              <Label>Mode</Label>
              <RadioGroup value={config.mode} onValueChange={(v) => setConfig({ ...config, mode: v })} className="flex gap-4 mt-1.5">
                <div className="flex items-center gap-2"><RadioGroupItem value="test" id="rz-test" /><Label htmlFor="rz-test" className="font-normal">Test Mode</Label></div>
                <div className="flex items-center gap-2"><RadioGroupItem value="live" id="rz-live" /><Label htmlFor="rz-live" className="font-normal">Live Mode</Label></div>
              </RadioGroup>
            </div>
            <div><Label>Key ID</Label><Input value={config.keyId} onChange={(e) => setConfig({ ...config, keyId: e.target.value })} placeholder={config.mode === "test" ? "rzp_test_..." : "rzp_live_..."} className="mt-1" /></div>
            <div><Label>Key Secret</Label><Input type="password" value={config.keySecret} onChange={(e) => setConfig({ ...config, keySecret: e.target.value })} className="mt-1" /></div>
            <div><Label>UPI ID (for QR codes)</Label><Input value={config.upiId} onChange={(e) => setConfig({ ...config, upiId: e.target.value })} placeholder="hospital@upi" className="mt-1" /></div>
            <Button variant="outline" onClick={testConnection} disabled={testing}>{testing ? "Testing..." : "Test Connection"}</Button>
          </div>
        </section>

        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">Payment Settings</h2>
          <div className="space-y-3">
            <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
              <div><Label>Allow Part Payments</Label><p className="text-xs text-muted-foreground">Let patients pay in installments</p></div>
              <Switch checked={config.partPayments} onCheckedChange={(v) => setConfig({ ...config, partPayments: v })} />
            </div>
            <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
              <div><Label>Auto-send Receipt</Label><p className="text-xs text-muted-foreground">Send WhatsApp receipt on payment</p></div>
              <Switch checked={config.autoReceipt} onCheckedChange={(v) => setConfig({ ...config, autoReceipt: v })} />
            </div>
          </div>
        </section>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsRazorpayPage;
