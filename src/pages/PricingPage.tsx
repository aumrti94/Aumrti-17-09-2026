/**
 * Public pricing page — the self-service acquisition surface.
 *
 * Why this exists: Aumrti published no price anywhere a prospect could reach
 * without a sales call, which kept it off every comparison shortlist assembled
 * from public pricing (competitors publish from ₹999/month). No self-service
 * motion can start without this page.
 *
 * Two rules this page obeys:
 *   1. Plans are read LIVE from `subscription_plans` (the anon-read policy from
 *      migration 20260601160001). A price edited in /platform → Plans shows here
 *      immediately, with no deploy. STATIC_PLANS is a fetch-failure fallback for
 *      DISPLAY only — it never drives what anyone is charged.
 *   2. The bed calculator uses `resolveEffectivePrice`, the SAME function the
 *      checkout edge function uses to bind the Razorpay plan. The quoted figure
 *      and the charged figure cannot diverge by construction.
 *
 * Unlike the landing hero (which is deliberately h-screen/Zero Scroll), this is
 * a long-form marketing page and scrolls.
 */
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import AumrtiLogo from "@/components/brand/AumrtiLogo";
import { Check, Loader2, Minus, Plus } from "lucide-react";
import { formatINRExact } from "@/lib/currency";
import { resolveEffectivePrice, type BillingCycle } from "@/lib/platformBilling";
import { describeGrant, type AddonSku } from "@/lib/addons";
import { SALES_EMAIL } from "@/lib/brand";

interface PublicPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  price_yearly: number | null;
  max_beds: number | null;
  trial_days: number;
  is_custom_price: boolean;
  badge_text: string | null;
  description: string | null;
  beds_included: number | null;
  bed_block_size: number | null;
  price_per_bed_block: number | null;
  price_per_bed_block_yearly: number | null;
  sort_order: number;
}

// DISPLAY-ONLY fallback mirroring the migration-164 seed. Never used for billing.
const STATIC_PLANS: PublicPlan[] = [
  {
    id: "10000000-0000-0000-0000-000000000004", name: "Clinic & Day Care", slug: "clinic",
    price_monthly: 2499, price_yearly: 24990, max_beds: 15, trial_days: 30,
    is_custom_price: false, badge_text: "New",
    description: "For clinics, day-care centres and small nursing homes up to 15 beds.",
    beds_included: 15, bed_block_size: 10, price_per_bed_block: null,
    price_per_bed_block_yearly: null, sort_order: 1,
  },
  {
    id: "10000000-0000-0000-0000-000000000001", name: "Starter", slug: "starter",
    price_monthly: 8999, price_yearly: 89990, max_beds: null, trial_days: 30,
    is_custom_price: false, badge_text: null,
    description: "Full core clinical for growing hospitals.",
    beds_included: 20, bed_block_size: 10, price_per_bed_block: 750,
    price_per_bed_block_yearly: null, sort_order: 2,
  },
  {
    id: "10000000-0000-0000-0000-000000000002", name: "Professional", slug: "professional",
    price_monthly: 17999, price_yearly: 179990, max_beds: null, trial_days: 30,
    is_custom_price: false, badge_text: "Most Popular",
    description: "Everything Aumrti does, including AI, NABH and ABDM.",
    beds_included: 40, bed_block_size: 10, price_per_bed_block: 950,
    price_per_bed_block_yearly: null, sort_order: 3,
  },
  {
    id: "10000000-0000-0000-0000-000000000003", name: "Enterprise", slug: "enterprise",
    price_monthly: 49999, price_yearly: 499990, max_beds: null, trial_days: 30,
    is_custom_price: true, badge_text: "From ₹49,999",
    description: "For chains and 250+ bed hospitals. SLA-backed support and a dedicated CSM.",
    beds_included: 100, bed_block_size: 10, price_per_bed_block: 1100,
    price_per_bed_block_yearly: null, sort_order: 4,
  },
];

const HIGHLIGHTS: Record<string, string[]> = {
  clinic: [
    "OPD & Day Care", "Billing & Payments (GST)", "Retail Pharmacy POS",
    "Laboratory", "Patient Portal", "WhatsApp notifications",
  ],
  starter: [
    "Everything in Clinic", "IPD / Wards & Nursing", "Radiology & inpatient Pharmacy",
    "HR & Payroll", "Inventory & Stores", "Day Closure & cash reconciliation",
  ],
  professional: [
    "Everything in Starter", "Operation Theatre & Emergency", "Blood Bank & CSSD",
    "Insurance / TPA & PMJAY", "ABDM / ABHA & NABH engine", "Full AI suite incl. Voice Scribe",
  ],
  enterprise: [
    "Everything in Professional", "SLA-backed support", "Dedicated success manager",
    "Custom integrations", "On-site training", "Data migration assistance",
  ],
};

const PricingPage: React.FC = () => {
  const navigate = useNavigate();
  const [plans, setPlans] = useState<PublicPlan[]>(STATIC_PLANS);
  const [loading, setLoading] = useState(true);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [beds, setBeds] = useState(50);
  const [addons, setAddons] = useState<AddonSku[]>([]);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase
          .from("subscription_plans")
          .select("id, name, slug, price_monthly, price_yearly, max_beds, trial_days, is_custom_price, badge_text, description, beds_included, bed_block_size, price_per_bed_block, price_per_bed_block_yearly, sort_order")
          .eq("is_active", true)
          .order("sort_order")
          .returns<PublicPlan[]>();
        if (data?.length) setPlans(data);

        // Add-on catalogue is public marketing data; failure is non-fatal, the
        // section simply does not render.
        // `as any`: addon_skus is not in the generated Database types until the
        // add-on migration is applied and types.ts regenerated.
        const { data: skus } = await (supabase as any)
          .from("addon_skus")
          .select("id, slug, name, description, price_monthly, price_yearly, module_keys, ai_feature_keys, badge_text, sort_order")
          .eq("is_active", true)
          .order("sort_order");
        if (skus?.length) setAddons(skus as AddonSku[]);
      } catch {
        // Keep the static fallback — a pricing page that renders nothing is
        // worse than one showing last-known list prices.
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Quoted with the same resolver the gateway binds against.
  const quotes = useMemo(() => plans.map((plan) => ({
    plan,
    price: resolveEffectivePrice({ plan, cycle, activeBeds: beds }),
    // Enterprise is quote-gated (is_custom_price), so resolveEffectivePrice
    // returns unavailable. The published floor still needs a figure on the card,
    // so compute it from the same columns with the custom flag lifted.
    anchor: resolveEffectivePrice({ plan: { ...plan, is_custom_price: false }, cycle, activeBeds: beds }),
  })), [plans, cycle, beds]);

  const cycleWord = cycle === "yearly" ? "year" : "month";

  return (
    <div className="min-h-screen w-full bg-background">
      {/* ── Nav ── */}
      <nav className="h-16 bg-card border-b border-border flex items-center justify-between px-6 md:px-12 sticky top-0 z-10">
        <button onClick={() => navigate("/")} className="flex items-center gap-3">
          <AumrtiLogo variant="mark" className="h-10 w-10" />
          <span className="text-xl font-bold tracking-tight text-secondary">AUMRTI</span>
        </button>
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/login")}
            className="border-[1.5px] border-primary text-primary bg-transparent px-5 py-2 rounded-md text-sm font-medium hover:bg-primary hover:text-primary-foreground transition-colors"
          >
            Sign In
          </button>
          <button
            onClick={() => navigate("/register")}
            className="bg-primary text-primary-foreground px-5 py-2 rounded-md text-sm font-medium hover:bg-[hsl(220,54%,16%)] transition-colors"
          >
            Start Free Trial
          </button>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-6 py-12 md:py-16">
        {/* ── Header ── */}
        <div className="text-center">
          <h1 className="text-3xl md:text-[42px] font-bold text-[#0F172A] tracking-tight leading-tight">
            Pay for the beds you actually have
          </h1>
          <p className="mt-4 text-base text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            Every plan includes unlimited staff logins, a {plans[0]?.trial_days ?? 30}-day free trial,
            and no setup fee on annual billing. Prices are inclusive of 18% GST.
          </p>
        </div>

        {/* ── Controls ── */}
        <div className="mt-10 flex flex-col items-center gap-6">
          {/* Billing cycle */}
          <div className="inline-flex bg-muted rounded-lg p-1">
            {(["monthly", "yearly"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setCycle(c)}
                className={`px-5 py-2 rounded-md text-sm font-medium capitalize transition-colors ${
                  cycle === c ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {c}
                {c === "yearly" && <span className="ml-1.5 text-[11px] text-emerald-600 font-semibold">2 months free</span>}
              </button>
            ))}
          </div>

          {/* Bed calculator — the whole point of the page: the price moves with
              the hospital's real size, so a prospect self-qualifies instantly. */}
          <div className="w-full max-w-xl bg-card border border-border rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <label htmlFor="bed-count" className="text-sm font-medium text-foreground">
                How many beds does your hospital have?
              </label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Decrease bed count"
                  onClick={() => setBeds((b) => Math.max(0, b - 5))}
                  className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted transition-colors"
                >
                  <Minus size={14} />
                </button>
                <span className="text-lg font-bold text-foreground tabular-nums w-14 text-center">{beds}</span>
                <button
                  type="button"
                  aria-label="Increase bed count"
                  onClick={() => setBeds((b) => Math.min(500, b + 5))}
                  className="h-8 w-8 rounded-md border border-border flex items-center justify-center hover:bg-muted transition-colors"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <input
              id="bed-count"
              type="range"
              min={0}
              max={500}
              step={5}
              value={beds}
              onChange={(e) => setBeds(Number(e.target.value))}
              className="w-full accent-primary"
            />
            <div className="flex justify-between text-[11px] text-muted-foreground mt-1">
              <span>0</span><span>250</span><span>500</span>
            </div>
          </div>
        </div>

        {/* ── Plan cards ── */}
        {loading && (
          <div className="flex justify-center mt-10">
            <Loader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
          {quotes.map(({ plan, price, anchor }) => {
            const shown = plan.is_custom_price ? anchor : price;
            // A capped tier (Clinic) simply cannot serve a larger hospital.
            const overCap = plan.max_beds != null && beds > plan.max_beds;
            const highlights = HIGHLIGHTS[plan.slug] ?? [];

            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl border p-6 flex flex-col transition-opacity ${
                  plan.badge_text === "Most Popular"
                    ? "border-primary shadow-[0_4px_24px_rgba(0,0,0,0.08)]"
                    : "border-border"
                } ${overCap ? "opacity-45" : ""}`}
              >
                {plan.badge_text && (
                  <span className="absolute -top-2.5 left-6 bg-primary text-primary-foreground text-[11px] font-semibold px-2.5 py-1 rounded-full">
                    {plan.badge_text}
                  </span>
                )}

                <p className="text-base font-bold text-foreground">{plan.name}</p>
                <p className="text-xs text-muted-foreground mt-1 min-h-[32px] leading-relaxed">
                  {plan.description?.split(".")[0]}.
                </p>

                {/* Price */}
                <div className="mt-4">
                  {overCap ? (
                    <p className="text-sm text-muted-foreground">
                      Not available above {plan.max_beds} beds
                    </p>
                  ) : (
                    <>
                      <p className="text-[28px] font-bold text-foreground leading-none">
                        {plan.is_custom_price && "From "}
                        {formatINRExact(shown.amountInr)}
                        <span className="text-sm font-normal text-muted-foreground">/{cycleWord}</span>
                      </p>
                      {shown.bedBlocks > 0 ? (
                        <p className="text-[11px] text-muted-foreground mt-1.5 leading-relaxed">
                          {formatINRExact(shown.baseInr)} base ({plan.beds_included} beds)
                          {" + "}
                          {shown.bedBlocks} × {plan.bed_block_size ?? 10}-bed block
                          {" = "}
                          {formatINRExact(shown.bedFeeInr)}
                        </p>
                      ) : (
                        <p className="text-[11px] text-muted-foreground mt-1.5">
                          {plan.price_per_bed_block
                            ? `Includes ${plan.beds_included} beds`
                            : `Up to ${plan.beds_included ?? plan.max_beds} beds`}
                        </p>
                      )}
                    </>
                  )}
                </div>

                <div className="border-t border-border my-5" />

                <ul className="space-y-2 flex-1">
                  {highlights.map((h) => (
                    <li key={h} className="flex items-start gap-2 text-xs text-foreground">
                      <Check size={13} className="text-emerald-600 mt-0.5 shrink-0" />
                      {h}
                    </li>
                  ))}
                </ul>

                <button
                  onClick={() =>
                    plan.is_custom_price
                      ? window.open(`mailto:${SALES_EMAIL}?subject=Enterprise plan enquiry`)
                      : navigate("/register")
                  }
                  disabled={overCap}
                  className={`mt-6 w-full py-2.5 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                    plan.badge_text === "Most Popular"
                      ? "bg-primary text-primary-foreground hover:bg-[hsl(220,54%,16%)]"
                      : "border-[1.5px] border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                  }`}
                >
                  {plan.is_custom_price ? "Talk to Sales" : "Start Free Trial"}
                </button>
              </div>
            );
          })}
        </div>

        {/* ── Add-ons ── */}
        {addons.length > 0 && (
          <div className="mt-14">
            <h2 className="text-xl font-bold text-[#0F172A] tracking-tight">Add-ons</h2>
            <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl leading-relaxed">
              Extend any plan without moving tier. Add one whenever you need it — access starts
              straight away and it appears on your next renewal, never as a surprise mid-month charge.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {addons.map((a) => (
                <div key={a.id} className="rounded-xl border border-border p-5 flex flex-col">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-bold text-foreground">{a.name}</p>
                    {a.badge_text && (
                      <span className="text-[10px] font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
                        {a.badge_text}
                      </span>
                    )}
                  </div>
                  <p className="text-[22px] font-bold text-foreground mt-2 leading-none">
                    {formatINRExact(Number(a.price_monthly))}
                    <span className="text-xs font-normal text-muted-foreground">/month</span>
                  </p>
                  <p className="text-[11px] text-muted-foreground mt-1">{describeGrant(a)}</p>
                  {a.description && (
                    <p className="text-xs text-muted-foreground mt-3 leading-relaxed flex-1">{a.description}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Footnotes ── */}
        <div className="mt-12 grid gap-6 md:grid-cols-3 text-xs text-muted-foreground leading-relaxed">
          <div>
            <p className="font-semibold text-foreground text-sm mb-1.5">Unlimited staff logins</p>
            Every nurse, doctor and clerk gets their own account on every plan. We never
            charge per user — your NABH evidence trail depends on every action being
            attributable to a real person, and shared logins destroy that.
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm mb-1.5">Beds are counted, not capped</p>
            You are billed on the beds actually registered in Aumrti. Add a ward mid-cycle
            and nothing changes until your next renewal — no mid-month billing surprises.
          </div>
          <div>
            <p className="font-semibold text-foreground text-sm mb-1.5">Already on another HMS?</p>
            You do not have to move everything at once. Start with a single module —
            Billing, or the Insurance desk — alongside your current system, and expand
            when it earns it.
          </div>
        </div>

        <p className="mt-10 text-center text-[11px] text-muted-foreground">
          All prices in ₹ and inclusive of 18% GST · Cancel anytime ·{" "}
          <button onClick={() => navigate("/register")} className="text-primary hover:underline">
            Start your free trial
          </button>
        </p>
      </div>
    </div>
  );
};

export default PricingPage;
