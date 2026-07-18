import { Clock, AlertTriangle, XCircle, X } from "lucide-react";
import { useState } from "react";
import { useSubscriptionConfig } from "@/hooks/useSubscriptionConfig";
import { useNavigate, useLocation } from "react-router-dom";

const DISMISS_KEY = "trialBannerDismissedOn";

/** Local calendar day as YYYY-MM-DD (used to reset the dismissal each day). */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Shows a dismissable sticky banner on the hospital main Dashboard (/dashboard) when:
 *   - Trial has ≤ 7 days left
 *   - Trial has expired
 *   - Account is suspended or past_due
 *
 * Rendered from AppShell but only visible on /dashboard. Dismissing it hides the
 * banner until the next calendar day (persisted in localStorage).
 * It renders nothing when the account is in good standing.
 */
export default function TrialBanner() {
  const { status, trialDaysLeft, isExpired, isSuspended, isLoading } = useSubscriptionConfig();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === todayKey()
  );

  // Only surface on the hospital main Dashboard, not on every module screen.
  if (pathname !== "/dashboard") return null;

  if (isLoading || dismissed) return null;

  // Nothing to show for healthy active subscriptions
  if (status === "active") return null;

  // No subscription at all (new hospital, no plan assigned yet) — silent
  if (status === "no_subscription") return null;

  // Trial with plenty of time left — no banner
  if (status === "trial" && trialDaysLeft !== null && trialDaysLeft > 7) return null;

  // Determine banner variant
  let variant: "warning" | "error" | "info" = "info";
  let icon = <Clock size={15} className="shrink-0" />;
  let message = "";
  let sub = "";
  let ctaLabel = "View Plan";

  if (isExpired) {
    variant = "error";
    icon = <XCircle size={15} className="shrink-0" />;
    message = "Your trial has expired.";
    sub = "Contact support to activate your subscription and restore full access.";
    ctaLabel = "Contact Support";
  } else if (isSuspended) {
    variant = "error";
    icon = <AlertTriangle size={15} className="shrink-0" />;
    message = status === "past_due" ? "Payment overdue." : "Account suspended.";
    sub = "Please clear outstanding dues to restore access.";
    ctaLabel = "Contact Support";
  } else if (status === "trial" && trialDaysLeft !== null) {
    if (trialDaysLeft === 0) {
      variant = "error";
      icon = <XCircle size={15} className="shrink-0" />;
      message = "Your trial ends today.";
      sub = "Upgrade now to keep access to all modules.";
      ctaLabel = "Upgrade Now";
    } else if (trialDaysLeft <= 3) {
      variant = "error";
      icon = <AlertTriangle size={15} className="shrink-0" />;
      message = `Trial ends in ${trialDaysLeft} day${trialDaysLeft !== 1 ? "s" : ""}.`;
      sub = "Upgrade to avoid interruption.";
      ctaLabel = "Upgrade Now";
    } else {
      variant = "warning";
      icon = <Clock size={15} className="shrink-0" />;
      message = `${trialDaysLeft} days left in your free trial.`;
      sub = "Upgrade anytime from Settings → Plan & Billing.";
      ctaLabel = "View Plans";
    }
  }

  if (!message) return null;

  const BG: Record<string, string> = {
    error:   "bg-red-600",
    warning: "bg-amber-500",
    info:    "bg-blue-600",
  };

  const handleCta = () => {
    if (ctaLabel === "Contact Support") {
      window.open("mailto:support@aumrti.in?subject=Subscription query");
    } else {
      navigate("/settings/plan");
    }
  };

  return (
    <div className={`fixed top-14 left-0 right-0 z-40 ${BG[variant]} text-white text-xs flex items-center gap-3 px-5 py-2`}>
      {icon}
      <span className="font-semibold">{message}</span>
      {sub && <span className="text-white/80 hidden sm:inline">{sub}</span>}
      <button
        onClick={handleCta}
        className="ml-auto underline underline-offset-2 font-semibold whitespace-nowrap hover:no-underline transition-all"
      >
        {ctaLabel}
      </button>
      <button
        onClick={() => {
          localStorage.setItem(DISMISS_KEY, todayKey());
          setDismissed(true);
        }}
        className="text-white/70 hover:text-white transition-colors ml-1"
        aria-label="Dismiss"
      >
        <X size={13} />
      </button>
    </div>
  );
}
