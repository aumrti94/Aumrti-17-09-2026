import React, { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } from "react";
import { formatINRExact } from "@/lib/currency";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useHospitalId } from "@/hooks/useHospitalId";
import {
  Building2, ClipboardList, Send, BarChart3, CalendarClock,
  Settings2, Layers, ShieldCheck, MessageSquare, Bot, SlidersHorizontal,
  TrendingUp, Bell, PieChart, Zap, RefreshCw, ChevronDown, ChevronUp,
  AlertTriangle, IndianRupee, ShieldAlert, Sparkles, Lock, CheckCircle2, Scale,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { differenceInMinutes } from "date-fns";
import { useModuleAccess } from "@/components/access/useModuleAccess";
import ActiveAdmissions from "@/components/insurance/ActiveAdmissions";
import PreAuthQueue from "@/components/insurance/PreAuthQueue";
import ClaimsToSubmit from "@/components/insurance/ClaimsToSubmit";
import ClaimsStatus from "@/components/insurance/ClaimsStatus";
import TPAAgeing from "@/components/insurance/TPAAgeing";
import TPAConfiguration from "@/components/insurance/TPAConfiguration";
import UnifiedAgeingView from "@/components/insurance/UnifiedAgeingView";
import CGHSECHSTab from "@/components/insurance/CGHSECHSTab";
import ESISchemeTab from "@/components/insurance/ESISchemeTab";
import TPAQueryManager from "@/components/insurance/TPAQueryManager";
import AutomationStatusPipeline from "@/components/insurance/AutomationStatusPipeline";
import InsuranceAutomationSettings from "@/components/insurance/InsuranceAutomationSettings";
import EnhancementQueue from "@/components/insurance/EnhancementQueue";
import IntimationsTab from "@/components/insurance/IntimationsTab";
import ArogyasriTab from "@/components/insurance/ArogyasriTab";
import DenialAnalyticsDashboard from "@/components/insurance/DenialAnalyticsDashboard";
import HCXClaimsTab from "@/components/insurance/HCXClaimsTab";
import PaymentReconciliation from "@/components/insurance/PaymentReconciliation";
import TpaDisputePanel from "@/components/insurance/TpaDisputePanel";
import { InsurancePlanContext, useInsurancePlan } from "@/hooks/useInsurancePlan";

// ── Plan Context ───────────────────────────────────────────────────────────────
// Exported so child components can consume it instead of loading settings again.

interface InsurancePlanCtx {
  planTier:   string;
  hospitalId: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const ENHANCEMENT_ROLES  = ["insurance_executive", "super_admin", "hospital_admin"];
const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const PLAN_META = {
  manual:      { label: "Plan A — Manual",       color: "bg-slate-100 text-slate-700",     price: "₹5,000/mo",  dot: "bg-slate-500"   },
  ai_assisted: { label: "Plan B — AI Assisted",  color: "bg-blue-100 text-blue-700",       price: "₹12,000/mo", dot: "bg-blue-500"    },
  automated:   { label: "Plan C — Automated",    color: "bg-emerald-100 text-emerald-700", price: "₹25,000/mo", dot: "bg-emerald-500" },
};

const PLAN_FEATURES: Record<string, string[]> = {
  manual:      ["Manual claims tracking", "Document checklist", "TPA query log", "SLA timer", "Appeal workflow"],
  ai_assisted: ["Everything in Manual", "AI pre-fill for pre-auth", "AI denial prediction", "Email auto-submission", "AI cover letters"],
  automated:   ["Everything in AI Assisted", "HCX API auto-submit", "RPA bot integration", "Auto-reconciliation", "Auto-appeal tracking"],
};

// ── Nav groups ─────────────────────────────────────────────────────────────────

const navGroups = [
  {
    title: "Pre-Admission & Admission",
    items: [
      { key: "admissions",        label: "Active Admissions",   icon: Building2,      roles: null },
      { key: "intimations",       label: "Intimations",         icon: Bell,           roles: null },
      { key: "preauth",           label: "Pre-Auth Queue",      icon: ClipboardList,  roles: null },
      { key: "enhancement_queue", label: "Enhancement Queue",   icon: TrendingUp,     roles: ENHANCEMENT_ROLES },
    ],
  },
  {
    title: "Claim Processing",
    items: [
      { key: "submit",          label: "Claims to Submit",  icon: Send,          roles: null },
      { key: "hcx",             label: "HCX Claims",        icon: Zap,           roles: null },
      { key: "status",          label: "Claims Status",     icon: BarChart3,     roles: null },
      { key: "denial",          label: "Denial Management", icon: ShieldAlert,   roles: null },   // NEW
      { key: "queries",         label: "TPA Queries",       icon: MessageSquare, roles: null },
      { key: "ageing",          label: "TPA Ageing",        icon: CalendarClock, roles: null },
      { key: "unified",         label: "Unified View",      icon: Layers,        roles: null },
      { key: "reconciliation",  label: "Reconciliation",    icon: IndianRupee,   roles: null },
      { key: "disputes",        label: "TPA Disputes",      icon: Scale,         roles: null },
    ],
  },
  {
    title: "Government Schemes",
    items: [
      { key: "cghs_echs",  label: "CGHS / ECHS",       icon: ShieldCheck, roles: null },
      { key: "esi",        label: "ESI Scheme",         icon: ShieldCheck, roles: null },
      { key: "arogyasri",  label: "Arogyasri / State",  icon: ShieldCheck, roles: null },
    ],
  },
  {
    title: "Operations & Analytics",
    items: [
      { key: "analytics",    label: "Denial Analytics",   icon: PieChart,          roles: null },
      { key: "automation",   label: "Automation",         icon: Bot,               roles: null },
      { key: "auto_settings",label: "Auto Settings",      icon: SlidersHorizontal, roles: null },
      { key: "config",       label: "TPA Configuration",  icon: Settings2,         roles: null },
      { key: "settings",     label: "Plan & Settings",    icon: Sparkles,          roles: null },   // NEW
    ],
  },
];

// ── Types ──────────────────────────────────────────────────────────────────────

type DateRange = "this_month" | "last_month" | "last_3_months" | "custom";

interface KPIData {
  pendingPreAuth:     number;
  slaAtRisk:          number;
  outstandingCount:   number;
  outstandingAmount:  number;
  deniedCount:        number;
  denialRate:         number;
  overdueQueries:     number;
  supplementaryNeeded:number;
  avgPreAuthMinutes:  number | null;
  firstPassRate:      number | null;
  avgSettlementDays:  number | null;
  underpaymentAmount: number;
  recoveryRate:       number | null;
  automationPct:      number;
}

const DEFAULT_KPI: KPIData = {
  pendingPreAuth: 0, slaAtRisk: 0,
  outstandingCount: 0, outstandingAmount: 0,
  deniedCount: 0, denialRate: 0,
  overdueQueries: 0, supplementaryNeeded: 0,
  avgPreAuthMinutes: null, firstPassRate: null,
  avgSettlementDays: null, underpaymentAmount: 0,
  recoveryRate: null, automationPct: 0,
};

interface AdmissionContext {
  admission_id:   string;
  patient_id:     string;
  patient_name:   string;
  insurance_type: string;
  admitted_at?:   string;
  estimated_amount?: string;
  notes?:         string;
}

// ── Hooks ──────────────────────────────────────────────────────────────────────

function useInterval(callback: () => void, delay: number) {
  const saved = useRef(callback);
  useEffect(() => { saved.current = callback; });
  useEffect(() => {
    const id = setInterval(() => saved.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const fmtL = (n: number): string => (n > 0 ? formatINRExact(n) : "₹0");

const minutesAgo = (d: Date | null): string => {
  if (!d) return "";
  const m = differenceInMinutes(new Date(), d);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)}h ago`;
};

// ── KPI card ───────────────────────────────────────────────────────────────────

interface KpiCardProps {
  label:      string;
  value:      React.ReactNode;
  sub?:       React.ReactNode;
  valueClass?: string;
  alert?:     boolean;
  pulse?:     boolean;
  onClick?:   () => void;
  loading?:   boolean;
}

const KpiCard = React.memo<KpiCardProps>(({
  label, value, sub, valueClass, alert, pulse, onClick, loading,
}) => (
  <div
    onClick={onClick}
    role={onClick ? "button" : undefined}
    tabIndex={onClick ? 0 : undefined}
    onKeyDown={onClick ? (e) => e.key === "Enter" && onClick() : undefined}
    className={cn(
      "relative flex flex-col justify-center px-4 py-2 border-r border-border min-w-[155px]",
      onClick && "cursor-pointer hover:bg-muted/60 transition-colors",
      alert  && "bg-red-50/40"
    )}
  >
    {/* Pulse indicator */}
    {pulse && (
      <span className="absolute top-2 right-2 flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
    )}
    <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-none">
      {label}
    </p>
    {loading
      ? <div className="h-5 w-16 bg-muted animate-pulse rounded mt-1.5" />
      : <p className={cn("text-lg font-bold leading-none mt-1 tabular-nums", valueClass ?? "text-foreground")}>{value}</p>
    }
    {loading
      ? <div className="h-3 w-20 bg-muted animate-pulse rounded mt-1" />
      : sub && <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">{sub}</p>
    }
  </div>
));

const KpiDivider: React.FC = () => (
  <div className="w-px bg-border/50 self-stretch my-1 mx-1" />
);

// ── Plan & Settings Tab ────────────────────────────────────────────────────────
// Standalone inline component for the `settings` nav item.

interface PlanSettings {
  plan_tier:             string;
  auto_submit_pre_auth:  boolean;
  auto_submit_claims:    boolean;
  sla_alert_channel:     string;
  whatsapp_alert_number: string | null;
  denial_threshold_score:number;
  n8n_webhook_url:       string | null;
}

const DEFAULT_PLAN_SETTINGS: PlanSettings = {
  plan_tier: "manual", auto_submit_pre_auth: false, auto_submit_claims: false,
  sla_alert_channel: "in_app", whatsapp_alert_number: null, denial_threshold_score: 40, n8n_webhook_url: null,
};

const PlanSettingsTab: React.FC<{ hospitalId: string }> = ({ hospitalId }) => {
  const [settings, setSettings]   = useState<PlanSettings>(DEFAULT_PLAN_SETTINGS);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    (supabase as any).from("hospital_insurance_settings").select("*")
      .eq("hospital_id", hospitalId).maybeSingle()
      .then(({ data }: any) => {
        if (data) {
          setSettingsId(data.id);
          setSettings({
            plan_tier:             data.plan_tier             ?? "manual",
            auto_submit_pre_auth:  data.auto_submit_pre_auth  ?? false,
            auto_submit_claims:    data.auto_submit_claims     ?? false,
            sla_alert_channel:     data.sla_alert_channel     ?? "in_app",
            whatsapp_alert_number: data.whatsapp_alert_number ?? null,
            denial_threshold_score: data.denial_threshold_score ?? 40,
            n8n_webhook_url:       data.n8n_webhook_url       ?? null,
          });
        }
        setLoading(false);
      });
  }, [hospitalId]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = { ...settings, hospital_id: hospitalId };
      if (settingsId) {
        await (supabase as any).from("hospital_insurance_settings").update(payload).eq("id", settingsId);
      } else {
        const { data } = await (supabase as any).from("hospital_insurance_settings").insert(payload).select().single();
        if (data?.id) setSettingsId(data.id);
      }
      toast({ title: "Plan settings saved ✓" });
    } catch (e: any) {
      toast({ title: "Save failed", description: e.message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center h-full text-muted-foreground text-sm">Loading…</div>;

  const planTier = settings.plan_tier as keyof typeof PLAN_META;
  const meta     = PLAN_META[planTier] ?? PLAN_META.manual;
  const features = PLAN_FEATURES[planTier] ?? [];

  return (
    <div className="h-full overflow-auto p-5 max-w-2xl space-y-6">
      <div>
        <h2 className="text-base font-bold">Insurance Plan &amp; Settings</h2>
        <p className="text-xs text-muted-foreground mt-0.5">Manage your Aumrti Insurance subscription tier and automation preferences.</p>
      </div>

      {/* Current plan card */}
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-semibold">Current Plan</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={cn("inline-block w-2 h-2 rounded-full", meta.dot)} />
              <span className="text-lg font-bold">{meta.label}</span>
              <span className="text-sm text-muted-foreground">{meta.price}</span>
            </div>
          </div>
          {planTier !== "automated" && (
            <a href="/settings/billing" className="text-xs text-primary underline underline-offset-2">
              Upgrade Plan →
            </a>
          )}
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1">
          {features.map(f => (
            <span key={f} className="flex items-center gap-1 text-xs text-muted-foreground">
              <CheckCircle2 size={11} className="text-emerald-500 shrink-0" /> {f}
            </span>
          ))}
        </div>
      </div>

      {/* Plan tier selector */}
      <div className="space-y-2">
        <Label className="text-sm font-semibold">Subscription Tier</Label>
        <div className="grid grid-cols-3 gap-3">
          {(["manual", "ai_assisted", "automated"] as const).map(tier => {
            const m = PLAN_META[tier];
            const active = settings.plan_tier === tier;
            return (
              <button
                key={tier}
                onClick={() => setSettings(s => ({ ...s, plan_tier: tier }))}
                className={cn(
                  "rounded-lg border-2 px-3 py-2.5 text-left transition-all",
                  active ? "border-primary bg-primary/5" : "border-border hover:border-border/70"
                )}
              >
                <p className="text-xs font-bold">{m.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{m.price}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Automation toggles */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <p className="text-sm font-semibold">Automation Settings</p>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Auto-submit Pre-Auth</Label>
              <p className="text-xs text-muted-foreground">Requires Plan B or higher</p>
            </div>
            {settings.plan_tier === "manual"
              ? <Lock size={14} className="text-muted-foreground" />
              : <Switch checked={settings.auto_submit_pre_auth} onCheckedChange={v => setSettings(s => ({ ...s, auto_submit_pre_auth: v }))} />
            }
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm">Auto-submit Claims</Label>
              <p className="text-xs text-muted-foreground">Requires Plan C (Automated)</p>
            </div>
            {settings.plan_tier !== "automated"
              ? <Lock size={14} className="text-muted-foreground" />
              : <Switch checked={settings.auto_submit_claims} onCheckedChange={v => setSettings(s => ({ ...s, auto_submit_claims: v }))} />
            }
          </div>
        </div>
      </div>

      {/* Alert settings */}
      <div className="rounded-lg border border-border p-4 space-y-4">
        <p className="text-sm font-semibold">SLA &amp; Alert Settings</p>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-sm font-semibold">Alert Channel</Label>
            <Select value={settings.sla_alert_channel} onValueChange={v => setSettings(s => ({ ...s, sla_alert_channel: v }))}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in_app">In-App</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="whatsapp">WhatsApp</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {settings.sla_alert_channel === "whatsapp" && (
            <div>
              <Label className="text-sm font-semibold">WhatsApp Number</Label>
              <Input
                className="mt-1" placeholder="+91 9XXXXXXXXX"
                value={settings.whatsapp_alert_number ?? ""}
                onChange={e => setSettings(s => ({ ...s, whatsapp_alert_number: e.target.value || null }))}
              />
            </div>
          )}
          <div>
            <Label className="text-sm font-semibold">Denial Risk Threshold (0–100)</Label>
            <Input
              className="mt-1" type="number" min={0} max={100}
              value={settings.denial_threshold_score}
              onChange={e => setSettings(s => ({ ...s, denial_threshold_score: Number(e.target.value) }))}
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">Claims above this AI score are held for review.</p>
          </div>
          <div>
            <Label className="text-sm font-semibold">n8n Webhook URL</Label>
            <Input
              className="mt-1 text-xs font-mono" placeholder="https://n8n.your-domain.com/webhook/…"
              value={settings.n8n_webhook_url ?? ""}
              onChange={e => setSettings(s => ({ ...s, n8n_webhook_url: e.target.value || null }))}
            />
            <p className="text-[11px] text-muted-foreground mt-0.5">Relay for WhatsApp alerts via n8n.</p>
          </div>
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="gap-1.5">
        {saving ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
};

// ── Main component ─────────────────────────────────────────────────────────────

const InsurancePage: React.FC = () => {
  const { hospitalId } = useHospitalId();
  const { toast }      = useToast();

  // Navigation
  const [activeNav,        setActiveNav]        = useState("admissions");
  const [pendingAdmission, setPendingAdmission] = useState<AdmissionContext | null>(null);
  const handleAdmissionHandled = useCallback(() => setPendingAdmission(null), []);
  const [userRole,         setUserRole]         = useState<string | null>(null);
  const { tabAllowed } = useModuleAccess();
  const [hcxEnabled,       setHcxEnabled]       = useState(false);

  // Plan context (shared with children via context)
  const [planTier, setPlanTier] = useState("manual");

  // Supplementary alert count (bubbled from ActiveAdmissions)
  const [supplementaryAlertCount, setSupplementaryAlertCount] = useState(0);

  // KPI state
  const [kpiData,         setKpiData]       = useState<KPIData>(DEFAULT_KPI);
  const [kpiLoading,      setKpiLoading]    = useState(true);
  const [kpiError,        setKpiError]      = useState<string | null>(null);
  const [lastRefreshed,   setLastRefreshed] = useState<Date | null>(null);
  const [showPerformance, setShowPerformance] = useState(false);

  // Sidebar badge state
  const [pendingEnhancements, setPendingEnhancements] = useState(0);
  const [failedIntimations,   setFailedIntimations]   = useState(0);
  // Realtime query counter (bumped immediately on INSERT; KPI refresh follows)
  const [realtimeQueryBump, setRealtimeQueryBump] = useState(0);

  // Date range filter
  const [dateRange,  setDateRange]  = useState<DateRange>("this_month");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo,   setCustomTo]   = useState("");

  // ── Date bounds ──────────────────────────────────────────────────────────

  const getDateBounds = useCallback((): { fromISO: string; toISO: string } => {
    const now = new Date();
    let from: Date;
    let to: Date = now;
    switch (dateRange) {
      case "last_month":
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to   = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
        break;
      case "last_3_months":
        from = new Date(now.getFullYear(), now.getMonth() - 3, 1);
        break;
      case "custom":
        from = customFrom ? new Date(customFrom)             : new Date(now.getFullYear(), now.getMonth(), 1);
        to   = customTo   ? new Date(customTo + "T23:59:59") : now;
        break;
      default:
        from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return { fromISO: from.toISOString(), toISO: to.toISOString() };
  }, [dateRange, customFrom, customTo]);

  // ── KPI loader — single RPC call replaces 20 round-trips ────────────────

  const loadKPIs = useCallback(async () => {
    if (!hospitalId) return;
    setKpiLoading(true);
    setKpiError(null);
    try {
      const { fromISO, toISO } = getDateBounds();
      const { data, error } = await (supabase as any).rpc("get_insurance_kpis", {
        p_hospital_id: hospitalId,
        p_from_ts:     fromISO,
        p_to_ts:       toISO,
      });
      if (error) throw error;
      const d = data as any;
      setPendingEnhancements(d.pendingEnhancements ?? 0);
      setFailedIntimations  (d.failedIntimations   ?? 0);
      setKpiData({
        pendingPreAuth:      d.pendingPreAuth      ?? 0,
        slaAtRisk:           d.slaAtRisk           ?? 0,
        outstandingCount:    d.outstandingCount    ?? 0,
        outstandingAmount:   Number(d.outstandingAmount ?? 0),
        deniedCount:         d.deniedCount         ?? 0,
        denialRate:          d.denialRate          ?? 0,
        overdueQueries:      d.overdueQueries      ?? 0,
        supplementaryNeeded: d.supplementaryNeeded ?? 0,
        avgPreAuthMinutes:   d.avgPreAuthMinutes   ?? null,
        firstPassRate:       d.firstPassRate       ?? null,
        avgSettlementDays:   d.avgSettlementDays   ?? null,
        underpaymentAmount:  Number(d.underpaymentAmount ?? 0),
        recoveryRate:        d.recoveryRate        ?? null,
        automationPct:       d.automationPct       ?? 0,
      });
      setLastRefreshed(new Date());
    } catch (err: any) {
      const msg = err?.message ?? "Failed to load KPIs";
      setKpiError(msg);
      toast({ title: "KPI refresh failed", description: msg, variant: "destructive" });
    } finally {
      setKpiLoading(false);
    }
  }, [hospitalId, getDateBounds, toast]);

  // ── Lifecycle ────────────────────────────────────────────────────────────

  // One-time per-hospital init (role, flags, plan tier) — does NOT call loadKPIs
  // to avoid double-firing with the effect below.
  useEffect(() => {
    if (!hospitalId) return;

    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      (supabase as any).from("users").select("role")
        .eq("auth_user_id", user.id).maybeSingle()
        .then(({ data }: { data: any }) => { if (data?.role) setUserRole(data.role); });
    });

    (supabase as any).from("hospital_abdm_config").select("feature_hcx_claims")
      .eq("hospital_id", hospitalId).maybeSingle()
      .then(({ data }: { data: any }) => setHcxEnabled(!!(data?.feature_hcx_claims)));

    (supabase as any).from("hospital_insurance_settings").select("plan_tier")
      .eq("hospital_id", hospitalId).maybeSingle()
      .then(({ data }: { data: any }) => { if (data?.plan_tier) setPlanTier(data.plan_tier); });
  }, [hospitalId]);

  // Fires on mount, hospitalId change, and date-range change (loadKPIs identity changes).
  // Single source of truth for KPI loads — no double-fire.
  useEffect(() => { loadKPIs(); }, [loadKPIs]);
  useInterval(loadKPIs, REFRESH_INTERVAL_MS);

  // ── Realtime — tpa_queries INSERT ────────────────────────────────────────

  useEffect(() => {
    if (!hospitalId) return;

    const channel = supabase
      .channel(`tpa_queries_realtime_${hospitalId}`)
      .on(
        "postgres_changes" as any,
        {
          event:  "INSERT",
          schema: "public",
          table:  "tpa_queries",
          filter: `hospital_id=eq.${hospitalId}`,
        },
        (payload: any) => {
          const deadline = payload.new?.response_deadline
            ? new Date(payload.new.response_deadline).toLocaleDateString("en-IN", { day: "numeric", month: "short" })
            : "check deadline";
          toast({
            title:       "📋 New TPA Query received",
            description: `A TPA has raised a query on a claim. Respond by ${deadline} to avoid rejection.`,
          });
          // Immediate badge bump for UI responsiveness
          setRealtimeQueryBump(n => n + 1);
          // Then refresh KPIs for accurate counts
          setTimeout(() => loadKPIs(), 2000);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [hospitalId, toast, loadKPIs]);

  // ── Navigation ───────────────────────────────────────────────────────────

  const handleNavigate = useCallback((nav: string, admissionData?: AdmissionContext) => {
    setPendingAdmission(nav === "preauth" && admissionData ? admissionData : null);
    setActiveNav(nav);
  }, []);

  const renderContent = () => {
    switch (activeNav) {
      case "admissions":        return <ActiveAdmissions onNavigate={handleNavigate} onNeedsSupplementary={setSupplementaryAlertCount} />;
      case "intimations":       return <IntimationsTab />;
      case "preauth":           return <PreAuthQueue initialAdmission={pendingAdmission} onAdmissionHandled={handleAdmissionHandled} />;
      case "submit":            return <ClaimsToSubmit />;
      case "status":            return <ClaimsStatus />;
      case "denial":            return <ClaimsStatus initialFilter="rejected" />;
      case "ageing":            return <TPAAgeing />;
      case "unified":           return <UnifiedAgeingView />;
      case "cghs_echs":         return <CGHSECHSTab />;
      case "esi":               return <ESISchemeTab />;
      case "arogyasri":         return <ArogyasriTab />;
      case "queries":           return <TPAQueryManager />;
      case "config":            return <TPAConfiguration />;
      case "settings":          return hospitalId ? <PlanSettingsTab hospitalId={hospitalId} /> : null;
      case "automation":        return <AutomationStatusPipeline />;
      case "auto_settings":     return <InsuranceAutomationSettings />;
      case "enhancement_queue": return <EnhancementQueue />;
      case "analytics":         return <DenialAnalyticsDashboard />;
      case "hcx":               return <HCXClaimsTab />;
      case "reconciliation":    return <PaymentReconciliation />;
      case "disputes":          return <TpaDisputePanel />;
      default:                  return null;
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────

  const overdueQueries    = kpiData.overdueQueries;
  // Queries badge = KPI overdue count + any realtime bumps not yet reflected
  const queriesNavBadge   = Math.max(overdueQueries, realtimeQueryBump > 0 ? overdueQueries + realtimeQueryBump : 0);
  const deniedNavBadge    = kpiData.deniedCount > 0 ? kpiData.deniedCount : null;

  // ── Render ───────────────────────────────────────────────────────────────

  const planContextValue = useMemo(
    () => ({ planTier, hospitalId: hospitalId ?? null }),
    [planTier, hospitalId]
  );

  return (
    <InsurancePlanContext.Provider value={planContextValue}>
      <div className="flex flex-col" style={{ height: "calc(100vh - 56px)" }}>

        {/* ── Page header ── */}
        <div className="h-[48px] flex-shrink-0 bg-background border-b border-border px-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-bold text-foreground whitespace-nowrap">Insurance & TPA</h1>
            {hcxEnabled && (
              <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 font-medium border border-violet-200">
                <Zap size={10} /> HCX
              </span>
            )}
            {/* Plan tier badge */}
            <span className={cn("hidden sm:inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full font-medium border",
              PLAN_META[planTier as keyof typeof PLAN_META]?.color ?? "bg-slate-100 text-slate-700"
            )}>
              <span className={cn("w-1.5 h-1.5 rounded-full", PLAN_META[planTier as keyof typeof PLAN_META]?.dot ?? "bg-slate-500")} />
              {PLAN_META[planTier as keyof typeof PLAN_META]?.label ?? planTier}
            </span>
          </div>

          {/* Date range + controls */}
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
              {(["this_month", "last_month", "last_3_months", "custom"] as DateRange[]).map((r) => (
                <button
                  key={r}
                  onClick={() => setDateRange(r)}
                  className={cn(
                    "px-2.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap",
                    dateRange === r
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {r === "this_month" ? "This Month" : r === "last_month" ? "Last Month" : r === "last_3_months" ? "Last 3M" : "Custom"}
                </button>
              ))}
            </div>

            {dateRange === "custom" && (
              <div className="flex items-center gap-1">
                <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-7 text-xs border border-input rounded-md px-2 bg-background w-32" />
                <span className="text-xs text-muted-foreground">–</span>
                <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                  className="h-7 text-xs border border-input rounded-md px-2 bg-background w-32" />
              </div>
            )}

            {lastRefreshed && !kpiLoading && (
              <span className="text-[10px] text-muted-foreground whitespace-nowrap">{minutesAgo(lastRefreshed)}</span>
            )}
            <button
              onClick={loadKPIs} disabled={kpiLoading} title="Refresh KPIs"
              className="h-7 w-7 flex items-center justify-center rounded-md border border-input bg-background hover:bg-muted transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={cn(kpiLoading && "animate-spin")} />
            </button>

            {/* Contextual alert chips */}
            {overdueQueries > 0 && (
              <button onClick={() => setActiveNav("queries")}
                className="text-[11px] px-2.5 py-1 rounded-full bg-orange-100 text-orange-800 font-semibold border border-orange-300 hover:bg-orange-200 transition-colors whitespace-nowrap">
                ⚠️ {overdueQueries} overdue
              </button>
            )}
            {(supplementaryAlertCount > 0 || kpiData.supplementaryNeeded > 0) && (
              <button onClick={() => setActiveNav("admissions")}
                className="text-[11px] px-2.5 py-1 rounded-full bg-red-100 text-red-800 font-semibold border border-red-300 hover:bg-red-200 transition-colors whitespace-nowrap">
                🔔 {Math.max(supplementaryAlertCount, kpiData.supplementaryNeeded)} need supplementary
              </button>
            )}
            {kpiData.underpaymentAmount > 0 && (
              <button onClick={() => setActiveNav("reconciliation")}
                className="text-[11px] px-2.5 py-1 rounded-full bg-red-50 text-red-700 font-semibold border border-red-200 hover:bg-red-100 transition-colors whitespace-nowrap flex items-center gap-1">
                <IndianRupee size={10} />
                {fmtL(kpiData.underpaymentAmount)} underpayments
              </button>
            )}
            {pendingEnhancements > 0 && userRole && ENHANCEMENT_ROLES.includes(userRole) && (
              <button onClick={() => setActiveNav("enhancement_queue")}
                className="text-[11px] px-2.5 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold border border-amber-200 hover:bg-amber-200 transition-colors whitespace-nowrap">
                {pendingEnhancements} enh. pending
              </button>
            )}
          </div>
        </div>

        {/* ── KPI error banner ── */}
        {kpiError && (
          <div className="flex-shrink-0 flex items-center gap-2 px-4 py-2 bg-red-50 border-b border-red-200 text-xs text-red-700">
            <AlertTriangle size={13} className="shrink-0" />
            <span>{kpiError}</span>
            <button onClick={loadKPIs} className="ml-auto underline underline-offset-2 font-medium">Retry</button>
          </div>
        )}

        {/* ── KPI strip ── */}
        <div className="flex-shrink-0 bg-background border-b border-border">
          {/* Row 1 — real-time status */}
          <div className="flex overflow-x-auto scrollbar-hide">
            <KpiCard
              label="Pre-Auth Pending"
              value={kpiData.pendingPreAuth}
              sub={kpiData.slaAtRisk > 0
                ? <span className="text-red-600 font-semibold animate-pulse">⏱ {kpiData.slaAtRisk} SLA at risk</span>
                : "no SLA at risk"}
              valueClass={kpiData.pendingPreAuth > 0 ? "text-amber-700" : "text-foreground"}
              pulse={kpiData.slaAtRisk > 0}
              onClick={() => handleNavigate("preauth")}
              loading={kpiLoading}
            />
            <KpiDivider />
            <KpiCard
              label="Claims Outstanding"
              value={fmtL(kpiData.outstandingAmount)}
              sub={`${kpiData.outstandingCount} claims · submitted + under review`}
              valueClass="text-blue-700"
              onClick={() => handleNavigate("status")}
              loading={kpiLoading}
            />
            <KpiDivider />
            <KpiCard
              label="Denied This Period"
              value={kpiData.deniedCount}
              sub={kpiData.denialRate > 0
                ? <span className={kpiData.denialRate > 20 ? "text-red-600 font-semibold" : ""}>
                    {kpiData.denialRate}% denial rate
                  </span>
                : "0% denial rate"}
              valueClass={kpiData.deniedCount > 0 ? "text-red-700" : "text-foreground"}
              alert={kpiData.denialRate > 20}
              onClick={() => handleNavigate("denial")}
              loading={kpiLoading}
            />
            <KpiDivider />
            <KpiCard
              label="TPA Queries Overdue"
              value={kpiData.overdueQueries}
              sub={kpiData.overdueQueries > 0 ? "TPA may reject claims" : "all on time"}
              valueClass={kpiData.overdueQueries > 0 ? "text-orange-700" : "text-foreground"}
              alert={kpiData.overdueQueries > 0}
              pulse={kpiData.overdueQueries > 0}
              onClick={() => handleNavigate("queries")}
              loading={kpiLoading}
            />
            <KpiDivider />
            <KpiCard
              label="Need Supplementary"
              value={kpiData.supplementaryNeeded}
              sub="admissions ≥80% utilization"
              valueClass={kpiData.supplementaryNeeded > 0 ? "text-violet-700" : "text-foreground"}
              onClick={() => handleNavigate("enhancement_queue")}
              loading={kpiLoading}
            />
            <KpiDivider />
            <KpiCard
              label="Automation Rate"
              value={`${kpiData.automationPct}%`}
              sub="of admissions auto-handled"
              valueClass={kpiData.automationPct >= 50 ? "text-emerald-700" : "text-muted-foreground"}
              loading={kpiLoading}
            />

            {/* Performance row toggle */}
            <button
              onClick={() => setShowPerformance((v) => !v)}
              className="ml-auto px-4 flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border-l border-border shrink-0 transition-colors"
              title={showPerformance ? "Hide performance metrics" : "Show performance metrics"}
            >
              {showPerformance ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
              <span className="whitespace-nowrap">Performance</span>
            </button>
          </div>

          {/* Row 2 — performance (collapsible) */}
          {showPerformance && (
            <div className="flex overflow-x-auto scrollbar-hide border-t border-border/60 bg-muted/20">
              <KpiCard
                label="Avg Pre-Auth Time"
                value={kpiData.avgPreAuthMinutes !== null ? `${kpiData.avgPreAuthMinutes} min` : "—"}
                sub={kpiData.avgPreAuthMinutes !== null
                  ? kpiData.avgPreAuthMinutes > 60
                    ? <span className="text-red-600 font-semibold">SLA target: 60 min ⚠️</span>
                    : "✓ within 60 min SLA"
                  : "insufficient data"}
                valueClass={
                  kpiData.avgPreAuthMinutes === null ? "text-muted-foreground" :
                  kpiData.avgPreAuthMinutes > 60    ? "text-red-700" : "text-emerald-700"
                }
                loading={kpiLoading}
              />
              <KpiDivider />
              <KpiCard
                label="First-pass Approval"
                value={kpiData.firstPassRate !== null ? `${kpiData.firstPassRate}%` : "—"}
                sub="pre-auth approved first time"
                valueClass={
                  kpiData.firstPassRate === null ? "text-muted-foreground" :
                  kpiData.firstPassRate >= 80    ? "text-emerald-700" :
                  kpiData.firstPassRate >= 60    ? "text-amber-700"   : "text-red-700"
                }
                loading={kpiLoading}
              />
              <KpiDivider />
              <KpiCard
                label="Avg Claim Settlement"
                value={kpiData.avgSettlementDays !== null ? `${kpiData.avgSettlementDays} days` : "—"}
                sub="from submission to approval"
                valueClass={
                  kpiData.avgSettlementDays === null ? "text-muted-foreground" :
                  kpiData.avgSettlementDays > 30    ? "text-red-700" :
                  kpiData.avgSettlementDays > 15    ? "text-amber-700" : "text-emerald-700"
                }
                loading={kpiLoading}
              />
              <KpiDivider />
              <KpiCard
                label="Underpayments Pending"
                value={fmtL(kpiData.underpaymentAmount)}
                sub="unrectified shortfalls"
                valueClass={kpiData.underpaymentAmount > 0 ? "text-orange-700" : "text-foreground"}
                loading={kpiLoading}
              />
              <KpiDivider />
              <KpiCard
                label="Recovery Rate"
                value={kpiData.recoveryRate !== null ? `${kpiData.recoveryRate}%` : "—"}
                sub="settled / claimed amount"
                valueClass={
                  kpiData.recoveryRate === null ? "text-muted-foreground" :
                  kpiData.recoveryRate >= 90   ? "text-emerald-700" :
                  kpiData.recoveryRate >= 75   ? "text-amber-700"   : "text-red-700"
                }
                loading={kpiLoading}
              />
            </div>
          )}
        </div>

        {/* ── Nav + content ── */}
        <div className="flex flex-1 overflow-hidden">
          <nav className="w-[240px] bg-background border-r border-border flex-shrink-0 flex flex-col py-2 overflow-y-auto">
            {navGroups.map((group, gIdx) => {
              const filteredItems = group.items.filter((item) =>
                (item.roles === null || (userRole !== null && item.roles.includes(userRole)))
                && tabAllowed("insurance", item.key)
              );
              if (filteredItems.length === 0) return null;
              return (
                <div key={gIdx} className="mb-4 last:mb-0">
                  <div className="px-4 mb-1">
                    <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      {group.title}
                    </h3>
                  </div>
                  <div>
                    {filteredItems.map((item) => {
                      const Icon     = item.icon;
                      const isActive = activeNav === item.key;
                      const badge =
                        item.key === "enhancement_queue" && pendingEnhancements > 0 ? pendingEnhancements :
                        item.key === "intimations"        && failedIntimations > 0   ? failedIntimations   :
                        item.key === "queries"            && queriesNavBadge > 0     ? queriesNavBadge     :
                        item.key === "denial"             && deniedNavBadge !== null ? deniedNavBadge      :
                        null;
                      return (
                        <button
                          key={item.key}
                          onClick={() => handleNavigate(item.key)}
                          className={cn(
                            "flex items-center gap-3 h-10 px-4 text-[13px] font-medium transition-colors text-left w-full",
                            isActive
                              ? "bg-primary/5 text-primary border-l-[3px] border-primary"
                              : "text-muted-foreground hover:bg-muted/50 border-l-[3px] border-transparent"
                          )}
                        >
                          <Icon size={16} className="shrink-0" />
                          <span className="flex-1">{item.label}</span>
                          {badge !== null && (
                            <span className={cn(
                              "text-[10px] font-bold rounded-full px-1.5 py-0.5 leading-none",
                              item.key === "intimations" ? "bg-red-100 text-red-700"      :
                              item.key === "queries"     ? "bg-orange-100 text-orange-800":
                              item.key === "denial"      ? "bg-red-100 text-red-700"      :
                                                           "bg-amber-100 text-amber-700"
                            )}>
                              {badge}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </nav>
          <main className="flex-1 bg-muted/20 overflow-hidden relative">
            {renderContent()}
          </main>
        </div>
      </div>
    </InsurancePlanContext.Provider>
  );
};

export default InsurancePage;
