import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useSubscriptionConfig } from "@/hooks/useSubscriptionConfig";
import { Loader2, CreditCard, Tag, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { formatINRExact } from "@/lib/currency";
import { resolveEffectivePrice, type BillingCycle } from "@/lib/platformBilling";

// Razorpay global type
declare global {
  interface Window {
    Razorpay: any;
  }
}

interface SubscribePlan {
  id: string;
  name: string;
  slug: string;
  price_monthly: number;
  /** Null means the plan is not sold annually — the yearly option is hidden. */
  price_yearly?: number | null;
  is_custom_price: boolean;
  razorpay_plan_id: string | null;
  /** Bed-band pricing (v3) — NULL columns mean the plan has no bed billing. */
  beds_included?: number | null;
  bed_block_size?: number | null;
  price_per_bed_block?: number | null;
  price_per_bed_block_yearly?: number | null;
}

interface Props {
  plan: SubscribePlan;
  label?: string;
  variant?: "default" | "outline";
  className?: string;
}

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function SubscribeButton({ plan, label, variant = "default", className }: Props) {
  const { hospitalId } = useHospitalId();
  const { refetch } = useSubscriptionConfig();
  const [open, setOpen] = useState(false);
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState<{
    valid: boolean; pct: number; message: string;
  } | null>(null);
  const [validating, setValidating] = useState(false);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const couponRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Validate coupon code with debounce
  useEffect(() => {
    if (!couponCode.trim()) { setCouponResult(null); return; }
    if (couponRef.current) clearTimeout(couponRef.current);
    couponRef.current = setTimeout(() => validateCoupon(couponCode.trim().toUpperCase()), 600);
    return () => { if (couponRef.current) clearTimeout(couponRef.current); };
  }, [couponCode]);

  const validateCoupon = async (code: string) => {
    setValidating(true);
    try {
      const { data } = await (supabase as any)
        .from("discount_codes")
        .select("discount_type, discount_value, valid_until, max_uses, used_count, is_active, applies_to")
        .eq("code", code)
        .eq("is_active", true)
        .maybeSingle();

      if (!data) {
        setCouponResult({ valid: false, pct: 0, message: "Invalid or expired code" });
        return;
      }
      if (data.valid_until && new Date(data.valid_until) < new Date()) {
        setCouponResult({ valid: false, pct: 0, message: "This code has expired" });
        return;
      }
      if (data.max_uses && data.used_count >= data.max_uses) {
        setCouponResult({ valid: false, pct: 0, message: "This code has reached its usage limit" });
        return;
      }
      if (data.applies_to !== "all" && data.applies_to !== plan.slug) {
        setCouponResult({ valid: false, pct: 0, message: `This code only applies to ${data.applies_to} plan` });
        return;
      }
      const pct = data.discount_type === "percentage" ? Number(data.discount_value) : 0;
      const flatOff = data.discount_type === "flat" ? Number(data.discount_value) : 0;
      const msg = pct > 0
        ? `${pct}% off applied!`
        : `₹${flatOff.toLocaleString("en-IN")} off applied!`;
      setCouponResult({ valid: true, pct, message: msg });
    } catch {
      setCouponResult({ valid: false, pct: 0, message: "Could not validate code" });
    } finally {
      setValidating(false);
    }
  };

  // Bed-band pricing (v3): the price depends on the live active-bed count, via
  // the same current_active_beds() RPC the edge function bills against — the
  // preview and the charge use one bed count by construction. Until it loads
  // (or for plans with no bed billing) the base price is shown unchanged.
  const [activeBeds, setActiveBeds] = useState<number | null>(null);
  useEffect(() => {
    if (!hospitalId || plan.price_per_bed_block == null) return;
    let cancelled = false;
    (supabase as any)
      .rpc("current_active_beds", { p_hospital_id: hospitalId })
      .then(({ data }: { data: number | null }) => {
        if (!cancelled && typeof data === "number") setActiveBeds(data);
      });
    return () => { cancelled = true; };
  }, [hospitalId, plan.price_per_bed_block]);

  // Price shown here is computed with the SAME resolver the edge function uses
  // to bind the Razorpay plan, so the displayed figure and the charged figure
  // cannot diverge. (They used to: the coupon was applied only for display.)
  const price = resolveEffectivePrice({
    plan,
    cycle,
    couponPct: couponResult?.valid ? couponResult.pct : 0,
    activeBeds,
  });
  const monthlyPrice = resolveEffectivePrice({
    plan, cycle: "monthly", couponPct: couponResult?.valid ? couponResult.pct : 0, activeBeds,
  });
  const yearlyPrice = resolveEffectivePrice({
    plan, cycle: "yearly", couponPct: couponResult?.valid ? couponResult.pct : 0, activeBeds,
  });
  const yearlyAvailable = yearlyPrice.available;

  const handleSubscribe = async () => {
    if (!hospitalId) return;
    setLoading(true);

    try {
      // Load Razorpay.js
      const loaded = await loadRazorpayScript();
      if (!loaded) {
        toast.error("Could not load payment gateway. Check your internet connection.");
        return;
      }

      // Call Edge Function to create Razorpay subscription
      const { data, error } = await supabase.functions.invoke("create-razorpay-subscription", {
        body: {
          plan_id: plan.id,
          hospital_id: hospitalId,
          billing_cycle: cycle,
          coupon_code: couponResult?.valid ? couponCode.trim().toUpperCase() : undefined,
        },
      });

      if (error || data?.error) {
        toast.error(data?.error || error?.message || "Failed to initiate payment");
        return;
      }

      const {
        subscription_id,
        razorpay_key_id,
        plan_name,
        amount_paise,
        customer_name,
        customer_email,
        customer_contact,
      } = data;

      // Open Razorpay checkout
      const rzp = new window.Razorpay({
        key: razorpay_key_id,
        subscription_id,
        name: "Aumrti HMS",
        description: `${plan_name} — ${cycle === "yearly" ? "Annual" : "Monthly"} Subscription`,
        image: "/favicon.ico",
        handler: (_response: any) => {
          // Actual activation is confirmed via webhook, not here.
          // Show a positive message and refresh subscription status.
          setDone(true);
          setOpen(false);
          toast.success("Payment submitted! Your plan will activate within a few minutes.");
          // Poll for status update (webhook may take a few seconds)
          const poll = setInterval(async () => {
            refetch();
          }, 3000);
          setTimeout(() => clearInterval(poll), 30_000);
        },
        prefill: {
          name:    customer_name,
          email:   customer_email,
          contact: customer_contact,
        },
        notes: {
          hospital_id: hospitalId,
          plan_id:     plan.id,
        },
        theme: { color: "#1A2F5A" },
        modal: {
          ondismiss: () => {
            toast.info("Payment cancelled. You can try again anytime.");
          },
        },
      });

      rzp.open();
    } catch (e: any) {
      toast.error(e?.message || "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  // Don't show the button for custom-priced plans
  if (plan.is_custom_price) {
    return (
      <Button
        variant="outline"
        className={className}
        onClick={() => window.open(`mailto:support@aumrti.in?subject=Enterprise Plan Enquiry`)}
      >
        <CreditCard size={14} className="mr-2" />
        Contact Sales
      </Button>
    );
  }

  // NOTE: there used to be a `!plan.razorpay_plan_id` branch here that degraded
  // to a mailto: link. Since no plan had a razorpay_plan_id, EVERY plan hit it —
  // which is why "Subscribe"/"Upgrade Now" opened an email client instead of
  // checkout. The edge function now creates the Razorpay plan on demand via the
  // plan registry, so there is nothing to pre-configure and nothing to degrade to.

  return (
    <>
      <Button
        variant={variant}
        className={className}
        onClick={() => setOpen(true)}
        disabled={done}
      >
        {done ? (
          <><CheckCircle2 size={14} className="mr-2 text-emerald-400" /> Payment Submitted</>
        ) : (
          <><CreditCard size={14} className="mr-2" />{label || `Subscribe to ${plan.name}`}</>
        )}
      </Button>

      {/* ── Checkout modal ── */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-card border border-border rounded-2xl w-[420px] shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <p className="text-base font-bold text-foreground">{plan.name} Plan</p>
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Billing cycle — a real choice, not decoration. The yearly figure
                  used to be rendered as monthly × 10, a number that matched no
                  plan row and was not purchasable at all. */}
              {yearlyAvailable && (
                <div className="grid grid-cols-2 gap-2">
                  {(["monthly", "yearly"] as const).map((c) => {
                    const p = c === "monthly" ? monthlyPrice : yearlyPrice;
                    const savingPct = yearlyPrice.available && monthlyPrice.amountInr > 0
                      ? Math.round((1 - yearlyPrice.amountInr / (monthlyPrice.amountInr * 12)) * 100)
                      : 0;
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setCycle(c)}
                        className={`rounded-xl border p-3 text-left transition-colors ${
                          cycle === c
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/40"
                        }`}
                      >
                        <p className="text-xs text-muted-foreground capitalize">{c}</p>
                        <p className="text-base font-bold text-foreground mt-0.5">
                          {formatINRExact(p.amountInr)}
                          <span className="text-xs font-normal text-muted-foreground">
                            /{c === "yearly" ? "yr" : "mo"}
                          </span>
                        </p>
                        {c === "yearly" && savingPct > 0 && (
                          <p className="text-[11px] text-emerald-600 font-medium mt-0.5">Save {savingPct}%</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Price summary */}
              <div className="bg-accent/30 rounded-xl p-4">
                <p className="text-sm text-muted-foreground">
                  {cycle === "yearly" ? "Annual subscription" : "Monthly subscription"}
                </p>
                <p className="text-2xl font-bold text-foreground mt-0.5">
                  {formatINRExact(price.amountInr)}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{cycle === "yearly" ? "year" : "month"}
                  </span>
                </p>
                {price.amountInr < price.listInr && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    <span className="line-through">{formatINRExact(price.listInr)}</span>
                    <span className="text-emerald-600 ml-1.5 font-medium">
                      {price.source === "override" ? "negotiated rate" : `${price.appliedCouponPct}% off`}
                    </span>
                  </p>
                )}
                {/* Bed-fee itemisation: a hospital must see WHY its price is
                    what it is before authorising the mandate. */}
                {price.bedBlocks > 0 && (
                  <div className="text-xs text-muted-foreground mt-1.5 space-y-0.5 border-t border-border/60 pt-1.5">
                    <p>
                      Base ({plan.beds_included} beds included): <span className="font-medium text-foreground">{formatINRExact(price.baseInr)}</span>
                    </p>
                    <p>
                      {activeBeds} active beds → {price.bedBlocks} × {plan.bed_block_size ?? 10}-bed block: <span className="font-medium text-foreground">+{formatINRExact(price.bedFeeInr)}</span>
                    </p>
                  </div>
                )}
                <p className="text-[11px] text-muted-foreground mt-1">Inclusive of 18% GST</p>
              </div>

              {/* Coupon code */}
              <div>
                <Label className="text-sm text-foreground flex items-center gap-2">
                  <Tag size={13} />
                  Have a coupon code?
                </Label>
                <div className="relative mt-1.5">
                  <Input
                    value={couponCode}
                    onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                    placeholder="e.g. LAUNCH50"
                    className="pr-8 font-mono uppercase"
                    disabled={loading}
                  />
                  {validating && (
                    <Loader2 size={13} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-muted-foreground" />
                  )}
                </div>
                {couponResult && (
                  <p className={`text-xs mt-1.5 flex items-center gap-1.5 ${couponResult.valid ? "text-emerald-600" : "text-destructive"}`}>
                    {couponResult.valid
                      ? <CheckCircle2 size={12} />
                      : <AlertTriangle size={12} />
                    }
                    {couponResult.message}
                  </p>
                )}
              </div>

              {/* RBI compliance note */}
              <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg px-4 py-3 text-xs text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-semibold">Recurring Payment — RBI e-Mandate</p>
                <p>You will authenticate a UPI/card mandate during checkout. Aumrti will send a 72-hour advance notification before each {cycle === "yearly" ? "annual" : "monthly"} charge. Cancel anytime from your plan settings.</p>
              </div>

              {/* Subscribe button */}
              <Button
                className="w-full h-12 text-[15px] font-semibold"
                onClick={handleSubscribe}
                disabled={loading || (!!couponCode && !couponResult?.valid)}
              >
                {loading ? (
                  <><Loader2 size={16} className="mr-2 animate-spin" /> Opening Payment…</>
                ) : (
                  <>Proceed to Payment — {formatINRExact(price.amountInr)}/{cycle === "yearly" ? "yr" : "mo"}</>
                )}
              </Button>

              <p className="text-center text-[11px] text-muted-foreground">
                Secured by Razorpay · PCI-DSS compliant · Cancel anytime
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
