import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Plus, X, Save, Loader2, Trash2, MessageCircle, AlertTriangle, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import type { AumrtiAdmin } from "@/hooks/useAumrtiAdmin";
import { getErrorMessage } from "@/lib/errorMessage";
import { FormError } from "@/components/ui/FormError";
import { logAdminAction } from "@/lib/adminAudit";

async function fetchAdmins(): Promise<AumrtiAdmin[]> {
  const { data } = await (supabase as any).from("aumrti_admins").select("*").order("created_at");
  return data || [];
}

interface PlatformSettings {
  signup_otp_enabled: boolean;
  meta_phone_number_id: string | null;
  meta_otp_template: string | null;
  meta_otp_template_lang: string | null;
}

async function fetchPlatformSettings(): Promise<PlatformSettings | null> {
  // Sensitive column meta_access_token is intentionally NOT selected.
  const { data } = await (supabase as any)
    .from("platform_settings")
    .select("signup_otp_enabled, meta_phone_number_id, meta_otp_template, meta_otp_template_lang")
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// ── Social login (OAuth) provider settings ──────────────────────────────────
const OAUTH_PROVIDERS = [
  { key: "google", label: "Google" },
  { key: "azure", label: "Microsoft (Azure)" },
  { key: "facebook", label: "Facebook" },
] as const;

interface OAuthRow {
  provider: string;
  enabled: boolean;
  client_id: string | null;
}

async function fetchOAuthProviders(): Promise<OAuthRow[]> {
  // client_secret is intentionally NOT selected — it is write-only from the UI.
  const { data } = await (supabase as any)
    .from("oauth_provider_settings")
    .select("provider, enabled, client_id");
  return data || [];
}

export default function PlatformSettingsPage() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [uuidInput, setUuidInput] = useState("");

  const { data: admins = [], isLoading } = useQuery({
    queryKey: ["platform-admins"],
    queryFn: fetchAdmins,
    staleTime: 60_000,
  });

  const addAdmin = useMutation({
    mutationFn: async () => {
      await (supabase as any).from("aumrti_admins").insert([{
        auth_user_id: uuidInput,
        full_name: fullName,
        email,
        is_active: true,
      }]);
    },
    onSuccess: () => {
      logAdminAction("admin_added", { details: { email, full_name: fullName } });
      toast.success("Admin added successfully");
      setShowForm(false);
      setEmail(""); setFullName(""); setUuidInput("");
      qc.invalidateQueries({ queryKey: ["platform-admins"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  const deactivate = useMutation({
    mutationFn: async (id: string) => {
      await (supabase as any).from("aumrti_admins").update({ is_active: false }).eq("id", id);
      return id;
    },
    onSuccess: (deactivatedId: string) => {
      logAdminAction("admin_deactivated", { details: { admin_id: deactivatedId } });
      toast.success("Admin deactivated");
      qc.invalidateQueries({ queryKey: ["platform-admins"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  // ── Data erasure requests (DPDP review queue) ─────────────────────────────
  const { data: erasureRequests = [], isLoading: erasureLoading } = useQuery({
    queryKey: ["platform-erasure-requests"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("data_erasure_requests")
        .select("id, hospital_id, reason, status, requested_at, admin_notes, hospitals(name)")
        .in("status", ["pending", "in_review"])
        .order("requested_at", { ascending: true });
      return data || [];
    },
    staleTime: 30_000,
  });

  const actionErasureRequest = useMutation({
    mutationFn: async ({ id, hospitalId, status }: { id: string; hospitalId: string; status: "approved" | "rejected" }) => {
      const { data: { user } } = await supabase.auth.getUser();
      await (supabase as any).from("data_erasure_requests").update({
        status, reviewed_by: user?.id, reviewed_at: new Date().toISOString(),
      }).eq("id", id);
      if (status === "approved") {
        // Kicks off the existing two-phase soft-delete flow — this does NOT
        // purge immediately, it starts the 7-day grace window, same as a
        // manual delete from HospitalDetailPage.
        await (supabase as any).functions.invoke("delete-hospital", { body: { hospital_id: hospitalId } });
      }
    },
    onSuccess: (_r, vars) => {
      logAdminAction(vars.status === "approved" ? "erasure_request_approved" : "erasure_request_rejected", { hospitalId: vars.hospitalId });
      toast.success(vars.status === "approved" ? "Approved — hospital marked for deletion (7-day grace period started)" : "Request rejected");
      qc.invalidateQueries({ queryKey: ["platform-erasure-requests"] });
    },
    onError: (e: any) => toast.error(getErrorMessage(e)),
  });

  // ── Signup WhatsApp OTP settings ──────────────────────────────────────────
  const { data: settings, isLoading: settingsLoading } = useQuery({
    queryKey: ["platform-settings"],
    queryFn: fetchPlatformSettings,
    staleTime: 60_000,
  });

  const [otpEnabled, setOtpEnabled] = useState(false);
  const [metaPhoneId, setMetaPhoneId] = useState("");
  const [metaToken, setMetaToken] = useState("");
  const [metaTemplate, setMetaTemplate] = useState("");
  const [metaLang, setMetaLang] = useState("en");
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  // Hydrate the form from the loaded settings (token is never read back).
  useEffect(() => {
    if (!settings) return;
    setOtpEnabled(!!settings.signup_otp_enabled);
    setMetaPhoneId(settings.meta_phone_number_id ?? "");
    setMetaTemplate(settings.meta_otp_template ?? "");
    setMetaLang(settings.meta_otp_template_lang ?? "en");
  }, [settings]);

  const credsConfigured = !!(settings?.meta_phone_number_id && settings?.meta_otp_template);
  const formCredsIncomplete = !metaPhoneId.trim() || !metaTemplate.trim();

  const saveSettings = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const payload: any = {
        id: true,
        signup_otp_enabled: otpEnabled,
        whatsapp_provider: "meta_cloud",
        meta_phone_number_id: metaPhoneId.trim() || null,
        meta_otp_template: metaTemplate.trim() || null,
        meta_otp_template_lang: metaLang.trim() || "en",
        updated_at: new Date().toISOString(),
        updated_by: user?.id ?? null,
      };
      // Only overwrite the access token when a new value is entered — blank keeps the saved one.
      if (metaToken.trim()) payload.meta_access_token = metaToken.trim();
      const { error } = await (supabase as any)
        .from("platform_settings")
        .upsert(payload, { onConflict: "id" });
      if (error) throw error;
    },
    onSuccess: () => {
      setSettingsError(null);
      toast.success("WhatsApp OTP settings saved");
      setMetaToken("");
      qc.invalidateQueries({ queryKey: ["platform-settings"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setSettingsError(m); toast.error(m); },
  });

  // ── Social login (OAuth) ───────────────────────────────────────────────────
  const { data: oauthRows, isLoading: oauthLoading } = useQuery({
    queryKey: ["oauth-providers"],
    queryFn: fetchOAuthProviders,
    staleTime: 60_000,
  });

  type OAuthFormEntry = { enabled: boolean; clientId: string; clientSecret: string };
  const [oauthForm, setOauthForm] = useState<Record<string, OAuthFormEntry>>({});

  // Hydrate the editable form from loaded rows (secrets are never read back).
  useEffect(() => {
    if (!oauthRows) return;
    const byProvider = new Map(oauthRows.map((r) => [r.provider, r]));
    const next: Record<string, OAuthFormEntry> = {};
    for (const p of OAUTH_PROVIDERS) {
      const row = byProvider.get(p.key);
      next[p.key] = { enabled: !!row?.enabled, clientId: row?.client_id ?? "", clientSecret: "" };
    }
    setOauthForm(next);
  }, [oauthRows]);

  const setOAuthField = (provider: string, patch: Partial<OAuthFormEntry>) =>
    setOauthForm((prev) => ({ ...prev, [provider]: { ...prev[provider], ...patch } }));

  const oauthConfigured = (oauthRows || []).some((r) => r.enabled && r.client_id);

  const saveOAuth = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      // Upsert per provider so a blank secret never overwrites the saved one.
      for (const p of OAUTH_PROVIDERS) {
        const f = oauthForm[p.key] ?? { enabled: false, clientId: "", clientSecret: "" };
        const payload: any = {
          provider: p.key,
          enabled: f.enabled,
          client_id: f.clientId.trim() || null,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        };
        if (f.clientSecret.trim()) payload.client_secret = f.clientSecret.trim();
        const { error } = await (supabase as any)
          .from("oauth_provider_settings")
          .upsert(payload, { onConflict: "provider" });
        if (error) throw error;
      }
      // Push the keys to the Supabase project auth config via the Management API.
      const { data: res, error: fnErr } = await (supabase as any).functions.invoke("update-oauth-providers");
      if (fnErr) throw fnErr;
      if (res?.error) throw new Error(res.error);
    },
    onSuccess: () => {
      setOauthError(null);
      toast.success("Social login providers saved & applied");
      setOauthForm((prev) => {
        const cleared = { ...prev };
        for (const k of Object.keys(cleared)) cleared[k] = { ...cleared[k], clientSecret: "" };
        return cleared;
      });
      qc.invalidateQueries({ queryKey: ["oauth-providers"] });
    },
    onError: (e: any) => { const m = getErrorMessage(e); setOauthError(m); toast.error(m); },
  });

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <h1 className="text-[15px] font-semibold text-foreground">Platform Settings</h1>
      </div>

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {/* Admins section */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Aumrti Admins</p>
            <button
              onClick={() => setShowForm(true)}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors"
            >
              <Plus size={12} /> Add Admin
            </button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-24"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase font-bold text-muted-foreground border-b border-border">
                  {["Name", "Email", "Status", "Added", ""].map((h) => (
                    <th key={h} className="px-5 py-2.5 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {admins.map((a) => (
                  <tr key={a.id} className="border-t border-border hover:bg-muted/40">
                    <td className="px-5 py-3 text-xs font-medium text-foreground">{a.full_name}</td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{a.email}</td>
                    <td className="px-5 py-3">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${a.is_active ? "bg-emerald-500/20 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                        {a.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-xs text-muted-foreground">{format(new Date(a.created_at), "dd MMM yyyy")}</td>
                    <td className="px-5 py-3">
                      {a.is_active && (
                        <button
                          onClick={() => deactivate.mutate(a.id)}
                          className="text-muted-foreground hover:text-red-500 transition-colors"
                          title="Deactivate"
                        >
                          <Trash2 size={13} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Signup WhatsApp OTP */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageCircle size={14} className="text-emerald-600" />
              <p className="text-sm font-semibold text-foreground">Signup Phone Verification (WhatsApp OTP)</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${credsConfigured ? "bg-emerald-500/20 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
              {credsConfigured ? "Configured" : "Not configured"}
            </span>
          </div>

          {settingsLoading ? (
            <div className="flex items-center justify-center h-24"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="p-5 space-y-5">
              {/* Master toggle */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-foreground">Require OTP verification at signup</p>
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-md">
                    When ON, every hospital must verify their mobile number via a WhatsApp OTP before
                    registering. When OFF, registration proceeds without verification.
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={otpEnabled}
                  onClick={() => setOtpEnabled((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${otpEnabled ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                >
                  <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${otpEnabled ? "translate-x-5" : "translate-x-0.5"}`} />
                </button>
              </div>

              {otpEnabled && formCredsIncomplete && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
                  <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                  <span>
                    OTP is ON but the WhatsApp credentials below are incomplete. Verification is
                    fail-closed — new signups will be blocked until a valid Phone Number ID and
                    approved template are saved.
                  </span>
                </div>
              )}

              {/* Meta Cloud API credentials */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground">Meta Phone Number ID</label>
                  <input
                    type="text"
                    value={metaPhoneId}
                    onChange={(e) => setMetaPhoneId(e.target.value)}
                    placeholder="e.g. 123456789012345"
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Authentication Template Name</label>
                  <input
                    type="text"
                    value={metaTemplate}
                    onChange={(e) => setMetaTemplate(e.target.value)}
                    placeholder="e.g. signup_otp"
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Template Language</label>
                  <input
                    type="text"
                    value={metaLang}
                    onChange={(e) => setMetaLang(e.target.value)}
                    placeholder="en"
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Permanent Access Token</label>
                  <input
                    type="password"
                    value={metaToken}
                    onChange={(e) => setMetaToken(e.target.value)}
                    placeholder={credsConfigured ? "•••••• (leave blank to keep saved)" : "Paste Meta system-user token"}
                    autoComplete="off"
                    className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                  />
                </div>
              </div>

              <FormError message={settingsError} />

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  Template must be a Meta-approved <strong>Authentication</strong> template.
                </p>
                <button
                  onClick={() => saveSettings.mutate()}
                  disabled={saveSettings.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {saveSettings.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save Settings
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Social Login (OAuth) */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <KeyRound size={14} className="text-blue-600" />
              <p className="text-sm font-semibold text-foreground">Social Login (OAuth)</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${oauthConfigured ? "bg-emerald-500/20 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
              {oauthConfigured ? "Active" : "Not configured"}
            </span>
          </div>

          {oauthLoading ? (
            <div className="flex items-center justify-center h-24"><Loader2 size={18} className="animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="p-5 space-y-5">
              <div className="flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                <span>
                  Saving here pushes the keys live to this Supabase project's auth config (via the
                  Management API). Set each provider's redirect URL to{" "}
                  <code className="font-mono">https://&lt;project-ref&gt;.supabase.co/auth/v1/callback</code>{" "}
                  in the provider console. Client secrets are write-only and never shown after saving.
                </span>
              </div>

              {OAUTH_PROVIDERS.map((p) => {
                const f = oauthForm[p.key] ?? { enabled: false, clientId: "", clientSecret: "" };
                const savedRow = (oauthRows || []).find((r) => r.provider === p.key);
                const hasClientId = !!savedRow?.client_id;
                return (
                  <div key={p.key} className="border border-border rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-foreground">{p.label}</p>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={f.enabled}
                        onClick={() => setOAuthField(p.key, { enabled: !f.enabled })}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${f.enabled ? "bg-emerald-500" : "bg-muted-foreground/30"}`}
                      >
                        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${f.enabled ? "translate-x-5" : "translate-x-0.5"}`} />
                      </button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs text-muted-foreground">Client ID</label>
                        <input
                          type="text"
                          value={f.clientId}
                          onChange={(e) => setOAuthField(p.key, { clientId: e.target.value })}
                          placeholder="Paste client ID"
                          autoComplete="off"
                          className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-muted-foreground">Client Secret</label>
                        <input
                          type="password"
                          value={f.clientSecret}
                          onChange={(e) => setOAuthField(p.key, { clientSecret: e.target.value })}
                          placeholder={hasClientId ? "•••••• (leave blank to keep saved)" : "Paste client secret"}
                          autoComplete="off"
                          className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                        />
                      </div>
                    </div>
                    {f.enabled && !hasClientId && !f.clientId.trim() && (
                      <p className="text-[11px] text-amber-600">Enabled but no Client ID set — the button won't work until keys are saved.</p>
                    )}
                  </div>
                );
              })}

              <FormError message={oauthError} />

              <div className="flex items-center justify-between">
                <p className="text-[11px] text-muted-foreground">
                  Enabled providers appear on the login page automatically.
                </p>
                <button
                  onClick={() => saveOAuth.mutate()}
                  disabled={saveOAuth.isPending}
                  className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-semibold rounded-lg transition-colors disabled:opacity-50"
                >
                  {saveOAuth.isPending ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save &amp; Apply
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Data Erasure Requests */}
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="px-5 py-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-600" />
              <p className="text-sm font-semibold text-foreground">Data Erasure Requests</p>
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${erasureRequests.length > 0 ? "bg-red-500/20 text-red-600" : "bg-muted text-muted-foreground"}`}>
              {erasureRequests.length} pending
            </span>
          </div>
          {erasureLoading ? (
            <div className="flex items-center justify-center h-16"><Loader2 size={16} className="animate-spin text-muted-foreground" /></div>
          ) : erasureRequests.length === 0 ? (
            <p className="text-xs text-muted-foreground p-5">No pending DPDP erasure requests.</p>
          ) : (
            <div className="divide-y divide-border">
              {erasureRequests.map((r: any) => (
                <div key={r.id} className="p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">{r.hospitals?.name || r.hospital_id}</p>
                    <span className="text-[10px] text-muted-foreground">{format(new Date(r.requested_at), "dd MMM yyyy, HH:mm")}</span>
                  </div>
                  {r.reason && <p className="text-xs text-muted-foreground">"{r.reason}"</p>}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => actionErasureRequest.mutate({ id: r.id, hospitalId: r.hospital_id, status: "approved" })}
                      disabled={actionErasureRequest.isPending}
                      className="px-3 py-1.5 bg-red-600/10 hover:bg-red-600/20 border border-red-600/30 text-red-600 text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-50"
                    >
                      Approve → Start 7-day deletion
                    </button>
                    <button
                      onClick={() => actionErasureRequest.mutate({ id: r.id, hospitalId: r.hospital_id, status: "rejected" })}
                      disabled={actionErasureRequest.isPending}
                      className="px-3 py-1.5 border border-border text-muted-foreground hover:text-foreground text-[11px] font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Instructions */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <p className="text-sm font-semibold text-foreground mb-3">How to add a new Aumrti admin</p>
          <ol className="space-y-2 text-xs text-muted-foreground list-decimal list-inside">
            <li>Go to <span className="text-blue-600">Supabase Dashboard → Authentication → Users</span></li>
            <li>Click <strong className="text-foreground">Add user</strong> → enter email and a strong password → Create</li>
            <li>Copy the UUID of the new user</li>
            <li>Come back here, click <strong className="text-foreground">Add Admin</strong>, paste the UUID</li>
          </ol>
        </div>
      </div>

      {/* Add admin modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="bg-card border border-border rounded-xl w-[420px] shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Add Aumrti Admin</p>
              <button onClick={() => setShowForm(false)}><X size={15} className="text-muted-foreground hover:text-foreground" /></button>
            </div>

            <div className="p-5 space-y-4">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700">
                    First create the user in Supabase Auth (Authentication → Users → Add user), then paste their UUID below.
                  </div>
                  {[
                    { label: "Full Name", val: fullName, set: setFullName, type: "text" },
                    { label: "Email", val: email, set: setEmail, type: "email" },
                    { label: "Auth User UUID (from Supabase)", val: uuidInput, set: setUuidInput, type: "text" },
                  ].map(({ label, val, set, type }) => (
                    <div key={label}>
                      <label className="text-xs text-muted-foreground">{label}</label>
                      <input
                        type={type}
                        value={val}
                        onChange={(e) => set(e.target.value)}
                        className="w-full mt-1 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary"
                      />
                    </div>
                  ))}
                  <button
                    onClick={() => addAdmin.mutate()}
                    disabled={!fullName || !email || !uuidInput || addAdmin.isPending}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-semibold rounded-lg transition-colors disabled:opacity-50"
                  >
                    {addAdmin.isPending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    Add Admin
                  </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
