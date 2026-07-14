import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Check, X, Loader2, MessageCircle, Mail } from "lucide-react";
import { RegistrationData, SALES_WHATSAPP, SALES_EMAIL } from "./constants";

interface Props {
  data: RegistrationData;
  onChange: (d: Partial<RegistrationData>) => void;
}

interface DbPlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  price_yearly: number;
  max_beds: number | null;
  max_staff: number | null;
  trial_days: number;
  is_custom_price: boolean;
  badge_text: string | null;
  description: string | null;
  feature_highlights?: Array<{ text: string; included: boolean }>;
  enabled_count?: number;
}

// Static fallback — mirrors the migration seed data.
// Used if Supabase is unreachable or the anon policy is not yet applied.
const STATIC_PLANS: DbPlan[] = [
  {
    id: "10000000-0000-0000-0000-000000000001",
    name: "Starter", slug: "starter",
    price_monthly: 8999, price_yearly: 89990,
    max_beds: 50, max_staff: 15, trial_days: 30,
    is_custom_price: false, badge_text: null,
    description: "For clinics and small hospitals up to 50 beds.",
    enabled_count: 18,
  },
  {
    id: "10000000-0000-0000-0000-000000000002",
    name: "Professional", slug: "professional",
    price_monthly: 18999, price_yearly: 189990,
    max_beds: 250, max_staff: 100, trial_days: 30,
    is_custom_price: false, badge_text: "Most Popular",
    description: "For hospitals 50–250 beds. All 56 modules including AI, NABH & ABDM.",
    enabled_count: 56,
  },
  {
    id: "10000000-0000-0000-0000-000000000003",
    name: "Enterprise", slug: "enterprise",
    price_monthly: 0, price_yearly: 0,
    max_beds: null, max_staff: null, trial_days: 30,
    is_custom_price: true, badge_text: "Custom Pricing",
    description: "For chains and 250+ bed hospitals. Multi-branch, white-label and SLA support.",
    enabled_count: 56,
  },
];

// Feature highlights per plan (shown when we can't fetch individual module names)
const PLAN_HIGHLIGHTS: Record<string, Array<{ text: string; included: boolean }>> = {
  starter: [
    { text: "OPD, IPD & Emergency", included: true },
    { text: "Lab, Radiology & Pharmacy", included: true },
    { text: "Billing & Payments (GST)", included: true },
    { text: "HR & Inventory", included: true },
    { text: "WhatsApp Notifications", included: true },
    { text: "Insurance / TPA", included: false },
    { text: "AI Voice Scribe", included: false },
    { text: "NABH Compliance Engine", included: false },
    { text: "Analytics & BI Dashboard", included: false },
  ],
  professional: [
    { text: "Everything in Starter", included: true },
    { text: "All 56 Modules", included: true },
    { text: "AI Voice Scribe (4 languages)", included: true },
    { text: "NABH 6th Edition Engine", included: true },
    { text: "ABDM / ABHA Integration", included: true },
    { text: "Insurance / TPA / PMJAY", included: true },
    { text: "Analytics & BI Dashboard", included: true },
    { text: "Oncology, IVF, Dialysis & more", included: true },
    { text: "Priority Support", included: true },
  ],
  enterprise: [
    { text: "Everything in Professional", included: true },
    { text: "Multi-Branch Management", included: true },
    { text: "White-Label Branding", included: true },
    { text: "Custom Integrations", included: true },
    { text: "SLA-backed Support", included: true },
    { text: "On-site Training", included: true },
    { text: "Data Migration Assistance", included: true },
    { text: "Unlimited Users & Beds", included: true },
  ],
};

const fmtINR = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const Step4ChoosePlan: React.FC<Props> = ({ data, onChange }) => {
  const [plans, setPlans] = useState<DbPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadSubmitting, setLeadSubmitting] = useState(false);
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [leadMessage, setLeadMessage] = useState("");
  const [detailPlan, setDetailPlan] = useState<DbPlan | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Fetch active plans — works for both anon and authenticated sessions
        const { data: rows, error } = await (supabase as any)
          .from("subscription_plans")
          .select("id, name, slug, price_monthly, price_yearly, max_beds, max_staff, trial_days, is_custom_price, badge_text, description, feature_highlights")
          .eq("is_active", true)
          .order("sort_order");

        if (cancelled) return;

        if (!error && rows && rows.length > 0) {
          // Fetch enabled module counts for each plan
          const { data: featureRows } = await (supabase as any)
            .from("plan_features")
            .select("plan_id, is_enabled");

          const countMap = new Map<string, number>();
          for (const f of (featureRows || [])) {
            if (f.is_enabled) {
              countMap.set(f.plan_id, (countMap.get(f.plan_id) || 0) + 1);
            }
          }

          setPlans(rows.map((p: any) => ({
            ...p,
            enabled_count: countMap.get(p.id) ?? undefined,
          })));
        } else {
          // Fallback to static plans
          setPlans(STATIC_PLANS);
        }
      } catch {
        if (!cancelled) setPlans(STATIC_PLANS);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const submitEnterpriseLead = async () => {
    setLeadSubmitting(true);
    try {
      await (supabase as any).from("enterprise_leads").insert([{
        hospital_name: data.hospitalName,
        contact_name:  data.fullName,
        email:         data.email,
        phone:         data.phone,
        beds_range:    data.bedCount,
        state:         data.state,
        message:       leadMessage || null,
        status:        "new",
      }]);
    } catch {
      // fail silently — captured via WhatsApp/email if DB insert blocked
    } finally {
      setLeadSubmitting(false);
      setLeadSubmitted(true); // always show success — contact links are the real CTA
    }
  };

  if (loading) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-[22px] font-bold text-foreground">Choose your plan</h2>
          <p className="text-sm text-muted-foreground mt-1">Start free for 30 days. No credit card required.</p>
        </div>
        <div className="flex items-center justify-center h-40">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[22px] font-bold text-foreground">Choose your plan</h2>
        <p className="text-sm text-muted-foreground mt-1">Start free for 30 days. No credit card required.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-6" role="radiogroup" aria-label="Subscription plan">
        {plans.map((plan) => {
          const selected = data.plan === plan.slug;
          const highlights = (plan.feature_highlights?.length ? plan.feature_highlights : PLAN_HIGHLIGHTS[plan.slug]) || [];
          const isMostPopular = plan.badge_text === "Most Popular";

          return (
            <div
              key={plan.id}
              role="radio"
              aria-checked={selected}
              aria-label={`${plan.name} plan`}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange({ plan: plan.slug as any });
                }
              }}
              className={`relative rounded-xl p-5 border-2 cursor-pointer transition-all active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${
                isMostPopular ? "-mt-1" : ""
              } ${
                selected
                  ? "border-primary shadow-[0_2px_12px_rgba(26,47,90,0.12)]"
                  : "border-border hover:border-primary/40"
              }`}
              onClick={() => onChange({ plan: plan.slug as any })}
            >
              {/* Badge */}
              {plan.badge_text && (
                <div className={`absolute -top-0 left-1/2 -translate-x-1/2 text-[11px] font-medium px-3 py-0.5 rounded-b-lg ${
                  isMostPopular ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"
                }`}>
                  {plan.badge_text}
                </div>
              )}

              <p className="text-sm font-semibold text-foreground mt-2">{plan.name}</p>

              {/* Price */}
              <div className="mt-2">
                {plan.is_custom_price ? (
                  <span className="text-2xl font-bold text-foreground">Custom Pricing</span>
                ) : (
                  <>
                    <span className="text-2xl font-bold text-foreground">{fmtINR(plan.price_monthly)}</span>
                    <span className="text-sm text-muted-foreground"> /month</span>
                  </>
                )}
              </div>

              {/* Subtitle */}
              <p className="text-xs text-muted-foreground mt-1">
                {plan.description
                  ? plan.description.split(".")[0] + "."
                  : plan.max_beds
                  ? `Up to ${plan.max_beds} beds`
                  : "Unlimited beds"}
              </p>

              {/* Module count pill */}
              {plan.enabled_count !== undefined && (
                <div className="mt-2 inline-flex items-center gap-1 bg-primary/8 text-primary text-[11px] font-medium px-2 py-0.5 rounded-full">
                  <Check size={10} />
                  {plan.enabled_count} modules included
                </div>
              )}

              <div className="border-t border-border my-3" />

              {/* View features → opens the marketing-content modal (keeps cards compact) */}
              {highlights.length > 0 && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setDetailPlan(plan); }}
                  className="w-full text-[13px] font-medium text-primary hover:underline"
                >
                  View features
                </button>
              )}

              {/* CTA button */}
              <button
                onClick={() => {
                  if (plan.slug === "enterprise") {
                    onChange({ plan: "enterprise" });
                    setShowLeadForm(true);
                  }
                }}
                className={`mt-4 w-full py-2.5 rounded-md text-sm font-medium transition-colors ${
                  plan.slug === "enterprise"
                    ? "border border-secondary text-secondary hover:bg-secondary hover:text-white"
                    : selected
                    ? "bg-primary text-primary-foreground"
                    : "border border-primary text-primary hover:bg-primary hover:text-primary-foreground"
                }`}
              >
                {plan.slug === "enterprise" ? "Contact Sales" : `Select ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-center text-[13px] text-muted-foreground mt-4">
        All plans include {plans[0]?.trial_days ?? 30}-day free trial · No credit card required · Cancel anytime
      </p>

      {/* Enterprise lead capture panel */}
      {showLeadForm && (
        <div className="mt-4 border-2 border-secondary/40 rounded-xl p-5 bg-secondary/5 space-y-4">
          {leadSubmitted ? (
            <div className="text-center py-4 space-y-2">
              <div className="text-2xl">🎉</div>
              <p className="text-sm font-semibold text-foreground">We've received your request!</p>
              <p className="text-xs text-muted-foreground">Our team will reach out to <strong>{data.email}</strong> within 1 business day to schedule a demo and discuss custom pricing.</p>
              <p className="text-xs text-muted-foreground mt-2">While you wait, you can continue with a <button className="text-primary underline" onClick={() => { setShowLeadForm(false); onChange({ plan: "professional" }); }}>Professional trial</button>.</p>
            </div>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold text-foreground">Enterprise Plan — Get Custom Pricing</p>
                <p className="text-xs text-muted-foreground mt-0.5">Includes multi-branch, white-label branding, SLA support & unlimited beds. Our team will prepare a quote for you.</p>
              </div>

              <div className="flex gap-3">
                <a
                  href={`https://wa.me/${SALES_WHATSAPP}?text=Hi%2C+I%27m+interested+in+Aumrti+Enterprise+HMS+for+my+hospital.`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-2 bg-[#25D366] text-white text-xs font-medium rounded-lg hover:bg-[#1ebe5d] transition-colors"
                >
                  <MessageCircle size={14} /> WhatsApp Us
                </a>
                <a
                  href={`mailto:${SALES_EMAIL}?subject=Enterprise+HMS+Enquiry&body=Hospital%20Name%3A%20${encodeURIComponent(data.hospitalName)}%0ABeds%3A%20${encodeURIComponent(data.bedCount)}%0AState%3A%20${encodeURIComponent(data.state)}`}
                  className="flex items-center gap-2 px-4 py-2 border border-border text-foreground text-xs font-medium rounded-lg hover:bg-muted transition-colors"
                >
                  <Mail size={14} /> Email Sales
                </a>
              </div>

              <div>
                <label className="text-xs text-muted-foreground">Anything specific you'd like us to know? (optional)</label>
                <textarea
                  rows={3}
                  value={leadMessage}
                  onChange={(e) => setLeadMessage(e.target.value)}
                  placeholder="e.g. multi-branch chain, specific integration needs, go-live timeline..."
                  className="w-full mt-1 px-3 py-2 text-xs bg-background border border-border rounded-lg text-foreground focus:outline-none focus:border-primary resize-none"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={submitEnterpriseLead}
                  disabled={leadSubmitting}
                  className="flex items-center gap-2 px-4 py-2 bg-secondary text-white text-xs font-semibold rounded-lg hover:bg-secondary/90 transition-colors disabled:opacity-50"
                >
                  {leadSubmitting ? <Loader2 size={12} className="animate-spin" /> : null}
                  Submit Enquiry
                </button>
                <button
                  onClick={() => { setShowLeadForm(false); onChange({ plan: "" as any }); }}
                  className="px-4 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Plan marketing-content modal (keeps the cards compact) */}
      {detailPlan && (() => {
        const dp = detailPlan;
        const dpHighlights = (dp.feature_highlights?.length ? dp.feature_highlights : PLAN_HIGHLIGHTS[dp.slug]) || [];
        const isEnt = dp.slug === "enterprise";
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setDetailPlan(null)}>
            <div className="bg-card border border-border rounded-xl w-full max-w-md max-h-[85vh] overflow-auto shadow-2xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-start justify-between p-5 border-b border-border">
                <div>
                  {dp.badge_text && (
                    <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded bg-primary/10 text-primary mb-1">{dp.badge_text}</span>
                  )}
                  <p className="text-lg font-bold text-foreground">{dp.name}</p>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {dp.is_custom_price ? "Custom Pricing" : `${fmtINR(dp.price_monthly)} /month`}
                  </p>
                </div>
                <button onClick={() => setDetailPlan(null)} aria-label="Close">
                  <X size={18} className="text-muted-foreground hover:text-foreground" />
                </button>
              </div>
              <div className="p-5 space-y-4">
                {dp.description && <p className="text-sm text-muted-foreground">{dp.description}</p>}
                <ul className="space-y-2">
                  {dpHighlights.map((ff) => (
                    <li key={ff.text} className={`flex items-start gap-2 text-sm ${ff.included ? "text-foreground" : "text-muted-foreground/50"}`}>
                      {ff.included ? (
                        <Check size={16} className="text-[hsl(160,84%,39%)] mt-0.5 shrink-0" />
                      ) : (
                        <X size={16} className="mt-0.5 shrink-0" />
                      )}
                      {ff.text}
                    </li>
                  ))}
                </ul>
              </div>
              <div className="p-5 border-t border-border">
                <button
                  onClick={() => {
                    if (isEnt) { onChange({ plan: "enterprise" }); setDetailPlan(null); setShowLeadForm(true); }
                    else { onChange({ plan: dp.slug as any }); setDetailPlan(null); }
                  }}
                  className={`w-full py-2.5 rounded-md text-sm font-medium transition-colors ${
                    isEnt
                      ? "border border-secondary text-secondary hover:bg-secondary hover:text-white"
                      : "bg-primary text-primary-foreground hover:bg-primary/90"
                  }`}
                >
                  {isEnt ? "Contact Sales" : `Select ${dp.name}`}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default Step4ChoosePlan;
