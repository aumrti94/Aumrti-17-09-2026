import React from "react";
import { useQuery } from "@tanstack/react-query";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Mail, AlertTriangle, Clock, CheckCircle2, XCircle, Loader2, FileText, ExternalLink, Gift, Copy, Check, Sparkles } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useSubscriptionConfig } from "@/hooks/useSubscriptionConfig";
import { useHospitalId } from "@/hooks/useHospitalId";
import { supabase } from "@/integrations/supabase/client";
import { ALL_MODULES } from "@/lib/modules";
import SubscribeButton from "@/components/subscription/SubscribeButton";
import PaymentHistoryTable, { downloadInvoiceDocument } from "@/components/billing/PaymentHistoryTable";
import UpgradeDialog from "@/components/subscription/UpgradeDialog";
import { toast } from "sonner";
import {
  activeSkus, addonsMonthlyTotal, describeGrant,
  type AddonSku, type HospitalAddon,
} from "@/lib/addons";
import { resolveAiBudgetStatus } from "@/lib/aiBudget";
import { formatINRExact, formatINRPrecise } from "@/lib/currency";
import { resolveEncounterAllowance, type EncounterAllowanceStatus } from "@/lib/encounterAllowance";

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
    isLoading, refetch,
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
  // billed yet. Only counts toward ai_included_budget_inr if the plan has
  // one set (NULL for every plan today — see the migration comment).
  const { data: aiUsage } = useQuery({
    queryKey: ["plan-ai-usage", hospitalId],
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const { data } = await (supabase as any)
        .from("ai_cost_daily")
        .select("total_cost_inr, total_calls")
        .eq("hospital_id", hospitalId!)
        .gte("date", monthStart.toISOString().slice(0, 10));
      const rows = data || [];
      return {
        totalCostInr: rows.reduce((s: number, r: any) => s + Number(r.total_cost_inr || 0), 0),
        totalCalls: rows.reduce((s: number, r: any) => s + Number(r.total_calls || 0), 0),
      };
    },
    enabled: !!hospitalId,
    staleTime: 5 * 60_000,
  });

  // Budget status comes from the hospital_ai_budget_status view, which is the
  // authority on what counts: it EXCLUDES safety-class AI (drug interactions,
  // allergy and deterioration alerts) from the cap. Summing ai_cost_daily
  // directly here would count those and could show a hospital as over budget
  // because of its safety checks.
  const { data: budgetRow } = useQuery({
    queryKey: ["ai-budget-status", hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("hospital_ai_budget_status")
        .select("budget_inr, metered_cost_inr, safety_cost_inr, total_calls")
        .eq("hospital_id", hospitalId!)
        .maybeSingle();
      return data as {
        budget_inr: number | null; metered_cost_inr: number;
        safety_cost_inr: number; total_calls: number;
      } | null;
    },
    enabled: !!hospitalId,
    staleTime: 5 * 60_000,
  });

  // ── Encounter / document allowances + prepaid credits (Phase 4) ──
  const { data: encUsage, refetch: refetchEncUsage } = useQuery({
    queryKey: ["encounter-usage", hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("hospital_encounter_usage")
        .select("voice_encounters, ocr_documents, voice_encounters_included, ocr_documents_included, encounter_credits, document_credits")
        .eq("hospital_id", hospitalId!)
        .maybeSingle();
      return data as {
        voice_encounters: number; ocr_documents: number;
        voice_encounters_included: number | null; ocr_documents_included: number | null;
        encounter_credits: number; document_credits: number;
      } | null;
    },
    enabled: !!hospitalId,
    staleTime: 5 * 60_000,
  });

  const { data: packs = [] } = useQuery({
    queryKey: ["credit-packs"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("credit_packs")
        .select("id, slug, name, description, encounters, documents, price_inr")
        .eq("is_active", true)
        .order("sort_order");
      return (data || []) as Array<{
        id: string; slug: string; name: string; description: string | null;
        encounters: number; documents: number; price_inr: number;
      }>;
    },
    staleTime: 5 * 60_000,
  });

  const voiceAllowance = resolveEncounterAllowance({
    used: encUsage?.voice_encounters,
    included: encUsage?.voice_encounters_included,
    creditBalance: encUsage?.encounter_credits,
  });
  const scanAllowance = resolveEncounterAllowance({
    used: encUsage?.ocr_documents,
    included: encUsage?.ocr_documents_included,
    creditBalance: encUsage?.document_credits,
  });

  const [pendingPack, setPendingPack] = React.useState<typeof packs[number] | null>(null);
  const [packBusy, setPackBusy] = React.useState(false);

  const aiBudgetStatus = resolveAiBudgetStatus({
    meteredCostInr: budgetRow?.metered_cost_inr,
    budgetInr: budgetRow?.budget_inr,
    safetyCostInr: budgetRow?.safety_cost_inr,
  });

  // Tenant-facing budget display is staged: off until a full cycle of complete
  // metering data has been reviewed (ten AI functions logged nothing before
  // Phase 3, so earlier figures understate reality).
  const { data: meteringLive = false } = useQuery({
    queryKey: ["flag-ai-metering-live", hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("resolve_feature_flag", {
        p_key: "ai_metering_live", p_hospital_id: hospitalId,
      });
      return data === true;
    },
    enabled: !!hospitalId,
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
  const [upgradeOpen, setUpgradeOpen] = React.useState(false);

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

  // ── Add-ons (pricing v3 Phase 2) ──
  // Catalogue + what this hospital already owns. Purchase does NOT go through
  // Razorpay: an add-on is granted immediately and the subscription amount is
  // rebound at the next renewal by the webhook reconciler, so buying one is a
  // confirm-and-write action rather than a checkout.
  const { data: addonCatalogue = [] } = useQuery({
    queryKey: ["addon-catalogue"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("addon_skus")
        .select("id, slug, name, description, price_monthly, price_yearly, module_keys, ai_feature_keys, badge_text, sort_order")
        .eq("is_active", true)
        .order("sort_order");
      return (data || []) as AddonSku[];
    },
    staleTime: 5 * 60_000,
  });

  const { data: myAddons = [], refetch: refetchAddons } = useQuery({
    queryKey: ["hospital-addons", hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("hospital_addons")
        .select("id, addon_sku_id, status, granted_at, billing_starts_at, source, addon_skus(id, slug, name, description, price_monthly, price_yearly, module_keys, ai_feature_keys, sort_order)")
        .eq("hospital_id", hospitalId!)
        .eq("status", "active");
      return (data || []) as HospitalAddon[];
    },
    enabled: !!hospitalId,
    staleTime: 60_000,
  });

  const ownedSkuIds = new Set(myAddons.map((a) => a.addon_sku_id));
  const ownedSkus = activeSkus(myAddons);
  const [pendingAddon, setPendingAddon] = React.useState<AddonSku | null>(null);
  const [addonBusy, setAddonBusy] = React.useState(false);

  // Invoice history
  const { data: invoices = [] } = useQuery({
    queryKey: ["subscription-invoices", hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscription_invoices")
        .select("id, invoice_number, pdf_storage_path, document_format, created_at")
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
  // Staff logins are unlimited on every plan (pricing v3): per-user pricing
  // incentivises shared logins, which destroy clinical audit attribution.
  const maxBeds  = plan?.max_beds  ?? null;

  // Bed-band pricing: extra beds are BILLED, not blocked, so the meaningful
  // figure is how many blocks this hospital is paying for — not a cap.
  const bedsIncluded  = plan?.beds_included ?? null;
  const bedBlockSize  = plan?.bed_block_size ?? 10;
  const bedBlockPrice = plan?.price_per_bed_block ?? null;
  const bedBlocks = bedsIncluded != null && bedBlockPrice != null
    ? Math.max(0, Math.ceil((bedsCount - bedsIncluded) / (bedBlockSize || 10)))
    : 0;

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
      // Unlimited on every plan — give every nurse her own login, because the
      // NABH evidence trail depends on actions being attributable to a person.
      limit: null,
      pct: 0,
      sub: "Unlimited on every plan",
    },
    {
      label: "Registered Beds",
      used: bedsCount,
      // On a bed-banded plan there is no cap to fill, so the bar is not a
      // "usage vs limit" gauge — it shows what is being billed.
      limit: bedBlockPrice != null ? null : maxBeds,
      pct: bedBlockPrice != null ? 0 : limitPct(bedsCount, maxBeds),
      sub: bedBlockPrice != null
        ? `${bedsIncluded ?? 0} included · ${bedBlocks} × ${bedBlockSize}-bed block${bedBlocks === 1 ? "" : "s"} billed at ${fmtINR(bedBlockPrice)} each`
        : undefined,
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
              <p className="text-xs mt-0.5 text-red-600">Activate a paid subscription to restore full access. Your data is safe.</p>
            </div>
            <Button size="sm" className="ml-auto bg-red-600 hover:bg-red-700 text-white" onClick={() => setUpgradeOpen(true)}>
              Reactivate
            </Button>
          </div>
        )}
        {isSuspended && !isExpired && (
          <div className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-sm text-amber-700">
            <AlertTriangle size={18} className="shrink-0" />
            <div>
              <p className="font-semibold">Account {status === "past_due" ? "payment overdue" : "suspended"}</p>
              <p className="text-xs mt-0.5 text-amber-600">Clear the outstanding amount to restore access.</p>
            </div>
            <Button size="sm" variant="outline" className="ml-auto border-amber-400 text-amber-700 hover:bg-amber-50" onClick={() => setUpgradeOpen(true)}>
              Pay Now
            </Button>
          </div>
        )}
        {status === "trial" && trialDaysLeft !== null && trialDaysLeft <= 7 && trialDaysLeft > 0 && (
          <div className="flex items-center gap-3 bg-blue-50 border border-blue-200 rounded-xl px-5 py-4 text-sm text-blue-700">
            <Clock size={18} className="shrink-0" />
            <p><span className="font-semibold">{trialDaysLeft} day{trialDaysLeft !== 1 ? "s" : ""} left</span> in your free trial.</p>
            <Button size="sm" className="ml-auto bg-blue-600 hover:bg-blue-700 text-white" onClick={() => setUpgradeOpen(true)}>
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
            {meteringLive && aiBudgetStatus.budgeted
              ? "Your plan includes an AI allowance. Going over it never interrupts anything — we will just suggest a better-fitting plan."
              : "Shown for visibility. AI usage is not billed separately."}
          </p>

          {/* Budget bar — only once metering is live AND the plan is metered. */}
          {meteringLive && aiBudgetStatus.budgeted && (
            <div className="bg-card border border-border rounded-lg p-4 mb-4">
              <div className="flex items-baseline justify-between mb-2">
                <p className="text-xs text-muted-foreground">AI allowance used</p>
                <p className="text-xs font-medium text-foreground">
                  {formatINRPrecise(aiBudgetStatus.usedInr)} of {formatINRExact(aiBudgetStatus.budgetInr!)}
                  <span className="text-muted-foreground font-normal ml-1.5">
                    ({Math.round(aiBudgetStatus.pctUsed!)}%)
                  </span>
                </p>
              </div>
              <Progress value={Math.min(100, aiBudgetStatus.pctUsed ?? 0)} className="h-2" />

              {aiBudgetStatus.state !== "ok" && (
                <div className="mt-3 pt-3 border-t border-border flex items-start gap-2">
                  <Sparkles size={13} className="text-primary mt-0.5 shrink-0" />
                  <div className="text-xs">
                    <p className="text-foreground font-medium">
                      {aiBudgetStatus.state === "over"
                        ? "You are using more AI than your plan includes."
                        : "You are approaching your AI allowance."}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      Nothing has been limited or charged. A higher plan or AI Suite Pro would
                      give you more headroom.
                    </p>
                    <button
                      onClick={() => setUpgradeOpen(true)}
                      className="text-primary hover:underline font-medium mt-1"
                    >
                      See options
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-muted-foreground mt-3">
                Safety features — drug interactions, allergy and deterioration alerts — are never
                limited and never count toward this allowance
                {aiBudgetStatus.safetyInr > 0 ? ` (${formatINRPrecise(aiBudgetStatus.safetyInr)} this cycle).` : "."}
              </p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">AI Calls</p>
              <p className="text-lg font-bold text-foreground mt-1">{aiUsage?.totalCalls ?? 0}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Estimated Cost</p>
              <p className="text-lg font-bold text-foreground mt-1">{formatINRPrecise(aiUsage?.totalCostInr ?? 0)}</p>
            </div>
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-xs text-muted-foreground">Included in Plan</p>
              <p className="text-lg font-bold text-foreground mt-1">
                {aiBudgetStatus.budgetInr != null ? formatINRExact(aiBudgetStatus.budgetInr) : "Not metered"}
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

        {/* ── Dictation & scanning allowances ── */}
        {meteringLive && (voiceAllowance.metered || scanAllowance.metered) && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-1">Dictation &amp; Scanning</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Your plan includes a monthly allowance. Beyond it we draw on any credits you
              hold — and nothing ever stops working mid-clinic.
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { label: "Dictated notes", unit: "notes", a: voiceAllowance, credits: encUsage?.encounter_credits ?? 0 },
                { label: "Documents scanned", unit: "documents", a: scanAllowance, credits: encUsage?.document_credits ?? 0 },
              ] as Array<{ label: string; unit: string; a: EncounterAllowanceStatus; credits: number }>)
                .filter((row) => row.a.metered)
                .map((row) => (
                  <div key={row.label} className="bg-card border border-border rounded-lg p-4">
                    <div className="flex items-baseline justify-between mb-2">
                      <p className="text-xs text-muted-foreground">{row.label}</p>
                      <p className="text-xs font-medium text-foreground">
                        {row.a.used} of {row.a.included}
                        <span className="text-muted-foreground font-normal ml-1.5">this month</span>
                      </p>
                    </div>
                    <Progress value={Math.min(100, row.a.pctUsed ?? 0)} className="h-2" />

                    {row.credits > 0 && (
                      <p className="text-[11px] text-muted-foreground mt-2">
                        <span className="text-foreground font-medium">+{row.credits} credits</span> in reserve —
                        these don&apos;t expire while your subscription is active.
                      </p>
                    )}

                    {row.a.drawingCredits && (
                      <p className="text-[11px] mt-2 text-foreground">
                        {row.a.creditsLeft >= 0
                          ? `Monthly allowance used — drawing on your credits (${row.a.creditsLeft} left).`
                          : `Allowance and credits both used. Nothing has been limited; top up when convenient.`}
                      </p>
                    )}

                    {row.a.state === "approaching" && !row.a.drawingCredits && (
                      <p className="text-[11px] text-muted-foreground mt-2">
                        Approaching this month&apos;s allowance.
                      </p>
                    )}
                  </div>
                ))}
            </div>

            {packs.length > 0 && (
              <>
                <p className="text-xs text-muted-foreground mt-4 mb-2">
                  Top up with credits that carry over — useful for seasonal peaks.
                </p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {packs.map((p) => (
                    <div key={p.id} className="border border-border rounded-lg p-3 flex flex-col">
                      <p className="text-sm font-semibold text-foreground">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {p.encounters > 0 ? `${p.encounters} notes` : ""}
                        {p.encounters > 0 && p.documents > 0 ? " · " : ""}
                        {p.documents > 0 ? `${p.documents} scans` : ""}
                      </p>
                      <div className="flex items-center justify-between mt-3 pt-2 border-t border-border">
                        <p className="text-sm font-bold text-foreground">{fmtINR(Number(p.price_inr))}</p>
                        <Button size="sm" variant="outline" onClick={() => setPendingPack(p)}>Buy</Button>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        )}

        {/* Pack purchase confirmation. Same confirm-and-write pattern as add-ons:
            credits are granted immediately and the charge joins the next
            renewal, so there is no separate checkout to fail. */}
        {pendingPack && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPendingPack(null)}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <p className="text-base font-bold text-foreground">Buy {pendingPack.name}?</p>
              <p className="text-xs text-muted-foreground mt-1">
                {pendingPack.encounters > 0 ? `${pendingPack.encounters} dictated notes. ` : ""}
                {pendingPack.documents > 0 ? `${pendingPack.documents} document scans. ` : ""}
                Available immediately.
              </p>

              <div className="bg-accent/30 rounded-xl p-4 mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">One-time</span>
                  <span className="font-medium text-foreground">{fmtINR(Number(pendingPack.price_inr))}</span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-border">
                  <span className="text-muted-foreground">Added to invoice</span>
                  <span className="font-medium text-foreground">
                    {subscription?.current_period_end ? fmtDate(subscription.current_period_end) : "next renewal"}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground mt-3">
                Credits do not expire while your subscription is active.
              </p>

              <div className="flex gap-2 mt-5">
                <Button variant="outline" className="flex-1" onClick={() => setPendingPack(null)} disabled={packBusy}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={packBusy}
                  onClick={async () => {
                    if (!hospitalId || !pendingPack) return;
                    setPackBusy(true);
                    try {
                      // Two grants rather than one: encounters and documents are
                      // separate balances, and a pack may carry either or both.
                      if (pendingPack.encounters > 0) {
                        const { error } = await (supabase as any).rpc("grant_credits", {
                          p_hospital_id: hospitalId, p_kind: "encounter",
                          p_qty: pendingPack.encounters,
                          p_reason: `Purchased ${pendingPack.name}`, p_source: "purchase",
                        });
                        if (error) throw error;
                      }
                      if (pendingPack.documents > 0) {
                        const { error } = await (supabase as any).rpc("grant_credits", {
                          p_hospital_id: hospitalId, p_kind: "document",
                          p_qty: pendingPack.documents,
                          p_reason: `Purchased ${pendingPack.name}`, p_source: "purchase",
                        });
                        if (error) throw error;
                      }
                      toast.success(`${pendingPack.name} added — credits available now.`);
                      setPendingPack(null);
                      await refetchEncUsage();
                    } catch (e: any) {
                      toast.error(e?.message || "Could not add credits. Please try again.");
                    } finally {
                      setPackBusy(false);
                    }
                  }}
                >
                  {packBusy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                  Confirm
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* ── Add-ons ── */}
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-1">Add-ons</h2>
          <p className="text-xs text-muted-foreground mb-4">
            Extend your plan without changing tier. Access starts immediately; the charge
            appears from your next renewal
            {subscription?.current_period_end ? ` on ${fmtDate(subscription.current_period_end)}` : ""}.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            {addonCatalogue.map((sku) => {
              const owned = ownedSkuIds.has(sku.id);
              return (
                <div
                  key={sku.id}
                  className={`rounded-xl border p-4 ${owned ? "border-emerald-300 bg-emerald-50/40 dark:bg-emerald-950/10" : "border-border"}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{sku.name}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{describeGrant(sku)}</p>
                    </div>
                    {owned ? (
                      <Badge variant="secondary" className="text-[10px] shrink-0">
                        <Check size={10} className="mr-1" /> Active
                      </Badge>
                    ) : sku.badge_text ? (
                      <Badge variant="outline" className="text-[10px] shrink-0">{sku.badge_text}</Badge>
                    ) : null}
                  </div>

                  {sku.description && (
                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{sku.description}</p>
                  )}

                  <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
                    <p className="text-sm font-bold text-foreground">
                      {fmtINR(Number(sku.price_monthly))}
                      <span className="text-[11px] font-normal text-muted-foreground">/mo</span>
                    </p>
                    {!owned && (
                      <Button size="sm" variant="outline" onClick={() => setPendingAddon(sku)}>
                        Add
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {ownedSkus.length > 0 && (
            <p className="text-xs text-muted-foreground mt-3">
              Add-ons total <span className="font-semibold text-foreground">{fmtINR(addonsMonthlyTotal(ownedSkus))}/month</span>,
              billed with your subscription. To remove one, contact support.
            </p>
          )}
        </section>

        {/* Purchase confirmation — states the exact renewal date and the new
            total, because "access now, charge later" is only fair if the
            customer is told when later is. */}
        {pendingAddon && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setPendingAddon(null)}>
            <div className="bg-card border border-border rounded-2xl w-full max-w-md shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
              <p className="text-base font-bold text-foreground">Add {pendingAddon.name}?</p>
              <p className="text-xs text-muted-foreground mt-1">{describeGrant(pendingAddon)} unlocked immediately.</p>

              <div className="bg-accent/30 rounded-xl p-4 mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">This add-on</span>
                  <span className="font-medium text-foreground">{fmtINR(Number(pendingAddon.price_monthly))}/mo</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Add-ons after this</span>
                  <span className="font-medium text-foreground">
                    {fmtINR(addonsMonthlyTotal([...ownedSkus, pendingAddon]))}/mo
                  </span>
                </div>
                <div className="flex justify-between pt-1.5 border-t border-border">
                  <span className="text-muted-foreground">First charged</span>
                  <span className="font-medium text-foreground">
                    {subscription?.current_period_end ? fmtDate(subscription.current_period_end) : "next renewal"}
                  </span>
                </div>
              </div>

              <p className="text-[11px] text-muted-foreground mt-3">
                Nothing is charged today. Your subscription amount updates at the next renewal.
              </p>

              <div className="flex gap-2 mt-5">
                <Button variant="outline" className="flex-1" onClick={() => setPendingAddon(null)} disabled={addonBusy}>
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  disabled={addonBusy}
                  onClick={async () => {
                    if (!hospitalId || !pendingAddon) return;
                    setAddonBusy(true);
                    try {
                      const { error } = await (supabase as any).from("hospital_addons").insert({
                        hospital_id: hospitalId,
                        addon_sku_id: pendingAddon.id,
                        status: "active",
                        source: "self_service",
                        billing_starts_at: subscription?.current_period_end ?? null,
                      });
                      if (error) throw error;
                      toast.success(`${pendingAddon.name} added — available now.`);
                      setPendingAddon(null);
                      await refetchAddons();
                      await refetch();
                    } catch (e: any) {
                      toast.error(e?.message || "Could not add this add-on. Please try again.");
                    } finally {
                      setAddonBusy(false);
                    }
                  }}
                >
                  {addonBusy ? <Loader2 size={14} className="mr-1.5 animate-spin" /> : null}
                  Confirm
                </Button>
              </div>
            </div>
          </div>
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

        <UpgradeDialog
          open={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          currentPlanId={plan?.id}
          title={isExpired || isSuspended ? "Reactivate your subscription" : "Choose your plan"}
          subtitle={
            isExpired
              ? "Your trial has ended. Pick a plan to restore full access — your data is intact."
              : isSuspended
                ? "Clear the outstanding amount to restore access."
                : "Upgrade any time. You keep the rest of your trial."
          }
        />
      </div>
    </SettingsPageWrapper>
  );
};

export default SettingsPlanPage;
