import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useHospitalId } from "@/hooks/useHospitalId";
import { useSubscriptionConfig } from "@/hooks/useSubscriptionConfig";
import { Loader2, CreditCard, Tag, X, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

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
  is_custom_price: boolean;
  razorpay_plan_id: string | null;
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

  const effectivePrice = couponResult?.valid && couponResult.pct > 0
    ? plan.price_monthly * (1 - couponResult.pct / 100)
    : plan.price_monthly;

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
        description: `${plan_name} — Monthly Subscription`,
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

  // Plan has no Razorpay plan ID configured yet
  if (!plan.razorpay_plan_id) {
    return (
      <Button
        variant="outline"
        className={className}
        onClick={() => window.open(`mailto:support@aumrti.in?subject=Activate ${plan.name} Plan`)}
      >
        <CreditCard size={14} className="mr-2" />
        {label || `Subscribe to ${plan.name}`}
      </Button>
    );
  }

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
              {/* Price summary */}
              <div className="bg-accent/30 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Monthly subscription</p>
                  <p className="text-2xl font-bold text-foreground mt-0.5">
                    ₹{Math.round(effectivePrice).toLocaleString("en-IN")}
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  </p>
                  {couponResult?.valid && couponResult.pct > 0 && (
                    <p className="text-xs text-emerald-600 mt-0.5 line-through text-muted-foreground">
                      Was ₹{plan.price_monthly.toLocaleString("en-IN")}/month
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Yearly (2 months free)</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">
                    ₹{Math.round(effectivePrice * 10).toLocaleString("en-IN")}/year
                  </p>
                </div>
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
                <p>You will authenticate a UPI/card mandate during checkout. Aumrti will send a 72-hour advance notification before each monthly charge. Cancel anytime from your plan settings.</p>
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
                  <>Proceed to Payment — ₹{Math.round(effectivePrice).toLocaleString("en-IN")}/mo</>
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
