import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  RefreshCw, AlertTriangle, CheckCircle2, TrendingUp,
  Lightbulb, Bell, Zap, Calendar, ArrowRight,
} from "lucide-react";
import { fmtINR } from "@/lib/platform-utils";
import { format, formatDistanceToNow, subDays, addDays } from "date-fns";


// ─── types ────────────────────────────────────────────────────────────────────
type BriefingCategory = "urgent" | "warning" | "positive" | "insight" | "growth";

interface BriefingItem {
  id: string;
  category: BriefingCategory;
  title: string;
  body: string;
  hospitalId?: string;
  hospitalName?: string;
  value?: string;
  actionLabel?: string;
}

interface BriefingData {
  generatedAt: Date;
  items: BriefingItem[];
  mrr: number;
  newThisWeek: number;
  totalActive: number;
}

// ─── Data Fetcher ─────────────────────────────────────────────────────────────
async function fetchBriefing(): Promise<BriefingData> {
  const now           = new Date();
  const sevenDaysAgo  = subDays(now, 7).toISOString();
  const fourteenDaysAgo = subDays(now, 14).toISOString();
  const thirtyDaysAgo = subDays(now, 30).toISOString();

  const [hRes, sRes, activeRes] = await Promise.all([
    (supabase as any).from("hospitals")
      .select("id, name, state, beds_count, created_at")
      .eq("is_active", true),
    (supabase as any).from("hospital_subscriptions")
      .select("hospital_id, status, trial_ends_at, current_period_end, subscription_plans(name, price_monthly)"),
    (supabase as any).rpc("platform_active_hospitals", { since: thirtyDaysAgo }),
  ]);

  const hospitals: any[] = hRes.data || [];
  const subs: any[]      = sRes.data || [];
  const subMap           = new Map(subs.map((s: any) => [s.hospital_id, s]));
  const activeList       = activeRes.data || [];
  const opdSet           = new Set(activeList.filter((r: any) => r.has_opd).map((r: any) => r.hospital_id));
  const billSet          = new Set(activeList.filter((r: any) => r.has_billing).map((r: any) => r.hospital_id));

  const hospMap = new Map(hospitals.map((h: any) => [h.id, h]));

  const active   = subs.filter((s: any) => s.status === "active");
  const trial    = subs.filter((s: any) => s.status === "trial");
  const pastDue  = subs.filter((s: any) => ["past_due", "suspended"].includes(s.status));
  const mrr      = [...active, ...trial].reduce((s: number, r: any) => s + (Number(r.subscription_plans?.price_monthly) || 0), 0);

  const newThisWeek = hospitals.filter((h: any) => new Date(h.created_at) >= new Date(sevenDaysAgo)).length;
  const totalActive = active.length;

  const items: BriefingItem[] = [];

  // ── URGENT: Trials expiring within 7 days ─────────────────────────────────
  const expiringTrials = trial.filter((s: any) => {
    if (!s.trial_ends_at) return false;
    const daysLeft = Math.round((new Date(s.trial_ends_at).getTime() - now.getTime()) / 86400000);
    return daysLeft >= 0 && daysLeft <= 7;
  });
  for (const s of expiringTrials.slice(0, 3)) {
    const h = hospMap.get(s.hospital_id);
    if (!h) continue;
    const daysLeft = Math.round((new Date(s.trial_ends_at!).getTime() - now.getTime()) / 86400000);
    items.push({
      id: `trial-${s.hospital_id}`,
      category: "urgent",
      title: `${h.name} — trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`,
      body: `${s.subscription_plans?.name || "Trial"} hospital in ${h.state || "India"} with ${h.beds_count} beds. ${opdSet.has(h.id) ? "Has used OPD" : "No OPD activity yet"} — ${opdSet.has(h.id) && billSet.has(h.id) ? "engaged" : "needs activation"}.`,
      hospitalId: h.id, hospitalName: h.name,
      value: format(new Date(s.trial_ends_at!), "dd MMM"),
      actionLabel: "Convert now",
    });
  }

  // ── URGENT: Past due / suspended ─────────────────────────────────────────
  for (const s of pastDue.slice(0, 3)) {
    const h = hospMap.get(s.hospital_id);
    if (!h) continue;
    const price = Number(s.subscription_plans?.price_monthly) || 0;
    const daysSince = s.current_period_end
      ? Math.round((now.getTime() - new Date(s.current_period_end).getTime()) / 86400000)
      : null;
    items.push({
      id: `pastdue-${s.hospital_id}`,
      category: "warning",
      title: `${h.name} — payment ${s.status === "suspended" ? "suspended" : "overdue"}`,
      body: `${fmtINR(price)}/month at risk.${daysSince ? ` ${daysSince} days since last billing period.` : ""} Contact to resolve payment.`,
      hospitalId: h.id, hospitalName: h.name,
      value: fmtINR(price),
      actionLabel: "Resolve payment",
    });
  }

  // ── WARNING: Active hospitals with no OPD activity in 14 days ─────────────
  const inactiveActive = active.filter((s: any) => {
    const h = hospMap.get(s.hospital_id);
    if (!h) return false;
    const ageDays = (now.getTime() - new Date(h.created_at).getTime()) / 86400000;
    return ageDays > 21 && !opdSet.has(s.hospital_id);
  });
  if (inactiveActive.length > 0) {
    const topInactive = inactiveActive.slice(0, 2);
    for (const s of topInactive) {
      const h = hospMap.get(s.hospital_id);
      if (!h) continue;
      items.push({
        id: `inactive-${s.hospital_id}`,
        category: "warning",
        title: `${h.name} — paid but not using the system`,
        body: `Active subscription (${s.subscription_plans?.name || "paid plan"}) with no OPD activity in 30 days. At risk of churn — they may have switched to another HMS.`,
        hospitalId: h.id, hospitalName: h.name,
        actionLabel: "Schedule training call",
      });
    }
  }

  // ── POSITIVE: Hospitals using new modules ─────────────────────────────────
  const newThisWeekHospitals = hospitals.filter((h: any) => new Date(h.created_at) >= new Date(sevenDaysAgo));
  if (newThisWeekHospitals.length > 0) {
    items.push({
      id: "new-hospitals",
      category: "positive",
      title: `${newThisWeekHospitals.length} new hospital${newThisWeekHospitals.length > 1 ? "s" : ""} signed up this week`,
      body: newThisWeekHospitals.slice(0, 3).map((h: any) => `${h.name} (${h.state || "India"}, ${h.beds_count} beds)`).join(" · ") + (newThisWeekHospitals.length > 3 ? ` and ${newThisWeekHospitals.length - 3} more.` : "."),
      value: `+${newThisWeekHospitals.length}`,
    });
  }

  // ── POSITIVE: Revenue milestone ───────────────────────────────────────────
  if (mrr > 0) {
    items.push({
      id: "mrr-live",
      category: "growth",
      title: `Platform MRR is ${fmtINR(mrr)} — ARR run rate ${fmtINR(mrr * 12)}`,
      body: `${totalActive} paying hospitals · ${trial.length} on trial · ${pastDue.length > 0 ? pastDue.length + " past due" : "no payment issues"}.`,
      value: fmtINR(mrr),
    });
  }

  // ── INSIGHT: Trials with no billing activity (activation gap) ─────────────
  const unactivatedTrials = trial.filter((s: any) => {
    const h = hospMap.get(s.hospital_id);
    if (!h) return false;
    const ageDays = (now.getTime() - new Date(h.created_at).getTime()) / 86400000;
    return ageDays > 3 && !billSet.has(s.hospital_id) && !opdSet.has(s.hospital_id);
  });
  if (unactivatedTrials.length > 0) {
    items.push({
      id: "unactivated-trials",
      category: "insight",
      title: `${unactivatedTrials.length} trial hospital${unactivatedTrials.length > 1 ? "s" : ""} haven't used any module yet`,
      body: "These hospitals registered but haven't created a single patient token or bill. A quick onboarding call or email could activate them before trial ends.",
      value: `${unactivatedTrials.length}`,
      actionLabel: "View trial hospitals",
    });
  }

  // ── INSIGHT: Upcoming renewals this week ──────────────────────────────────
  const renewalsThisWeek = active.filter((s: any) => {
    if (!s.current_period_end) return false;
    const d = new Date(s.current_period_end);
    return d >= now && d <= addDays(now, 7);
  });
  if (renewalsThisWeek.length > 0) {
    const renewalMrr = renewalsThisWeek.reduce((sum: number, s: any) => sum + (Number(s.subscription_plans?.price_monthly) || 0), 0);
    items.push({
      id: "renewals",
      category: "insight",
      title: `${renewalsThisWeek.length} subscription${renewalsThisWeek.length > 1 ? "s" : ""} renewing this week`,
      body: `Total renewal value: ${fmtINR(renewalMrr)}. Ensure payment details are up to date to avoid disruption.`,
      value: fmtINR(renewalMrr),
    });
  }

  // Sort: urgent first, then warning, positive, insight, growth
  const ORDER: BriefingCategory[] = ["urgent", "warning", "positive", "growth", "insight"];
  items.sort((a, b) => ORDER.indexOf(a.category) - ORDER.indexOf(b.category));

  return { generatedAt: now, items, mrr, newThisWeek, totalActive };
}

// ─── Item Card ────────────────────────────────────────────────────────────────
const CATEGORY_CFG: Record<BriefingCategory, {
  icon: React.ComponentType<any>;
  border: string; bg: string; iconCls: string; label: string;
}> = {
  urgent:  { icon: AlertTriangle, border: "border-red-300",    bg: "bg-red-50",    iconCls: "text-red-500",    label: "URGENT" },
  warning: { icon: Bell,          border: "border-amber-300",  bg: "bg-amber-50",  iconCls: "text-amber-600",  label: "WARNING" },
  positive:{ icon: CheckCircle2,  border: "border-emerald-300",bg: "bg-emerald-50",iconCls: "text-emerald-600",label: "POSITIVE" },
  growth:  { icon: TrendingUp,    border: "border-blue-300",   bg: "bg-blue-50",   iconCls: "text-blue-600",   label: "METRICS" },
  insight: { icon: Lightbulb,     border: "border-border",     bg: "bg-card",      iconCls: "text-muted-foreground",  label: "INSIGHT" },
};

function BriefingCard({ item, onNavigate }: { item: BriefingItem; onNavigate: (id: string) => void }) {
  const cfg = CATEGORY_CFG[item.category];
  const Icon = cfg.icon;

  return (
    <div className={`border rounded-xl p-4 ${cfg.border} ${cfg.bg}`}>
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5">
          <Icon size={16} className={cfg.iconCls} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[9px] font-bold tracking-widest uppercase ${cfg.iconCls}`}>{cfg.label}</span>
            {item.value && (
              <span className={`text-xs font-mono font-bold ${cfg.iconCls}`}>{item.value}</span>
            )}
          </div>
          <p className="text-sm font-semibold text-foreground leading-snug">{item.title}</p>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{item.body}</p>
          {(item.hospitalId || item.actionLabel) && (
            <div className="mt-3 flex items-center gap-2">
              {item.hospitalId && (
                <button
                  onClick={() => onNavigate(item.hospitalId!)}
                  className="flex items-center gap-1.5 text-[11px] text-blue-600 hover:text-blue-700 font-medium transition-colors"
                >
                  {item.actionLabel || "View hospital"}
                  <ArrowRight size={11} />
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PlatformBriefingPage() {
  const navigate = useNavigate();
  const { data, isLoading, refetch, dataUpdatedAt } = useQuery({
    queryKey: ["platform-briefing"],
    queryFn: fetchBriefing,
    staleTime: 10 * 60_000,
  });

  const urgentCount  = (data?.items || []).filter((i) => i.category === "urgent").length;
  const warningCount = (data?.items || []).filter((i) => i.category === "warning").length;

  return (
    <div className="flex flex-col h-full">
      <div className="h-14 border-b border-border flex items-center justify-between px-6 shrink-0">
        <div>
          <h1 className="text-[15px] font-semibold text-foreground">Daily Briefing</h1>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {format(new Date(), "EEEE, dd MMMM yyyy")}
            {dataUpdatedAt ? ` · updated ${formatDistanceToNow(dataUpdatedAt, { addSuffix: true })}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {urgentCount > 0 && (
            <span className="flex items-center gap-1.5 text-xs text-red-500 bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
              <Zap size={11} />
              {urgentCount} urgent
            </span>
          )}
          {warningCount > 0 && (
            <span className="text-xs text-amber-600 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
              {warningCount} warnings
            </span>
          )}
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {isLoading ? (
          <div className="py-16 text-center space-y-2">
            <Zap size={20} className="text-blue-500 mx-auto animate-pulse" />
            <p className="text-xs text-muted-foreground">Generating today's briefing…</p>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <CheckCircle2 size={20} className="text-emerald-500 mx-auto" />
            <p className="text-sm font-semibold text-foreground">All clear — no action items today</p>
            <p className="text-xs text-muted-foreground">No urgent issues, no expiring trials, all payments current.</p>
          </div>
        ) : (
          <div className="max-w-2xl space-y-3">
            {/* Summary header */}
            <div className="bg-card border border-border rounded-xl px-5 py-3 flex items-center gap-6 mb-5 shadow-sm">
              <div className="flex items-center gap-2">
                <Calendar size={13} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{data.items.length} items to review</span>
              </div>
              {data.totalActive > 0 && (
                <span className="text-xs text-muted-foreground">
                  <span className="text-emerald-600 font-mono font-bold">{data.totalActive}</span> paying customers
                </span>
              )}
              {data.newThisWeek > 0 && (
                <span className="text-xs text-muted-foreground">
                  <span className="text-blue-600 font-mono font-bold">+{data.newThisWeek}</span> new this week
                </span>
              )}
            </div>

            {data.items.map((item) => (
              <BriefingCard
                key={item.id}
                item={item}
                onNavigate={(id) => navigate(`/platform/hospitals/${id}`)}
              />
            ))}

            <p className="text-[10px] text-muted-foreground/60 text-center pt-2">
              Briefing generated from live database · {format(new Date(), "HH:mm")} IST
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
