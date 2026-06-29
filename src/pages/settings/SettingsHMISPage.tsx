import React, { useState, useEffect } from "react";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

const SettingsHMISPage: React.FC = () => {
  const { toast } = useToast();
  const { hospitalId } = useHospitalId();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [config, setConfig] = useState({
    hin_code: "",
    facility_code: "",
    username: "",
    password: "",
    portal_url: "https://ihip.nhp.gov.in",
  });
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    if (!hospitalId) return;
    (async () => {
      const { data } = await (supabase as any)
        .from("api_configurations")
        .select("config")
        .eq("hospital_id", hospitalId)
        .eq("service_key", "hmis_portal")
        .eq("is_active", true)
        .maybeSingle();
      if (data?.config) {
        const c = data.config as Record<string, any>;
        setConfig({
          hin_code: c.hin_code || "",
          facility_code: c.facility_code || "",
          username: c.username || "",
          password: c.password || "",
          portal_url: c.portal_url || "https://ihip.nhp.gov.in",
        });
        setConnected(!!c.facility_code);
      }
      setLoading(false);
    })();
  }, [hospitalId]);

  const handleSave = async () => {
    if (!hospitalId) return;
    setSaving(true);
    const { error } = await (supabase as any)
      .from("api_configurations")
      .upsert({
        hospital_id: hospitalId,
        service_key: "hmis_portal",
        service_name: "MoHFW HMIS / IHIP Portal",
        is_active: true,
        config,
      }, { onConflict: "hospital_id,service_key" });
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "HMIS credentials saved" });
      setConnected(!!config.facility_code);
    }
    setSaving(false);
  };

  if (loading) return null;

  return (
    <SettingsPageWrapper title="HMIS / IHIP Portal" onSave={handleSave} saving={saving}>
      <p className="text-sm text-muted-foreground mb-4">
        Configure credentials for the{" "}
        <a href="https://ihip.nhp.gov.in" target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-1">
          MoHFW IHIP Portal <ExternalLink size={12} />
        </a>{" "}
        to enable one-click HMIS, IDSP, and RMNCH+A report submission.
      </p>

      {connected === true && (
        <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-4 py-2.5 mb-5">
          <CheckCircle2 size={16} /> Portal credentials configured
        </div>
      )}
      {connected === false && (
        <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 mb-5">
          <AlertTriangle size={16} /> Not configured — reports will need manual upload
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>HIN Code (Hospital ID on NHP)</Label>
            <Input value={config.hin_code} onChange={(e) => setConfig({ ...config, hin_code: e.target.value })}
              placeholder="e.g. MH-HIN-00123" className="mt-1 font-mono" />
          </div>
          <div>
            <Label>Facility Code</Label>
            <Input value={config.facility_code} onChange={(e) => setConfig({ ...config, facility_code: e.target.value })}
              placeholder="e.g. FAC-MH-0456" className="mt-1 font-mono" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label>Portal Username</Label>
            <Input value={config.username} onChange={(e) => setConfig({ ...config, username: e.target.value })}
              placeholder="IHIP login username" className="mt-1" />
          </div>
          <div>
            <Label>Portal Password</Label>
            <Input type="password" value={config.password} onChange={(e) => setConfig({ ...config, password: e.target.value })}
              className="mt-1" />
          </div>
        </div>
        <div>
          <Label>Portal Base URL</Label>
          <Input value={config.portal_url} onChange={(e) => setConfig({ ...config, portal_url: e.target.value })}
            placeholder="https://ihip.nhp.gov.in" className="mt-1 font-mono text-sm" />
          <p className="text-xs text-muted-foreground mt-1">Leave default unless your state uses a custom HMIS endpoint.</p>
        </div>

        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 text-sm text-blue-800">
          <p className="font-semibold mb-1">How to get credentials</p>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>Register your hospital at <strong>ihip.nhp.gov.in</strong></li>
            <li>Log in and navigate to Facility Management → Get HIN Code</li>
            <li>Note the Facility Code from your facility profile</li>
            <li>Use the same login credentials here</li>
          </ol>
        </div>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsHMISPage;
