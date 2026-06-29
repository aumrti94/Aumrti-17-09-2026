import React from "react";
import { useQuery } from "@tanstack/react-query";
import SettingsPageWrapper from "@/components/settings/SettingsPageWrapper";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Mail, AlertTriangle, Clock, CheckCircle2, XCircle, Loader2, FileText, ExternalLink } from "lucide-react";
import { useSubscriptionConfig } from "@/hooks/useSubscriptionConfig";
import { useHospitalId } from "@/hooks/useHospitalId";
import { supabase } from "@/integrations/supabase/client";
import { ALL_MODULES } from "@/lib/modules";
import SubscribeButton from "@/components/subscription/SubscribeButton";

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

  // Other available plans for upgrade section
  const { data: allPlans = [] } = useQuery({
    queryKey: ["available-plans"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscription_plans")
        .select("id, name, slug, price_monthly, is_custom_price, badge_text, description")
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

  const downloadInvoice = async (inv: any) => {
    if (!inv.pdf_storage_path) return;
    const { data } = await supabase.storage
      .from("subscription-invoices")
      .createSignedUrl(inv.pdf_storage_path, 300);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

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

  const usageRows = [
    {
      label: "Staff Accounts",
      used: staffCount,
      limit: maxStaff,
      pct: maxStaff ? Math.round((staffCount / maxStaff) * 100) : 0,
    },
    {
      label: "Registered Beds",
      used: bedsCount,
      limit: maxBeds,
      pct: maxBeds ? Math.round((bedsCount / maxBeds) * 100) : 0,
    },
    {
      label: "Active Modules",
      used: enabledModules.length,
      limit: 56,
      pct: Math.round((enabledModules.length / 56) * 100),
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
            {plan?.max_beds && (
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
          <div className="grid grid-cols-3 gap-4">
            {usageRows.map((u) => (
              <div key={u.label} className="bg-card border border-border rounded-lg p-4">
                <p className="text-xs text-muted-foreground">{u.label}</p>
                <p className="text-lg font-bold text-foreground mt-1">
                  {u.used}
                  {u.limit && (
                    <span className="text-sm font-normal text-muted-foreground"> / {u.limit}</span>
                  )}
                </p>
                {u.limit && (
                  <Progress
                    value={u.pct}
                    className={`mt-2 h-1.5 ${u.pct >= 90 ? "[&>div]:bg-red-500" : u.pct >= 70 ? "[&>div]:bg-amber-500" : ""}`}
                  />
                )}
              </div>
            ))}
          </div>
        </section>

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

        {/* ── Invoice History ── */}
        {invoices.length > 0 && (
          <section>
            <h2 className="text-sm font-semibold text-foreground mb-3">Invoice History</h2>
            <div className="rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/40 text-xs text-muted-foreground uppercase tracking-wide">
                    <th className="text-left px-4 py-2.5 font-medium">Invoice</th>
                    <th className="text-left px-4 py-2.5 font-medium">Plan</th>
                    <th className="text-left px-4 py-2.5 font-medium">Period</th>
                    <th className="text-right px-4 py-2.5 font-medium">Amount</th>
                    <th className="text-right px-4 py-2.5 font-medium">Download</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invoices.map((inv: any) => (
                    <tr key={inv.id} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-foreground">{inv.invoice_number}</td>
                      <td className="px-4 py-3 text-foreground">{inv.plan_name}</td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">
                        {inv.billing_period_start
                          ? `${fmtDate(inv.billing_period_start)} – ${fmtDate(inv.billing_period_end)}`
                          : fmtDate(inv.created_at)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold">
                        {fmtINR(Number(inv.amount_inr))}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {inv.pdf_storage_path ? (
                          <button
                            onClick={() => downloadInvoice(inv)}
                            className="inline-flex items-center gap-1 text-primary hover:underline text-xs font-medium"
                          >
                            <Download size={12} /> PDF
                          </button>
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

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
            <Button variant="outline" className="gap-2" onClick={() => downloadInvoice(invoices[0])}>
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
