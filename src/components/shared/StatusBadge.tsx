import React from "react";
import { cn } from "@/lib/utils";

const STATUS_CONFIG: Record<string, { bg: string; text: string; label?: string }> = {
  // Patient/Appointment statuses
  active:          { bg: "bg-emerald-100", text: "text-emerald-700" },
  inactive:        { bg: "bg-slate-100",   text: "text-slate-600" },
  waiting:         { bg: "bg-amber-100",   text: "text-amber-700" },
  in_consultation: { bg: "bg-blue-100",    text: "text-blue-700" },
  called:          { bg: "bg-amber-100",   text: "text-amber-800" },
  completed:       { bg: "bg-slate-100",   text: "text-slate-500" },
  cancelled:       { bg: "bg-red-100",     text: "text-red-600" },
  no_show:         { bg: "bg-slate-100",   text: "text-slate-500" },
  // Lab/Radiology
  ordered:         { bg: "bg-blue-100",    text: "text-blue-700" },
  collected:       { bg: "bg-purple-100",  text: "text-purple-700" },
  processing:      { bg: "bg-amber-100",   text: "text-amber-700" },
  resulted:        { bg: "bg-emerald-100", text: "text-emerald-700" },
  reported:        { bg: "bg-emerald-100", text: "text-emerald-700" },
  // IPD/Admission
  admitted:        { bg: "bg-blue-100",    text: "text-blue-700" },
  discharged:      { bg: "bg-slate-100",   text: "text-slate-500" },
  // Billing
  draft:           { bg: "bg-slate-100",   text: "text-slate-600" },
  finalised:       { bg: "bg-emerald-100", text: "text-emerald-700" },
  paid:            { bg: "bg-emerald-100", text: "text-emerald-700" },
  partial:         { bg: "bg-amber-100",   text: "text-amber-700" },
  pending:         { bg: "bg-amber-100",   text: "text-amber-700" },
  overdue:         { bg: "bg-red-100",     text: "text-red-600" },
  // Priority/urgency
  routine:         { bg: "bg-slate-100",   text: "text-slate-600" },
  urgent:          { bg: "bg-amber-100",   text: "text-amber-700" },
  stat:            { bg: "bg-red-100",     text: "text-red-700" },
  emergency:       { bg: "bg-red-100",     text: "text-red-700" },
  critical:        { bg: "bg-red-100",     text: "text-red-700" },
  // Insurance / TPA
  intimated:        { bg: "bg-emerald-100", text: "text-emerald-700" },
  not_intimated:    { bg: "bg-red-100",     text: "text-red-600",   label: "Not Intimated" },
  late_intimation:  { bg: "bg-amber-100",   text: "text-amber-700", label: "Late — Intimate Now" },
  preauth_expiring: { bg: "bg-amber-100",   text: "text-amber-700", label: "Expiring Soon" },
  preauth_expired:  { bg: "bg-red-100",     text: "text-red-600",   label: "Pre-Auth Expired" },
  resubmitted:      { bg: "bg-blue-100",    text: "text-blue-700" },
  irdai_overdue:    { bg: "bg-red-100",     text: "text-red-700",   label: "IRDAI Overdue" },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const key = status?.toLowerCase() ?? "";
  const config = STATUS_CONFIG[key] ?? { bg: "bg-slate-100", text: "text-slate-600" };
  const label = config.label ?? (status?.replace(/_/g, " ") ?? "Unknown");
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[13px] font-medium capitalize",
        config.bg,
        config.text,
        className
      )}
    >
      {label}
    </span>
  );
};

export default StatusBadge;
