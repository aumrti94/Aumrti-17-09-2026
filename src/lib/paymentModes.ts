/**
 * Payment mode options shared by the billing, OPD and patient-registration forms.
 * Lifted out of CollectPaymentForm.tsx so that file exports only its component —
 * a file mixing component and non-component exports silently disables Fast
 * Refresh for it.
 */
export const PAYMENT_MODES = [
  { value: "cash", label: "💵 Cash" },
  { value: "upi", label: "📱 UPI" },
  { value: "card", label: "💳 Card" },
  { value: "net_banking", label: "🌐 Net Banking" },
  { value: "cheque", label: "💳 Cheque" },
  { value: "insurance", label: "🏥 Insurance" },
  { value: "pmjay", label: "🏥 PMJAY / Govt Scheme" },
  { value: "advance_adjust", label: "🔄 Advance Adjust" },
];
