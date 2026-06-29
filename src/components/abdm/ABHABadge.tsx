import React from "react";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  abhaNumber?: string | null;
  abhaAddress?: string | null;
  /** "sm" fits inside compact cards; "md" for headers and drawers */
  size?: "sm" | "md";
  /** When provided, renders an orange "Link ABHA" call-to-action instead of the grey placeholder */
  onLinkClick?: () => void;
  className?: string;
}

/**
 * Reusable ABHA linkage status indicator.
 *
 * - Linked   → green ShieldCheck badge with ABHA number
 * - Not linked + onLinkClick → orange "Link ABHA" action button
 * - Not linked, no handler   → subtle grey "No ABHA" chip
 */
const ABHABadge: React.FC<Props> = ({
  abhaNumber,
  abhaAddress,
  size = "sm",
  onLinkClick,
  className,
}) => {
  const linked = !!(abhaNumber || abhaAddress);

  const display = abhaNumber
    ? abhaNumber.replace(/(\d{2})(\d{4})(\d{4})(\d{4})/, "$1-$2-$3-$4")
    : abhaAddress ?? "";

  if (linked) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-semibold bg-emerald-100 text-emerald-700 border border-emerald-200",
          size === "sm" ? "text-[9px] px-1.5 py-px" : "text-xs px-2 py-0.5",
          className,
        )}
      >
        <ShieldCheck className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
        {size === "sm" ? "ABHA ✓" : `ABHA: ${display}`}
      </span>
    );
  }

  if (onLinkClick) {
    return (
      <button
        type="button"
        onClick={onLinkClick}
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors",
          size === "sm" ? "text-[9px] px-1.5 py-px" : "text-xs px-2 py-0.5",
          className,
        )}
      >
        <ShieldAlert className={size === "sm" ? "h-2.5 w-2.5" : "h-3 w-3"} />
        Link ABHA
      </button>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full font-medium bg-slate-100 text-slate-400 border border-slate-200",
        size === "sm" ? "text-[9px] px-1.5 py-px" : "text-xs px-2 py-0.5",
        className,
      )}
    >
      No ABHA
    </span>
  );
};

export default ABHABadge;
