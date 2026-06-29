import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Clock, ShieldCheck } from "lucide-react";

type PaymentStatus = "pending_payment" | "paid" | "advance_covered" | "waived" | "insurance_auth" | null | undefined;

interface PaymentGateProps {
  paymentStatus: PaymentStatus;
  amount?: number;
  onRequestPayment?: () => void;
  compact?: boolean;
}

const STATUS_CONFIG = {
  paid:             { label: "Paid",             icon: CheckCircle2, variant: "default"     as const, color: "text-emerald-600", bg: "bg-emerald-50 border-emerald-200" },
  advance_covered:  { label: "Advance",          icon: ShieldCheck,  variant: "secondary"   as const, color: "text-blue-600",    bg: "bg-blue-50 border-blue-200" },
  waived:           { label: "Waived",           icon: CheckCircle2, variant: "secondary"   as const, color: "text-gray-600",    bg: "bg-gray-50 border-gray-200" },
  insurance_auth:   { label: "Insurance Auth",   icon: ShieldCheck,  variant: "secondary"   as const, color: "text-purple-600", bg: "bg-purple-50 border-purple-200" },
  pending_payment:  { label: "Payment Pending",  icon: AlertCircle,  variant: "destructive" as const, color: "text-red-600",    bg: "bg-red-50 border-red-200" },
};

/** Returns true if the service is cleared to proceed (payment not blocking). */
export function isPaymentCleared(status: PaymentStatus): boolean {
  return status === "paid" || status === "advance_covered" || status === "waived" || status === "insurance_auth";
}

/**
 * Shows payment status badge. In compact mode just a coloured badge.
 * In full mode shows a "Collect Payment" action button when pending.
 */
export default function PaymentGate({ paymentStatus, amount, onRequestPayment, compact = false }: PaymentGateProps) {
  const status = paymentStatus || "pending_payment";
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.pending_payment;
  const Icon = cfg.icon;
  const cleared = isPaymentCleared(status);

  if (compact) {
    return (
      <Badge variant={cfg.variant} className="text-xs gap-1">
        <Icon className="h-3 w-3" />
        {cfg.label}
      </Badge>
    );
  }

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${cfg.bg}`}>
      <Icon className={`h-4 w-4 shrink-0 ${cfg.color}`} />
      <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
      {amount != null && amount > 0 && (
        <span className="text-muted-foreground ml-1">₹{amount.toLocaleString("en-IN")}</span>
      )}
      {!cleared && onRequestPayment && (
        <Button size="sm" variant="destructive" className="ml-auto h-7 text-xs" onClick={onRequestPayment}>
          <Clock className="h-3 w-3 mr-1" /> Collect Payment
        </Button>
      )}
    </div>
  );
}
