import React from "react";
import { useQuery } from "@tanstack/react-query";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Mail, AlertTriangle, Clock, CheckCircle2, XCircle, Loader2, FileText, ExternalLink, Gift, Copy, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useSubscriptionConfig } from "@/hooks/useSubscriptionConfig";
import { useHospitalId } from "@/hooks/useHospitalId";
import { supabase } from "@/integrations/supabase/client";
import { ALL_MODULES } from "@/lib/modules";
import SubscribeButton from "@/components/subscription/SubscribeButton";
import PaymentHistoryTable from "@/components/billing/PaymentHistoryTable";

// Module key → display name map
const ROUTE_KEY: Record<string, string> = {
  "/opd":"opd","/ipd":"ipd","/ipd/day-care":"day_care","/emergency":"emergency",
  "/ot":"ot","/nursing":"nursing","/telemedicine":"telemedicine","/packages":"health_packages",
  "/lab":"lab","/radiology":"radiology","/blood-bank":"blood_bank","/cssd":"cssd",
  "/pharmacy":"pharmacy","/pharmacy?mode=retail":"pharmacy_retail","/billing":"billing",
  "/billing/closure":"day_closure","/insurance":"insurance","/payments":"payments",
  "/accounts":"accounts","/assets":"assets","/pmjay":"pmjay","/hr":"hr",
  "/inventory":"inventory","/quality":"quality","/dialysis":"dialysis","/oncology":"oncology",
  "/physio":"physio","/mortuary":"mortuary","/vaccination":"vaccination","/ambulance":"ambulance",
  "/home-care":"home_care","/dental":"dental","/ayush":"ayush","/ivf":"ivf",
  "/specialty/anc":"obstetric_anc","/specialty/neonatal":"neonatal",
  "/specialty/anaesthesia":"anaesthesia","/specialty/ophthalmology":"ophthalmology",
  "/specialty/partograph":"partograph","/mental-health":"mental_health",
  "/chronic-disease":"chronic_disease","/mrd":"mrd","/biomedical":"biomedical",
  "/housekeeping":"housekeeping","/hmis":"hmis","/dietetics":"dietetics","/lms":"lms",
  "/crm":"crm","/abdm":"abdm","/portal":"patient_portal","/pro":"patient_relations",
  "/inbox":"inbox","/analytics":"analytics","/hod-dashboard":"hod_dashboard",
  "/tv-display":"tv_display","/settings":"settings",
};
const MODULE_NAME = new Map<string, string>(
  ALL_MODULES.map((m) => [ROUTE_KEY[m.route] ?? ROUTE_KEY[m.route.split("?")[0]], m.name])
);

// Format price in Indian locale
const fmtINR = (n: number) =>
  `₹${n.toLocaleString("en-IN")}`;

// Format date to DD/MM/YYYY
const fmtDate = (iso: string | null | undefined) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

// Human-readable storage size (decimal GB/MB/KB, matching quota units).
const formatBytes = (bytes: number): string => {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
};

// Usage percentage that treats a limit of 0 as a real hard cap (not "unlimited").
// null limit  → unlimited → 0%; limit 0 with any usage → over limit → 100%.
const limitPct = (used: number, limit: number | null): number => {
  if (limit == null) return 0;
  if (limit <= 0) return used > 0 ? 100 : 0;
  return Math.min(100, Math.round((used / limit) * 100));
};

const SettingsPlanPage: React.FC = () => {
  const { hospitalId } = useHospitalId();

  const {
    plan, subscription, status,
    trialDaysLeft, isExpired, isSuspended,
    enabledModules, effectiveMonthlyPrice, effectiveYearlyPrice,
    isLoading,
  } = useSubscriptionConfig();

  // Staff count for usage stats
  const { data: usageData } = useQuery({
    queryKey: ["plan-usage", hospitalId],
    queryFn: async () => {
      const [staffRes, hospRes] = await Promise.all([
        supabase.from("users").select("id", { count: "exact", head: true })
          .eq("hospital_id", hospitalId!).eq("is_active", true),
        supabase.from("hospitals").select("beds_count").eq("id", hospitalId!).maybeSingle(),
      ]);
      return {
        staffCount: staffRes.count || 0,
        bedsCount: (hospRes.data as any)?.beds_count || 0,
      };
    },
    enabled: !!hospitalId,
    staleTime: 5 * 60_000,
  });

  // AI usage this billing cycle (calendar month) — observability only, not
  // billed yet. Only counts toward ai_included_budget_usd if the plan has
  // one set (NULL for every plan today — see the migration comment).
  const { data: aiUsage } = useQuery({
    queryKey: ["plan-ai-usage", hospitalId],
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const { data } = await (supabase as any)
        .from("ai_cost_daily")
        .select("total_cost_usd, total_calls")
        .eq("hospital_id", hospitalId!)
        .gte("date", monthStart.toISOString().slice(0, 10));
      const rows = data || [];
      return {
        totalCostUsd: rows.reduce((s: number, r: any) => s + Number(r.total_cost_usd || 0), 0),
        totalCalls: rows.reduce((s: number, r: any) => s + Number(r.total_calls || 0), 0),
      };
    },
    enabled: !!hospitalId,
    staleTime: 5 * 60_000,
  });

  const { data: aiBudget } = useQuery({
    queryKey: ["plan-ai-budget", plan?.id],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscription_plans")
        .select("ai_included_budget_usd")
        .eq("id", plan!.id)
        .maybeSingle();
      return data?.ai_included_budget_usd as number | null;
    },
    enabled: !!plan?.id,
    staleTime: 5 * 60_000,
  });

  // Storage usage: exact file bytes + estimated DB-row share (per-tenant RPC)
  const { data: storageUsage } = useQuery({
    queryKey: ["plan-storage", hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("get_storage_usage", { p_hospital_id: hospitalId });
      return (data || { file_bytes: 0, db_bytes_est: 0, total_bytes: 0 }) as {
        file_bytes: number; db_bytes_est: number; total_bytes: number;
      };
    },
    enabled: !!hospitalId,
    staleTime: 5 * 60_000,
  });

  // Refer & Earn: the hospital's own referral code (lazily created) + funnel stats
  const { data: referral } = useQuery({
    queryKey: ["hospital-referral", hospitalId],
    queryFn: async () => {
      const [codeRes, statsRes] = await Promise.all([
        (supabase as any).rpc("get_or_create_hospital_referral_code", { p_hospital_id: hospitalId }),
        (supabase as any).rpc("get_referral_stats", { p_hospital_id: hospitalId }),
      ]);
      return {
        code: (codeRes.data as any)?.code || "",
        signed_up: (statsRes.data as any)?.signed_up || 0,
        converted: (statsRes.data as any)?.converted || 0,
        reward_earned: (statsRes.data as any)?.reward_earned || 0,
      };
    },
    enabled: !!hospitalId,
    staleTime: 5 * 60_000,
  });
  const [refCopied, setRefCopied] = React.useState(false);

  // Other available plans for upgrade section
  const { data: allPlans = [] } = useQuery({
    queryKey: ["available-plans"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscription_plans")
        .select("id, name, slug, price_monthly, price_yearly, is_custom_price, badge_text, description, razorpay_plan_id")
        .eq("is_active", true)
        .order("sort_order");
      return data || [];
    },
    staleTime: 5 * 60_000,
  });

  // Invoice history
  const { data: invoices = [] } = useQuery({
    queryKey: ["subscription-invoices", hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscription_invoices")
        .select("id, invoice_number, amount_inr, plan_name, billing_period_start, billing_period_end, pdf_storage_path, status, created_at")
        .eq("hospital_id", hospitalId!)
        .order("created_at", { ascending: false })
        .limit(12);
      return data || [];
    },
    enabled: !!hospitalId,
    staleTime: 5 * 60_000,
  });


  if (isLoading) {
    return (
      <SettingsPageWrapper title="Plan & Billing" hideSave>
        <div className="flex items-center justify-center h-40">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      </SettingsPageWrapper>
    );
  }

  const staffCount = usageData?.staffCount ?? 0;
  const bedsCount = usageData?.bedsCount ?? 0;
  const maxStaff = plan?.max_staff ?? null;
  const maxBeds  = plan?.max_beds  ?? null;

  // Storage: total_bytes vs plan quota (storage_included_gb; NULL = unlimited)
  const storageBytes = storageUsage?.total_bytes ?? 0;
  const storageGb = plan?.storage_included_gb ?? null;
  const storageLimitBytes = storageGb ? storageGb * 1e9 : null;

  const usageRows: {
    label: string; used: number | string; limit: number | string | null; pct: number; sub?: string;
  }[] = [
    {
      label: "Staff Accounts",
      used: staffCount,
      limit: maxStaff,
      // limitPct: null limit = unlimited (0%); a 0 limit with any usage = over limit (100%).
      pct: limitPct(staffCount, maxStaff),
    },
    {
      label: "Registered Beds",
      used: bedsCount,
      limit: maxBeds,
      pct: limitPct(bedsCount, maxBeds),
    },
    {
      label: "Active Modules",
      used: enabledModules.length,
      limit: 56,
      pct: Math.round((enabledModules.length / 56) * 100),
    },
    {
      label: "Database Storage",
      used: formatBytes(storageBytes),
      limit: storageLimitBytes ? formatBytes(storageLimitBytes) : null,
      pct: storageLimitBytes ? Math.round((storageBytes / storageLimitBytes) * 100) : 0,
      sub: `Files ${formatBytes(storageUsage?.file_bytes ?? 0)} · DB ≈ ${formatBytes(storageUsage?.db_bytes_est ?? 0)} (est.)`,
    },
  ];

  // Status badge config
  const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    trial:           { label: "Free Trial",   color: "bg-blue-50 text-blue-700 border-blue-200",     icon: <Clock size={13} /> },
    active:          { label: "Active",       color: "bg-emerald-50 text-emerald-700 border-emerald-200", icon: <CheckCircle2 size={13} /> },
    past_due:        { label: "Payment Due",  color: "bg-amber-50 text-amber-700 border-amber-200",   icon: <AlertTriangle size={13} /> },
    suspended:       { label: "Suspended",    color: "bg-red-50 text-red-700 border-red-200",         icon: <XCircle size={13} /> },
    cancelled:       { label: "Cancelled",    color: "bg-red-50 text-red-700 border-red-200",         icon: <XCircle size={13} /> },
    no_subscription: { label: "Trial",        color: "bg-blue-50 text-blue-700 border-blue-200",      icon: <Clock size={13} /> },
  };
  const statusCfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.no_subscription;

  return (
    <SettingsPageWrapper title="Plan & Billing" hideSave>
      <div className="space-y-8">

        {/* ── Alert banners ── */}
        {isExpired && (
          <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-5 py-4 text-sm text-red-700">
            <XCircle size={18} className="shrink-0" />
            <div>
              <p className="font-semibold">Your trial has expired</p>
              <p className="text-xs mt-0.5 text-red-600">Contact support to activate your subscription and restore full access.</p>
            </div>
            <Button size="sm" className="ml-auto bg-red-600 hover:bg-red-700 text-white" onClick={() => window.open("mailto:support@aumrti.in")}>
              Contact Support
            </Button>
          </div>
        )}
        {isSuspended && !isExpired && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-700">
            <AlertTriangle size={18} className="shrink-0" />
            <div>
              <p className="font-semibold">Account {status === "past_due" ? "payment overdue" : "suspended"}</p>
              <p className="text-xs mt-0.5 text-amber-600">Please clear dues to restore access. Contact support for help.</p>
            </div>
            <Button size="sm" variant="outline" className="ml-auto border-amber-400 text-amber-700 hover:bg-amber-50" onClick={() => window.open("mailto:support@aumrti.in")}>
              Contact Support
            </Button>
          </div>
        )}
        {status === "trial" && trialDaysLeft !== null && trialDaysLeft <= 7 && trialDaysLeft > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-700">
            <Clock size={18} className="shrink-0" />
            <p><span className="font-semibold">{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} left</span> in your free trial.</p>
            <Button size="sm" className="ml-auto bg-blue-600 hover:bg-blue-700 text-white" onClick={() => window.open("mailto:support@aumrti.in")}>
              Upgrade Now
            </Button>
          </div>
        )}

        {/* ── Current plan card ── */}
        <div className="rounded-xl bg-accent/30 border border-border p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Current Plan</p>
              <p className="text-2xl font-bold text-primary mt-1">
                {plan?.name ?? "Trial"}
                {plan?.badge_text && (
                  <span className="ml-2 text-sm font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                    {plan.badge_text}
                  </span>
                )}
              </p>
              {plan?.description && (
                <p className="text-sm text-muted-foreground mt-1 max-w-md leading-relaxed">{plan.description}</p>
              )}
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium ${statusCfg.color}`}>
              {statusCfg.icon}
              {statusCfg.label}
              {status === "trial" && trialDaysLeft !== null && (
                <span className="ml-1">— {trialDaysLeft}d left</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Monthly Price</p>
              <p className="font-bold text-foreground mt-0.5">
                {plan?.is_custom_price ? "Custom" : effectiveMonthlyPrice > 0 ? fmtINR(effectiveMonthlyPrice) : "—"}
                {!plan?.is_custom_price && effectiveMonthlyPrice > 0 && <span className="text-muted-foreground font-normal">/month</span>}
              </p>
            </div>
            {!plan?.is_custom_price && effectiveYearlyPrice > 0 && (
              <div>
                <p className="text-xs text-muted-foreground">Yearly Price</p>
                <p className="font-bold text-foreground mt-0.5">
                  {fmtINR(effectiveYearlyPrice)}<span className="text-muted-foreground font-normal">/year</span>
                </p>
              </div>
            )}
            {subscription?.trial_ends_at && status === "trial" && (
              <div>
                <p className="text-xs text-muted-foreground">Trial Ends</p>
                <p className="font-medium text-foreground mt-0.5">{fmtDate(subscription.trial_ends_at)}</p>
              </div>
            )}
            {subscription?.current_period_end && status === "active" && (
              <div>
                <p className="text-xs text-muted-foreground">Next Billing</p>
                <p className="font-medium text-foreground mt-0.5">{fmtDate(subscription.current_period_end)}</p>
              </div>
            )}
            {plan?.max_beds != null && (
              <div>
                <p className="text-xs text-muted-foreground">Bed Limit</p>
                <p className="font-medium text-foreground mt-0.5">{plan.max_beds} beds</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Usage statistics ── */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-4">Usage Statistics</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {usageRows.map((u) => (
              <div key={u.label} className="bg-card border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground">{u.label}</p>
                <p className="text-lg font-bold text-foreground mt-1">
                  {u.used}
                  {u.limit != null && (
                    <span className="text-sm font-normal text-muted-foreground"> / {u.limit}</span>
                  )}
                </p>
                {u.limit != null && (
                  <Progress
                    value={u.pct}
                    className={`mt-2 h-1.5 ${u.pct >= 90 ? "[&>div]:bg-red-500" : u.pct >= 70 ? "[&>div]:bg-amber-500" : ""}`}
                  />
                )}
                {u.sub && (
                  <p className="text-[11px] text-muted-foreground mt-2 leading-tight">{u.sub}</p>
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── AI usage this cycle ── */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-1">AI Usage This Cycle</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Not billed separately today — shown here for visibility as usage-based AI billing is being scoped.
          </p>
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">AI Calls</p>
              <p className="text-lg font-bold text-foreground mt-1">{aiUsage?.totalCalls ?? 0}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Estimated Cost</p>
              <p className="text-lg font-bold text-foreground mt-1">${(aiUsage?.totalCostUsd ?? 0).toFixed(2)}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Included in Plan</p>
              <p className="text-lg font-bold text-foreground mt-1">
                {aiBudget != null ? `$${aiBudget.toFixed(2)}` : "Not metered"}
              </p>
            </div>
          </div>
        </section>

        {/* ── Refer & Earn ── */}
        {referral?.code && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
              <Gift size={15} className="text-primary" /> Refer &amp; Earn
            </h2>
            <p className="text-xs text-muted-foreground mb-4">
              Share your invite link. When a hospital signs up with it and subscribes, you earn a reward.
            </p>
            <div className="bg-card border border-border rounded-lg p-4 flex flex-col md:flex-row gap-5">
              <div className="bg-white p-2 rounded-lg self-start shrink-0">
                <QRCodeSVG value={`${window.location.origin}/register?ref=${referral.code}`} size={104} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap gap-4 mb-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Signed up</p>
                    <p className="text-lg font-bold text-foreground">{referral.signed_up}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Converted</p>
                    <p className="text-lg font-bold text-emerald-600">{referral.converted}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Reward earned</p>
                    <p className="text-lg font-bold text-foreground">{referral.reward_earned} free month(s)</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-1">Your referral code: <span className="font-mono font-bold text-foreground">{referral.code}</span></p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={`${window.location.origin}/register?ref=${referral.code}`}
                    className="flex-1 min-w-0 h-8 px-3 text-xs bg-background border border-border rounded-lg text-foreground/80 focus:outline-none"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 shrink-0"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/register?ref=${referral.code}`);
                      setRefCopied(true);
                      setTimeout(() => setRefCopied(false), 1500);
                    }}
                  >
                    {refCopied ? <Check size={13} className="mr-1" /> : <Copy size={13} className="mr-1" />}
                    {refCopied ? "Copied" : "Copy link"}
                  </Button>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ── Active modules ── */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Active Modules
            <span className="ml-2 text-muted-foreground font-normal text-xs">({enabledModules.length} of 56)</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {enabledModules.map((key) => {
              const name = MODULE_NAME.get(key) || key;
              return <Badge key={key} variant="secondary" className="text-xs">{name}</Badge>;
            })}
          </div>
        </section>

        {/* ── Other available plans (upgrade prompt) ── */}
        {allPlans.length > 1 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-4">Available Plans</h2>
            <div className="grid grid-cols-3 gap-4">
              {allPlans
                .filter((p: any) => p.slug !== plan?.slug)
                .map((p: any) => (
                  <div key={p.id} className="bg-card border border-border rounded-xl p-4 space-y-2">
                    <div>
                      <p className="text-sm font-bold text-foreground">{p.name}</p>
                      {p.badge_text && (
                        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">{p.badge_text}</span>
                      )}
                    </div>
                    <p className="text-lg font-bold text-foreground">
                      {p.is_custom_price ? "Custom" : `${fmtINR(p.price_monthly)}/mo`}
                    </p>
                    {p.description && (
                      <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">{p.description}</p>
                    )}
                    <SubscribeButton
                      plan={p}
                      label={p.is_custom_price ? "Contact Sales" : `Upgrade to ${p.name}`}
                      variant="outline"
                      className="w-full text-xs mt-2"
                    />
                  </div>
                ))}
            </div>
          </section>
        )}

        {/* ── Primary subscribe CTA (shown when no active plan) ── */}
        {(status === "no_subscription" || status === "trial") && allPlans.length > 0 && (
          <div className="flex gap-3 flex-wrap">
            {allPlans
              .filter((p: any) => !p.is_custom_price && p.slug !== "enterprise")
              .map((p: any) => (
                <SubscribeButton
                  key={p.id}
                  plan={p}
                  label={`Subscribe — ${p.name}`}
                  className="gap-2"
                />
              ))}
          </div>
        )}

        {/* ── Payment History ── */}
        <PaymentHistoryTable hospitalId={hospitalId ?? undefined} title="Payment History" limit={12} />

        {/* ── Actions ── */}
        <div className="flex gap-3">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => window.open("mailto:support@aumrti.in?subject=Billing query")}
          >
            <Mail size={14} /> Contact Support
          </Button>
          {invoices[0]?.pdf_storage_path && (
            <Button variant="outline" className="gap-2" onClick={() => downloadInvoiceDocument(invoices[0])}>
              <Download size={14} /> Latest Invoice
            </Button>
          )}
        </div>

        {/* Razorpay sub ID for reference */}
        {subscription?.razorpay_subscription_id && (
          <p className="text-xs text-muted-foreground">
            Subscription ID: <span className="font-mono">{subscription.razorpay_subscription_id}</span>
          </p>
        )}
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsPlanPage;
