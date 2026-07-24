/**
 * Plan picker for the "Upgrade Now" / "Reactivate" calls to action.
 *
 * These buttons used to open `mailto:support@aumrti.in` — every one of them, on
 * every banner. A hospital that wanted to pay had no way to do so from the
 * product. They now open this, which reuses SubscribeButton (and therefore the
 * real Razorpay checkout, the monthly/yearly toggle, and the shared price
 * resolver) rather than reimplementing any of it.
 *
 * A suspended or past-due account also lands here rather than on
 * change-subscription-plan: a lapsed mandate cannot be "changed", it needs a
 * fresh authorisation, which is exactly what the subscribe flow does.
 */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { X, Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import SubscribeButton from "./SubscribeButton";
import { formatINRExact } from "@/lib/currency";
import { useHospitalId } from "@/hooks/useHospitalId";
import { resolveEffectivePrice } from "@/lib/platformBilling";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Highlighted as "current" and not offered as an upgrade target. */
  currentPlanId?: string | null;
  title?: string;
  subtitle?: string;
}

export default function UpgradeDialog({
  open,
  onClose,
  currentPlanId,
  title = "Choose your plan",
  subtitle = "Activate a paid subscription to keep full access.",
}: Props) {
  const { hospitalId } = useHospitalId();

  // The card price must include the bed fee, because that is what checkout will
  // charge. Quoting the plan's base here while SubscribeButton bills base + bed
  // blocks is exactly the display-vs-charge divergence the shared resolver
  // exists to prevent.
  const { data: activeBeds = null } = useQuery({
    queryKey: ["upgrade-dialog-beds", hospitalId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("current_active_beds", { p_hospital_id: hospitalId });
      return typeof data === "number" ? data : null;
    },
    enabled: open && !!hospitalId,
    staleTime: 5 * 60_000,
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["upgrade-dialog-plans"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("subscription_plans")
        .select("id, name, slug, price_monthly, price_yearly, is_custom_price, badge_text, description, razorpay_plan_id, max_beds, beds_included, bed_block_size, price_per_bed_block, price_per_bed_block_yearly")
        .eq("is_active", true)
        .order("sort_order");
      return data || [];
    },
    enabled: open,
    staleTime: 5 * 60_000,
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-2xl w-full max-w-3xl max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between px-6 py-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <p className="text-base font-bold text-foreground">{title}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 grid gap-4 sm:grid-cols-2">
          {plans.map((p: any) => {
            const isCurrent = p.id === currentPlanId;
            // Same resolver the edge function binds the Razorpay plan with.
            const monthly = resolveEffectivePrice({ plan: p, cycle: "monthly", activeBeds });
            const yearly  = resolveEffectivePrice({ plan: p, cycle: "yearly",  activeBeds });
            return (
              <div
                key={p.id}
                className={`rounded-xl border p-4 flex flex-col ${
                  isCurrent ? "border-primary/50 bg-primary/5" : "border-border"
                }`}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-foreground">{p.name}</p>
                  {p.badge_text && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                      {p.badge_text}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-border text-muted-foreground font-medium ml-auto">
                      Current
                    </span>
                  )}
                </div>

                <p className="text-xl font-bold text-foreground mt-2">
                  {p.is_custom_price ? "Custom" : formatINRExact(monthly.amountInr)}
                  {!p.is_custom_price && <span className="text-xs font-normal text-muted-foreground">/mo</span>}
                </p>
                {!p.is_custom_price && yearly.available && (
                  <p className="text-[11px] text-muted-foreground">
                    or {formatINRExact(yearly.amountInr)}/year
                  </p>
                )}
                {monthly.bedBlocks > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {formatINRExact(monthly.baseInr)} base + {monthly.bedBlocks} × {p.bed_block_size ?? 10}-bed block
                    {" "}for your {activeBeds} beds
                  </p>
                )}

                {p.description && (
                  <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{p.description}</p>
                )}
                {p.price_per_bed_block != null ? (
                  <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Check size={11} className="text-emerald-600" /> Includes {p.beds_included} beds
                  </p>
                ) : p.max_beds != null && (
                  <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                    <Check size={11} className="text-emerald-600" /> Up to {p.max_beds} beds
                  </p>
                )}

                <div className="mt-4 pt-3 border-t border-border">
                  {p.is_custom_price ? (
                    // Enterprise genuinely is a sales conversation, so this one
                    // mailto stays.
                    <Button
                      variant="outline"
                      className="w-full gap-2"
                      onClick={() => window.open("mailto:support@aumrti.in?subject=Enterprise Plan Enquiry")}
                    >
                      <Mail size={14} /> Contact Sales
                    </Button>
                  ) : (
                    <SubscribeButton
                      plan={p}
                      className="w-full"
                      label={isCurrent ? `Renew ${p.name}` : `Choose ${p.name}`}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
