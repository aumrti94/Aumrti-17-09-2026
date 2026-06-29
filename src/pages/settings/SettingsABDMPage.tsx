import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle, CheckCircle2, XCircle, Loader2, Radio,
  Eye, EyeOff, RotateCcw, ShieldCheck, FlaskConical, ChevronDown, ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────
// abdm_client_secret is intentionally excluded from the SELECT so it never
// flows back to the browser.  Only the hint (last-4 chars) is loaded.
interface AbdmConfig {
  hfr_id: string;
  facility_name: string;
  abdm_client_id: string;
  /** Display-only: "••••XXXX" — the full secret never leaves the DB. */
  abdm_client_secret_hint: string;
  abdm_base_url: string;
  bridge_url: string;
  is_production: boolean;
  hfr_registered_at: string | null;
  feature_abha_creation: boolean;
  feature_hip_sharing: boolean;
  feature_hiu_fetch: boolean;
  feature_hcx_claims: boolean;
}

const EMPTY_CONFIG: AbdmConfig = {
  hfr_id: "", facility_name: "", abdm_client_id: "", abdm_client_secret_hint: "",
  abdm_base_url: "https://dev.abdm.gov.in", bridge_url: "",
  is_production: false, hfr_registered_at: null,
  feature_abha_creation: false, feature_hip_sharing: false,
  feature_hiu_fetch: false, feature_hcx_claims: false,
};

interface IntegrationTestResult {
  name: string;
  description: string;
  pass: boolean;
  detail?: string;
  error?: string;
}

const SettingsABDMPage: React.FC = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [config, setConfig] = useState<AbdmConfig>(EMPTY_CONFIG);
  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "ok" | "fail">("idle");
  const [testMessage, setTestMessage] = useState("");

  // Credential inputs — only written by the user, never pre-filled from DB
  const [newClientId, setNewClientId] = useState("");
  const [newClientSecret, setNewClientSecret] = useState("");
  const [showSecret, setShowSecret] = useState(false);
  const [savingCreds, setSavingCreds] = useState(false);
  const [rotating, setRotating] = useState(false);

  // Integration test state
  const [testResults, setTestResults] = useState<IntegrationTestResult[]>([]);
  const [testRunning, setTestRunning] = useState<string | null>(null);
  const [lastTestTime, setLastTestTime] = useState<string | null>(null);
  const [testOverall, setTestOverall] = useState<"pass" | "fail" | null>(null);
  const [testResultsOpen, setTestResultsOpen] = useState(false);

  // ── Fetch hospital id ──────────────────────────────────────────────────────
  const { data: me } = useQuery({
    queryKey: ["current-user"],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data } = await supabase.from("users").select("hospital_id").eq("id", user.id).single();
      return data;
    },
  });

  const hospitalId = me?.hospital_id;

  // ── Load config — abdm_client_secret intentionally excluded ───────────────
  const { data: dbConfig, isLoading } = useQuery({
    queryKey: ["hospital-abdm-config", hospitalId],
    enabled: !!hospitalId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("hospital_abdm_config")
        .select(
          "id, hfr_id, facility_name, abdm_client_id, abdm_client_secret_hint, " +
          "abdm_base_url, bridge_url, is_production, hfr_registered_at, " +
          "feature_abha_creation, feature_hip_sharing, feature_hiu_fetch, feature_hcx_claims",
        )
        .eq("hospital_id", hospitalId)
        .maybeSingle();
      if (error) throw error;
      return data as (AbdmConfig & { id: string }) | null;
    },
  });

  useEffect(() => {
    if (dbConfig) {
      setConfig({
        hfr_id:                    dbConfig.hfr_id ?? "",
        facility_name:             dbConfig.facility_name ?? "",
        abdm_client_id:            dbConfig.abdm_client_id ?? "",
        abdm_client_secret_hint:   dbConfig.abdm_client_secret_hint ?? "",
        abdm_base_url:             dbConfig.abdm_base_url ?? "https://dev.abdm.gov.in",
        bridge_url:                dbConfig.bridge_url ?? "",
        is_production:             dbConfig.is_production ?? false,
        hfr_registered_at:         dbConfig.hfr_registered_at ?? null,
        feature_abha_creation:     dbConfig.feature_abha_creation ?? false,
        feature_hip_sharing:       dbConfig.feature_hip_sharing ?? false,
        feature_hiu_fetch:         dbConfig.feature_hiu_fetch ?? false,
        feature_hcx_claims:        dbConfig.feature_hcx_claims ?? false,
      });
    }
  }, [dbConfig]);

  // ── Save non-credential fields ─────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (cfg: AbdmConfig) => {
      if (!hospitalId) throw new Error("No hospital context");
      // Exclude hint and secret from this upsert path
      const { abdm_client_secret_hint: _hint, abdm_client_id: _id, ...rest } = cfg;
      const payload = { ...rest, abdm_client_id: cfg.abdm_client_id, hospital_id: hospitalId, updated_at: new Date().toISOString() };
      const { error } = await (supabase as any)
        .from("hospital_abdm_config")
        .upsert(payload, { onConflict: "hospital_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hospital-abdm-config", hospitalId] });
      toast({ title: "ABDM config saved" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  // ── Save credentials via SECURITY DEFINER RPC ─────────────────────────────
  // The full secret is sent to the RPC which stores it and computes the hint.
  // The secret never comes back to the browser — only the hint is readable.
  const handleSaveCredentials = async () => {
    if (!hospitalId) return;
    setSavingCreds(true);
    try {
      // Ensure the config row exists first
      await (supabase as any).from("hospital_abdm_config").upsert(
        { hospital_id: hospitalId, updated_at: new Date().toISOString() },
        { onConflict: "hospital_id", ignoreDuplicates: true },
      );

      if (newClientId.trim()) {
        const { error } = await (supabase as any).rpc("set_hospital_abdm_secret", {
          p_hospital_id: hospitalId,
          p_key: "abdm_client_id",
          p_value: newClientId.trim(),
        });
        if (error) throw error;
        setNewClientId("");
      }

      if (newClientSecret.trim()) {
        const { error } = await (supabase as any).rpc("set_hospital_abdm_secret", {
          p_hospital_id: hospitalId,
          p_key: "abdm_client_secret",
          p_value: newClientSecret.trim(),
        });
        if (error) throw error;
        setNewClientSecret("");
        setShowSecret(false);
      }

      queryClient.invalidateQueries({ queryKey: ["hospital-abdm-config", hospitalId] });
      toast({ title: "Credentials saved securely" });
    } catch (e: any) {
      toast({ title: "Failed to save credentials", description: e.message, variant: "destructive" });
    } finally {
      setSavingCreds(false);
    }
  };

  // ── Rotate credentials ─────────────────────────────────────────────────────
  // Clears the cached token so the next ABDM operation forces re-authentication.
  const handleRotateCredentials = async () => {
    if (!hospitalId) return;
    setRotating(true);
    try {
      const { error } = await (supabase as any).rpc("rotate_abdm_credentials", {
        p_hospital_id: hospitalId,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["hospital-abdm-config", hospitalId] });
      setTestStatus("idle");
      toast({ title: "Credentials rotated — token cache cleared. Re-authentication will occur on next ABDM call." });
    } catch (e: any) {
      toast({ title: "Rotation failed", description: e.message, variant: "destructive" });
    } finally {
      setRotating(false);
    }
  };

  // ── Toggle feature — persist immediately ───────────────────────────────────
  const toggleFeature = async (key: keyof AbdmConfig, value: boolean) => {
    const next = { ...config, [key]: value };
    setConfig(next);
    saveMutation.mutate(next);
  };

  // ── Test connection ────────────────────────────────────────────────────────
  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestMessage("");
    try {
      const { data, error } = await supabase.functions.invoke("abdm-abha-verify", {
        body: { mode: "ping", abhaId: "00-0000-0000-0000" },
      });
      if (error) throw error;
      if (data?.sandbox || data?.status === "sandbox" || data?.mode === "sandbox") {
        setTestStatus("ok");
        setTestMessage("Connected — running in sandbox mode (no live credentials)");
      } else if (data?.error) {
        setTestStatus("fail");
        setTestMessage(data.error);
      } else {
        setTestStatus("ok");
        setTestMessage("Connected to ABDM gateway successfully");
      }
    } catch (e: any) {
      setTestStatus("fail");
      setTestMessage(e.message ?? "Connection failed");
    }
  };

  // ── Integration tests ──────────────────────────────────────────────────────
  const handleRunIntegrationTest = async (test: "token" | "discover" | "link" | "data_push" | "full") => {
    if (!hospitalId) return;
    setTestRunning(test);
    setTestResults([]);
    setTestOverall(null);
    setTestResultsOpen(true);
    try {
      const { data, error } = await supabase.functions.invoke("abdm-sandbox-test", {
        body: { hospital_id: hospitalId, test },
      });
      if (error) throw error;
      const d = data as { overall: "pass" | "fail"; results: IntegrationTestResult[]; ran_at: string };
      setTestResults(d.results ?? []);
      setTestOverall(d.overall ?? null);
      setLastTestTime(d.ran_at ?? new Date().toISOString());
    } catch (e: any) {
      setTestResults([{ name: "Test runner", description: "abdm-sandbox-test invocation", pass: false, error: e.message }]);
      setTestOverall("fail");
      setLastTestTime(new Date().toISOString());
    } finally {
      setTestRunning(null);
    }
  };

  const features: { key: keyof AbdmConfig; label: string; desc: string }[] = [
    { key: "feature_abha_creation", label: "ABHA ID creation at registration", desc: "Create ABHA IDs during patient registration" },
    { key: "feature_hip_sharing",   label: "Health record sharing (HIP)",       desc: "Share patient records via ABDM network" },
    { key: "feature_hiu_fetch",     label: "Fetch patient records (HIU)",        desc: "Retrieve records from other facilities" },
    { key: "feature_hcx_claims",    label: "HCX claims (NHCX)",                  desc: "Submit claims via Health Claims Exchange" },
  ];

  const hfrRegistered = !!config.hfr_registered_at;
  const hasCredentialHint = !!config.abdm_client_secret_hint || !!config.abdm_client_id;
  const saving = saveMutation.isPending;

  return (
    <SettingsPageWrapper
      title="ABDM / ABHA"
      onSave={() => saveMutation.mutate(config)}
      saving={saving || isLoading}
    >
      {/* Info banner */}
      <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-4 mb-6">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-blue-800 dark:text-blue-300">Live ABHA Verification</p>
            <p className="text-xs text-blue-700 dark:text-blue-400 mt-1 leading-relaxed">
              Configure your NHA credentials below to enable live ABDM gateway calls.
              Credentials are stored securely and <strong>never returned to the browser</strong> —
              only the last 4 characters of the secret are displayed as a confirmation hint.
            </p>
          </div>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Connect to Ayushman Bharat Digital Mission for ABHA ID creation and health record sharing.
      </p>

      <div className="space-y-8">
        {/* ── Facility Details ── */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-sm font-semibold text-foreground">Facility Details</h2>
            {hfrRegistered ? (
              <Badge className="text-[10px] bg-emerald-100 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="h-3 w-3 mr-1" />HFR Registered
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px]">
                <XCircle className="h-3 w-3 mr-1" />Not Registered
              </Badge>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <Label>HFR (Health Facility Registry) ID</Label>
              <Input value={config.hfr_id} onChange={(e) => setConfig({ ...config, hfr_id: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Facility Name (as per HFR)</Label>
              <Input value={config.facility_name} onChange={(e) => setConfig({ ...config, facility_name: e.target.value })} className="mt-1" />
            </div>
            <div>
              <Label>Bridge URL (Callback URL)</Label>
              <Input
                value={config.bridge_url}
                onChange={(e) => setConfig({ ...config, bridge_url: e.target.value })}
                className="mt-1"
                placeholder="https://your-domain/api/abdm/callback"
              />
              <p className="text-[11px] text-muted-foreground mt-1">Registered with the ABDM gateway as the callback endpoint.</p>
            </div>
            <div>
              <Label>ABDM Base URL</Label>
              <Input
                value={config.abdm_base_url}
                onChange={(e) => setConfig({ ...config, abdm_base_url: e.target.value })}
                className="mt-1"
              />
            </div>
          </div>
        </section>

        {/* ── ABDM Credentials (write-only via RPC) ── */}
        <section className="rounded-lg border border-border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" />
                NHA Credentials
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Credentials are stored securely. The full secret is never displayed.
              </p>
            </div>
            {hasCredentialHint && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRotateCredentials}
                disabled={rotating}
                className="text-amber-700 border-amber-300 hover:bg-amber-50"
              >
                {rotating ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
                )}
                Rotate Credentials
              </Button>
            )}
          </div>

          {/* Current credentials status */}
          {hasCredentialHint && (
            <div className="rounded-md bg-muted/50 border border-border px-3 py-2 text-[12px] space-y-1">
              {config.abdm_client_id && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-28">Client ID:</span>
                  <span className="font-mono">{config.abdm_client_id}</span>
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                </div>
              )}
              {config.abdm_client_secret_hint && (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground w-28">Client Secret:</span>
                  <span className="font-mono text-muted-foreground">{config.abdm_client_secret_hint}</span>
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                  <span className="text-[10px] text-muted-foreground">(last 4 chars shown)</span>
                </div>
              )}
            </div>
          )}

          {/* New credential inputs */}
          <div className="space-y-3">
            <div>
              <Label>
                {hasCredentialHint ? "Replace Client ID" : "ABDM_CLIENT_ID"}
                {!hasCredentialHint && <span className="text-destructive ml-1">*</span>}
              </Label>
              <Input
                value={newClientId}
                onChange={(e) => setNewClientId(e.target.value)}
                className="mt-1 font-mono"
                placeholder={hasCredentialHint ? "Leave blank to keep existing" : "Required for live verification"}
                autoComplete="off"
              />
            </div>
            <div>
              <Label>
                {hasCredentialHint ? "Replace Client Secret" : "ABDM_CLIENT_SECRET"}
                {!hasCredentialHint && <span className="text-destructive ml-1">*</span>}
              </Label>
              <div className="relative mt-1">
                <Input
                  type={showSecret ? "text" : "password"}
                  value={newClientSecret}
                  onChange={(e) => setNewClientSecret(e.target.value)}
                  className="pr-10 font-mono"
                  placeholder={hasCredentialHint ? "Leave blank to keep existing" : "Required for live verification"}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Stored via secure RPC — never exposed to the browser after saving.
              </p>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={savingCreds || (!newClientId.trim() && !newClientSecret.trim())}
              onClick={handleSaveCredentials}
            >
              {savingCreds && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {hasCredentialHint ? "Update Credentials" : "Save Credentials"}
            </Button>
          </div>
        </section>

        {/* ── Environment ── */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">Environment</h2>
          <div className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
            <div>
              <Label>Production Mode</Label>
              <p className="text-xs text-muted-foreground">
                {config.is_production
                  ? "Sending real requests to NHA production gateway"
                  : "Using sandbox gateway — safe for testing"}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant={config.is_production ? "default" : "secondary"} className="text-[10px]">
                <Radio className="h-3 w-3 mr-1" />
                {config.is_production ? "Production" : "Sandbox"}
              </Badge>
              <Switch
                checked={config.is_production}
                onCheckedChange={(v) => toggleFeature("is_production", v)}
              />
            </div>
          </div>
        </section>

        {/* ── Features ── */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">Features</h2>
          <div className="space-y-3">
            {features.map((f) => {
              const enabled = !!config[f.key];
              return (
                <div key={f.key as string} className="flex items-center justify-between bg-card border border-border rounded-lg px-4 py-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Label>{f.label}</Label>
                      <Badge variant={enabled ? "default" : "secondary"} className="text-[10px]">
                        {enabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{f.desc}</p>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(v) => toggleFeature(f.key, v)}
                  />
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Test connection ── */}
        <div className="flex items-center gap-4">
          <Button
            variant="outline"
            onClick={handleTestConnection}
            disabled={testStatus === "testing"}
          >
            {testStatus === "testing" && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Test ABDM Connection
          </Button>
          {testStatus === "ok" && (
            <span className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle2 className="h-4 w-4" />{testMessage}
            </span>
          )}
          {testStatus === "fail" && (
            <span className="flex items-center gap-1.5 text-sm text-destructive">
              <XCircle className="h-4 w-4" />{testMessage}
            </span>
          )}
        </div>

        {/* ── Integration Tests ── */}
        <section className="border border-border rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 bg-muted/40">
            <div className="flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold text-foreground">Integration Tests</h2>
              {testOverall && (
                <span className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium ${
                  testOverall === "pass"
                    ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                    : "bg-red-100 text-red-700 border border-red-200"
                }`}>
                  {testOverall === "pass" ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                  {testOverall === "pass" ? "All tests passed" : "Some tests failed"}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {lastTestTime && (
                <span className="text-[11px] text-muted-foreground">
                  Last run: {new Date(lastTestTime).toLocaleTimeString()}
                </span>
              )}
              {testResults.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTestResultsOpen((v) => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1"
                >
                  {testResultsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  {testResultsOpen ? "Hide" : "Show"} results
                </button>
              )}
            </div>
          </div>

          <div className="p-4 space-y-3">
            <p className="text-[12px] text-muted-foreground">
              Validate your ABDM setup against the NHA sandbox before going live.
              Tests run in sandbox mode unless production credentials are configured.
            </p>

            {/* Test buttons */}
            <div className="flex flex-wrap gap-2">
              {[
                { id: "token" as const, label: "Test Gateway Token" },
                { id: "discover" as const, label: "Test Discovery Flow" },
                { id: "link" as const, label: "Test Link Init" },
                { id: "data_push" as const, label: "Test Data Push" },
                { id: "full" as const, label: "Run Full Flow (M1+M2)" },
              ].map(({ id, label }) => (
                <Button
                  key={id}
                  variant="outline"
                  size="sm"
                  className="text-xs h-8"
                  disabled={!!testRunning || !hospitalId}
                  onClick={() => handleRunIntegrationTest(id)}
                >
                  {testRunning === id
                    ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    : <FlaskConical className="h-3.5 w-3.5 mr-1.5" />}
                  {label}
                </Button>
              ))}
            </div>

            {/* Results */}
            {testResultsOpen && testResults.length > 0 && (
              <div className="mt-3 border border-border rounded-md overflow-hidden divide-y divide-border">
                {testResults.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 px-3 py-2.5 text-[12px]">
                    <span className="mt-0.5 shrink-0">
                      {r.pass
                        ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        : <XCircle className="h-3.5 w-3.5 text-destructive" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className={`font-medium leading-snug ${r.pass ? "text-foreground" : "text-destructive"}`}>
                        {r.name}
                      </p>
                      <p className="text-muted-foreground text-[11px]">{r.description}</p>
                      {r.detail && <p className="text-[11px] text-emerald-700 mt-0.5">{r.detail}</p>}
                      {r.error && <p className="text-[11px] text-destructive mt-0.5 font-mono break-all">{r.error}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsABDMPage;
